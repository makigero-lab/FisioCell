/**
 * Arquivista Consultas — Cron Job (FisioCell)
 *
 * F7 — Todos os domingos às 03:00 (Europe/Lisbon), move consultas concluídas
 * ou canceladas com mais de 6 meses para a coleção `consultas_arquivo`
 * (ConsultaArquivo). Mantém as notas clínicas SOAP para auditoria legal/RGPD
 * (obrigações de retenção: tipicamente 10-20 anos), mas fora da coleção
 * principal para garantir a performance do calendário e queries.
 *
 * Padrão: igual ao arquivista.js (legacy) mas para Consultas.
 */

const cron = require('node-cron');
const Consulta = require('../models/Consulta');
const ConsultaArquivo = require('../models/ConsultaArquivo');

/**
 * Executa o arquivamento de consultas antigas.
 * @returns {Promise<{ arquivadas: number, erros: number }>}
 */
async function executarArquivistaConsultas() {
  console.log('📦 [Arquivista Consultas] A iniciar às', new Date().toISOString());

  try {
    // 1) Calcula a data limite (6 meses atrás).
    const agora = new Date();
    const limite = new Date(agora);
    limite.setMonth(limite.getMonth() - 6);

    // 2) Procura consultas concluídas/canceladas anteriores ao limite.
    const consultasParaArquivar = await Consulta.find({
      estado: { $in: ['concluida', 'cancelada', 'faltou', 'nao_compareceu'] },
      data_hora_inicio: { $lt: limite },
    }).lean();

    if (consultasParaArquivar.length === 0) {
      console.log('ℹ️  [Arquivista Consultas] Sem consultas para arquivar.');
      return { arquivadas: 0, erros: 0 };
    }

    console.log(`📦 [Arquivista Consultas] ${consultasParaArquivar.length} consulta(s) para arquivar.`);

    // 3) Move cada consulta para ConsultaArquivo (preserva todos os campos).
    let arquivadas = 0;
    let erros = 0;
    const idsParaApagar = [];

    for (const c of consultasParaArquivar) {
      try {
        // Remove _id e timestamps para criar novo documento no arquivo.
        const { _id, __v, createdAt, updatedAt, ...dadosConsulta } = c;
        await ConsultaArquivo.create({
          ...dadosConsulta,
          arquivado_em: new Date(),
        });
        idsParaApagar.push(_id);
        arquivadas++;
      } catch (err) {
        console.error(`❌ [Arquivista Consultas] Erro ao arquivar consulta ${c._id}:`, err.message);
        erros++;
      }
    }

    // 4) Apaga as consultas originais (já copiadas para o arquivo).
    if (idsParaApagar.length > 0) {
      await Consulta.deleteMany({ _id: { $in: idsParaApagar } });
    }

    console.log(
      `✅ [Arquivista Consultas] Concluído: ${arquivadas} arquivada(s), ${erros} erro(s).`
    );
    return { arquivadas, erros };
  } catch (err) {
    console.error('❌ [Arquivista Consultas] Erro:', err.message);
    return { arquivadas: 0, erros: 1, erro: err.message };
  }
}

/**
 * Inicia o cron job. Agenda para todos os domingos às 03:00 (Europe/Lisbon).
 */
function iniciarArquivistaConsultas() {
  console.log('⏰ [Arquivista Consultas] Cron agendado para domingo 03:00 (Europe/Lisbon).');
  cron.schedule('0 3 * * 0', async () => {
    await executarArquivistaConsultas();
  }, { timezone: 'Europe/Lisbon' });
  return { executarArquivistaConsultas };
}

module.exports = { iniciarArquivistaConsultas, executarArquivistaConsultas };
