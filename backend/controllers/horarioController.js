/**
 * Horário Controller — FisioCell
 *
 * F3 — CRUD de HorarioFisioterapeuta (limites de agenda).
 *
 * Permissões:
 *   - isDiretorClinico: gerir horários de qualquer fisioterapeuta da empresa.
 *   - isClinico (fisioterapeuta): ver os seus próprios horários.
 *
 * Endpoints:
 *   GET    /api/gestor/horarios?fisioterapeuta_id=   — lista horários
 *   GET    /api/gestor/horarios/:id                  — detalhe
 *   POST   /api/gestor/horarios                      — cria horário
 *   PUT    /api/gestor/horarios/:id                  — atualiza
 *   DELETE /api/gestor/horarios/:id                  — elimina
 *   GET    /api/gestor/horarios/disponibilidade?fisioterapeuta_id=&data= — verifica disponibilidade
 */
const mongoose = require('mongoose');
const HorarioFisioterapeuta = require('../models/HorarioFisioterapeuta');
const Utilizador = require('../models/Utilizador');
const { obterEmpresaId } = require('./gestorController');
const { registarAuditoria } = require('../utils/auditoria');
const { obterHorarioDia, verificarConflitoHorario } = require('../utils/disponibilidade');

/* ------------------------------------------------------------------ */
/* GET /api/gestor/horarios — lista horários                           */
/* ------------------------------------------------------------------ */

/**
 * Lista horários de fisioterapeutas da empresa.
 *
 * Query params:
 *   - fisioterapeuta_id (opcional): filtra por fisioterapeuta.
 *   - tipo (opcional): 'recorrente' | 'excecao'.
 *   - ativo (opcional): 'true' | 'false'.
 *
 * Permissões: isDiretorClinico (vê todos) ou isClinico (vê só os seus).
 */
