/**
 * Modelo: Consulta
 *
 * F4 — Substitui Tarefa para o domínio Fisioterapia.
 *
 * Representa uma marcação/sessão de fisioterapia com 3 eixos:
 *   - fisioterapeuta_id (quem atende)
 *   - sala_id (onde — Propriedade alias Sala até F8)
 *   - paciente_id (a quem)
 *
 * Validação de conflitos (no controller, ao criar/atualizar):
 *   1. Fisioterapeuta disponível (motor F3: ausência + folga + horário)
 *   2. Sala sem sobreposição (outra Consulta na mesma sala + intervalo)
 *   3. Fisioterapeuta sem sobreposição (outra Consulta com o mesmo fisio + intervalo)
 *   4. Paciente sem sobreposição (não pode ter 2 consultas em paralelo)
 *
 * Nota clínica SOAP (snapshot imutável após conclusão — RGPD/legal).
 */
const mongoose = require('mongoose');

const consultaSchema = new mongoose.Schema(
  {
    empresa_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empresa',
      required: true,
      index: true,
    },
    // Onde — Propriedade (alias Sala até F8).
    sala_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Propriedade',
      required: true,
      index: true,
    },
    // Quem atende — fisioterapeuta ou diretor_clinico.
    fisioterapeuta_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Utilizador',
      required: true,
      index: true,
    },
    // A quem — paciente.
    paciente_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Paciente',
      required: true,
      index: true,
    },

    // ═══ Marcação temporal ═══
    data_hora_inicio: {
      type: Date,
      required: true,
      index: true,
    },
    data_hora_fim: {
      type: Date,
      required: true,
    },
    duracao_minutos: {
      type: Number,
      required: true,
      default: 45,
      min: 15,
    },

    // ═══ Tipo e estado ═══
    tipo: {
      type: String,
      enum: ['primeira_consulta', 'sessao', 'reavaliacao', 'alta', 'grupo'],
      default: 'sessao',
      index: true,
    },
    estado: {
      type: String,
      enum: ['marcada', 'confirmada', 'em_curso', 'concluida', 'cancelada', 'faltou', 'nao_compareceu'],
      default: 'marcada',
      index: true,
    },
    motivo_cancelamento: {
      type: String,
      enum: ['paciente', 'clinica', 'fisio', 'outro'],
      default: null,
    },
    // Estado de presença (preenchido pela rececionista no momento).
    presenca: {
      type: String,
      enum: ['pendente', 'presente', 'ausente', 'atrasado'],
      default: 'pendente',
    },

    // ═══ Nota clínica (SOAP) — snapshot imutável após conclusão ═══
    // Preenchida pelo fisioterapeuta durante/após a sessão.
    // Uma vez concluída a consulta, torna-se read-only (RGPD/legal).
    nota_clinica: {
      // S — Subjetivo: queixas do paciente.
      subjetivo: { type: String, default: '' },
      // O — Objetivo: observação/exame físico.
      objetivo: { type: String, default: '' },
      // A — Avaliação: diagnóstico clínico.
      avaliacao: { type: String, default: '' },
      // P — Plano: plano de tratamento.
      plano: { type: String, default: '' },
      // O que foi feito nesta sessão (tratamento efetuado).
      tratamento_efetuado: { type: String, default: '' },
      // Protocolo aplicado (snapshot de ModeloProtocolo — futuro F5).
      protocolo_aplicado: [
        {
          nome: { type: String, required: true },
          items: [{ texto: String, concluido: Boolean }],
        },
      ],
      // F4 — Cédula do fisioterapeuta que assinou a nota (snapshot para
      // auditoria legal — garante que quem assinou tinha cédula válida).
      cedula_assinante: { type: String, default: '' },
    },

    // ═══ Auditoria da marcação ═══
    criada_por: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Utilizador',
      required: true,
    },
    concluida_em: {
      type: Date,
      default: null,
    },
    cancelada_em: {
      type: Date,
      default: null,
    },
    cancelada_por: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Utilizador',
      default: null,
    },

    // ═══ Lembretes (enviados/notificados) ═══
    lembrete_24h_enviado: {
      type: Boolean,
      default: false,
    },
    lembrete_2h_enviado: {
      type: Boolean,
      default: false,
    },

    // Observações admin (não clínicas).
    observacoes: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

// Índices compostos para queries frequentes e validação de conflitos.
consultaSchema.index({ empresa_id: 1, fisioterapeuta_id: 1, data_hora_inicio: 1 });
consultaSchema.index({ empresa_id: 1, sala_id: 1, data_hora_inicio: 1 });
consultaSchema.index({ empresa_id: 1, paciente_id: 1, data_hora_inicio: -1 });
consultaSchema.index({ estado: 1, data_hora_inicio: 1 });

module.exports = mongoose.model('Consulta', consultaSchema);
