/**
 * Rotas do Super Admin — FisioCell
 *
 * Prefixo montado em server.js: /api/admin
 *
 * F0 — Rotas Smoobu removidas (sincronizar-propriedades, sincronizar-reservas,
 * registrar-webhooks, backfill-nomes-hospedes, backfill-tempos-viagem).
 * Endpoints /config-empresa e /empresas/:id/config refatorados para gerir
 * nome/nif/morada/telefone/email (antes: smoobu_api_key).
 *
 * F8 — Limpeza: removidas routes /seed-checklists (ModeloChecklist eliminado)
 * e /forcar-daily-briefing, /forcar-agenda-amanha, /forcar-cao-guarda
 * (jobs legacy eliminados). O hard-reset passa a apagar Consulta em vez de
 * Tarefa (Tarefa eliminado em F8).
 *
 * Segurança: todas as rotas usam auth + isAdmin (ESTRITO — só role 'admin').
 */
const express = require('express');
const router = express.Router();

const { auth } = require('../middleware/auth');
const { isAdmin } = require('../middleware/requireRole');
const {
  listarEmpresas,
  impersonarGestor,
  listarUtilizadoresEmpresa,
  criarUtilizadorEmpresa,
  alternarEstadoUtilizadorEmpresa,
} = require('../controllers/superAdminController');

// Todas as rotas exigem auth + isAdmin (só Super Admin).
router.use(auth, isAdmin);

// Listar todas as empresas (cross-tenant) com gestor principal.
router.get('/empresas', listarEmpresas);

// Impersonar gestor de uma empresa (gera token JWT do gestor).
router.post('/empresas/:id/impersonar', impersonarGestor);

// Gestão de utilizadores de empresas terceiras.
router.get('/empresas/:empresaId/utilizadores', listarUtilizadoresEmpresa);
router.post('/empresas/:empresaId/utilizadores', criarUtilizadorEmpresa);
router.patch(
  '/empresas/:empresaId/utilizadores/:utilizadorId/estado',
  alternarEstadoUtilizadorEmpresa
);

// Hard Reset global: apaga TODAS as Propriedades e Consultas da empresa
// do utilizador autenticado (admin). Se o admin for cross-tenant, apaga tudo.
// F8 — Tarefa eliminado, passa a apagar Consulta (F4+).
router.delete('/hard-reset', async (req, res) => {
  try {
    const Propriedade = require('../models/Propriedade');
    const Consulta = require('../models/Consulta');
    const mongoose = require('mongoose');

    const empresaId = req.user && req.user.empresa_id;
    const filtro = empresaId && mongoose.isValidObjectId(empresaId)
      ? { empresa_id: empresaId }
      : {};

    const propsResult = await Propriedade.deleteMany(filtro);
    const consultasResult = await Consulta.deleteMany(filtro);

    console.log(
      `🗑️  Hard Reset por admin ${req.user?.email || '?'} — ` +
        `${propsResult.deletedCount} propriedade(s) e ${consultasResult.deletedCount} consulta(s) apagadas` +
        (empresaId ? ` (empresa ${empresaId}).` : ' (TODAS as empresas).')
    );

    return res.status(200).json({
      message: 'Base de dados limpa com sucesso. Propriedades e Consultas eliminadas.',
      detalhe: {
        propriedades_apagadas: propsResult.deletedCount,
        consultas_apagadas: consultasResult.deletedCount,
        ambito: empresaId ? `empresa ${empresaId}` : 'todas as empresas',
      },
    });
  } catch (err) {
    console.error('❌ hard-reset:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.', detalhe: err.message });
  }
});

// Enviar Push de Teste para o utilizador atual.
router.post('/push-teste', async (req, res) => {
  try {
    const { notificarUtilizador } = require('../utils/notificar');
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(400).json({ erro: 'Utilizador sem ID no token.' });
    }
    notificarUtilizador(
      String(userId),
      '🧪 Push de Teste',
      'Se estás a ver esta notificação, o sistema de push notifications está a funcionar!',
      '/admin/sistema',
      { criarInApp: true, tipo: 'sistema' }
    );
    return res.status(200).json({ message: 'Push de teste enviado. Verifica o teu dispositivo (se tiveres subscrição ativa).' });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao enviar push.', detalhe: err.message });
  }
});

// Configuração da Empresa (tenant local do admin).
router.get('/config-empresa', async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const empresaId = req.user && req.user.empresa_id;
    if (!empresaId) {
      return res.status(400).json({ erro: 'Admin sem empresa_id associada.' });
    }
    const empresa = await Empresa.findById(empresaId).select('nome nif morada telefone email').lean();
    if (!empresa) {
      return res.status(404).json({ erro: 'Empresa não encontrada.' });
    }
    return res.status(200).json({
      nome: empresa.nome,
      nif: empresa.nif || '',
      morada: empresa.morada || '',
      telefone: empresa.telefone || '',
      email: empresa.email || '',
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro interno.', detalhe: err.message });
  }
});

