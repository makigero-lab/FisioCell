/**
 * Middleware de Controlo de Acesso por Role (RBAC) — FisioCell
 *
 * F1 — Hierarquia migrada para o domínio Fisioterapia:
 *   admin             → Super Admin da plataforma (cross-tenant, NÃO vê
 *                       dados clínicos por RGPD).
 *   diretor_clinico   → Diretor Clínico (acesso TOTAL à clínica).
 *   fisioterapeuta    → Fisioterapeuta (vê só os seus pacientes/consultas).
 *   rececionista      → Rececionista (gere marcações, NÃO vê notas clínicas).
 *
 * Middlewares:
 *   isAdmin          — só admin (ações sensíveis: criar admins, setup, etc.)
 *   isDiretorClinico — admin OU diretor_clinico (gestão operacional da clínica:
 *                      propriedades/salas, equipa, ausências, consultas, etc.)
 *   isClinico        — admin OU diretor_clinico OU fisioterapeuta (ações
 *                      clínicas: ver ficha de paciente, registar SOAP, etc.)
 *   isRececionista   — admin OU diretor_clinico OU rececionista (marcações,
 *                      gestão admin de pacientes)
 *
 * Uso:
 *   const { isDiretorClinico, isClinico, isAdmin } = require('../middleware/requireRole');
 *   router.patch('/ausencias/:id/estado', auth, isDiretorClinico, aprovar);
 *
 * Nota: o `auth` deve ser sempre chamado antes (injeta req.user com o role).
 */

/**
 * Cria um middleware que só deixa passar se o role do utilizador (req.user.role)
 * estiver na lista de roles permitidas.
 *
 * @param  {...string} rolesPermitidas — ex: 'admin', 'diretor_clinico'
 * @returns {Function} middleware Express
 */
function requireRole(...rolesPermitidas) {
  return (req, res, next) => {
    const role = req.user && req.user.role;

    if (!role) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }

    if (!rolesPermitidas.includes(role)) {
      return res.status(403).json({
        erro: `Acesso negado. Esta ação requer role: ${rolesPermitidas.join(' ou ')}.`,
      });
    }

    return next();
  };
}

/**
 * isAdmin — ESTRITO. Só admin (Super Admin da plataforma).
 * Usado para: criar outros admins, setup, configurações sensíveis, gestão
 * cross-tenant de empresas.
 */
const isAdmin = requireRole('admin');

/**
 * isDiretorClinico — permite admin e diretor_clinico.
 * O admin tem todas as permissões do diretor_clinico (para testes/supervisão).
 * Usado para: dashboard, propriedades/salas, equipa, ausências, consultas,
 * webhooks, auditoria, etc. (gestão operacional da clínica).
 */
const isDiretorClinico = requireRole('admin', 'diretor_clinico');

/**
 * isClinico — permite admin, diretor_clinico e fisioterapeuta.
 * Usado para: ver ficha clínica de paciente, registar nota SOAP, concluir
 * consulta, reportar avarias, etc. (ações que exigem formação clínica).
 */
const isClinico = requireRole('admin', 'diretor_clinico', 'fisioterapeuta');

/**
 * isRececionista — permite admin, diretor_clinico e rececionista.
 * Usado para: criar/editar marcações de TODOS os fisioterapeutas, ver dados
 * administrativos de pacientes (contactos), registar presença/falta.
 */
const isRececionista = requireRole('admin', 'diretor_clinico', 'rececionista');

module.exports = {
  requireRole,
  isAdmin,
  isDiretorClinico,
  isClinico,
  isRececionista,
};
