/**
 * Paciente Controller — FisioCell
 *
 * F2 — CRUD de Pacientes com permissões baseadas em role.
 *
 * Permissões:
 *   - isRececionista (admin, diretor_clinico, rececionista): vê dados
 *     administrativos (contactos, morada, NIF). NÃO vê dados clínicos.
 *   - isClinico (admin, diretor_clinico, fisioterapeuta): vê dados
 *     clínicos (historico_medico, alergias, contacto_emergencia).
 *
 * Nota F2: o filtro "fisioterapeuta vê só os seus pacientes" será
 * implementado em F4 (Consulta com paciente_id + fisioterapeuta_id).
 * Por agora, todos os clínicos vêem todos os pacientes ativos da empresa.
 *
 * O campo `dados_clinicos` na resposta é incluído apenas para isClinico.
 */
const mongoose = require('mongoose');
const Paciente = require('../models/Paciente');
const { obterEmpresaId } = require('./gestorController');
const { registarAuditoria } = require('../utils/auditoria');

/**
 * Verifica se o utilizador autenticado tem acesso a dados clínicos.
 * @param {object} req - req.user.role
 * @returns {boolean}
 */
function temAcessoClinico(req) {
  const role = req.user && req.user.role;
  return ['admin', 'diretor_clinico', 'fisioterapeuta'].includes(role);
}

/**
 * Remove campos clínicos sensíveis do documento paciente (para devolver
 * a rececionistas).
 */
 function sanitizarParaNaoClinico(p) {
  if (!p) return p;
  const obj = typeof p.toObject === 'function' ? p.toObject() : { ...p };
  delete obj.historico_medico;
  delete obj.alergias;
  delete obj.contacto_emergencia;
  return obj;
}

/* ------------------------------------------------------------------ */
/* GET /api/gestor/pacientes — lista pacientes da empresa             */
/* ------------------------------------------------------------------ */

/**
 * Lista pacientes da empresa do utilizador autenticado.
 *
 * Query params:
 *   - busca (opcional): filtra por nome, num_utente, telefone ou email.
 *   - ativo (opcional): 'true' / 'false' filtra por ativo.
 *   - limit (opcional, default 200, máx 500).
 *
 * Resposta 200: { pacientes: [...], total: number }
 *
 * Permissões: isRececionista (rececionista/diretor_clinico/admin).
 *   - isClinico recebe dados clínicos completos.
 *   - Rececionista recebe versão sanitizada (sem historico/alergias/emergencia).
 */
