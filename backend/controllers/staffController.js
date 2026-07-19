/**
 * Staff Controller — FisioCell
 *
 * Endpoints para o staff gerir as SUAS ausências (pedidos de férias/doença).
 *
 * Diferença para o ausenciaController (admin):
 *   - O staff só vê e cria as SUAS ausências (utilizador_id = req.user.id).
 *   - As ausências criadas pelo staff ficam SEMPRE 'pendente' (fluxo de aprovação).
 *   - O staff NÃO pode aprovar/rejeitar (só o admin).
 *
 * F8 — Limpeza: removidas as funções concluirTarefa, reportarAvaria,
 * reportarAtraso e toggleChecklistItem (Tarefa eliminado em F8). O fluxo de
 * Tarefas foi substituído pelo de Consultas (F4-F7), gerido pelos endpoints
 * /api/gestor/consultas. As funções de ausências do staff são mantidas.
 */

const mongoose = require('mongoose');
const Ausencia = require('../models/Ausencia');
const Utilizador = require('../models/Utilizador');
const { notificarUtilizador } = require('../utils/notificar');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function normalizarDia(valor) {
  const d = new Date(valor);
  if (isNaN(d.getTime())) return null;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

/* ------------------------------------------------------------------ */
/* GET /api/staff/ausencias — histórico do próprio utilizador         */
/* ------------------------------------------------------------------ */

/**
 * Devolve o histórico de ausências do utilizador autenticado
 * (todas, qualquer estado). Ordenadas por data_inicio desc.
 */
exports.minhasAusencias = async (req, res) => {
  try {
    const utilizadorId = req.user && req.user.id;
    if (!utilizadorId) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }

    const ausencias = await Ausencia.find({ utilizador_id: utilizadorId })
      .sort({ data_inicio: -1 })
      .lean();

    return res.status(200).json({ ausencias });
  } catch (err) {
    console.error('❌ minhasAusencias:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* POST /api/staff/ausencias — criar pedido (sempre 'pendente')       */
/* ------------------------------------------------------------------ */

/**
 * Cria um novo pedido de ausência para o próprio utilizador.
 *
 * Body: { data_inicio, data_fim, tipo, notas? }
 *   - tipo: 'ferias' | 'doenca' | 'outro' (default 'ferias')
 *
 * O estado fica SEMPRE 'pendente' — o staff não pode auto-aprovar.
 *
 * Validações:
 *   - data_inicio e data_fim obrigatórias, data_fim >= data_inicio.
 *   - tipo válido.
 *   - Não pode haver sobreposição com outra ausência do mesmo utilizador.
 *
 * Resposta 201: { ausencia }
 */
exports.criarAusencia = async (req, res) => {
  try {
    const utilizadorId = req.user && req.user.id;
    const empresaId = req.user && req.user.empresa_id;
    if (!utilizadorId || !empresaId) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }

    const { data_inicio, data_fim, tipo, notas } = req.body || {};

    if (!data_inicio || !data_fim) {
      return res.status(400).json({
        erro: 'Campos obrigatórios em falta: data_inicio e data_fim.',
      });
    }

    const inicio = normalizarDia(data_inicio);
    const fim = normalizarDia(data_fim);
    if (!inicio || !fim) {
      return res.status(400).json({ erro: 'data_inicio ou data_fim inválidas.' });
    }
    if (fim < inicio) {
      return res.status(400).json({
        erro: 'data_fim não pode ser anterior a data_inicio.',
      });
    }

    // Valida tipo.
    const tipoFinal = tipo || 'ferias';
    if (!['ferias', 'doenca', 'outro'].includes(tipoFinal)) {
      return res.status(400).json({
        erro: 'tipo inválido. Valores permitidos: ferias, doenca, outro.',
      });
    }

    // Valida sobreposição.
    // Prompt 130 — SÓ bloqueia se houver ausência com estado 'pendente' ou
    // 'aprovada'. 'rejeitada' e 'pendente_emergencia' NÃO bloqueiam.
    const sobreposta = await Ausencia.findOne({
      utilizador_id: utilizadorId,
      data_inicio: { $lte: fim },
      data_fim: { $gte: inicio },
      estado: { $in: ['pendente', 'aprovada'] },
    });
    if (sobreposta) {
      console.log(`[criarAusencia] BLOQUEIO (sobreposição): ausência ${sobreposta._id} estado=${sobreposta.estado} início=${sobreposta.data_inicio} fim=${sobreposta.data_fim} | pedido: inicio=${inicio} fim=${fim}`);
      return res.status(409).json({
        erro: 'Já existe uma ausência registada que se sobrepõe a este período.',
      });
    }

    // Debug: lista TODAS as ausências deste utilizador que se sobrepõem
    // (qualquer estado) para entender o que está na BD.
    const todasSobrepostas = await Ausencia.find({
      utilizador_id: utilizadorId,
      data_inicio: { $lte: fim },
      data_fim: { $gte: inicio },
    }).select('estado data_inicio data_fim').lean();
    console.log(`[criarAusencia] DEBUG: ${todasSobrepostas.length} ausência(s) sobreposta(s) na BD (qualquer estado):`, JSON.stringify(todasSobrepostas));

    // Prompt 131 — Remove o índice único antigo antes de tentar criar.
    try {
      const indexes = await Ausencia.collection.listIndexes().toArray();
      for (const idx of indexes) {
        if (idx.unique && idx.key && idx.key.utilizador_id) {
          console.log(`[criarAusencia] A remover índice único antigo: ${idx.name}`);
          await Ausencia.collection.dropIndex(idx.name);
        }
      }
    } catch (idxErr) {
      // Não bloqueia se falhar.
    }

    const nova = await Ausencia.create({
      utilizador_id: utilizadorId,
      empresa_id: empresaId,
      data_inicio: inicio,
      data_fim: fim,
      tipo: tipoFinal,
      estado: 'pendente', // sempre pendente — o admin aprova
      notas: notas ? String(notas).trim() : '',
    });

    return res.status(201).json({ ausencia: nova });
  } catch (err) {
    console.error('❌ criarAusencia:', err.message);

    // Prompt 131 — Erro de duplicate key (índice único antigo na BD).
    if (err.code === 11000) {
      console.error('[criarAusencia] BLOQUEIO (11000 duplicate key). Índice único ainda existe. err:', JSON.stringify(err.keyValue || err.message));
      return res.status(409).json({
        erro: 'Já existe uma ausência com esta data de início (erro de índice único).',
      });
    }

    if (err.name === 'ValidationError') {
      return res.status(400).json({ erro: err.message });
    }
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* DELETE /api/staff/ausencias/:id — cancelar (hard delete, legacy)    */
/* PATCH  /api/staff/ausencias/:id/cancelar — cancelar (soft, Prompt 132) */
/* ------------------------------------------------------------------ */

/**
 * PATCH /api/staff/ausencias/:id/cancelar
 *
 * Soft cancel — marca estado='cancelada' (mantém histórico).
 * O staff só pode cancelar as SUAS ausências, e só se estiverem
 * 'pendente', 'pendente_emergencia' ou 'aprovada'.
 *
 * Resposta 200: { mensagem, ausencia }
 */
exports.cancelarAusenciaSoft = async (req, res) => {
  try {
    const utilizadorId = req.user && req.user.id;
    if (!utilizadorId) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de ausência inválido.' });
    }

    const ausencia = await Ausencia.findOne({
      _id: id,
      utilizador_id: utilizadorId,
    });

    if (!ausencia) {
      return res.status(404).json({
        erro: 'Ausência não encontrada (ou não te pertence).',
      });
    }

    const estadosCancelaveis = ['pendente', 'pendente_emergencia', 'aprovada'];
    if (!estadosCancelaveis.includes(ausencia.estado)) {
      return res.status(400).json({
        erro: `Não é possível cancelar uma ausência já ${ausencia.estado}.`,
      });
    }

    const estadoAnterior = ausencia.estado;
    ausencia.estado = 'cancelada';
    await ausencia.save();

    console.log(
      `[cancelarAusenciaSoft] Ausência ${ausencia._id} cancelada por staff ${utilizadorId} ` +
      `(estado anterior: ${estadoAnterior}).`
    );

    return res.status(200).json({
      mensagem: 'Ausência cancelada com sucesso.',
      ausencia,
    });
  } catch (err) {
    console.error('❌ cancelarAusenciaSoft:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * DELETE /api/staff/ausencias/:id — hard delete (legacy, mantido para compat).
 *
 * O frontend foi atualizado para usar PATCH /cancelar (soft).
 * Este DELETE é mantido para retrocompatibilidade.
 */
exports.cancelarAusencia = async (req, res) => {
  try {
    const utilizadorId = req.user && req.user.id;
    if (!utilizadorId) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de ausência inválido.' });
    }

    const ausencia = await Ausencia.findOne({
      _id: id,
      utilizador_id: utilizadorId,
    });

    if (!ausencia) {
      return res.status(404).json({
        erro: 'Ausência não encontrada (ou não te pertence).',
      });
    }

    if (!['pendente', 'pendente_emergencia'].includes(ausencia.estado)) {
      return res.status(403).json({
        erro: `Não podes cancelar um pedido já ${ausencia.estado}.`,
      });
    }

    await Ausencia.deleteOne({ _id: id });

    return res.status(200).json({
      mensagem: 'Pedido cancelado com sucesso.',
      ausencia_id: id,
    });
  } catch (err) {
    console.error('❌ cancelarAusencia:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * POST /api/staff/falta-hoje
 *
 * Cria um pedido de falta de emergência para o dia atual (doença súbita).
 * O pedido fica com estado 'pendente_emergencia' — o admin é notificado.
 *
 * F8 — Limpeza: removida a referência a redistribuição de Tarefas na
 * documentação (Tarefa eliminado). A aprovação da ausência apenas atualiza
 * o estado; o gestor gere manualmente as Consultas afetadas.
 *
 * Body: { justificacao?: string }
 *
 * Resposta 201: { ausencia }
 */
exports.faltaHoje = async (req, res) => {
  try {
    const utilizadorId = req.user && req.user.id;
    const empresaId = req.user && req.user.empresa_id;
    if (!utilizadorId || !empresaId) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }

    const { justificacao } = req.body || {};

    const agora = new Date();
    const hoje = new Date(
      Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())
    );

    // Valida sobreposição: não pode haver outra ausência que cubra hoje.
    // Prompt 130 — SÓ bloqueia se houver ausência com estado 'pendente' ou
    // 'aprovada' (ou 'pendente_emergencia' para faltas súbitas). 'rejeitada' NÃO.
    const sobreposta = await Ausencia.findOne({
      utilizador_id: utilizadorId,
      data_inicio: { $lte: hoje },
      data_fim: { $gte: hoje },
      estado: { $ne: 'rejeitada' },
    });
    if (sobreposta) {
      console.log(`[faltaHoje] Conflito detetado: ausência ${sobreposta._id} estado=${sobreposta.estado}`);
      return res.status(409).json({
        erro: `Já tens uma ausência registada para hoje (estado: ${sobreposta.estado}).`,
      });
    }

    // Prompt 131 — Remove o índice único antigo antes de tentar criar.
    // Garante que o erro 11000 não ocorre mesmo se o arranque do servidor
    // ainda não tiver removido o índice.
    try {
      const indexes = await Ausencia.collection.listIndexes().toArray();
      for (const idx of indexes) {
        if (idx.unique && idx.key && idx.key.utilizador_id) {
          console.log(`[faltaHoje] A remover índice único antigo: ${idx.name}`);
          await Ausencia.collection.dropIndex(idx.name);
        }
      }
    } catch (idxErr) {
      // Não bloqueia se falhar.
    }

    const nova = await Ausencia.create({
      utilizador_id: utilizadorId,
      empresa_id: empresaId,
      data_inicio: hoje,
      data_fim: hoje,
      tipo: 'doenca',
      estado: 'pendente_emergencia',
      justificacao: justificacao ? String(justificacao).trim() : '',
    });

    // Notifica todos os diretores clínicos da empresa via push (fire-and-forget).
    // Inclui o admin (role 'admin') como gestor de topo.
    try {
      const staffNome = await Utilizador.findById(utilizadorId)
        .select('nome')
        .lean();
      const nomeStaff = staffNome?.nome ?? 'Fisioterapeuta';

      const gestores = await Utilizador.find({
        empresa_id: empresaId,
        role: { $in: ['diretor_clinico', 'admin'] },
        ativo: true,
        eliminado_em: null,
        pushSubscription: { $ne: null },
      })
        .select('_id')
        .lean();

      for (const g of gestores) {
        notificarUtilizador(
          String(g._id),
          '🚨 Falta de emergência',
          `${nomeStaff} reportou falta para hoje.`,
          '/gestor/aprovacoes',
          { criarInApp: true, tipo: 'aviso' }
        );
      }
    } catch (e) {
      // Fire-and-forget: não bloqueia a resposta.
      console.error('⚠️  notificar gestores (faltaHoje):', e.message);
    }

    return res.status(201).json({ ausencia: nova });
  } catch (err) {
    console.error('❌ faltaHoje:', err.message);
    // Prompt 131 — Tratamento do erro 11000 (índice único antigo).
    if (err.code === 11000) {
      console.error('[faltaHoje] Erro 11000 (duplicate key). Índice único antigo ainda existe.');
      // Tenta remover o índice e recriar.
      try {
        const indexes = await Ausencia.collection.listIndexes().toArray();
        for (const idx of indexes) {
          if (idx.unique && idx.key && idx.key.utilizador_id) {
            await Ausencia.collection.dropIndex(idx.name);
            console.log(`[faltaHoje] Índice ${idx.name} removido. A tentar novamente...`);
          }
        }
        // Re-tenta criar.
        const nova = await Ausencia.create({
          utilizador_id: req.user.id,
          empresa_id: req.user.empresa_id,
          data_inicio: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())),
          data_fim: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())),
          tipo: 'doenca',
          estado: 'pendente_emergencia',
          justificacao: (req.body && req.body.justificacao) ? String(req.body.justificacao).trim() : '',
        });
        return res.status(201).json({ ausencia: nova });
      } catch (err2) {
        return res.status(409).json({
          erro: 'Já existe uma ausência para hoje. O índice único será removido no próximo arranque.',
        });
      }
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ erro: err.message });
    }
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

// F8 — Funções concluirTarefa, reportarAvaria, reportarAtraso e
// toggleChecklistItem REMOVIDAS (Tarefa eliminado em F8). O fluxo de
// Tarefas foi substituído pelo de Consultas (F4-F7), gerido pelos
// endpoints /api/gestor/consultas.
