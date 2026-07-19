/**
 * Rotas de Pacientes — FisioCell
 *
 * Prefixo montado em server.js: /api/gestor/pacientes
 *
 * F2 — CRUD de Pacientes com permissões baseadas em role.
 *
 * Permissões:
 *   - GET (listar/obter): isClinico OU isRececionista (todos os 4 roles podem ver,
 *     mas a rececionista recebe versão sanitizada sem dados clínicos).
 *   - POST/PUT/PATCH estado: isRececionista (admin, diretor_clinico, rececionista).
 *     Fisioterapeuta NÃO cria/edita pacientes (essa é função da rececionista).
 *   - DELETE (soft delete): isDiretorClinico (só admin + diretor_clinico).
 *
 * O controller sanitiza a resposta para rececionistas (remove dados clínicos).
 */
const express = require('express');
const router = express.Router();

const { auth } = require('../middleware/auth');
const { isRececionista, isDiretorClinico, isClinico } = require('../middleware/requireRole');
const {
  listarPacientes,
  obterPaciente,
  criarPaciente,
  atualizarPaciente,
  eliminarPaciente,
  alternarEstadoPaciente,
} = require('../controllers/pacienteController');

// GET (listar/obter): isClinico OU isRececionista = todos os 4 roles podem ver.
// O controller decide se devolve dados clínicos conforme o role.
// Como não há middleware "OR", criamos um custom que aceita ambos.
const podeVer = (req, res, next) => {
  const role = req.user && req.user.role;
  if (!role) return res.status(401).json({ erro: 'Não autenticado.' });
  if (['admin', 'diretor_clinico', 'fisioterapeuta', 'rececionista'].includes(role)) {
    return next();
  }
  return res.status(403).json({ erro: 'Acesso negado.' });
};

router.get('/', auth, podeVer, listarPacientes);
router.get('/:id', auth, podeVer, obterPaciente);

// Criar: podeVer (todos os 4 roles podem criar pacientes).
// O controller decide quais campos consoante o role (fisio pode definir
// campos clínicos, rececionista não).
router.post('/', auth, podeVer, criarPaciente);

// Atualizar: podeVer (todos os 4 roles podem editar).
// O controller decide quais campos consoante o role (fisio edita só clínicos,
// rececionista edita só administrativos).
router.put('/:id', auth, podeVer, atualizarPaciente);

// Estado: isRececionista.
router.patch('/:id/estado', auth, isRececionista, alternarEstadoPaciente);

// Soft delete: só diretor_clinico + admin.
router.delete('/:id', auth, isDiretorClinico, eliminarPaciente);

module.exports = router;
