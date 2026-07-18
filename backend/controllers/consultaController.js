/**
 * Consulta Controller — FisioCell
 *
 * F4 — CRUD de Consultas com validação de conflitos.
 *
 * Validação de conflitos (validarConflitos):
 *   1. Fisioterapeuta disponível (motor F3: ausência + folga + horário)
 *   2. Sala sem sobreposição (outra Consulta na mesma sala + intervalo)
 *   3. Fisioterapeuta sem sobreposição (outra Consulta com o mesmo fisio)
 *   4. Paciente sem sobreposição (não pode ter 2 consultas em paralelo)
 *
 * Comportamento (soft block — padrão do código-base):
 *   - Conflitos devolvem 200 com { warning } (não bloqueia — o gestor pode
 *     forçar). O frontend mostra um modal "Forçar Agendamento".
 *   - Erros de validação graves (sem fisio, sem sala, sem paciente) devolvem 400.
 *
 * Permissões:
 *   - isRececionista: criar/editar marcações de TODOS os fisioterapeutas.
 *   - isClinico (fisio): ver as suas consultas, registar SOAP, concluir.
 *   - isDiretorClinico: ver todas, eliminar.
 */
const mongoose = require('mongoose');
const Consulta = require('../models/Consulta');
const Utilizador = require('../models/Utilizador');
const Paciente = require('../models/Paciente');
const Propriedade = require('../models/Propriedade');
const { obterEmpresaId } = require('./gestorController');
const { registarAuditoria } = require('../utils/auditoria');
const { verificarDisponibilidadeCompleta } = require('../utils/disponibilidade');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Validação de conflitos para uma consulta proposta.
 *
 * Verifica em simultâneo:
 *   1. Fisioterapeuta disponível (motor F3)
 *   2. Sala sem sobreposição temporal com outra consulta ATIVA
 *      (estado ≠ cancelada/faltou/nao_compareceu)
 *   3. Fisioterapeuta sem sobreposição temporal com outra consulta
 *   4. Paciente sem sobreposição temporal
 *
 * @param {object} params - { empresaId, fisioterapeutaId, salaId, pacienteId, dataHoraInicio, duracaoMinutos, excluirConsultaId }
 * @returns {Promise<{ ok: boolean, warnings: string[], horario?: object }>}
 */
