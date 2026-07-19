/**
 * Lembrete 2h Consulta — Cron Job (FisioCell)
 *
 * F7 — A cada 15 minutos, procura consultas que começam em ~2h (entre 1h45 e 2h15
 * de agora) e envia push ao fisioterapeuta. Marca lembrete_2h_enviado=true para
 * não repetir.
 *
 * Mensagem: "⏰ Consulta com [Paciente] às [HH:mm] — faltam ~2 horas."
 *
 * Padrão: novo job (não há equivalente no legacy). notificarUtilizador é
 * require lazy para permitir jest.spyOn.
 */

const cron = require('node-cron');
const Consulta = require('../models/Consulta');

/**
 * Executa a verificação de lembretes 2h.
 * @returns {Promise<{ notificados: number, consultas: number }>}
 */
async function executarLembrete2h() {
  console.log('⏰ [Lembrete 2h] A verificar às', new Date().toISOString());

  try {
    const agora = new Date();
    // Janela: consultas que começam entre 1h45 e 2h15 de agora.
    const inicioJanela = new Date(agora.getTime() + 105 * 60 * 1000); // +1h45
    const fimJanela = new Date(agora.getTime() + 135 * 60 * 1000);    // +2h15

    // Procura consultas na janela, estados ativos, sem lembrete 2h enviado.
    const consultas = await Consulta.find({
      data_hora_inicio: { $gte: inicioJanela, $lt: fimJanela },
      estado: { $in: ['marcada', 'confirmada'] },
      lembrete_2h_enviado: { $ne: true },
    })
      .populate('fisioterapeuta_id', 'nome ativo eliminado_em role')
      .populate('paciente_id', 'nome')
      .lean();

    if (consultas.length === 0) {
      return { notificados: 0, consultas: 0 };
    }

    const { notificarUtilizador } = require('../utils/notificar');
    let notificados = 0;
    const idsAtualizar = [];

    for (const c of consultas) {
      const f = c.fisioterapeuta_id;
      if (!f || f.eliminado_em || !f.ativo) continue;
      if (f.role !== 'fisioterapeuta' && f.role !== 'diretor_clinico') continue;

      const hora = new Date(c.data_hora_inicio).toLocaleTimeString('pt-PT', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const nomePaciente = c.paciente_id?.nome ?? 'paciente';

      notificarUtilizador(
        String(f._id),
        '⏰ Consulta em 2 horas',
        `Consulta com ${nomePaciente} às ${hora} — faltam ~2 horas.`,
        '/staff',
        { criarInApp: true, tipo: 'sistema' }
      );
      notificados++;
      idsAtualizar.push(c._id);
    }

    // Marca lembrete enviado.
    if (idsAtualizar.length > 0) {
      await Consulta.updateMany(
        { _id: { $in: idsAtualizar } },
        { $set: { lembrete_2h_enviado: true } }
      );
    }

    console.log(`✅ [Lembrete 2h] ${notificados} fisio(s) notificado(s).`);
    return { notificados, consultas: consultas.length };
  } catch (err) {
    console.error('❌ [Lembrete 2h] Erro:', err.message);
    return { notificados: 0, consultas: 0, erro: err.message };
  }
}

/**
 * Inicia o cron job. A cada 15 minutos.
 */
function iniciarLembrete2h() {
  console.log('⏰ [Lembrete 2h] Cron agendado a cada 15 minutos.');
  cron.schedule('*/15 * * * *', async () => {
    await executarLembrete2h();
  }, { timezone: 'Europe/Lisbon' });
  return { executarLembrete2h };
}

module.exports = { iniciarLembrete2h, executarLembrete2h };
