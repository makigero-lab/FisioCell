/**
 * Lembrete Consultas Amanhã — Cron Job (FisioCell)
 *
 * F7 — Todos os dias às 19:00 (Europe/Lisbon), envia push/lembrete sobre
 * consultas marcadas para o dia seguinte.
 *
 * Destinatários: fisioterapeutas (notifica cada fisio com consultas amanhã).
 * Futuro: quando houver portal do paciente, enviar SMS ao paciente.
 *
 * Mensagem: "📅 Lembrete: tens X consulta(s) amanhã."
 *
 * Padrão: igual ao agendaAmanha.js (legacy) mas para Consultas.
 * notificarUtilizador é require lazy para permitir jest.spyOn.
 */

const cron = require('node-cron');
const Consulta = require('../models/Consulta');

/**
 * Executa o lembrete de consultas de amanhã.
 * @returns {Promise<{ processados: number, notificados: number, consultas: number }>}
 */
async function executarLembreteAmanha() {
  console.log('📅 [Lembrete Amanhã] A iniciar às', new Date().toISOString());

  try {
    // 1) Calcula o intervalo de amanhã (meia-noite UTC).
    const agora = new Date();
    const amanhaInicio = new Date(
      Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())
    );
    amanhaInicio.setUTCDate(amanhaInicio.getUTCDate() + 1);
    const amanhaFim = new Date(amanhaInicio.getTime() + 24 * 60 * 60 * 1000);

    // 2) Procura Consultas de amanhã (estados ativos).
    const consultas = await Consulta.find({
      data_hora_inicio: { $gte: amanhaInicio, $lt: amanhaFim },
      estado: { $in: ['marcada', 'confirmada'] },
      // Só consultas que ainda não receberam lembrete_24h.
      lembrete_24h_enviado: { $ne: true },
    })
      .populate({
        path: 'fisioterapeuta_id',
        select: 'nome ativo eliminado_em role',
      })
      .lean();

    if (consultas.length === 0) {
      console.log('ℹ️  [Lembrete Amanhã] Sem consultas para amanhã.');
      return { processados: 0, notificados: 0, consultas: 0 };
    }

    // 3) Agrupa por fisioterapeuta.
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
      console.log('ℹ️  [Lembrete Amanhã] Consultas encontradas, mas sem fisios ativos.');
      return { processados: 0, notificados: 0, consultas: consultas.length };
    }

    // 4) Envia push a cada fisio + marca lembrete_24h_enviado=true.
    const { notificarUtilizador } = require('../utils/notificar');
    let notificados = 0;
    const consultasAtualizadas = [];

    for (const [, { fisio, consultas: consultasFisio }] of porFisio) {
      const count = consultasFisio.length;
      const msg = count === 1
        ? `📅 Lembrete: tens 1 consulta amanhã.`
        : `📅 Lembrete: tens ${count} consultas amanhã.`;

      notificarUtilizador(
        String(fisio._id),
        '📅 Agenda de Amanhã',
        msg,
        '/staff',
        { criarInApp: true, tipo: 'sistema' }
      );
      notificados++;

      // Marca as consultas como lembrete enviado.
      for (const c of consultasFisio) {
        consultasAtualizadas.push(c._id);
      }
    }

    // Atualiza as consultas em lote.
    await Consulta.updateMany(
      { _id: { $in: consultasAtualizadas } },
      { $set: { lembrete_24h_enviado: true } }
    );

    console.log(
      `✅ [Lembrete Amanhã] Concluído: ${notificados} fisio(s) notificado(s), ${consultas.length} consulta(s).`
    );
    return { processados: porFisio.size, notificados, consultas: consultas.length };
  } catch (err) {
    console.error('❌ [Lembrete Amanhã] Erro:', err.message);
    return { processados: 0, notificados: 0, consultas: 0, erro: err.message };
  }
}

/**
 * Inicia o cron job. Agenda para todos os dias às 19:00 (Europe/Lisbon).
 */
function iniciarLembreteAmanha() {
  console.log('⏰ [Lembrete Amanhã] Cron agendado para 19:00 diariamente (Europe/Lisbon).');
  cron.schedule('0 19 * * *', async () => {
    await executarLembreteAmanha();
  }, { timezone: 'Europe/Lisbon' });
  return { executarLembreteAmanha };
}

module.exports = { iniciarLembreteAmanha, executarLembreteAmanha };
