/**
 * Rotas de Horários — FisioCell
 *
 * Prefixo montado em server.js: /api/gestor/horarios
 *
 * F3 — CRUD de HorarioFisioterapeuta (limites de agenda dos fisios).
 *
 * Permissões:
 *   - Listar/Obter: isClinico (fisio vê só os seus) OU isDiretorClinico (vê todos).
 *   - Criar/Atualizar/Eliminar: isDiretorClinico (só diretor/admin gerem horários).
 *   - Verificar disponibilidade: isRececionista (para marcar) + isClinico.
 */
const express = require('express');
const router = express.Router();

const { auth } = require('../middleware/auth');
const { isDiretorClinico, isClinico, isRececionista } = require('../middleware/requireRole');
const {
  listarHorarios,
  obterHorario,
  criarHorario,
  atualizarHorario,
  eliminarHorario,
  verificarDisponibilidade,
} = require('../controllers/horarioController');

// Middleware: isClinico OU isRececionista (todos os 4 roles) para ver horários.
const podeVer = (req, res, next) => {
  const role = req.user && req.user.role;
  if (!role) return res.status(401).json({ erro: 'Não autenticado.' });
  if (['admin', 'diretor_clinico', 'fisioterapeuta', 'rececionista'].includes(role)) {
    return next();
  }
  return res.status(403).json({ erro: 'Acesso negado.' });
};

// GET (listar/obter/disponibilidade): podeVer (todos os 4 roles).
router.get('/', auth, podeVer, listarHorarios);
router.get('/disponibilidade', auth, podeVer, verificarDisponibilidade);
router.get('/:id', auth, podeVer, obterHorario);

// Criar/Atualizar/Eliminar: isDiretorClinico (só diretor/admin).
router.post('/', auth, isDiretorClinico, criarHorario);
router.put('/:id', auth, isDiretorClinico, atualizarHorario);
router.delete('/:id', auth, isDiretorClinico, eliminarHorario);

module.exports = router;
