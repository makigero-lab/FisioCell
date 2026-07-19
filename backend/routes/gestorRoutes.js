/**
 * Rotas do Painel do Gestor de Operações — FisioCell
 *
 * Prefixo montado em server.js: /api/gestor
 *
 * F0 — Rotas Smoobu removidas. Endpoints /configuracoes refatorados para
 * gerir nome/nif/morada/telefone/email da empresa (antes: smoobu_api_key).
 *
 * F8 — Limpeza: removidas todas as routes de Tarefas, Calendário (legado),
 * Checklists e Webhooks que referenciavam controllers/modelos eliminados
 * (tarefaController, checklistController, ModeloChecklist, WebhookLog).
 * O dashboard passa a usar Consulta. A gestão de tarefas / load balancer
 * foi substituída pelo fluxo de Consultas (F4-F7).
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
  getEquipa,
  criarMembroEquipa,
  atualizarMembroEquipa,
  alternarEstadoMembro,
  eliminarMembroEquipa,
  getAuditoria,
  setupClienteZero,
} = require('../controllers/gestorController');

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
// F8 — Mantido: usa o campo `checklist` (array de strings) da Propriedade,
// não referencia ModeloChecklist (eliminado).
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

// Gestão de equipa (utilizadores) da empresa. PROTEGIDO por JWT.
router.get('/equipa', auth, isDiretorClinico, getEquipa);
router.post('/equipa', auth, isDiretorClinico, criarMembroEquipa);
router.put('/equipa/:id', auth, isDiretorClinico, atualizarMembroEquipa);
router.patch('/equipa/:id/estado', auth, isDiretorClinico, alternarEstadoMembro);
router.delete('/equipa/:id', auth, isDiretorClinico, eliminarMembroEquipa);

// Auditoria.
router.get('/auditoria', auth, isDiretorClinico, getAuditoria);

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

module.exports = router;