router.put('/config-empresa', async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const empresaId = req.user && req.user.empresa_id;
    if (!empresaId) {
      return res.status(400).json({ erro: 'Admin sem empresa_id associada.' });
    }
    const { nome, nif, morada, telefone, email } = req.body || {};
    const update = {};
    if (nome !== undefined) update.nome = String(nome).trim();
    if (nif !== undefined) update.nif = String(nif).trim();
    if (morada !== undefined) update.morada = String(morada).trim();
    if (telefone !== undefined) update.telefone = String(telefone).trim();
    if (email !== undefined) update.email = String(email).trim().toLowerCase();

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ erro: 'Nenhum campo para atualizar.' });
    }

    const empresa = await Empresa.findByIdAndUpdate(empresaId, { $set: update }, { new: true }).select('nome nif morada telefone email').lean();
    if (!empresa) {
      return res.status(404).json({ erro: 'Empresa não encontrada.' });
    }
    return res.status(200).json({
      message: 'Configuração guardada com sucesso.',
      nome: empresa.nome,
      nif: empresa.nif || '',
      morada: empresa.morada || '',
      telefone: empresa.telefone || '',
      email: empresa.email || '',
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro interno.', detalhe: err.message });
  }
});

// CRUD de Empresas (Super Admin).

// Criar Nova Empresa.
router.post('/empresas', async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const { nome, nif, morada, telefone, email } = req.body || {};
    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ erro: 'Nome da empresa é obrigatório.' });
    }
    const nova = await Empresa.create({
      nome: String(nome).trim(),
      nif: nif ? String(nif).trim() : '',
      morada: morada ? String(morada).trim() : '',
      telefone: telefone ? String(telefone).trim() : '',
      email: email ? String(email).trim().toLowerCase() : '',
    });
    return res.status(201).json({ empresa: nova });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao criar empresa.', detalhe: err.message });
  }
});

// Eliminar Empresa (SOFT DELETE).
router.delete('/empresas/:id', async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const { id } = req.params;
    const mongoose = require('mongoose');
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }
    const empresa = await Empresa.findByIdAndUpdate(
      id,
      { $set: { apagada: true, ativa: false } },
      { new: true }
    ).select('nome apagada ativa');
    if (!empresa) {
      return res.status(404).json({ erro: 'Empresa não encontrada.' });
    }
    const { registarAuditoria } = require('../utils/auditoria');
    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Super Admin',
      empresa_id: id,
      acao: 'soft-delete',
      recurso: 'empresa',
      recurso_id: id,
      descricao: `Empresa "${empresa.nome}" movida para a reciclagem (apagada: true).`,
    });
    return res.status(200).json({
      message: `Empresa "${empresa.nome}" movida para a reciclagem.`,
      empresa: { _id: String(empresa._id), apagada: empresa.apagada, ativa: empresa.ativa },
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao eliminar empresa.', detalhe: err.message });
  }
});

// Restaurar Empresa (desfaz o soft delete).
router.patch('/empresas/:id/restaurar', async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const { id } = req.params;
    const mongoose = require('mongoose');
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }
    const empresa = await Empresa.findByIdAndUpdate(
      id,
      { $set: { apagada: false } },
      { new: true }
    ).select('nome apagada ativa');
    if (!empresa) {
      return res.status(404).json({ erro: 'Empresa não encontrada.' });
    }
    const { registarAuditoria } = require('../utils/auditoria');
    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Super Admin',
      empresa_id: id,
      acao: 'restaurar',
      recurso: 'empresa',
      recurso_id: id,
      descricao: `Empresa "${empresa.nome}" restaurada da reciclagem (apagada: false).`,
    });
    return res.status(200).json({
      message: `Empresa "${empresa.nome}" restaurada. Carrega em "Ativar" para reativar o acesso.`,
      empresa: { _id: String(empresa._id), apagada: empresa.apagada, ativa: empresa.ativa },
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao restaurar empresa.', detalhe: err.message });
  }
});

// Toggle do estado `ativa` de uma empresa.
router.patch('/empresas/:id/toggle-status', async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const { id } = req.params;
    const mongoose = require('mongoose');
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }
    const empresa = await Empresa.findById(id);
    if (!empresa) {
      return res.status(404).json({ erro: 'Empresa não encontrada.' });
    }
    const novoEstado = typeof req.body?.ativa === 'boolean' ? req.body.ativa : !empresa.ativa;
    empresa.ativa = novoEstado;
    await empresa.save();
    return res.status(200).json({
      message: `Empresa ${novoEstado ? 'ativada' : 'desativada'} com sucesso.`,
      empresa: { _id: String(empresa._id), nome: empresa.nome, ativa: empresa.ativa },
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao alterar estado da empresa.', detalhe: err.message });
  }
});