async function validarConflitos({
  empresaId,
  fisioterapeutaId,
  salaId,
  pacienteId,
  dataHoraInicio,
  duracaoMinutos,
  excluirConsultaId = null,
}) {
  const warnings = [];

  if (!fisioterapeutaId || !salaId || !pacienteId || !dataHoraInicio || !duracaoMinutos) {
    return { ok: false, warnings: ['Dados insuficientes para validar conflitos.'] };
  }

  const inicio = new Date(dataHoraInicio);
  const fim = new Date(inicio.getTime() + Number(duracaoMinutos) * 60000);

  // 1) Fisioterapeuta disponível (motor F3 — ausência + folga + horário).
  const fisio = await Utilizador.findOne({
    _id: fisioterapeutaId,
    empresa_id: empresaId,
    role: { $in: ['fisioterapeuta', 'diretor_clinico'] },
    ativo: true,
    eliminado_em: null,
  }).lean();

  if (!fisio) {
    return { ok: false, warnings: ['Fisioterapeuta não encontrado (não é fisio/diretor ativo desta empresa).'] };
  }

  if (fisio.perfil_profissional?.ativo_clinico === false) {
    warnings.push(`Fisioterapeuta "${fisio.nome}" está inativo clinicamente (ativo_clinico=false).`);
  }

  const dispCheck = await verificarDisponibilidadeCompleta(fisio, inicio, Number(duracaoMinutos));
  if (!dispCheck.ok) {
    warnings.push(`Fisioterapeuta: ${dispCheck.motivo}`);
  }

  // Filtro base para sobreposições: consultas ATIVAS (não canceladas/faltou).
  const filtroAtivas = {
    empresa_id: empresaId,
    estado: { $nin: ['cancelada', 'faltou', 'nao_compareceu'] },
    // Sobreposição de intervalos: inicio < fimExistente AND fim > inicioExistente
    data_hora_inicio: { $lt: fim },
    data_hora_fim: { $gt: inicio },
  };
  if (excluirConsultaId) {
    filtroAtivas._id = { $ne: excluirConsultaId };
  }

  // 2) Sala sem sobreposição.
  const conflitoSala = await Consulta.findOne({
    ...filtroAtivas,
    sala_id: salaId,
  })
    .populate('paciente_id', 'nome')
    .populate('fisioterapeuta_id', 'nome')
    .lean();

  if (conflitoSala) {
    warnings.push(
      `Sala ocupada: sobreposição com consulta de "${conflitoSala.paciente_id?.nome ?? '?'}" ` +
      `(fisio: ${conflitoSala.fisioterapeuta_id?.nome ?? '?'}) das ` +
      `${new Date(conflitoSala.data_hora_inicio).toLocaleString('pt-PT')} às ` +
      `${new Date(conflitoSala.data_hora_fim).toLocaleTimeString('pt-PT')}.`
    );
  }

  // 3) Fisioterapeuta sem sobreposição.
  const conflitoFisio = await Consulta.findOne({
    ...filtroAtivas,
    fisioterapeuta_id: fisioterapeutaId,
  })
    .populate('paciente_id', 'nome')
    .populate('sala_id', 'nome')
    .lean();

  if (conflitoFisio) {
    warnings.push(
      `Fisioterapeuta ocupado: sobreposição com consulta de "${conflitoFisio.paciente_id?.nome ?? '?'}" ` +
      `(sala: ${conflitoFisio.sala_id?.nome ?? '?'}) das ` +
      `${new Date(conflitoFisio.data_hora_inicio).toLocaleString('pt-PT')} às ` +
      `${new Date(conflitoFisio.data_hora_fim).toLocaleTimeString('pt-PT')}.`
    );
  }

  // 4) Paciente sem sobreposição.
  const conflitoPaciente = await Consulta.findOne({
    ...filtroAtivas,
    paciente_id: pacienteId,
  })
    .populate('fisioterapeuta_id', 'nome')
    .populate('sala_id', 'nome')
    .lean();

  if (conflitoPaciente) {
    warnings.push(
      `Paciente já tem consulta: sobreposição com fisio "${conflitoPaciente.fisioterapeuta_id?.nome ?? '?'}" ` +
      `(sala: ${conflitoPaciente.sala_id?.nome ?? '?'}) das ` +
      `${new Date(conflitoPaciente.data_hora_inicio).toLocaleString('pt-PT')} às ` +
      `${new Date(conflitoPaciente.data_hora_fim).toLocaleTimeString('pt-PT')}.`
    );
  }

  return {
    ok: warnings.length === 0,
    warnings,
    horario: dispCheck.horario,
  };
}

/* ------------------------------------------------------------------ */
/* GET /api/gestor/consultas — lista consultas                         */
/* ------------------------------------------------------------------ */

/**
 * Lista consultas da empresa com filtros.
 *
 * Query params:
 *   - fisioterapeuta_id, sala_id, paciente_id (filtros)
 *   - estado (filtros)
 *   - inicio, fim (intervalo de datas — data_hora_inicio entre estes)
 *   - limit (default 200, máx 500)
 *
 * Permissões: isRececionista (vê todas) + isClinico (fisio vê só as suas).
 */
