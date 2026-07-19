/**
 * Modelo: Documento
 *
 * F9 — Anexos a Pacientes/Consultas: receitas, relatórios, termos de
 * consentimento e fotografias de documentos. Storage local (uploads/)
 * com preparação para S3/Cloudinary no futuro.
 *
 *   - paciente_id: obrigatório (a quem pertence o documento)
 *   - consulta_id: opcional (se anexado a uma sessão específica)
 *   - uploaded_by: utilizador que carregou o ficheiro
 *   - tipo: categoria do documento (receita, relatorio, termo_consentimento, foto, exame, outro)
 *   - consentimento_obtido: RGPD — obrigatório para documentos clínicos
 *
 * Soft delete (eliminado_em) preserva metadados para auditoria.
 */
const mongoose = require('mongoose');

const documentoSchema = new mongoose.Schema(
  {
    empresa_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empresa',
      required: true,
      index: true,
    },
    // A quem pertence o documento (obrigatório).
    paciente_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Paciente',
      required: true,
      index: true,
    },
    // Se anexado a uma consulta específica (opcional).
    consulta_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Consulta',
      default: null,
      index: true,
    },
    // Quem carregou o ficheiro.
    uploaded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Utilizador',
      required: true,
    },
    // Tipo de documento.
    tipo: {
      type: String,
      enum: ['receita', 'relatorio', 'termo_consentimento', 'foto', 'exame', 'outro'],
      default: 'outro',
      index: true,
    },
    // Nome original do ficheiro carregado.
    nome_original: {
      type: String,
      required: true,
      trim: true,
    },
    // Caminho relativo no storage (uploads/xxx-yyy.pdf).
    // Futuro S3: URL completa do bucket.
    url_storage: {
      type: String,
      required: true,
    },
    // MIME type do ficheiro (application/pdf, image/jpeg, etc.).
    content_type: {
      type: String,
      default: 'application/octet-stream',
    },
    // Tamanho em bytes.
    tamanho_bytes: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Descrição opcional (metadados clínicos).
    descricao: {
      type: String,
      default: '',
      trim: true,
    },
    // RGPD — consentimento de tratamento de dados.
    consentimento_obtido: {
      type: Boolean,
      default: false,
    },
    data_consentimento: {
      type: Date,
      default: null,
    },
    // Soft delete.
    eliminado_em: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

// Índices para queries frequentes.
documentoSchema.index({ empresa_id: 1, paciente_id: 1, eliminado_em: 1 });
documentoSchema.index({ empresa_id: 1, consulta_id: 1, eliminado_em: 1 });

module.exports = mongoose.model('Documento', documentoSchema);
