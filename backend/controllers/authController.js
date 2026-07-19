/**
 * Auth Controller — FisioCell
 *
 * Autenticação com JWT + bcrypt.
 *
 * Endpoint: POST /api/auth/login
 *   Recebe { email, password }, valida as credenciais e devolve um JWT
 *   com { id, role, empresa_id }.
 *
 * F8 — Limpeza: removido o import de Tarefa (eliminado). As funções
 * meuCalendario, minhasTarefas, minhaTarefaDetalhe e concluirMinhaTarefa
 * foram convertidas em stubs (o domínio passou a usar Consultas via
 * /api/gestor/consultas). O frontend deve usar os endpoints de Consulta.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const Utilizador = require('../models/Utilizador');
const Ausencia = require('../models/Ausencia');
const { JWT_SECRET } = require('../middleware/auth');

// Tempo de expiração do token (pode ser overridden por env).
const TOKEN_EXPIRACAO = process.env.JWT_EXPIRACAO || '7d';

/**
 * POST /api/auth/login
 *
 * Body: { email, password }
 *
 * Resposta 200:
 *   {
 *     "token": "<jwt>",
 *     "utilizador": { "id", "nome", "email", "role", "empresa_id" }
 *   }
 *
 * Respostas de erro:
 *   400 — email/password em falta
 *   401 — credenciais inválidas / utilizador inativo / sem password definida
 *   500 — erro interno
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ erro: 'Email e password são obrigatórios.' });
    }

    // Procura o utilizador por email (único).
    const utilizador = await Utilizador.findOne({
      email: String(email).toLowerCase().trim(),
    });

    // Mensagem genérica para não revelar se o email existe ou não.
    const MSG_INVALIDAS = 'Credenciais inválidas.';

    if (!utilizador) {
      return res.status(401).json({ erro: MSG_INVALIDAS });
    }

    if (!utilizador.ativo) {
      return res
        .status(401)
        .json({ erro: 'Utilizador inativo. Contacta o administrador.' });
    }

    if (!utilizador.password_hash) {
      // Utilizador migrado sem password (ex.: criado antes do auth).
      return res.status(401).json({
        erro: 'Ainda não tem password definida. Contacta o administrador.',
      });
    }

    // Verifica a password contra a hash bcrypt.
    const passwordOk = await bcrypt.compare(password, utilizador.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ erro: MSG_INVALIDAS });
    }

    // Prompt 116 — Bloqueia o login se a empresa estiver inativa (ativa: false).
    // O Super Admin (role 'admin') é exceção — pode sempre entrar para
    // reativar a empresa. O admin não tem empresa_id de operações.
    if (utilizador.role !== 'admin' && utilizador.empresa_id) {
      const Empresa = require('../models/Empresa');
      const empresa = await Empresa.findById(utilizador.empresa_id).select('ativa').lean();
      if (empresa && empresa.ativa === false) {
        return res.status(403).json({
          erro: 'A tua empresa está desativada. Contacta o suporte.',
        });
      }
    }

    // Gera o JWT com o payload essencial.
    const token = jwt.sign(
      {
        id: String(utilizador._id),
        role: utilizador.role,
        empresa_id: String(utilizador.empresa_id),
      },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRACAO }
    );

    return res.status(200).json({
      token,
      utilizador: {
        id: String(utilizador._id),
        nome: utilizador.nome,
        email: utilizador.email,
        role: utilizador.role,
        empresa_id: String(utilizador.empresa_id),
      },
    });
  } catch (err) {
    console.error('❌ login:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * GET /api/auth/me  (requer JWT)
 * Devolve os dados do utilizador autenticado (a partir do token).
 *
 * Resposta 200: { utilizador: { id, nome, email, role, empresa_id } }
 */