exports.listarConsultas = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { fisioterapeuta_id, sala_id, paciente_id, estado, inicio, fim, limit } = req.query;
    const maxLimit = Math.min(Number(limit) || 200, 500);

    const filtro = { empresa_id: empresaId };

    // Fisioterapeuta vê só as suas consultas.
    if (req.user.role === 'fisioterapeuta') {
      filtro.fisioterapeuta_id = req.user.id;
    } else if (fisioterapeuta_id) {
      filtro.fisioterapeuta_id = fisioterapeuta_id;
    }
    if (sala_id) filtro.sala_id = sala_id;
    if (paciente_id) filtro.paciente_id = paciente_id;
    if (estado) filtro.estado = estado;

    if (inicio || fim) {
      filtro.data_hora_inicio = {};
      if (inicio) filtro.data_hora_inicio.$gte = new Date(inicio);
      if (fim) filtro.data_hora_inicio.$lte = new Date(fim);
    }

    const consultas = await Consulta.find(filtro)
      .populate('fisioterapeuta_id', 'nome email perfil_profissional.cor_calendario')
      .populate('sala_id', 'nome')
      .populate('paciente_id', 'nome telefone')
      .populate('criada_por', 'nome')
      .sort({ data_hora_inicio: 1 })
      .limit(maxLimit)
      .lean();

    return res.status(200).json({ consultas, total: consultas.length });
  } catch (err) {
    console.error('❌ listarConsultas:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* GET /api/gestor/consultas/:id — detalhe                             */
/* ------------------------------------------------------------------ */

exports.obterConsulta = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const consulta = await Consulta.findOne({ _id: id, empresa_id: empresaId })
      .populate('fisioterapeuta_id', 'nome email perfil_profissional')
      .populate('sala_id', 'nome')
      .populate('paciente_id', 'nome telefone email data_nascimento')
      .populate('criada_por', 'nome')
      .populate('cancelada_por', 'nome')
      .lean();

    if (!consulta) {
      return res.status(404).json({ erro: 'Consulta não encontrada.' });
    }

    // Fisioterapeuta vê só as suas.
    if (req.user.role === 'fisioterapeuta' && String(consulta.fisioterapeuta_id?._id) !== String(req.user.id)) {
      return res.status(403).json({ erro: 'Acesso negado.' });
    }

    return res.status(200).json({ consulta });
  } catch (err) {
    console.error('❌ obterConsulta:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* POST /api/gestor/consultas — cria consulta                          */
/* ------------------------------------------------------------------ */

/**
 * Cria uma nova consulta.
 *
 * Body:
 *   - fisioterapeuta_id, sala_id, paciente_id (obrigatórios)
 *   - data_hora_inicio (obrigatório ISO)
 *   - duracao_minutos (default 45, min 15)
 *   - tipo (default 'sessao')
 *   - observacoes (opcional)
 *   - forcar (boolean, default false) — se true, ignora warnings de conflito
 *
 * Resposta:
 *   - 201 { consulta } — criada sem conflitos
 *   - 200 { consulta, warning, conflitos } — criada COM conflitos (forçado)
 *   - 409 { erro, conflitos } — conflitos e não forçado
 *   - 400 { erro } — validação grave
 *
 * Permissões: isRececionista (todos podem marcar).
 */
exports.criarConsulta = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const {
      fisioterapeuta_id,
      sala_id,
      paciente_id,
      data_hora_inicio,
      duracao_minutos = 45,
      tipo = 'sessao',
      observacoes = '',
      forcar = false,
    } = req.body || {};

    // Validações de presença.
    if (!fisioterapeuta_id || !sala_id || !paciente_id || !data_hora_inicio) {
      return res.status(400).json({
        erro: 'fisioterapeuta_id, sala_id, paciente_id e data_hora_inicio são obrigatórios.',
      });
    }

    const inicio = new Date(data_hora_inicio);
    if (isNaN(inicio.getTime())) {
      return res.status(400).json({ erro: 'data_hora_inicio inválida.' });
    }
    if (inicio < new Date()) {
      return res.status(400).json({ erro: 'data_hora_inicio não pode ser no passado.' });
    }

    const duracao = Number(duracao_minutos);
    if (!Number.isFinite(duracao) || duracao < 15) {
      return res.status(400).json({ erro: 'duracao_minutos deve ser >= 15.' });
    }

    // Valida fisioterapeuta.
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

    // Valida sala (Propriedade alias Sala).
    const sala = await Propriedade.findOne({
      _id: sala_id,
      empresa_id: empresaId,
      ativo: true,
    }).lean();
    if (!sala) {
      return res.status(400).json({ erro: 'Sala não encontrada (ou inativa).' });
    }

    // Valida paciente.
    const paciente = await Paciente.findOne({
      _id: paciente_id,
      empresa_id: empresaId,
      eliminado_em: null,
    }).lean();
    if (!paciente) {
      return res.status(400).json({ erro: 'Paciente não encontrado.' });
    }

    // Valida conflitos (fisio + sala + paciente em simultâneo).
    const conflitos = await validarConflitos({
      empresaId,
      fisioterapeutaId: fisioterapeuta_id,
      salaId: sala_id,
      pacienteId: paciente_id,
      dataHoraInicio: inicio,
      duracaoMinutos: duracao,
    });

    if (!conflitos.ok && !forcar) {
      return res.status(409).json({
        erro: 'Conflitos detetados. Confirma com forcar=true para ignorar.',
        conflitos: conflitos.warnings,
      });
    }

    const fim = new Date(inicio.getTime() + duracao * 60000);

    const nova = await Consulta.create({
      empresa_id: empresaId,
      sala_id,
      fisioterapeuta_id,
      paciente_id,
      data_hora_inicio: inicio,
      data_hora_fim: fim,
      duracao_minutos: duracao,
      tipo,
      estado: 'marcada',
      criada_por: req.user.id,
      observacoes: observacoes ? String(observacoes).trim() : '',
    });

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'criar',
      recurso: 'consulta',
      recurso_id: nova._id,
      descricao: `Consulta marcada para ${paciente.nome} com ${fisio.nome} em ${sala.nome}`,
      detalhes: { data_hora_inicio: inicio, conflitos_forcados: !conflitos.ok },
    });

    const resposta = { consulta: nova };
    if (!conflitos.ok) {
      resposta.warning = 'Consulta criada com conflitos (forçado).';
      resposta.conflitos = conflitos.warnings;
    }
    return res.status(conflitos.ok ? 201 : 200).json(resposta);
  } catch (err) {
    console.error('❌ criarConsulta:', err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ erro: err.message });
    }
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* PUT /api/gestor/consultas/:id — atualiza consulta                   */
/* ------------------------------------------------------------------ */

