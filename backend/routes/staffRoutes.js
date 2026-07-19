/**
 * Rotas do Staff — FisioCell
 *
 * Prefixo montado em server.js: /api/staff
 *
 * Endpoints:
 *   GET    /ausencias            — histórico de ausências do próprio utilizador
 *   POST   /ausencias            — criar pedido de ausência (sempre 'pendente')
 *   DELETE /ausencias/:id        — cancelar pedido pendente (só pendentes)
 *   PATCH  /ausencias/:id/cancelar — soft cancel (mantém histórico, Prompt 132)
 *   POST   /falta-hoje           — reportar falta de emergência para o dia atual
 *
 * Autenticação: middleware `auth` (JWT). O utilizador_id vem do token.
 * O staff só pode gerir as SUAS ausências — não pode aprovar/rejeitar.
 *
 * F8 — Limpeza: removidas as routes de Tarefas (concluir, avaria, atraso,
 * toggle checklist) que referenciavam tarefaController/Tarefa (eliminados).
 * O fluxo de Tarefas foi substituído pelo de Consultas (F4-F7), gerido pelos
 * endpoints /api/gestor/consultas.
 */
const express = require('express');
const router = express.Router();

const { auth } = require('../middleware/auth');
const {
  minhasAusencias,
  criarAusencia,
  cancelarAusencia,
  cancelarAusenciaSoft,
  faltaHoje,
} = require('../controllers/staffController');

router.get('/ausencias', auth, minhasAusencias);
router.post('/ausencias', auth, criarAusencia);
router.delete('/ausencias/:id', auth, cancelarAusencia);
// Prompt 132 — Soft cancel (mantém histórico)
router.patch('/ausencias/:id/cancelar', auth, cancelarAusenciaSoft);
router.post('/falta-hoje', auth, faltaHoje);

module.exports = router;
