/**
 * Documento Controller — FisioCell
 *
 * F9 — Gestão de anexos clínicos (receitas, relatórios, fotografias, etc.).
 *
 * Endpoints (montados em /api/gestor/documentos):
 *   GET    /                — lista documentos (filtro: paciente_id, consulta_id, tipo)
 *   GET    /:id             — detalhe de um documento
 *   GET    /:id/download    — download do ficheiro
 *   POST   /upload          — upload de ficheiro (multipart/form-data)
 *   DELETE /:id             — soft delete
 *
 * Permissões:
 *   - isRececionista: ver/listar todos os documentos.
 *   - isClinico: ver + upload (fisio pode anexar a consultas dele).
 *   - isDiretorClinico: eliminar.
 */
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Documento = require('../models/Documento');
const Paciente = require('../models/Paciente');
const Consulta = require('../models/Consulta');
const { obterEmpresaId } = require('./gestorController');
const { registarAuditoria } = require('../utils/auditoria');

/**
 * Verifica se o utilizador tem acesso clínico (pode ver documentos clínicos).
 */
function temAcessoClinico(req) {
  const role = req.user && req.user.role;
  return ['admin', 'diretor_clinico', 'fisioterapeuta'].includes(role);
}

/* ------------------------------------------------------------------ */
/* GET /api/gestor/documentos — lista documentos                       */
/* ------------------------------------------------------------------ */

exports.listarDocumentos = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { paciente_id, consulta_id, tipo } = req.query;
    const filtro = { empresa_id: empresaId, eliminado_em: null };

    if (paciente_id) filtro.paciente_id = paciente_id;
    if (consulta_id) filtro.consulta_id = consulta_id;
    if (tipo && ['receita', 'relatorio', 'termo_consentimento', 'foto', 'exame', 'outro'].includes(tipo)) {
      filtro.tipo = tipo;
    }

    const documentos = await Documento.find(filtro)
      .populate('uploaded_by', 'nome')
      .populate('paciente_id', 'nome')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ documentos, total: documentos.length });
  } catch (err) {
    console.error('❌ listarDocumentos:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* GET /api/gestor/documentos/:id — detalhe                            */
/* ------------------------------------------------------------------ */

exports.obterDocumento = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const doc = await Documento.findOne({ _id: id, empresa_id: empresaId, eliminado_em: null })
      .populate('uploaded_by', 'nome')
      .populate('paciente_id', 'nome')
      .lean();

    if (!doc) {
      return res.status(404).json({ erro: 'Documento não encontrado.' });
    }

    return res.status(200).json({ documento: doc });
  } catch (err) {
    console.error('❌ obterDocumento:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* GET /api/gestor/documentos/:id/download — download do ficheiro     */
/* ------------------------------------------------------------------ */

exports.downloadDocumento = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const doc = await Documento.findOne({ _id: id, empresa_id: empresaId, eliminado_em: null }).lean();
    if (!doc) {
      return res.status(404).json({ erro: 'Documento não encontrado.' });
    }

    // Verifica se o ficheiro existe no storage local.
    const filePath = path.resolve(doc.url_storage);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ erro: 'Ficheiro não encontrado no storage.' });
    }

    // Envia o ficheiro com o nome original.
    return res.download(filePath, doc.nome_original);
  } catch (err) {
    console.error('❌ downloadDocumento:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* POST /api/gestor/documentos/upload — upload de ficheiro             */
/* ------------------------------------------------------------------ */

/**
 * Upload de ficheiro (multipart/form-data).
 *
 * Body:
 *   - file: ficheiro (multipart)
 *   - paciente_id (obrigatório)
 *   - consulta_id (opcional)
 *   - tipo (default 'outro')
 *   - descricao (opcional)
 *   - consentimento_obtido (boolean, default false)
 *
 * Permissões: podeVer (todos os 4 roles podem fazer upload).
 */
exports.uploadDocumento = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    // Verifica se o ficheiro foi enviado.
    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhum ficheiro enviado.' });
    }

    const { paciente_id, consulta_id, tipo = 'outro', descricao = '', consentimento_obtido = false } = req.body || {};

    if (!paciente_id) {
      return res.status(400).json({ erro: 'paciente_id é obrigatório.' });
    }

    // Valida tipo.
    if (!['receita', 'relatorio', 'termo_consentimento', 'foto', 'exame', 'outro'].includes(tipo)) {
      return res.status(400).json({ erro: 'Tipo inválido.' });
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

    // Valida consulta (se fornecida).
    if (consulta_id) {
      const consulta = await Consulta.findOne({
        _id: consulta_id,
        empresa_id: empresaId,
      }).lean();
      if (!consulta) {
        return res.status(400).json({ erro: 'Consulta não encontrada.' });
      }
    }

    // Cria o registo do documento.
    const novo = await Documento.create({
      empresa_id: empresaId,
      paciente_id,
      consulta_id: consulta_id || null,
      uploaded_by: req.user.id,
      tipo,
      nome_original: req.file.originalname,
      url_storage: req.file.path,
      content_type: req.file.mimetype,
      tamanho_bytes: req.file.size,
      descricao: descricao ? String(descricao).trim() : '',
      consentimento_obtido: !!consentimento_obtido,
      data_consentimento: consentimento_obtido ? new Date() : null,
    });

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'upload_documento',
      recurso: 'documento',
      recurso_id: novo._id,
      descricao: `Documento "${novo.nome_original}" carregado para paciente "${paciente.nome}"`,
    });

    return res.status(201).json({ documento: novo });
  } catch (err) {
    console.error('❌ uploadDocumento:', err.message);
    // Se falhou após o ficheiro ser gravado, apaga-o.
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* DELETE /api/gestor/documentos/:id — soft delete                     */
/* ------------------------------------------------------------------ */

exports.eliminarDocumento = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const doc = await Documento.findOneAndUpdate(
      { _id: id, empresa_id: empresaId, eliminado_em: null },
      { $set: { eliminado_em: new Date() } },
      { new: true }
    ).select('_id nome_original eliminado_em');

    if (!doc) {
      return res.status(404).json({ erro: 'Documento não encontrado.' });
    }

    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Utilizador',
      empresa_id: empresaId,
      acao: 'eliminar_documento',
      recurso: 'documento',
      recurso_id: doc._id,
      descricao: `Documento "${doc.nome_original}" eliminado (soft delete)`,
    });

    return res.status(200).json({ message: 'Documento eliminado.', documento: { _id: String(doc._id) } });
  } catch (err) {
    console.error('❌ eliminarDocumento:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

module.exports.temAcessoClinico = temAcessoClinico;