exports.listarPacientes = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { busca, ativo, limit } = req.query;
    const maxLimit = Math.min(Number(limit) || 200, 500);

    const filtro = {
      empresa_id: empresaId,
      eliminado_em: null,
    };

    if (ativo === 'true') filtro.ativo = true;
    if (ativo === 'false') filtro.ativo = false;

    if (busca && String(busca).trim()) {
      const termo = String(busca).trim();
      // Escape de regex para evitar injeção.
      const termoEsc = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filtro.$or = [
        { nome: { $regex: termoEsc, $options: 'i' } },
        { num_utente: { $regex: termoEsc, $options: 'i' } },
        { telefone: { $regex: termoEsc, $options: 'i' } },
        { email: { $regex: termoEsc, $options: 'i' } },
      ];
    }

    const clinico = temAcessoClinico(req);
    const select = clinico
      ? 'nome data_nascimento genero num_utente nif telefone email morada contacto_emergencia historico_medico alergias consentimento_dados ativo observacoes origem createdAt'
      : 'nome data_nascimento genero num_utente telefone email ativo observacoes origem createdAt';

    const pacientes = await Paciente.find(filtro)
      .select(select)
      .sort({ nome: 1 })
      .limit(maxLimit)
      .lean();

    return res.status(200).json({
      pacientes,
      total: pacientes.length,
      dados_clinicos: clinico,
    });
  } catch (err) {
    console.error('❌ listarPacientes:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* GET /api/gestor/pacientes/:id — detalhe de um paciente             */
/* ------------------------------------------------------------------ */

/**
 * Devolve o detalhe de um paciente.
 *
 * Permissões: isRececionista (todos) + isClinico (dados completos).
 * Rececionista recebe versão sanitizada.
 */
exports.obterPaciente = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de paciente inválido.' });
    }

    const clinico = temAcessoClinico(req);
    const select = clinico
      ? 'nome data_nascimento genero num_utente nif telefone email morada contacto_emergencia historico_medico alergias consentimento_dados ativo observacoes origem createdAt updatedAt empresa_id'
      : 'nome data_nascimento genero num_utente telefone email ativo observacoes origem createdAt updatedAt empresa_id';

    const paciente = await Paciente.findOne({
      _id: id,
      empresa_id: empresaId,
      eliminado_em: null,
    })
      .select(select)
      .lean();

    if (!paciente) {
      return res.status(404).json({ erro: 'Paciente não encontrado.' });
    }

    return res.status(200).json({
      paciente,
      dados_clinicos: clinico,
    });
  } catch (err) {
    console.error('❌ obterPaciente:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* POST /api/gestor/pacientes — cria um paciente                      */
/* ------------------------------------------------------------------ */

/**
 * Cria um novo paciente na empresa do utilizador autenticado.
 *
 * Body:
 *   - nome (obrigatório)
 *   - telefone (obrigatório)
 *   - data_nascimento, genero, num_utente, nif, email, morada (opcionais)
 *   - contacto_emergencia { nome, telefone, relacao } (opcional, só isClinico)
 *   - historico_medico, alergias (opcionais, só isClinico)
 *   - consentimento_dados { concedido, versao_termos } (opcional)
 *   - observacoes, origem (opcionais)
 *
 * Permissões: isRececionista (todos podem criar).
 *   - Rececionista NÃO pode definir historico_medico/alergias/contacto_emergencia
 *     (campos clínicos). Se os enviar, são ignorados.
 *   - isClinico pode definir todos os campos.
 */
exports.criarPaciente = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const {
      nome,
      telefone,
      data_nascimento,
      genero,
      num_utente,
      nif,
      email,
      morada,
      contacto_emergencia,
      historico_medico,
      alergias,
      consentimento_dados,
      observacoes,
      origem,
    } = req.body || {};

    // Validações de presença.
    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ erro: 'Nome é obrigatório.' });
    }
    if (!telefone || !String(telefone).trim()) {
      return res.status(400).json({ erro: 'Telefone é obrigatório.' });
    }

    // Validação de género.
    if (genero && !['M', 'F', 'Outro', 'NA'].includes(genero)) {
      return res.status(400).json({ erro: 'Género inválido (M, F, Outro, NA).' });
    }

    // Validação de origem.
    if (origem && !['walk_in', 'referenciacao', 'online', 'outro'].includes(origem)) {
      return res.status(400).json({ erro: 'Origem inválida.' });
    }

    // Validação de data_nascimento (não pode ser futura).
    if (data_nascimento) {
      const dn = new Date(data_nascimento);
      if (isNaN(dn.getTime())) {
        return res.status(400).json({ erro: 'data_nascimento inválida.' });
      }
      if (dn > new Date()) {
        return res.status(400).json({ erro: 'data_nascimento não pode ser futura.' });
      }
    }

    const clinico = temAcessoClinico(req);

    const novoPaciente = {
      empresa_id: empresaId,
      nome: String(nome).trim(),
      telefone: String(telefone).trim(),
      data_nascimento: data_nascimento || null,
      genero: genero || 'NA',
      num_utente: num_utente ? String(num_utente).trim() : '',
      nif: nif ? String(nif).trim() : '',
      email: email ? String(email).trim().toLowerCase() : '',
      morada: morada ? String(morada).trim() : '',
      observacoes: observacoes ? String(observacoes).trim() : '',
      origem: origem || 'walk_in',
    };

    // Consentimento RGPD.
    if (consentimento_dados && typeof consentimento_dados === 'object') {
      novoPaciente.consentimento_dados = {
        concedido: !!consentimento_dados.concedido,
        data: consentimento_dados.concedido ? new Date() : null,
        versao_termos: consentimento_dados.versao_termos || '1.0',
      };
    }

    // Campos clínicos — só isClinico pode definir.
    if (clinico) {
      if (contacto_emergencia && typeof contacto_emergencia === 'object') {
        novoPaciente.contacto_emergencia = {
          nome: contacto_emergencia.nome ? String(contacto_emergencia.nome).trim() : '',
          telefone: contacto_emergencia.telefone ? String(contacto_emergencia.telefone).trim() : '',
          relacao: contacto_emergencia.relacao ? String(contacto_emergencia.relacao).trim() : '',
        };
      }
      if (historico_medico !== undefined) {
        novoPaciente.historico_medico = String(historico_medico);
      }
      if (Array.isArray(alergias)) {
        novoPaciente.alergias = alergias
          .filter((a) => typeof a === 'string' && a.trim())
          .map((a) => String(a).trim());
      }
    }

    const criado = await Paciente.create(novoPaciente);

    // Auditoria.
    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'criar',
      recurso: 'paciente',
      recurso_id: criado._id,
      descricao: `Paciente "${criado.nome}" criado`,
      detalhes: { num_utente: criado.num_utente || null },
    });

    // Resposta: sanitiza se rececionista.
    const resposta = clinico ? criado.toObject() : sanitizarParaNaoClinico(criado);
    return res.status(201).json({ paciente: resposta, dados_clinicos: clinico });
  } catch (err) {
    console.error('❌ criarPaciente:', err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ erro: 'Validação falhou.', detalhe: err.message });
    }
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* PUT /api/gestor/pacientes/:id — atualiza um paciente               */
/* ------------------------------------------------------------------ */