exports.me = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }
    const utilizador = await Utilizador.findById(req.user.id).select(
      '-password_hash'
    );
    if (!utilizador) {
      return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    }
    return res.status(200).json({
      utilizador: {
        id: String(utilizador._id),
        nome: utilizador.nome,
        email: utilizador.email,
        role: utilizador.role,
        empresa_id: String(utilizador.empresa_id),
      },
    });
  } catch (err) {
    console.error('❌ me:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * GET /api/auth/me/calendario (requer JWT)
 *
 * F8 — STUB. O calendário pessoal agora deve ser obtido via
 * /api/gestor/consultas (F4-F6) com filtro por fisioterapeuta_id.
 * Mantém-se o array de ausências para retrocompatibilidade do frontend.
 *
 * Resposta 200: { tarefas: [], ausencias: [...] }
 */
exports.meuCalendario = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }

    const utilizadorId = req.user.id;

    // Data de hoje em meia-noite UTC.
    const agora = new Date();
    const hoje = new Date(
      Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())
    );

    // Ausências do utilizador a partir de hoje.
    const ausencias = await Ausencia.find({
      utilizador_id: utilizadorId,
      data_fim: { $gte: hoje },
    })
      .sort({ data_inicio: 1 })
      .lean();

    // F8 — Tarefas removidas (Tarefa eliminado). Devolve array vazio para
    // retrocompatibilidade do frontend. O calendário de Consultas está
    // disponível em /api/gestor/consultas.
    return res.status(200).json({ tarefas: [], ausencias });
  } catch (err) {
    console.error('❌ meuCalendario:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * GET /api/auth/me/tarefas (requer JWT)
 *
 * F8 — STUB. Tarefa eliminado em F8. As consultas do fisioterapeuta devem
 * ser obtidas via /api/gestor/consultas?fisioterapeuta_id=... (F4).
 *
 * Resposta 200: { tarefas: [] }
 */
exports.minhasTarefas = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }
    // F8 — Tarefa eliminado. Devolve array vazio para retrocompatibilidade.
    return res.status(200).json({ tarefas: [] });
  } catch (err) {
    console.error('❌ minhasTarefas:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * GET /api/auth/me/tarefas/:id (requer JWT)
 *
 * F8 — STUB. Tarefa eliminado em F8. O detalhe de uma consulta está
 * disponível em /api/gestor/consultas/:id (F4).
 *
 * Resposta 410 Gone — endpoint desativado.
 */
exports.minhaTarefaDetalhe = async (req, res) => {
  return res.status(410).json({
    erro: 'Endpoint desativado (Tarefa eliminado em F8). Usa /api/gestor/consultas/:id para detalhe de consultas.',
  });
};

/**
 * PATCH /api/auth/me/tarefas/:id/concluir (requer JWT)
 *
 * F8 — STUB. Tarefa eliminado em F8. A conclusão de consultas é feita
 * via /api/gestor/consultas/:id/estado (F4) ou PATCH /nota-clinica (F4).
 *
 * Resposta 410 Gone — endpoint desativado.
 */
exports.concluirMinhaTarefa = async (req, res) => {
  return res.status(410).json({
    erro: 'Endpoint desativado (Tarefa eliminado em F8). Usa /api/gestor/consultas/:id/estado para alterar o estado da consulta.',
  });
};

/* ------------------------------------------------------------------ */
/* Notificações Push (Web Push API) — v1.27.0                          */
/* ------------------------------------------------------------------ */

/**
 * GET /api/auth/me/push-vapid-public-key
 *
 * Devolve a chave pública VAPID para o frontend pedir a subscrição
 * do browser (PushManager.subscribe({ applicationServerKey })).
 *
 * Resposta 200: { publicKey: string }
 * Resposta 503: Web Push não configurado (chaves VAPID em falta).
 */
exports.pushVapidPublicKey = async (req, res) => {
  try {
    const { isConfigured, getPublicKey } = require('../utils/push');
    if (!isConfigured()) {
      return res.status(503).json({
        erro: 'Notificações push não configuradas no servidor.',
      });
    }
    return res.status(200).json({ publicKey: getPublicKey() });
  } catch (err) {
    console.error('❌ pushVapidPublicKey:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * POST /api/auth/me/push-subscribe
 *
 * Guarda a subscrição push gerada pelo browser no utilizador logado.
 * O frontend chama isto depois de obter a subscrição via:
 *   const sub = await registration.pushManager.subscribe({...});
 *   fetch('/api/auth/me/push-subscribe', { method: 'POST', body: sub })
 *
 * Body: { subscription: PushSubscription }
 *   - objeto com { endpoint, keys: { p256dh, auth }, expirationTime? }
 *
 * Resposta 200: { mensagem: 'Subscrição guardada com sucesso.' }
 * Resposta 400: subscription em falta ou inválida
 * Resposta 503: Web Push não configurado
 */
exports.pushSubscribe = async (req, res) => {
  try {
    const { isConfigured } = require('../utils/push');
    if (!isConfigured()) {
      return res.status(503).json({
        erro: 'Notificações push não configuradas no servidor.',
      });
    }

    const { subscription } = req.body || {};

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({
        erro: 'Subscrição inválida: falta o objeto subscription com endpoint.',
      });
    }

    // Guarda a subscrição no utilizador logado.
    const utilizador = await Utilizador.findById(req.user.id);
    if (!utilizador) {
      return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    }

    utilizador.pushSubscription = subscription;
    await utilizador.save();

    return res.status(200).json({
      mensagem: 'Subscrição guardada com sucesso.',
    });
  } catch (err) {
    console.error('❌ pushSubscribe:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * POST /api/auth/me/push-unsubscribe
 *
 * Remove a subscrição push do utilizador (ex: user fez logout, ou o
 * browser reportou que a subscrição expirou).
 *
 * Resposta 200: { mensagem: 'Subscrição removida.' }
 */
exports.pushUnsubscribe = async (req, res) => {
  try {
    const utilizador = await Utilizador.findById(req.user.id);
    if (!utilizador) {
      return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    }

    utilizador.pushSubscription = null;
    await utilizador.save();

    return res.status(200).json({ mensagem: 'Subscrição removida.' });
  } catch (err) {
    console.error('❌ pushUnsubscribe:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};