// Hard reset de UMA empresa específica.
// F8 — Tarefa eliminado, passa a apagar Consulta (F4+).
router.post('/empresas/:id/hard-reset', async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const Propriedade = require('../models/Propriedade');
    const Consulta = require('../models/Consulta');
    const { id } = req.params;
    const mongoose = require('mongoose');
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }
    const empresa = await Empresa.findById(id).select('_id nome').lean();
    if (!empresa) {
      return res.status(404).json({ erro: 'Empresa não encontrada.' });
    }
    const [propApagadas, consultasApagadas] = await Promise.all([
      Propriedade.deleteMany({ empresa_id: id }),
      Consulta.deleteMany({ empresa_id: id }),
    ]);
    const { registarAuditoria } = require('../utils/auditoria');
    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Super Admin',
      empresa_id: id,
      acao: 'hard-reset',
      recurso: 'empresa',
      recurso_id: id,
      descricao: `Hard reset da empresa "${empresa.nome}": ${propApagadas.deletedCount} propriedade(s) e ${consultasApagadas.deletedCount} consulta(s) apagadas.`,
      detalhes: { propriedades: propApagadas.deletedCount, consultas: consultasApagadas.deletedCount },
    });
    return res.status(200).json({
      message: `Hard reset concluído para a empresa "${empresa.nome}".`,
      detalhe: {
        propriedades_apagadas: propApagadas.deletedCount,
        consultas_apagadas: consultasApagadas.deletedCount,
      },
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro no hard reset da empresa.', detalhe: err.message });
  }
});

// Gaveta da Empresa: endpoints scoped por :id (empresa_id).

// GET /api/admin/empresas/:id/config — devolve a configuração da empresa.
router.get('/empresas/:id/config', async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const { id } = req.params;
    const mongoose = require('mongoose');
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }
    const emp = await Empresa.findById(id).select('nome nif morada telefone email ativa').lean();
    if (!emp) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    return res.status(200).json({
      nome: emp.nome,
      nif: emp.nif || '',
      morada: emp.morada || '',
      telefone: emp.telefone || '',
      email: emp.email || '',
      ativa: emp.ativa,
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao carregar config.', detalhe: err.message });
  }
});

// PUT /api/admin/empresas/:id/config — atualiza a configuração da empresa.
router.put('/empresas/:id/config', async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const { id } = req.params;
    const mongoose = require('mongoose');
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }
    const { nome, nif, morada, telefone, email } = req.body || {};
    const update = {};
    if (nome !== undefined) update.nome = String(nome).trim();
    if (nif !== undefined) update.nif = String(nif).trim();
    if (morada !== undefined) update.morada = String(morada).trim();
    if (telefone !== undefined) update.telefone = String(telefone).trim();
    if (email !== undefined) update.email = String(email).trim().toLowerCase();
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ erro: 'Nenhum campo para atualizar.' });
    }
    const emp = await Empresa.findByIdAndUpdate(id, { $set: update }, { new: true }).select('nome nif morada telefone email').lean();
    if (!emp) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    return res.status(200).json({
      message: 'Configuração guardada.',
      nome: emp.nome,
      nif: emp.nif || '',
      morada: emp.morada || '',
      telefone: emp.telefone || '',
      email: emp.email || '',
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao guardar config.', detalhe: err.message });
  }
});

// F8 — Rota /seed-checklists REMOVIDA (ModeloChecklist eliminado em F8).
// Para seeds de protocolos clínicos, usar o endpoint de Protocolos (F5)
// ou scripts dedicados (a criar futuramente).

// Monitor de Webhooks (Caixa Negra).

// GET /api/admin/webhook-logs — lista todos os logs de webhooks (cross-tenant).
router.get('/webhook-logs', async (req, res) => {
  try {
    const WebhookLog = require('../models/WebhookLog');
    const { status, limit, empresa_id } = req.query;
    const filtro = {};
    if (status && ['recebido', 'processado', 'erro'].includes(status)) {
      filtro.status = status;
    }
    if (empresa_id) {
      filtro.empresa_id = empresa_id;
    }
    const maxLimit = Math.min(Number(limit) || 100, 500);
    const logs = await WebhookLog.find(filtro)
      .sort({ createdAt: -1 })
      .limit(maxLimit)
      .lean();

    return res.status(200).json({ logs, total: logs.length });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro interno.', detalhe: err.message });
  }
});

// DELETE /api/admin/webhook-logs/limpar — elimina logs com mais de 30 dias.
router.delete('/webhook-logs/limpar', async (req, res) => {
  try {
    const WebhookLog = require('../models/WebhookLog');
    const limite = new Date();
    limite.setDate(limite.getDate() - 30);

    const resultado = await WebhookLog.deleteMany({ createdAt: { $lt: limite } });

    console.log(`🧹 Limpeza de webhook logs: ${resultado.deletedCount} registos com mais de 30 dias apagados.`);
    return res.status(200).json({
      message: 'Logs antigos limpos com sucesso.',
      apagados: resultado.deletedCount,
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao limpar logs.', detalhe: err.message });
  }
});

module.exports = router;
