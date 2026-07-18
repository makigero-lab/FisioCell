/**
 * Cão de Guarda Consultas — Cron Job (FisioCell)
 *
 * F7 — Todos os dias às 02:00 (Europe/Lisbon), verifica consultas problemáticas:
 *   1. Consultas de hoje sem fisioterapeuta ativo (órfãs)
 *   2. Consultas marcadas para datas passadas não concluídas/canceladas (esquecidas)
 *
 * Envia push ao diretor_clínico/admin com alertas.
 *
 * Padrão: igual ao caoGuarda.js (legacy) mas para Consultas.
 * notificarUtilizador é require lazy para permitir jest.spyOn.
 */

const cron = require('node-cron');
const Consulta = require('../models/Consulta');
const Utilizador = require('../models/Utilizador');

/**
 * Executa a verificação do cão de guarda.
 * @returns {Promise<{ orfas: number, esquecidas: number, alertas: number }>}
 */
async function executarCaoGuardaConsultas() {
  console.log('🐕 [Cão de Guarda Consultas] A iniciar às', new Date().toISOString());

  try {
    const agora = new Date();
    const inicioHoje = new Date(
      Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())
    );
    const fimHoje = new Date(inicioHoje.getTime() + 24 * 60 * 60 * 1000);

    // 1) Consultas de hoje sem fisio ativo (órfãs).
    const consultasHoje = await Consulta.find({
      data_hora_inicio: { $gte: inicioHoje, $lt: fimHoje },
      estado: { $in: ['marcada', 'confirmada', 'em_curso'] },
    })
      .populate('fisioterapeuta_id', 'nome ativo eliminado_em role')
      .populate('paciente_id', 'nome')
      .lean();

    const orfas = consultasHoje.filter((c) => {
      const f = c.fisioterapeuta_id;
      return !f || f.eliminado_em || !f.ativo;
    });

    // 2) Consultas de datas passadas não concluídas/canceladas (esquecidas).
    const esquecidas = await Consulta.find({
      data_hora_inicio: { $lt: inicioHoje },
      estado: { $in: ['marcada', 'confirmada', 'em_curso'] },
    })
      .populate('paciente_id', 'nome')
      .lean();

    const totalAlertas = orfas.length + esquecidas.length;

    if (totalAlertas === 0) {
      console.log('✅ [Cão de Guarda Consultas] Sem problemas detetados.');
      return { orfas: 0, esquecidas: 0, alertas: 0 };
    }

    console.log(
      `⚠️  [Cão de Guarda Consultas] ${orfas.length} órfã(s), ${esquecidas.length} esquecida(s).`
    );

    // 3) Notifica diretores clínicos + admins da empresa.
    const { notificarUtilizador } = require('../utils/notificar');

    // Agrupa alertas por empresa para notificar os diretores de cada empresa.
    const alertasPorEmpresa = new Map();
    for (const c of [...orfas, ...esquecidas]) {
      const empId = String(c.empresa_id);
      if (!alertasPorEmpresa.has(empId)) {
        alertasPorEmpresa.set(empId, { orfas: 0, esquecidas: 0 });
      }
      const alerta = alertasPorEmpresa.get(empId);
    }

    // Conta alertas por empresa.
    for (const c of orfas) {
      const alerta = alertasPorEmpresa.get(String(c.empresa_id));
      if (alerta) alerta.orfas++;
    }
    for (const c of esquecidas) {
      const alerta = alertasPorEmpresa.get(String(c.empresa_id));
      if (alerta) alerta.esquecidas++;
    }

    // Notifica diretores de cada empresa.
    for (const [empId, alerta] of alertasPorEmpresa) {
      const diretores = await Utilizador.find({
        empresa_id: empId,
        role: { $in: ['diretor_clinico', 'admin'] },
        ativo: true,
        eliminado_em: null,
      })
        .select('_id')
        .lean();

      const partes = [];
      if (alerta.orfas > 0) partes.push(`${alerta.orfas} consulta(s) órfã(s)`);
      if (alerta.esquecidas > 0) partes.push(`${alerta.esquecidas} consulta(s) esquecida(s)`);
      const msg = `🐕 Alerta: ${partes.join(', ')}. Verifica o painel.`;

      for (const d of diretores) {
        notificarUtilizador(
          String(d._id),
          '🐕 Cão de Guarda — Alerta',
          msg,
          '/gestor/consultas',
          { criarInApp: true, tipo: 'aviso' }
        );
      }
    }

    console.log(`✅ [Cão de Guarda Consultas] Alertas enviados.`);
    return { orfas: orfas.length, esquecidas: esquecidas.length, alertas: totalAlertas };
  } catch (err) {
    console.error('❌ [Cão de Guarda Consultas] Erro:', err.message);
    return { orfas: 0, esquecidas: 0, alertas: 0, erro: err.message };
  }
}

/**
 * Inicia o cron job. Agenda para todos os dias às 02:00 (Europe/Lisbon).
 */
function iniciarCaoGuardaConsultas() {
  console.log('⏰ [Cão de Guarda Consultas] Cron agendado para 02:00 diariamente (Europe/Lisbon).');
  cron.schedule('0 2 * * *', async () => {
    await executarCaoGuardaConsultas();
  }, { timezone: 'Europe/Lisbon' });
  return { executarCaoGuardaConsultas };
}

module.exports = { iniciarCaoGuardaConsultas, executarCaoGuardaConsultas };