/**
 * Atualiza um paciente existente.
 *
 * Permissões: isRececionista (todos podem editar).
 *   - Rececionista NÃO pode editar campos clínicos (ignorados se enviados).
 *   - isClinico pode editar todos os campos.
 *
 * Campos editáveis: todos exceto empresa_id.
 */
exports.atualizarPaciente = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de paciente inválido.' });
    }

    const paciente = await Paciente.findOne({
      _id: id,
      empresa_id: empresaId,
      eliminado_em: null,
    });
    if (!paciente) {
      return res.status(404).json({ erro: 'Paciente não encontrado.' });
    }

    const {
      nome,
      telefone,
      data_nascimento,
      genero,
      num_utente,
      nif,
      email,
      morada,
      contacto_emergencia,
      historico_medico,
      alergias,
      consentimento_dados,
      observacoes,
      origem,
      ativo,
    } = req.body || {};

    const clinico = temAcessoClinico(req);

    // Campos administrativos (todos podem editar).
    if (nome !== undefined) {
      if (!String(nome).trim()) return res.status(400).json({ erro: 'nome não pode ser vazio.' });
      paciente.nome = String(nome).trim();
    }
    if (telefone !== undefined) {
      if (!String(telefone).trim()) return res.status(400).json({ erro: 'telefone não pode ser vazio.' });
      paciente.telefone = String(telefone).trim();
    }
    if (data_nascimento !== undefined) {
      if (data_nascimento === null) {
        paciente.data_nascimento = null;
      } else {
        const dn = new Date(data_nascimento);
        if (isNaN(dn.getTime())) return res.status(400).json({ erro: 'data_nascimento inválida.' });
        if (dn > new Date()) return res.status(400).json({ erro: 'data_nascimento não pode ser futura.' });
        paciente.data_nascimento = dn;
      }
    }
    if (genero !== undefined) {
      if (!['M', 'F', 'Outro', 'NA'].includes(genero)) {
        return res.status(400).json({ erro: 'Género inválido.' });
      }
      paciente.genero = genero;
    }
    if (num_utente !== undefined) paciente.num_utente = String(num_utente).trim();
    if (nif !== undefined) paciente.nif = String(nif).trim();
    if (email !== undefined) paciente.email = String(email).trim().toLowerCase();
    if (morada !== undefined) paciente.morada = String(morada).trim();
    if (observacoes !== undefined) paciente.observacoes = String(observacoes).trim();
    if (origem !== undefined) {
      if (!['walk_in', 'referenciacao', 'online', 'outro'].includes(origem)) {
        return res.status(400).json({ erro: 'Origem inválida.' });
      }
      paciente.origem = origem;
    }
    if (ativo !== undefined) paciente.ativo = !!ativo;

    // Consentimento RGPD.
    if (consentimento_dados !== undefined && typeof consentimento_dados === 'object') {
      paciente.consentimento_dados = {
        concedido: !!consentimento_dados.concedido,
        data: consentimento_dados.concedido ? (consentimento_dados.data ? new Date(consentimento_dados.data) : new Date()) : null,
        versao_termos: consentimento_dados.versao_termos || paciente.consentimento_dados?.versao_termos || '1.0',
      };
    }

    // Campos clínicos — só isClinico pode editar.
    if (clinico) {
      if (contacto_emergencia !== undefined && typeof contacto_emergencia === 'object') {
        paciente.contacto_emergencia = {
          nome: contacto_emergencia.nome ? String(contacto_emergencia.nome).trim() : '',
          telefone: contacto_emergencia.telefone ? String(contacto_emergencia.telefone).trim() : '',
          relacao: contacto_emergencia.relacao ? String(contacto_emergencia.relacao).trim() : '',
        };
      }
      if (historico_medico !== undefined) paciente.historico_medico = String(historico_medico);
      if (alergias !== undefined) {
        paciente.alergias = Array.isArray(alergias)
          ? alergias.filter((a) => typeof a === 'string' && a.trim()).map((a) => String(a).trim())
          : [];
      }
    }

    await paciente.save();

    // Auditoria.
    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'atualizar',
      recurso: 'paciente',
      recurso_id: paciente._id,
      descricao: `Paciente "${paciente.nome}" atualizado`,
    });

    const resposta = clinico ? paciente.toObject() : sanitizarParaNaoClinico(paciente);
    return res.status(200).json({ paciente: resposta, dados_clinicos: clinico });
  } catch (err) {
    console.error('❌ atualizarPaciente:', err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ erro: 'Validação falhou.', detalhe: err.message });
    }
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* DELETE /api/gestor/pacientes/:id — soft delete                     */
/* ------------------------------------------------------------------ */

