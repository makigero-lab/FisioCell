/**
 * Modelo: Paciente
 * Representa um paciente de uma clínica (empresa).
 *
 * F2 — Novo modelo do domínio Fisioterapia.
 *
 *   - Paciente NÃO faz login (não é Utilizador). É gerido pela clínica.
 *   - Soft delete (eliminado_em) para preservar histórico clínico (RGPD).
 *   - Dados clínicos sensíveis (historico_medico, alergias) têm acesso
 *     restrito a fisioterapeuta + diretor_clinico (isClinico).
 *   - Consentimento RGPD obrigatório (consentimento_dados).
 *
 * O load balancer e os controllers usam empresa_id para scoping multi-tenant.
 */
const mongoose = require('mongoose');

const pacienteSchema = new mongoose.Schema(
  {
    empresa_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empresa',
      required: true,
      index: true,
    },
    // ═══ Dados demográficos (RGPD: mínimo necessário) ═══
    nome: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    data_nascimento: {
      type: Date,
      default: null,
      index: true,
    },
    genero: {
      type: String,
      enum: ['M', 'F', 'Outro', 'NA'],
      default: 'NA',
    },
    // Nº de Utente de Saúde (SNS) — para futuras integrações com Saúde 24.
    num_utente: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    nif: {
      type: String,
      trim: true,
      default: '',
    },

    // ═══ Contactos ═══
    telefone: {
      type: String,
      trim: true,
      required: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: '',
    },
    morada: {
      type: String,
      trim: true,
      default: '',
    },

    // ═══ Dados clínicos (acesso restrito a isClinico) ═══
    contacto_emergencia: {
      nome: { type: String, default: '' },
      telefone: { type: String, default: '' },
      relacao: { type: String, default: '' }, // "Filho", "Cônjuge", etc.
    },
    // Histórico médico relevante (alergias, patologias, medicação).
    historico_medico: {
      type: String,
      default: '',
    },
    alergias: {
      type: [String],
      default: [],
    },

    // ═══ Consentimentos (RGPD — obrigatório em saúde) ═══
    consentimento_dados: {
      concedido: {
        type: Boolean,
        default: false,
      },
      data: {
        type: Date,
        default: null,
      },
      versao_termos: {
        type: String,
        default: '1.0',
      },
    },

    // ═══ Estado ═══
    ativo: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Soft delete (RGPD: direito ao esquecimento, mas preserva histórico).
    eliminado_em: {
      type: Date,
      default: null,
      index: true,
    },

    // ═══ Metadados ═══
    observacoes: {
      type: String,
      default: '',
      trim: true,
    },
    origem: {
      type: String,
      enum: ['walk_in', 'referenciacao', 'online', 'outro'],
      default: 'walk_in',
    },
  },
  { timestamps: true }
);

// Índices compostos para queries frequentes.
pacienteSchema.index({ empresa_id: 1, nome: 1 });
pacienteSchema.index({ empresa_id: 1, num_utente: 1 });
pacienteSchema.index({ empresa_id: 1, ativo: 1, eliminado_em: 1 });

module.exports = mongoose.model('Paciente', pacienteSchema);
