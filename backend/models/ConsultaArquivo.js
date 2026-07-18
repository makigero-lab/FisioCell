/**
 * Modelo: ConsultaArquivo
 *
 * F7 — Cópia exata do schema da Consulta, usada para arquivar consultas
 * concluídas ou canceladas com mais de 6 meses. Mantém todos os dados
 * (incluindo nota clínica SOAP) para auditoria legal/RGPD, mas fora da
 * coleção principal para garantir a performance do calendário e queries.
 *
 * Campo extra:
 *   - arquivado_em: data em que a consulta foi movida para o arquivo.
 *
 * Nota: as notas clínicas SOAP são preservadas indefinitely (RGPD —
 * obrigações de retenção de dados clínicos: tipicamente 10-20 anos).
 */
const mongoose = require('mongoose');

const consultaArquivoSchema = new mongoose.Schema(
  {
    // Metadados do arquivo.
    arquivado_em: {
      type: Date,
      default: Date.now,
    },
    // Campos originais da Consulta (mesmo schema).
    empresa_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    sala_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Propriedade', required: true, index: true },
    fisioterapeuta_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Utilizador', required: true, index: true },
    paciente_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Paciente', required: true, index: true },
    data_hora_inicio: { type: Date, required: true, index: true },
    data_hora_fim: { type: Date, required: true },
    duracao_minutos: { type: Number, required: true, default: 45, min: 15 },
    tipo: { type: String, enum: ['primeira_consulta', 'sessao', 'reavaliacao', 'alta', 'grupo'], default: 'sessao' },
    estado: {
      type: String,
      enum: ['marcada', 'confirmada', 'em_curso', 'concluida', 'cancelada', 'faltou', 'nao_compareceu'],
      default: 'marcada',
    },
    motivo_cancelamento: { type: String, enum: ['paciente', 'clinica', 'fisio', 'outro'], default: null },
    presenca: { type: String, enum: ['pendente', 'presente', 'ausente', 'atrasado'], default: 'pendente' },
    nota_clinica: {
      subjetivo: { type: String, default: '' },
      objetivo: { type: String, default: '' },
      avaliacao: { type: String, default: '' },
      plano: { type: String, default: '' },
      tratamento_efetuado: { type: String, default: '' },
      protocolo_aplicado: [
        {
          nome: { type: String, required: true },
          items: [{ texto: String, concluido: Boolean }],
        },
      ],
      cedula_assinante: { type: String, default: '' },
    },
    criada_por: { type: mongoose.Schema.Types.ObjectId, ref: 'Utilizador', required: true },
    concluida_em: { type: Date, default: null },
    cancelada_em: { type: Date, default: null },
    cancelada_por: { type: mongoose.Schema.Types.ObjectId, ref: 'Utilizador', default: null },
    lembrete_24h_enviado: { type: Boolean, default: false },
    lembrete_2h_enviado: { type: Boolean, default: false },
    observacoes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

// Índices para queries de arquivo.
consultaArquivoSchema.index({ empresa_id: 1, fisioterapeuta_id: 1, data_hora_inicio: -1 });
consultaArquivoSchema.index({ empresa_id: 1, paciente_id: 1, data_hora_inicio: -1 });
consultaArquivoSchema.index({ arquivado_em: 1 });

module.exports = mongoose.model('ConsultaArquivo', consultaArquivoSchema, 'consultas_arquivo');
