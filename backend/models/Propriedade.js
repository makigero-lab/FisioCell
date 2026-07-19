/**
 * Modelo: Propriedade (futuro: Sala)
 * Representa um espaço físico da clínica.
 *
 * F0: Removido smoobu_id (integração Smoobu eliminada).
 * F3: Será transformado em Sala (nome, capacidade, equipamentos).
 * F8: Removido modelo_checklist_id (ModeloChecklist eliminado).
 */
const mongoose = require('mongoose');

const propriedadeSchema = new mongoose.Schema(
  {
    // F0 — smoobu_id removido (integração Smoobu eliminada).
    // O identificador único passará a ser (empresa_id + nome) na F3 (Sala).
    nome: {
      type: String,
      required: true,
      trim: true,
    },
    // Morada completa da propriedade (para geocoding e otimização de rotas).
    morada: {
      type: String,
      required: true,
      trim: true,
    },
    // Coordenadas geográficas (preenchidas automaticamente via geocoding
    // Nominatim/OpenStreetMap ao criar a propriedade).
    coordenadas: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    empresa_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empresa',
      required: true,
      index: true,
    },
    // Tempo de limpeza por defeito (minutos) — usado quando o payload
    // do Smoobu não traz esta informação.
    tempo_limpeza_minutos: {
      type: Number,
      default: 45,
      min: 0,
    },
    ativo: {
      type: Boolean,
      default: true,
    },
    // v1.34.0 — Checklist de limpeza da propriedade (lista de itens a verificar).
    // O staff vê esta lista ao concluir a tarefa e pode marcar cada item.
    // Definida pelo gestor no painel de propriedades.
    // Ex: ['Verificar toalhas', 'Esvaziar lixo', 'Trocar roupa de cama']
    // F8 — Mantido como array de strings (legacy). O fluxo de Consultas
    // (F4+) usa ModeloProtocolo para checklists clínicas dinâmicas.
    checklist: {
      type: [String],
      default: [],
    },
    // Prompt 125 — Observações livres da propriedade (notas internas do gestor).
    observacoes: {
      type: String,
      default: '',
      trim: true,
    },
    // v1.61.0 (Prompt 84) — Capacidade máxima de hóspedes (vinda do Smoobu:
    // apt.rooms.maxOccupancy ou apt.maxOccupancy). Usada para estimar tempo
    // de limpeza e para display no gestor.
    capacidade_hospedes: {
      type: Number,
      default: null,
      min: 0,
    },
    // Prompt 92 (Fase 1.5) — Funcionário preferencial desta propriedade.
    // F8 — Mantido: campo da sala (não depende do load balancer, que foi
    // extinto). Pode ser usado para filtros/preferências futuras.
    funcionario_preferencial_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Utilizador',
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Propriedade', propriedadeSchema);
