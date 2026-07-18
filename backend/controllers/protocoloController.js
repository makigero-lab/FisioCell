/**
 * Protocolo Controller — FisioCell
 *
 * F5 — CRUD de Modelos de Protocolo Clínico.
 *
 * Endpoints (montados em /api/gestor/protocolos):
 *   GET    /            — lista protocolos da empresa (filtro: area, ativo)
 *   POST   /            — cria um novo protocolo
 *   GET    /:id         — devolve um protocolo específico
 *   PUT    /:id         — atualiza um protocolo
 *   DELETE /:id         — apaga um protocolo (hard delete)
 *
 * Permissões: isDiretorClinico (só diretor/admin gerem protocolos clínicos).
 * Listagem pode ser vista por isClinico (fisio precisa de ver para aplicar).
 */
const mongoose = require('mongoose');
const ModeloProtocolo = require('../models/ModeloProtocolo');
const { obterEmpresaId } = require('./gestorController');
const { registarAuditoria } = require('../utils/auditoria');

// GET /api/gestor/protocolos
exports.listarProtocolos = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { area, ativo } = req.query;
    const filtro = { empresa_id: empresaId };
    if (area && ['musculoesqueletica', 'neurologica', 'cardioresp', 'desporto', 'pediatria', 'outro'].includes(area)) {
      filtro.area = area;
    }
    if (ativo === 'true') filtro.ativo = true;
    if (ativo === 'false') filtro.ativo = false;

    const protocolos = await ModeloProtocolo.find(filtro)
      .sort({ area: 1, nome: 1 })
      .lean();

    return res.status(200).json({ protocolos, total: protocolos.length });
  } catch (err) {
    console.error('❌ listarProtocolos:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

// POST /api/gestor/protocolos
exports.criarProtocolo = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { nome, descricao, area, seccoes, ativo = true } = req.body || {};

    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ erro: 'Nome é obrigatório.' });
    }
    if (area && !['musculoesqueletica', 'neurologica', 'cardioresp', 'desporto', 'pediatria', 'outro'].includes(area)) {
      return res.status(400).json({ erro: 'Área clínica inválida.' });
    }
    if (!Array.isArray(seccoes) || seccoes.length === 0) {
      return res.status(400).json({ erro: 'Pelo menos uma secção é obrigatória.' });
    }

    // Valida estrutura das secções.
    for (const sec of seccoes) {
      if (!sec.nome || !String(sec.nome).trim()) {
        return res.status(400).json({ erro: 'Cada secção deve ter um nome.' });
      }
      if (!Array.isArray(sec.items) || sec.items.length === 0) {
        return res.status(400).json({ erro: `Secção "${sec.nome}" deve ter pelo menos um item.` });
      }
    }

    const novo = await ModeloProtocolo.create({
      empresa_id: empresaId,
      nome: String(nome).trim(),
      descricao: descricao ? String(descricao).trim() : '',
      area: area || 'musculoesqueletica',
      seccoes: seccoes.map((sec) => ({
        nome: String(sec.nome).trim(),
        items: sec.items.map((item) => String(item).trim()).filter(Boolean),
      })),
      ativo: ativo !== false,
    });

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'criar',
      recurso: 'modelo_protocolo',
      recurso_id: novo._id,
      descricao: `Protocolo "${novo.nome}" criado (${novo.area})`,
    });

    return res.status(201).json({ protocolo: novo });
  } catch (err) {
    console.error('❌ criarProtocolo:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

// GET /api/gestor/protocolos/:id
exports.obterProtocolo = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const protocolo = await ModeloProtocolo.findOne({ _id: id, empresa_id: empresaId }).lean();
    if (!protocolo) {
      return res.status(404).json({ erro: 'Protocolo não encontrado.' });
    }

    return res.status(200).json({ protocolo });
  } catch (err) {
    console.error('❌ obterProtocolo:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

// PUT /api/gestor/protocolos/:id
exports.atualizarProtocolo = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const { nome, descricao, area, seccoes, ativo } = req.body || {};

    if (area && !['musculoesqueletica', 'neurologica', 'cardioresp', 'desporto', 'pediatria', 'outro'].includes(area)) {
      return res.status(400).json({ erro: 'Área clínica inválida.' });
    }

    const update = {};
    if (nome !== undefined) update.nome = String(nome).trim();
    if (descricao !== undefined) update.descricao = String(descricao).trim();
    if (area !== undefined) update.area = area;
    if (ativo !== undefined) update.ativo = !!ativo;
    if (seccoes !== undefined) {
      if (!Array.isArray(seccoes)) {
        return res.status(400).json({ erro: 'Secções deve ser um array.' });
      }
      for (const sec of seccoes) {
        if (!sec.nome || !String(sec.nome).trim()) {
          return res.status(400).json({ erro: 'Cada secção deve ter um nome.' });
        }
      }
      update.seccoes = seccoes.map((sec) => ({
        nome: String(sec.nome).trim(),
        items: Array.isArray(sec.items) ? sec.items.map((i) => String(i).trim()).filter(Boolean) : [],
      }));
    }

    const protocolo = await ModeloProtocolo.findOneAndUpdate(
      { _id: id, empresa_id: empresaId },
      { $set: update },
      { new: true }
    ).lean();

    if (!protocolo) {
      return res.status(404).json({ erro: 'Protocolo não encontrado.' });
    }

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'atualizar',
      recurso: 'modelo_protocolo',
      recurso_id: protocolo._id,
      descricao: `Protocolo "${protocolo.nome}" atualizado`,
    });

    return res.status(200).json({ protocolo });
  } catch (err) {
    console.error('❌ atualizarProtocolo:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

// DELETE /api/gestor/protocolos/:id
exports.apagarProtocolo = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const resultado = await ModeloProtocolo.deleteOne({ _id: id, empresa_id: empresaId });
    if (resultado.deletedCount === 0) {
      return res.status(404).json({ erro: 'Protocolo não encontrado.' });
    }

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'eliminar',
      recurso: 'modelo_protocolo',
      recurso_id: id,
      descricao: `Protocolo eliminado`,
    });

    return res.status(200).json({ message: 'Protocolo apagado com sucesso.' });
  } catch (err) {
    console.error('❌ apagarProtocolo:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* Helper — gera snapshot de protocolo para injectar na Consulta       */
/* ------------------------------------------------------------------ */

/**
 * Gera um snapshot do protocolo para guardar na Consulta.
 * O snapshot tem a estrutura { nome, items: [{ texto, concluido }] } por secção.
 *
 * @param {string|ObjectId} protocoloId
 * @param {string} empresaId
 * @returns {Promise<Array<{ nome: string, items: Array<{ texto: string, concluido: boolean }> }> | null>}
 */
exports.gerarSnapshotProtocolo = async function (protocoloId, empresaId) {
  if (!protocoloId) return null;
  const protocolo = await ModeloProtocolo.findOne({
    _id: protocoloId,
    empresa_id: empresaId,
  }).lean();

  if (!protocolo) return null;

  // Snapshot: copia secções + items com concluido=false.
  return protocolo.seccoes.map((sec) => ({
    nome: sec.nome,
    items: sec.items.map((item) => ({
      texto: item,
      concluido: false,
    })),
  }));
};