/**
 * Atualiza uma consulta (data, duração, tipo, observações, estado, presenca).
 *
 * Se data_hora_inicio ou duracao_minutos mudarem, re-valida conflitos
 * (excluindo a própria consulta).
 *
 * Permissões: isRececionista.
 */
exports.atualizarConsulta = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const consulta = await Consulta.findOne({ _id: id, empresa_id: empresaId });
    if (!consulta) {
      return res.status(404).json({ erro: 'Consulta não encontrada.' });
    }

    // Nota clínica já não pode ser editada se consulta concluída (RGPD/legal).
    if (consulta.estado === 'concluida' && req.body.nota_clinica !== undefined) {
      return res.status(403).json({ erro: 'Consulta concluída — nota clínica é imutável (RGPD/legal).' });
    }

    const {
      fisioterapeuta_id,
      sala_id,
      paciente_id,
      data_hora_inicio,
      duracao_minutos,
      tipo,
      estado,
      presenca,
      motivo_cancelamento,
      observacoes,
      nota_clinica,
      forcar = false,
    } = req.body || {};

    let novosConflitos = null;

    // Se mudou data/duração/fisio/sala/paciente, re-valida conflitos.
    const mudouTemporal = data_hora_inicio !== undefined || duracao_minutos !== undefined
      || fisioterapeuta_id !== undefined || sala_id !== undefined || paciente_id !== undefined;

    if (mudouTemporal) {
      const novoInicio = data_hora_inicio ? new Date(data_hora_inicio) : consulta.data_hora_inicio;
      const novaDuracao = duracao_minutos !== undefined ? Number(duracao_minutos) : consulta.duracao_minutos;
      const novoFisio = fisioterapeuta_id || consulta.fisioterapeuta_id;
      const novaSala = sala_id || consulta.sala_id;
      const novoPaciente = paciente_id || consulta.paciente_id;

      novosConflitos = await validarConflitos({
        empresaId,
        fisioterapeutaId: novoFisio,
        salaId: novaSala,
        pacienteId: novoPaciente,
        dataHoraInicio: novoInicio,
        duracaoMinutos: novaDuracao,
        excluirConsultaId: consulta._id,
      });

      if (!novosConflitos.ok && !forcar) {
        return res.status(409).json({
          erro: 'Conflitos detetados. Confirma com forcar=true para ignorar.',
          conflitos: novosConflitos.warnings,
        });
      }

      consulta.data_hora_inicio = novoInicio;
      consulta.duracao_minutos = novaDuracao;
      consulta.data_hora_fim = new Date(novoInicio.getTime() + novaDuracao * 60000);
      if (fisioterapeuta_id) consulta.fisioterapeuta_id = fisioterapeuta_id;
      if (sala_id) consulta.sala_id = sala_id;
      if (paciente_id) consulta.paciente_id = paciente_id;
    }

    if (tipo !== undefined) consulta.tipo = tipo;
    if (observacoes !== undefined) consulta.observacoes = String(observacoes).trim();
    if (presenca !== undefined) consulta.presenca = presenca;

    if (estado !== undefined) {
      consulta.estado = estado;
      if (estado === 'concluida' && !consulta.concluida_em) {
        consulta.concluida_em = new Date();
      }
      if (estado === 'cancelada') {
        consulta.cancelada_em = new Date();
        consulta.cancelada_por = req.user.id;
        if (motivo_cancelamento) consulta.motivo_cancelamento = motivo_cancelamento;
      }
    }

    // Nota clínica SOAP é atualizada via endpoint separado PATCH /nota-clinica
    // (porque tem permissões diferentes — isClinico em vez de isRececionista).
    if (nota_clinica !== undefined) {
      return res.status(400).json({
        erro: 'Nota clínica deve ser atualizada via PATCH /api/gestor/consultas/:id/nota-clinica.',
      });
    }

    await consulta.save();

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'atualizar',
      recurso: 'consulta',
      recurso_id: consulta._id,
      descricao: `Consulta atualizada`,
      detalhes: novosConflitos && !novosConflitos.ok ? { conflitos_forcados: true } : {},
    });

    const resposta = { consulta };
    if (novosConflitos && !novosConflitos.ok) {
      resposta.warning = 'Consulta atualizada com conflitos (forçado).';
      resposta.conflitos = novosConflitos.warnings;
    }
    return res.status(200).json(resposta);
  } catch (err) {
    console.error('❌ atualizarConsulta:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* DELETE /api/gestor/consultas/:id — elimina (hard delete)            */
/* ------------------------------------------------------------------ */

/**
 * Elimina uma consulta (hard delete — só para marcações erradas).
 * Consultas concluídas NÃO devem ser eliminadas (RGPD — preservar SOAP).
 *
 * Permissões: isDiretorClinico.
 */
exports.eliminarConsulta = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const consulta = await Consulta.findOne({ _id: id, empresa_id: empresaId });
    if (!consulta) {
      return res.status(404).json({ erro: 'Consulta não encontrada.' });
    }

    // Bloqueia eliminação de consultas concluídas (RGPD).
    if (consulta.estado === 'concluida') {
      return res.status(403).json({
        erro: 'Não é possível eliminar uma consulta concluída (RGPD — nota clínica é imutável). Cancela em vez de eliminar.',
      });
    }

    await Consulta.deleteOne({ _id: id });

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'eliminar',
      recurso: 'consulta',
      recurso_id: id,
      descricao: `Consulta eliminada (estado anterior: ${consulta.estado})`,
    });

    return res.status(200).json({ message: 'Consulta eliminada.' });
  } catch (err) {
    console.error('❌ eliminarConsulta:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* GET /api/gestor/consultas/validar — valida conflitos sem criar      */
/* ------------------------------------------------------------------ */

/**
 * Valida conflitos para uma consulta proposta sem a criar.
 * Útil para o frontend mostrar avisos em tempo real antes de submeter.
 *
 * Query params:
 *   - fisioterapeuta_id, sala_id, paciente_id, data_hora_inicio, duracao_minutos
 *   - excluir_id (opcional, para modo edição)
 *
 * Permissões: isRececionista.
 */
exports.validarConflitosEndpoint = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { fisioterapeuta_id, sala_id, paciente_id, data_hora_inicio, duracao_minutos = 45, excluir_id } = req.query;

    if (!fisioterapeuta_id || !sala_id || !paciente_id || !data_hora_inicio) {
      return res.status(400).json({ erro: 'fisioterapeuta_id, sala_id, paciente_id e data_hora_inicio são obrigatórios.' });
    }

    const conflitos = await validarConflitos({
      empresaId,
      fisioterapeutaId: fisioterapeuta_id,
      salaId: sala_id,
      pacienteId: paciente_id,
      dataHoraInicio: new Date(data_hora_inicio),
      duracaoMinutos: Number(duracao_minutos),
      excluirConsultaId: excluir_id || null,
    });

    return res.status(200).json({
      ok: conflitos.ok,
      conflitos: conflitos.warnings,
      horario: conflitos.horario,
    });
  } catch (err) {
    console.error('❌ validarConflitosEndpoint:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

module.exports.validarConflitos = validarConflitos;

/* ------------------------------------------------------------------ */
/* PATCH /api/gestor/consultas/:id/nota-clinica — atualiza SOAP        */
/* ------------------------------------------------------------------ */

/**
 * Atualiza a nota clínica SOAP de uma consulta.
 *
 * Endpoint SEPARADO do PUT geral porque tem permissões diferentes:
 *   - PUT geral: isRececionista (marcações — data, estado, presença).
 *   - PATCH /nota-clinica: isClinico (fisio/diretor/admin — SOAP).
 *
 * Regras:
 *   - Consulta concluída → 403 (nota imutável, RGPD/legal).
 *   - Fisioterapeuta só pode editar notas das SUAS consultas.
 *   - O assinante tem de ter cédula profissional válida (F4).
 *   - Snapshot da cédula é guardado para auditoria legal.
 *
 * Body: { subjetivo?, objetivo?, avaliacao?, plano?, tratamento_efetuado? }
 */
exports.atualizarNotaClinica = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const consulta = await Consulta.findOne({ _id: id, empresa_id: empresaId });
    if (!consulta) {
      return res.status(404).json({ erro: 'Consulta não encontrada.' });
    }

    // Consulta concluída → nota imutável.
    if (consulta.estado === 'concluida') {
      return res.status(403).json({ erro: 'Consulta concluída — nota clínica é imutável (RGPD/legal).' });
    }

    // Fisioterapeuta só pode editar notas das SUAS consultas.
    if (req.user.role === 'fisioterapeuta' && String(consulta.fisioterapeuta_id) !== String(req.user.id)) {
      return res.status(403).json({ erro: 'Acesso negado — só podes editar notas das tuas consultas.' });
    }

    // F4 — Validar cédula do fisioterapeuta assinante (RGPD/faturação).
    const fisioAssinante = await Utilizador.findById(req.user.id);
    if (fisioAssinante && !fisioAssinante.temCedulaValida()) {
      return res.status(403).json({
        erro: 'Não podes assinar notas clínicas sem cédula profissional válida (perfil_profissional.cedula).',
      });
    }

    const { subjetivo, objetivo, avaliacao, plano, tratamento_efetuado } = req.body || {};

    if (subjetivo !== undefined) consulta.nota_clinica.subjetivo = String(subjetivo);
    if (objetivo !== undefined) consulta.nota_clinica.objetivo = String(objetivo);
    if (avaliacao !== undefined) consulta.nota_clinica.avaliacao = String(avaliacao);
    if (plano !== undefined) consulta.nota_clinica.plano = String(plano);
    if (tratamento_efetuado !== undefined) consulta.nota_clinica.tratamento_efetuado = String(tratamento_efetuado);

    // Snapshot da cédula do assinante (auditoria legal).
    if (fisioAssinante) {
      const cedula = fisioAssinante.perfil_profissional?.cedula;
      consulta.nota_clinica.cedula_assinante = typeof cedula === 'string' ? cedula : '';
    }

    await consulta.save();

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'atualizar_nota_clinica',
      recurso: 'consulta',
      recurso_id: consulta._id,
      descricao: `Nota clínica SOAP atualizada`,
    });

    return res.status(200).json({ consulta });
  } catch (err) {
    console.error('❌ atualizarNotaClinica:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};
