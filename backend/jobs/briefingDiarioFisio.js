/**
 * Briefing Diário Fisio — Cron Job (FisioCell)
 *
 * F7 — Todos os dias às 08:00 (Europe/Lisbon), envia push a cada
 * fisioterapeuta com consultas marcadas para hoje.
 *
 * Mensagem: "📋 Tens X consulta(s) hoje. Entra na app para ver a agenda."
 *
 * Só considera consultas com estado 'marcada', 'confirmada' ou 'em_curso'
 * (ignora canceladas/faltou/concluídas). Só notifica fisios ativos não
 * eliminados com pushSubscription.
 *
 * Padrão: igual ao dailyBriefing.js (legacy) mas para Consultas em vez de
 * Tarefas. notificarUtilizador é require lazy para permitir jest.spyOn.
 */

const cron = require('node-cron');
const Consulta = require('../models/Consulta');
const Utilizador = require('../models/Utilizador');

/**
 * Executa o briefing diário de fisioterapeutas.
 * @returns {Promise<{ processados: number, notificados: number, consultas: number }>}
 */
async function executarBriefingFisio() {
  console.log('🔔 [Briefing Fisio] A iniciar às', new Date().toISOString());

  try {
    // 1) Calcula o intervalo de hoje (meia-noite UTC).
    const agora = new Date();
    const inicioDia = new Date(
      Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())
    );
    const fimDia = new Date(inicioDia.getTime() + 24 * 60 * 60 * 1000);

    // 2) Procura Consultas de hoje (estados ativos).
    const consultas = await Consulta.find({
      data_hora_inicio: { $gte: inicioDia, $lt: fimDia },
      estado: { $in: ['marcada', 'confirmada', 'em_curso'] },
    })
      .populate({
        path: 'fisioterapeuta_id',
        select: 'nome ativo eliminado_em role',
      })
      .lean();

    if (consultas.length === 0) {
      console.log('ℹ️  [Briefing Fisio] Sem consultas para hoje.');
      return { processados: 0, notificados: 0, consultas: 0 };
    }

    // 3) Agrupa por fisioterapeuta. Só fisios ativos não eliminados.
    const porFisio = new Map();
    for (const c of consultas) {
      const f = c.fisioterapeuta_id;
      if (!f || f.eliminado_em || !f.ativo) continue;
      if (f.role !== 'fisioterapeuta' && f.role !== 'diretor_clinico') continue;

      const key = String(f._id);
      if (!porFisio.has(key)) {
        porFisio.set(key, { fisio: f, consultas: [] });
      }
      porFisio.get(key).consultas.push(c);
    }

    if (porFisio.size === 0) {
      console.log('ℹ️  [Briefing Fisio] Consultas encontradas, mas sem fisios ativos.');
      return { processados: 0, notificados: 0, consultas: consultas.length };
    }

    // 4) Envia push a cada fisio (fire-and-forget).
    const { notificarUtilizador } = require('../utils/notificar');
    let notificados = 0;

    for (const [, { fisio, consultas: consultasFisio }] of porFisio) {
      const count = consultasFisio.length;
      const msg = count === 1
        ? `📋 Tens 1 consulta hoje. Entra na app para ver a agenda.`
        : `📋 Tens ${count} consultas hoje. Entra na app para ver a agenda.`;

      notificarUtilizador(
        String(fisio._id),
        '📅 Briefing Diário',
        msg,
        '/staff',
        { criarInApp: true, tipo: 'sistema' }
      );
      notificados++;
    }

    console.log(
      `✅ [Briefing Fisio] Concluído: ${notificados} fisio(s) notificado(s), ${consultas.length} consulta(s).`
    );
    return { processados: porFisio.size, notificados, consultas: consultas.length };
  } catch (err) {
    console.error('❌ [Briefing Fisio] Erro:', err.message);
    return { processados: 0, notificados: 0, consultas: 0, erro: err.message };
  }
}

/**
 * Inicia o cron job. Agenda para todos os dias às 08:00 (Europe/Lisbon).
 */
function iniciarBriefingFisio() {
  console.log('⏰ [Briefing Fisio] Cron agendado para 08:00 diariamente (Europe/Lisbon).');
  cron.schedule('0 8 * * *', async () => {
    await executarBriefingFisio();
  }, { timezone: 'Europe/Lisbon' });
  return { executarBriefingFisio };
}

module.exports = { iniciarBriefingFisio, executarBriefingFisio };
