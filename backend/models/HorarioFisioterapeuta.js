/**
 * Modelo: HorarioFisioterapeuta
 *
 * F3 — Define os limites de agenda de cada fisioterapeuta.
 *
 * Três camadas de disponibilidade (consultadas por ordem de prioridade):
 *   1. dias_folga no Utilizador (folga fixa semanal — herança do original)
 *   2. HorarioFisioterapeuta tipo='recorrente' (horário de trabalho normal:
 *      seg-sex 9-13, 14-19, etc.)
 *   3. HorarioFisioterapeuta tipo='excecao' (dia específico: "26/12 só manhã"
 *      ou "bloqueio 15/12 para formação")
 *   4. Ausencia (férias/doença — intervalo de dias, estado 'aprovada')
 *
 * O motor de disponibilidade (utils/disponibilidade.js) consulta estas camadas
 * por ordem para validar se uma consulta é possível.
 */
const mongoose = require('mongoose');

const horarioFisioterapeutaSchema = new mongoose.Schema(
  {
    empresa_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empresa',
      required: true,
      index: true,
    },
    fisioterapeuta_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Utilizador',
      required: true,
      index: true,
    },
    // Tipo: regra semanal recorrente ou exceção para um dia específico.
    tipo: {
      type: String,
      enum: ['recorrente', 'excecao'],
      required: true,
      default: 'recorrente',
      index: true,
    },
    // ═══ Para tipo='recorrente' (regra semanal) ═══
    // Dia da semana: 0=Dom, 1=Seg, ..., 6=Sáb. Null se excecao.
    dia_semana: {
      type: Number,
      min: 0,
      max: 6,
      default: null,
    },
    // Hora de início (formato "HH:mm", ex.: "09:00").
    hora_inicio: {
      type: String,
      default: '09:00',
      validate: {
        validator: function (v) {
          return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
        },
        message: 'hora_inicio deve ter formato HH:mm (ex.: 09:00).',
      },
    },
    // Hora de fim (formato "HH:mm", ex.: "19:00").
    hora_fim: {
      type: String,
      default: '19:00',
      validate: {
        validator: function (v) {
          return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
        },
        message: 'hora_fim deve ter formato HH:mm (ex.: 19:00).',
      },
    },

    // ═══ Para tipo='excecao' (dia específico) ═══
    // Data específica (dia do calendário). Null se recorrente.
    data: {
      type: Date,
      default: null,
    },
    // Se excecao, pode ser "disponivel" (horário extra) ou "indisponivel"
    // (bloqueio: formação, consulta médica, etc.).
    disponivel: {
      type: Boolean,
      default: true,
    },

    // Estado (permite desativar uma regra sem apagar).
    ativo: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Nota interna (ex.: "Formação em Pilates Clínico").
    nota: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

// Validação: se tipo='recorrente', dia_semana é obrigatório e data deve ser null.
// Se tipo='excecao', data é obrigatória e dia_semana deve ser null.
horarioFisioterapeutaSchema.pre('validate', function preValidate(next) {
  if (this.tipo === 'recorrente') {
    if (this.dia_semana === null || this.dia_semana === undefined) {
      return next(new Error('dia_semana é obrigatório para tipo="recorrente".'));
    }
    this.data = null;
  } else if (this.tipo === 'excecao') {
    if (!this.data) {
      return next(new Error('data é obrigatória para tipo="excecao".'));
    }
    this.dia_semana = null;
  }
  next();
});

// Índices para queries frequentes.
horarioFisioterapeutaSchema.index({ fisioterapeuta_id: 1, dia_semana: 1, ativo: 1 });
horarioFisioterapeutaSchema.index({ empresa_id: 1, fisioterapeuta_id: 1, tipo: 1 });
horarioFisioterapeutaSchema.index({ fisioterapeuta_id: 1, data: 1 });

module.exports = mongoose.model('HorarioFisioterapeuta', horarioFisioterapeutaSchema);
