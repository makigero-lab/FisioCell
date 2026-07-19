/**
 * Modelo: Empresa (Clínica)
 * Representa a entidade principal do SaaS multi-tenant FisioCell.
 * Cada empresa agrupa Salas, Utilizadores e Consultas.
 *
 * F0: Removido smoobu_api_key (integração Smoobu eliminada).
 *     Adicionados campos de clínica: morada, telefone, email.
 * F1: Adicionado bloco `config` (horário padrão, duração consulta, fuso).
 */
const mongoose = require('mongoose');

const empresaSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    nif: {
      type: String,
      trim: true,
    },
    plano_ativo: {
      type: Boolean,
      default: true,
    },
    // Prompt 116 — Estado da empresa (SaaS). Quando `false`:
    //   - o login é bloqueado para todos os utilizadores desta empresa.
    // Diferente de `plano_ativo` (que é informativo/comercial) — `ativa`
    // é o bloqueio operacional efetivo.
    ativa: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Prompt 122 — Soft Delete (Lixeira de Empresas). Quando `true`:
    //   - a empresa desaparece da aba "Ativas" e aparece na "Reciclagem";
    //   - `ativa` é forçada para false (bloqueia login);
    //   - pode ser restaurada via PATCH /api/admin/empresas/:id/restaurar.
    // Não apaga fisicamente — preserva os dados para auditoria/restauro.
    apagada: {
      type: Boolean,
      default: false,
      index: true,
    },
    // F0 — Dados da clínica (substituem o antigo smoobu_api_key).
    morada: {
      type: String,
      default: '',
      trim: true,
    },
    telefone: {
      type: String,
      default: '',
      trim: true,
    },
    email: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
    },
    logo_url: {
      type: String,
      default: '',
      trim: true,
    },
    // F1 — Configuração operacional da clínica.
    config: {
      // Horário padrão de funcionamento da clínica (regra semanal recorrente).
      // Cada item: { dia_semana: 0-6, abertura: "HH:mm", fecho: "HH:mm" }
      // 0=Dom, 1=Seg, ..., 6=Sáb. Array vazio = sem horário definido.
      horario_padrao: {
        type: [
          {
            dia_semana: {
              type: Number,
              min: 0,
              max: 6,
              required: true,
            },
            abertura: { type: String, default: '09:00' },
            fecho: { type: String, default: '19:00' },
          },
        ],
        default: [],
      },
      // Duração padrão de uma consulta em minutos (mín. 15).
      duracao_consulta_padrao: {
        type: Number,
        default: 45,
        min: 15,
      },
      // Tolerância de atraso do paciente em minutos (antes de marcar como "atrasado").
      tolerancia_atraso_min: {
        type: Number,
        default: 10,
        min: 0,
      },
      // Fuso horário da clínica (para o calendário e lembretes).
      fuso_horario: {
        type: String,
        default: 'Europe/Lisbon',
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Empresa', empresaSchema);