/**
 * Soft delete de um paciente (RGPD: preserva histórico).
 * Marca eliminado_em = now() e ativo = false.
 *
 * Permissões: isDiretorClinico (só diretor_clinico + admin).
 */
exports.eliminarPaciente = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de paciente inválido.' });
    }

    const paciente = await Paciente.findOneAndUpdate(
      { _id: id, empresa_id: empresaId, eliminado_em: null },
      { $set: { eliminado_em: new Date(), ativo: false } },
      { new: true }
    ).select('_id nome eliminado_em ativo');

    if (!paciente) {
      return res.status(404).json({ erro: 'Paciente não encontrado.' });
    }

    // Auditoria.
    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'soft-delete',
      recurso: 'paciente',
      recurso_id: paciente._id,
      descricao: `Paciente "${paciente.nome}" eliminado (soft delete).`,
    });

    return res.status(200).json({
      message: `Paciente "${paciente.nome}" eliminado.`,
      paciente: { _id: String(paciente._id), eliminado_em: paciente.eliminado_em },
    });
  } catch (err) {
    console.error('❌ eliminarPaciente:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* PATCH /api/gestor/pacientes/:id/estado — alterna ativo             */
/* ------------------------------------------------------------------ */

/**
 * Alterna o estado ativo do paciente (sem eliminar).
 * Útil para pacientes que receberam alta mas podem voltar.
 *
 * Permissões: isRececionista.
 * Body (opcional): { ativo: boolean }
 */
exports.alternarEstadoPaciente = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de paciente inválido.' });
    }

    const paciente = await Paciente.findOne({
      _id: id,
      empresa_id: empresaId,
      eliminado_em: null,
    });
    if (!paciente) {
      return res.status(404).json({ erro: 'Paciente não encontrado.' });
    }

    const novoEstado = typeof req.body?.ativo === 'boolean' ? req.body.ativo : !paciente.ativo;
    paciente.ativo = novoEstado;
    await paciente.save();

    return res.status(200).json({
      message: `Paciente ${novoEstado ? 'ativado' : 'desativado'}.`,
      paciente: { _id: String(paciente._id), nome: paciente.nome, ativo: paciente.ativo },
    });
  } catch (err) {
    console.error('❌ alternarEstadoPaciente:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

module.exports.temAcessoClinico = temAcessoClinico;
module.exports.sanitizarParaNaoClinico = sanitizarParaNaoClinico;
