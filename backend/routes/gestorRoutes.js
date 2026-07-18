/**
 * Rotas do Painel do Gestor de Operações — FisioCell
 *
 * Prefixo montado em server.js: /api/gestor
 *
 * F0 — Rotas Smoobu removidas. Endpoints /configuracoes refatorados para
 * gerir nome/nif/morada/telefone/email da empresa (antes: smoobu_api_key).
 */
const express = require('express');
const router = express.Router();

const { auth } = require('../middleware/auth');
const { isDiretorClinico } = require('../middleware/requireRole');
const {
  getDashboard,
  getPropriedades,
  criarPropriedade,
  atualizarPropriedade,
  alternarEstadoPropriedade,
  getTarefas,
  getDadosCalendario,
  getEquipa,
  criarMembroEquipa,
  atualizarMembroEquipa,
  alternarEstadoMembro,
  eliminarMembroEquipa,
  reportarFaltaSubita,
  registarBaixaProlongada,
  exportarTarefasCSV,
  getAuditoria,
  getWebhooks,
  reprocessarWebhook,
  setupClienteZero,
} = require('../controllers/gestorController');
const { reportarAtrasoTarefa, criarTarefa, atribuirTarefa, reatribuirTarefa, atualizarEstadoTarefa, apagarTarefasFuturas, listarIndisponiveisData, autoAtribuirTarefas } = require('../controllers/tarefaController');
const { listarModelos, criarModelo, obterModelo, atualizarModelo, apagarModelo } = require('../controllers/checklistController');

// Bootstrap do ambiente de testes — Cliente Zero. PÚBLICO (sem auth).
router.get('/setup', setupClienteZero);

// Dashboard com dados reais.
router.get('/dashboard', auth, isDiretorClinico, getDashboard);

// Gestão de propriedades/salas da empresa. PROTEGIDO por JWT.
router.get('/propriedades', auth, isDiretorClinico, getPropriedades);
router.post('/propriedades', auth, isDiretorClinico, criarPropriedade);
router.put('/propriedades/:id', auth, isDiretorClinico, atualizarPropriedade);
router.patch('/propriedades/:id/estado', auth, isDiretorClinico, alternarEstadoPropriedade);