exports.listarHorarios = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { fisioterapeuta_id, tipo, ativo } = req.query;
    const filtro = { empresa_id: empresaId };

    // Fisioterapeuta só vê os seus horários.
    if (req.user.role === 'fisioterapeuta') {
      filtro.fisioterapeuta_id = req.user.id;
    } else if (fisioterapeuta_id) {
      filtro.fisioterapeuta_id = fisioterapeuta_id;
    }

    if (tipo && ['recorrente', 'excecao'].includes(tipo)) {
      filtro.tipo = tipo;
    }
    if (ativo === 'true') filtro.ativo = true;
    if (ativo === 'false') filtro.ativo = false;

    const horarios = await HorarioFisioterapeuta.find(filtro)
      .populate('fisioterapeuta_id', 'nome email role')
      .sort({ fisioterapeuta_id: 1, tipo: 1, dia_semana: 1, data: 1 })
      .lean();

    return res.status(200).json({ horarios, total: horarios.length });
  } catch (err) {
    console.error('❌ listarHorarios:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* GET /api/gestor/horarios/:id — detalhe                              */
/* ------------------------------------------------------------------ */

exports.obterHorario = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const horario = await HorarioFisioterapeuta.findOne({
      _id: id,
      empresa_id: empresaId,
    })
      .populate('fisioterapeuta_id', 'nome email role')
      .lean();

    if (!horario) {
      return res.status(404).json({ erro: 'Horário não encontrado.' });
    }

    // Fisioterapeuta só vê os seus.
    if (req.user.role === 'fisioterapeuta' && String(horario.fisioterapeuta_id?._id) !== String(req.user.id)) {
      return res.status(403).json({ erro: 'Acesso negado.' });
    }

    return res.status(200).json({ horario });
  } catch (err) {
    console.error('❌ obterHorario:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* POST /api/gestor/horarios — cria horário                            */
/* ------------------------------------------------------------------ */

/**
 * Cria um novo horário.
 *
 * Body:
 *   - fisioterapeuta_id (obrigatório)
 *   - tipo: 'recorrente' | 'excecao' (default 'recorrente')
 *   - dia_semana (0-6, obrigatório se recorrente)
 *   - hora_inicio, hora_fim (formato HH:mm)
 *   - data (obrigatório se excecao)
 *   - disponivel (boolean, default true — para excecao)
 *   - nota (string)
 *   - ativo (boolean, default true)
 *
 * Permissões: isDiretorClinico (só diretor/admin criam horários).
 */
exports.criarHorario = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const {
      fisioterapeuta_id,
      tipo = 'recorrente',
      dia_semana,
      hora_inicio = '09:00',
      hora_fim = '19:00',
      data,
      disponivel = true,
      nota = '',
      ativo = true,
    } = req.body || {};

    // Validações.
    if (!fisioterapeuta_id) {
      return res.status(400).json({ erro: 'fisioterapeuta_id é obrigatório.' });
    }
    if (!['recorrente', 'excecao'].includes(tipo)) {
      return res.status(400).json({ erro: 'tipo inválido (recorrente | excecao).' });
    }

    // Valida fisioterapeuta (tem de ser fisioterapeuta ou diretor_clinico da empresa).
    const fisio = await Utilizador.findOne({
      _id: fisioterapeuta_id,
      empresa_id: empresaId,
      role: { $in: ['fisioterapeuta', 'diretor_clinico'] },
      ativo: true,
      eliminado_em: null,
    }).lean();
    if (!fisio) {
      return res.status(400).json({ erro: 'Fisioterapeuta não encontrado (não é fisio/diretor ativo desta empresa).' });
    }

    // Valida formato de horas.
    const reHora = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!reHora.test(hora_inicio) || !reHora.test(hora_fim)) {
      return res.status(400).json({ erro: 'hora_inicio e hora_fim devem ter formato HH:mm.' });
    }

    const novo = {
      empresa_id: empresaId,
      fisioterapeuta_id: String(fisioterapeuta_id),
      tipo,
      hora_inicio,
      hora_fim,
      disponivel: !!disponivel,
      nota: nota ? String(nota).trim() : '',
      ativo: ativo !== false,
    };

    if (tipo === 'recorrente') {
      if (dia_semana === null || dia_semana === undefined) {
        return res.status(400).json({ erro: 'dia_semana é obrigatório para tipo="recorrente".' });
      }
      if (!Number.isInteger(dia_semana) || dia_semana < 0 || dia_semana > 6) {
        return res.status(400).json({ erro: 'dia_semana deve ser inteiro 0-6.' });
      }
      novo.dia_semana = dia_semana;
    } else {
      // excecao
      if (!data) {
        return res.status(400).json({ erro: 'data é obrigatória para tipo="excecao".' });
      }
      const d = new Date(data);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ erro: 'data inválida.' });
      }
      novo.data = d;
    }

    const criado = await HorarioFisioterapeuta.create(novo);

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'criar',
      recurso: 'horario_fisioterapeuta',
      recurso_id: criado._id,
      descricao: `Horário ${tipo} criado para ${fisio.nome}`,
    });

    return res.status(201).json({ horario: criado });
  } catch (err) {
    console.error('❌ criarHorario:', err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ erro: err.message });
    }
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* PUT /api/gestor/horarios/:id — atualiza horário                     */
/* ------------------------------------------------------------------ */

