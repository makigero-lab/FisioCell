/**
 * Rotas de Protocolos Clínicos — FisioCell
 *
 * Prefixo montado em server.js: /api/gestor/protocolos
 *
 * F5 — CRUD de Modelos de Protocolo Clínico.
 *
 * Permissões:
 *   - Listar/Obter: podeVer (isClinico OU isRececionista — fisio precisa de
 *     ver para aplicar na consulta).
 *   - Criar/Atualizar/Eliminar: isDiretorClinico (só diretor/admin gerem
 *     protocolos clínicos).
 */
const express = require('express');
const router = express.Router();

const { auth } = require('../middleware/auth');
const { isDiretorClinico } = require('../middleware/requireRole');
const {
  listarProtocolos,
  obterProtocolo,
  criarProtocolo,
  atualizarProtocolo,
  apagarProtocolo,
} = require('../controllers/protocoloController');

// Middleware: isClinico OU isRececionista (todos os 4 roles) para ver protocolos.
const podeVer = (req, res, next) => {
  const role = req.user && req.user.role;
  if (!role) return res.status(401).json({ erro: 'Não autenticado.' });
  if (['admin', 'diretor_clinico', 'fisioterapeuta', 'rececionista'].includes(role)) {
    return next();
  }
  return res.status(403).json({ erro: 'Acesso negado.' });
};

// GET (listar/obter): podeVer (todos os 4 roles).
router.get('/', auth, podeVer, listarProtocolos);
router.get('/:id', auth, podeVer, obterProtocolo);

// Criar/Atualizar/Eliminar: isDiretorClinico (só diretor/admin).
router.post('/', auth, isDiretorClinico, criarProtocolo);
router.put('/:id', auth, isDiretorClinico, atualizarProtocolo);
router.delete('/:id', auth, isDiretorClinico, apagarProtocolo);

module.exports = router;
