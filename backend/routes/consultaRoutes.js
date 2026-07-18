/**
 * Rotas de Consultas — FisioCell
 *
 * Prefixo montado em server.js: /api/gestor/consultas
 *
 * F4 — CRUD de Consultas com validação de conflitos (fisio + sala + paciente).
 *
 * Permissões:
 *   - Listar/Obter/Validar: isRececionista (vê todas) + isClinico (fisio vê só as suas).
 *   - Criar/Atualizar: isRececionista (todos podem marcar).
 *   - Eliminar: isDiretorClinico (só diretor/admin).
 */
const express = require('express');
const router = express.Router();

const { auth } = require('../middleware/auth');
const { isDiretorClinico, isRececionista, isClinico } = require('../middleware/requireRole');
const {
  listarConsultas,
  obterConsulta,
  criarConsulta,
  atualizarConsulta,
  atualizarNotaClinica,
  eliminarConsulta,
  validarConflitosEndpoint,
} = require('../controllers/consultaController');

// Middleware: isRececionista OU isClinico (todos os 4 roles) para ver consultas.
const podeVer = (req, res, next) => {
  const role = req.user && req.user.role;
  if (!role) return res.status(401).json({ erro: 'Não autenticado.' });
  if (['admin', 'diretor_clinico', 'fisioterapeuta', 'rececionista'].includes(role)) {
    return next();
  }
  return res.status(403).json({ erro: 'Acesso negado.' });
};

// GET (listar/obter/validar): podeVer (todos os 4 roles).
router.get('/', auth, podeVer, listarConsultas);
router.get('/validar', auth, podeVer, validarConflitosEndpoint);
router.get('/:id', auth, podeVer, obterConsulta);

// Criar/Atualizar (marcações): isRececionista (admin, diretor_clinico, rececionista).
router.post('/', auth, isRececionista, criarConsulta);
router.put('/:id', auth, isRececionista, atualizarConsulta);

// PATCH /:id/nota-clinica: isClinico (fisio/diretor/admin — SOAP).
router.patch('/:id/nota-clinica', auth, isClinico, atualizarNotaClinica);

// Eliminar: isDiretorClinico (só admin + diretor_clinico).
router.delete('/:id', auth, isDiretorClinico, eliminarConsulta);

module.exports = router;
