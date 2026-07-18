/**
 * Modelo: ModeloProtocolo (Template Clínico)
 *
 * F5 — Protocolos clínicos reutilizáveis (evolução do ModeloChecklist).
 *
 * Representa um template de protocolo clínico que pode ser aplicado a uma
 * Consulta. Quando a consulta é criada/marcada, o protocolo é copiado
 * (snapshot) para o campo `nota_clinica.protocolo_aplicado` da Consulta —
 * alterações futuras no template não afetam consultas antigas (RGPD/legal).
 *
 * Estrutura:
 *   - empresa_id: scoping multi-tenant
 *   - nome: ex: "Avaliação Ombro", "Sessão Lombalgia", "Reabilitação Pós-Cirúrgica"
 *   - descricao: descrição opcional
 *   - area: área clínica (musculoesqueletica, neurologica, cardioresp, desporto, pediatria, outro)
 *   - seccoes: array de secções, cada uma com nome + items
 *     - ex: { nome: "Avaliação Inicial", items: ["Inspeção", "Palpação", "Testes ortopédicos"] }
 *   - ativo: permite desativar sem apagar (preserva snapshots antigos)
 */
const mongoose = require('mongoose');

const modeloProtocoloSchema = new mongoose.Schema(
  {
    empresa_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empresa',
      required: true,
      index: true,
    },
    nome: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    descricao: {
      type: String,
      default: '',
      trim: true,
    },
    // F5 — Área clínica (para filtrar no formulário de marcação).
    area: {
      type: String,
      enum: ['musculoesqueletica', 'neurologica', 'cardioresp', 'desporto', 'pediatria', 'outro'],
      default: 'musculoesqueletica',
      index: true,
    },
    seccoes: [
      {
        nome: {
          type: String,
          required: true,
          trim: true,
        },
        items: [
          {
            type: String,
            required: true,
            trim: true,
          },
        ],
      },
    ],
    // F5 — Permite desativar um protocolo sem apagar (preserva snapshots).
    ativo: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Índice para listar protocolos ativos por empresa + área.
modeloProtocoloSchema.index({ empresa_id: 1, ativo: 1, area: 1 });

module.exports = mongoose.model('ModeloProtocolo', modeloProtocoloSchema);
