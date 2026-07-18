/**
 * Modelo: Utilizador
 * Representa um utilizador do sistema dentro de uma empresa (Clínica).
 *
 * F1 — Roles migrados para o domínio Fisioterapia:
 *   - admin             → Super Admin da plataforma (cross-tenant, NÃO vê
 *                         dados clínicos por RGPD — princípio do minimizar).
 *   - diretor_clinico   → Diretor Clínico (acesso TOTAL à clínica; pode
 *                         atender pacientes; aprova ausências; gere equipa).
 *   - fisioterapeuta    → Fisioterapeuta (vê SÓ os seus pacientes/consultas;
 *                         regista notas SOAP; pede férias/ausências).
 *   - rececionista      → Rececionista (gere marcações de TODOS; vê dados
 *                         admin do paciente; NÃO vê notas clínicas — RGPD).
 *
 * Autenticação:
 *   - `email` é único (índice único) — serve de credencial de login.
 *   - `password_hash` guarda a hash bcrypt da password (nunca a password em claro).
 *
 * O load balancer (utils/loadBalancer.js) considera utilizadores com role
 * "fisioterapeuta" e ativos=true para atribuição de tarefas/consultas.
 */
const mongoose = require('mongoose');

const utilizadorSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },
    // Telemóvel para envio de notificações (Daily Briefing, lembretes).
    // Formato internacional (ex.: +351912345678).
    telefone: {
      type: String,
      trim: true,
      default: '',
    },
    // Hash bcrypt da password. Nunca armazenar a password em claro.
    password_hash: {
      type: String,
      // Não é `required` para permitir migrar utilizadores existentes sem
      // password (que terão de a definir depois). O login recusa se vazio.
    },
    empresa_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empresa',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['admin', 'diretor_clinico', 'fisioterapeuta', 'rececionista'],
      default: 'rececionista',
      required: true,
      index: true,
    },
    // Superior hierárquico (responsável) do utilizador.
    // Referência a outro Utilizador (normalmente role 'diretor_clinico').
    // O admin não tem responsavel_id (topo da hierarquia).
    responsavel_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Utilizador',
      default: null,
      index: true,
    },
    ativo: {
      type: Boolean,
      default: true,
    },
    // Folgas fixas semanais: array de dias da semana (0=Dom, 1=Seg, ..., 6=Sáb).
    // O load balancer exclui automaticamente o fisioterapeuta cujo dia da
    // semana da consulta está neste array (não precisa de marcar ausência manual).
    dias_folga: {
      type: [Number],
      default: [],
      validate: {
        validator: function (arr) {
          return arr.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
        },
        message: 'dias_folga: valores devem ser inteiros entre 0 (Dom) e 6 (Sáb).',
      },
    },
    // Soft delete: em vez de remover o utilizador da BD (o que deixaria
    // Tarefas/Consultas antigas com utilizador_id órfão), marca-se a data
    // de eliminação. Utilizadores com eliminado_em !== null são excluídos
    // das queries normais.
    eliminado_em: {
      type: Date,
      default: null,
      index: true,
    },
    // Notificações Push (Web Push API).
    // Subscrição gerada pelo browser (Service Worker) via PushManager.subscribe().
    // Guarda o objeto PushSubscription completo (endpoint + keys.p256dh + keys.auth).
    // Null = ainda não subscreveu. Se expirar (410 Gone), volta a null.
    pushSubscription: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // F1 — Perfil profissional (só faz sentido para fisioterapeuta/diretor_clinico).
    // Para admin/rececionista fica vazio.
    perfil_profissional: {
      // Nº de cédula da Ordem dos Fisioterapeutas (obrigatório para exercício
      // legal em PT). String livre — formato pode variar.
      cedula: {
        type: String,
        trim: true,
        default: '',
      },
      // Especialidades clínicas (ex.: "Desporto", "Neurologia", "Pediatria").
      especialidades: {
        type: [String],
        default: [],
      },
      // Bio curta para mostrar no perfil público da clínica (futuro portal paciente).
      biografia: {
        type: String,
        default: '',
        trim: true,
      },
      // Cor para o calendário (cada fisioterapeuta tem a sua cor nos blocos).
      // Hex string. Default azul shadcn.
      cor_calendario: {
        type: String,
        default: '#3b82f6',
      },
      // Pode estar de férias/inativo clinicamente mas ativo no sistema.
      // ativo_clinico=false impede novas marcações mas mantém o histórico.
      ativo_clinico: {
        type: Boolean,
        default: true,
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Utilizador', utilizadorSchema);