// Aplica um checklist padrão a TODAS as propriedades ativas da empresa.
router.post('/propriedades/default-checklist', auth, isDiretorClinico, async (req, res) => {
  try {
    const Propriedade = require('../models/Propriedade');
    const empresaId = req.user && req.user.empresa_id;
    if (!empresaId) {
      return res.status(400).json({ erro: 'empresa_id em falta no token.' });
    }

    const CHECKLIST_PADRAO = [
      'Esvaziar lixo',
      'Trocar roupa da cama',
      'Trocar Toalhas',
      'Limpar chão',
      'Limpar vidros',
      'Limpar pó',
    ];

    const resultado = await Propriedade.updateMany(
      { empresa_id: empresaId },
      { $set: { checklist: CHECKLIST_PADRAO } }
    );

    return res.status(200).json({
      sucesso: true,
      message: `Checklist padrão aplicada a ${resultado.modifiedCount} propriedade(s).`,
      checklist: CHECKLIST_PADRAO,
      modificadas: resultado.modifiedCount,
      correspondidas: resultado.matchedCount,
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro interno.', detalhe: err.message });
  }
});

// Calendário Geral de Operações — lista tarefas com filtro de datas.
router.get('/tarefas', auth, isDiretorClinico, getTarefas);

// Calendário Visual Avançado — endpoint unificado com filtros + populate.
router.get('/calendario/dados', auth, isDiretorClinico, getDadosCalendario);

// Exportação CSV de tarefas.
router.get('/tarefas/export', auth, isDiretorClinico, exportarTarefasCSV);

// Reportar atraso numa tarefa.
router.post('/tarefas/:id/atraso', auth, isDiretorClinico, reportarAtrasoTarefa);

// Gestão manual de tarefas.
router.post('/tarefas', auth, isDiretorClinico, criarTarefa);
router.patch('/tarefas/:id/atribuir', auth, isDiretorClinico, atribuirTarefa);
router.patch('/tarefas/:id/reatribuir', auth, isDiretorClinico, reatribuirTarefa);
router.patch('/tarefas/:id/estado', auth, isDiretorClinico, atualizarEstadoTarefa);

// Apagar tarefas futuras não concluídas (reset do calendário).
router.delete('/tarefas/futuras', auth, isDiretorClinico, apagarTarefasFuturas);

// Auto-atribuição em lote (corre o load balancer para todas as tarefas órfãs).
router.post('/tarefas/auto-atribuir', auth, isDiretorClinico, autoAtribuirTarefas);

// Staff indisponíveis (férias/doença) numa data.
router.get('/tarefas/indisponiveis', auth, isDiretorClinico, listarIndisponiveisData);

// Gestão de equipa (utilizadores) da empresa. PROTEGIDO por JWT.
router.get('/equipa', auth, isDiretorClinico, getEquipa);
router.post('/equipa', auth, isDiretorClinico, criarMembroEquipa);
router.put('/equipa/:id', auth, isDiretorClinico, atualizarMembroEquipa);
router.patch('/equipa/:id/estado', auth, isDiretorClinico, alternarEstadoMembro);
router.delete('/equipa/:id', auth, isDiretorClinico, eliminarMembroEquipa);

// Falta súbita — reatribuição de emergência.
router.post('/equipa/:id/falta-subita', auth, isDiretorClinico, reportarFaltaSubita);

// Baixa prolongada / férias — redistribuição de tarefas futuras.
router.post('/equipa/:id/baixa', auth, isDiretorClinico, registarBaixaProlongada);

// CRUD de Modelos de Checklist (futuro: Modelos de Protocolo Clínico).
router.get('/checklists', auth, isDiretorClinico, listarModelos);
router.post('/checklists', auth, isDiretorClinico, criarModelo);
router.get('/checklists/:id', auth, isDiretorClinico, obterModelo);
router.put('/checklists/:id', auth, isDiretorClinico, atualizarModelo);
router.delete('/checklists/:id', auth, isDiretorClinico, apagarModelo);

// Auditoria.
router.get('/auditoria', auth, isDiretorClinico, getAuditoria);

// Webhooks — logs de integrações externas (lista + reproccessamento manual).
router.get('/webhooks', auth, isDiretorClinico, getWebhooks);
router.post('/webhooks/:id/reprocessar', auth, isDiretorClinico, reprocessarWebhook);

// Configurações do Gestor (tenant local).

// GET /api/gestor/configuracoes — devolve a configuração da empresa do gestor.
router.get('/configuracoes', auth, isDiretorClinico, async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const empresaId = req.user && req.user.empresa_id;
    if (!empresaId) {
      return res.status(400).json({ erro: 'empresa_id em falta no token.' });
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

// PUT /api/gestor/configuracoes — atualiza a configuração da empresa.
router.put('/configuracoes', auth, isDiretorClinico, async (req, res) => {
  try {
    const Empresa = require('../models/Empresa');
    const empresaId = req.user && req.user.empresa_id;
    if (!empresaId) {
      return res.status(400).json({ erro: 'empresa_id em falta no token.' });
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

// POST /api/gestor/configuracoes/forcar-daily-briefing — dispara para a empresa do gestor.
router.post('/configuracoes/forcar-daily-briefing', auth, isDiretorClinico, async (req, res) => {
  try {
    const { executarBriefing } = require('../jobs/dailyBriefing');
    await executarBriefing();
    return res.status(200).json({ message: 'Daily Briefing executado.' });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao executar.', detalhe: err.message });
  }
});

// POST /api/gestor/configuracoes/forcar-agenda-amanha — dispara para a empresa do gestor.
router.post('/configuracoes/forcar-agenda-amanha', auth, isDiretorClinico, async (req, res) => {
  try {
    const { executarAgendaAmanha } = require('../jobs/agendaAmanha');
    await executarAgendaAmanha();
    return res.status(200).json({ message: 'Agenda de Amanhã executada.' });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao executar.', detalhe: err.message });
  }
});

module.exports = router;