exports.atualizarHorario = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const horario = await HorarioFisioterapeuta.findOne({
      _id: id,
      empresa_id: empresaId,
    });
    if (!horario) {
      return res.status(404).json({ erro: 'Horário não encontrado.' });
    }

    const {
      dia_semana,
      hora_inicio,
      hora_fim,
      data,
      disponivel,
      nota,
      ativo,
    } = req.body || {};

    const reHora = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (hora_inicio !== undefined) {
      if (!reHora.test(hora_inicio)) return res.status(400).json({ erro: 'hora_inicio inválida.' });
      horario.hora_inicio = hora_inicio;
    }
    if (hora_fim !== undefined) {
      if (!reHora.test(hora_fim)) return res.status(400).json({ erro: 'hora_fim inválida.' });
      horario.hora_fim = hora_fim;
    }
    if (dia_semana !== undefined) {
      if (dia_semana === null) {
        horario.dia_semana = null;
      } else {
        if (!Number.isInteger(dia_semana) || dia_semana < 0 || dia_semana > 6) {
          return res.status(400).json({ erro: 'dia_semana deve ser 0-6.' });
        }
        horario.dia_semana = dia_semana;
      }
    }
    if (data !== undefined) {
      if (data === null) {
        horario.data = null;
      } else {
        const d = new Date(data);
        if (isNaN(d.getTime())) return res.status(400).json({ erro: 'data inválida.' });
        horario.data = d;
      }
    }
    if (disponivel !== undefined) horario.disponivel = !!disponivel;
    if (nota !== undefined) horario.nota = String(nota).trim();
    if (ativo !== undefined) horario.ativo = !!ativo;

    await horario.save();

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'atualizar',
      recurso: 'horario_fisioterapeuta',
      recurso_id: horario._id,
      descricao: `Horário atualizado`,
    });

    return res.status(200).json({ horario });
  } catch (err) {
    console.error('❌ atualizarHorario:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* DELETE /api/gestor/horarios/:id — elimina horário                   */
/* ------------------------------------------------------------------ */

exports.eliminarHorario = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const horario = await HorarioFisioterapeuta.findOneAndDelete({
      _id: id,
      empresa_id: empresaId,
    });

    if (!horario) {
      return res.status(404).json({ erro: 'Horário não encontrado.' });
    }

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'eliminar',
      recurso: 'horario_fisioterapeuta',
      recurso_id: horario._id,
      descricao: `Horário eliminado`,
    });

    return res.status(200).json({ message: 'Horário eliminado.' });
  } catch (err) {
    console.error('❌ eliminarHorario:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* GET /api/gestor/horarios/disponibilidade — verifica disponibilidade */
/* ------------------------------------------------------------------ */

/**
 * Verifica a disponibilidade de um fisioterapeuta para uma data/hora.
 *
 * Query params:
 *   - fisioterapeuta_id (obrigatório)
 *   - data (obrigatório — ISO string)
 *   - duracao_minutos (opcional, default 45)
 *
 * Resposta 200: {
 *   disponivel: boolean,
 *   horario: { hora_inicio, hora_fim } | null,
 *   motivo: string | null,
 *   origem: 'excecao' | 'recorrente' | null
 * }
 *
 * Permissões: isClinico (todos os clínicos) + isRececionista (para marcar).
 */
exports.verificarDisponibilidade = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { fisioterapeuta_id, data, duracao_minutos = 45 } = req.query;

    if (!fisioterapeuta_id || !data) {
      return res.status(400).json({ erro: 'fisioterapeuta_id e data são obrigatórios.' });
    }

    // Valida fisioterapeuta.
    const fisio = await Utilizador.findOne({
      _id: fisioterapeuta_id,
      empresa_id: empresaId,
      role: { $in: ['fisioterapeuta', 'diretor_clinico'] },
    }).lean();
    if (!fisio) {
      return res.status(404).json({ erro: 'Fisioterapeuta não encontrado.' });
    }

    const dataInicio = new Date(data);
    if (isNaN(dataInicio.getTime())) {
      return res.status(400).json({ erro: 'data inválida.' });
    }

    const duracao = Number(duracao_minutos) || 45;

    // Consulta o horário do dia.
    const horarioDia = await obterHorarioDia(fisioterapeuta_id, dataInicio);

    if (!horarioDia.disponivel) {
      return res.status(200).json({
        disponivel: false,
        horario: null,
        motivo: horarioDia.motivo || 'Indisponível.',
        origem: horarioDia.origem,
      });
    }

    // Verifica conflito de horário (consulta dentro do bloco de trabalho).
    const conflito = await verificarConflitoHorario(fisioterapeuta_id, dataInicio, duracao);

    return res.status(200).json({
      disponivel: conflito.ok,
      horario: conflito.horario || horarioDia.horario,
      motivo: conflito.ok ? null : conflito.motivo,
      origem: horarioDia.origem,
    });
  } catch (err) {
    console.error('❌ verificarDisponibilidade:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};
