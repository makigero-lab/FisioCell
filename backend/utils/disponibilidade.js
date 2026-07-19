/**
 * Disponibilidade — FisioCell
 *
 * Utilitário partilhado para validar se um utilizador está disponível para
 * receber uma tarefa num determinado dia.
 *
 * Um utilizador está INDISPONÍVEL se tiver uma Ausência APROVADA que cubra
 * o dia da tarefa (data_inicio <= dia <= data_fim).
 *
 * Usado por:
 *   - tarefaController.atribuirTarefa (atribuição manual)
 *   - tarefaController.reatribuirTarefa (reatribuição inteligente)
 *   - tarefaController.criarTarefa (criação manual com atribuição direta)
 *
 * v1.59.0 — Prompt 81: fix crítico de atribuir a staff de férias.
 * Prompt 113 — Tornado robusto a offset de fuso horário (Lisboa/WEST):
 *   A comparação passa a ser feita pela DATA DE CALENDÁRIO de Lisboa
 *   (YYYY-MM-DD) em vez do instante UTC midnight. Isto garante que uma
 *   tarefa criada às 00:00 local (23:00Z do dia anterior em UTC) ainda
 *   conta como "mesmo dia" para efeitos de férias/ausência — que podem
 *   estar armazenadas quer em UTC midnight quer em local midnight.
 */

const Ausencia = require('../models/Ausencia');
const HorarioFisioterapeuta = require('../models/HorarioFisioterapeuta');

/**
 * Devolve a data de calendário (YYYY-MM-DD) de um instante no fuso de
 * Lisboa (Europe/Lisbon). Usa Intl.DateTimeFormat (suportado pelo Node sem
 * libs externas). Ex.: 2026-07-14T23:00:00Z → "2026-07-15" (Lisboa UTC+1).
 */
const fmtLisboa = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Lisbon',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dataLisboa(instante) {
  try {
    return fmtLisboa.format(new Date(instante)); // en-CA → YYYY-MM-DD
  } catch {
    return null;
  }
}

/**
 * Converte um instante para hora local de Lisboa no formato "HH:mm".
 * Usa Intl.DateTimeFormat para respeitar DST.
 */
const fmtHoraLisboa = new Intl.DateTimeFormat('pt-PT', {
  timeZone: 'Europe/Lisbon',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function horaLisboa(instante) {
  try {
    return fmtHoraLisboa.format(new Date(instante)); // "HH:mm"
  } catch {
    return null;
  }
}

/**
 * Compara duas horas no formato "HH:mm".
 * @returns {number} -1 se a < b, 0 se iguais, 1 se a > b
 */
function compararHoras(a, b) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  const amTotal = ah * 60 + am;
  const bmTotal = bh * 60 + bm;
  if (amTotal < bmTotal) return -1;
  if (amTotal > bmTotal) return 1;
  return 0;
}

/**
 * Verifica se o utilizador tem uma ausência APROVADA que cubra o dia da tarefa.
 *
 * @param {string|import('mongoose').Types.ObjectId} utilizadorId
 * @param {Date|string|number} dataTarefa - instante da tarefa (qualquer hora)
 * @returns {Promise<{ indisponivel: boolean, ausencia?: { tipo: string, data_inicio: Date, data_fim: Date } }>}
 */
async function verificarDisponibilidadeUtilizador(utilizadorId, dataTarefa) {
  if (!utilizadorId || !dataTarefa) {
    return { indisponivel: false };
  }

  const diaStr = dataLisboa(dataTarefa);
  if (!diaStr) {
    return { indisponivel: false };
  }

  // Janela de pesquisa ampla (±1 dia em torno do dia da tarefa) para apanhar
  // ausências armazenadas em UTC midnight ou local midnight. Depois filtra
  // em JS pela data de Lisboa para precisão total.
  const diaInicio = new Date(diaStr + 'T00:00:00Z');
  const diaFim = new Date(diaInicio.getTime() + 48 * 60 * 60 * 1000); // +2 dias

  const candidatos = await Ausencia.find({
    utilizador_id: utilizadorId,
    estado: 'aprovada',
    data_inicio: { $lte: diaFim },
    data_fim: { $gte: diaInicio },
  })
    .select('tipo data_inicio data_fim')
    .lean();

  // Compara pela data de Lisboa (robusto a offset).
  const emAusencia = candidatos.find((a) => {
    const ini = dataLisboa(a.data_inicio);
    const fim = dataLisboa(a.data_fim);
    if (!ini || !fim) return false;
    return diaStr >= ini && diaStr <= fim;
  });

  if (emAusencia) {
    return {
      indisponivel: true,
      ausencia: {
        tipo: emAusencia.tipo,
        data_inicio: emAusencia.data_inicio,
        data_fim: emAusencia.data_fim,
      },
    };
  }

  return { indisponivel: false };
}

/**
 * Gera uma mensagem humanizada para o motivo de indisponibilidade.
 *
 * @param {{ tipo: string, data_inicio: Date, data_fim: Date }} ausencia
 * @returns {string}
 */
function mensagemIndisponivel(ausencia) {
  const tipoLabel =
    ausencia.tipo === 'ferias' ? 'Férias'
    : ausencia.tipo === 'doenca' ? 'Baixa por doença'
    : 'Ausência aprovada';

  const inicio = dataLisboa(ausencia.data_inicio);
  const fim = dataLisboa(ausencia.data_fim);

  if (inicio === fim) {
    return `${tipoLabel} neste dia (${inicio}).`;
  }
  return `${tipoLabel} de ${inicio} a ${fim}.`;
}

module.exports = {
  verificarDisponibilidadeUtilizador,
  verificarDisponibilidadeCompleta,
  mensagemIndisponivel,
  // F3 — Horários
  obterHorarioDia,
  verificarConflitoHorario,
  dataLisboa,
  horaLisboa,
  compararHoras,
};

/* ------------------------------------------------------------------ */
/* F3 — Motor de disponibilidade (horários do fisioterapeuta)         */
/* ------------------------------------------------------------------ */

/**
 * Obtém o horário de trabalho de um fisioterapeuta para um dia específico,
 * consultando as 3 camadas por ordem de prioridade:
 *   1. Exceções do dia (tipo='excecao' com data = dia)
 *      - Se houver exceção indisponivel → devolve { disponivel: false }
 *      - Se houver exceção disponivel → usa essas horas
 *   2. Regra recorrente (tipo='recorrente' com dia_semana)
 *   3. Sem regra → devolve null (sem horário definido = não trabalha)
 *
 * Nota: a folga fixa (dias_folga no Utilizador) e as ausências aprovadas
 * são verificadas separadamente (verificarDisponibilidadeCompleta).
 *
 * @param {string|import('mongoose').Types.ObjectId} fisioterapeutaId
 * @param {Date|string|number} data - instante do dia a verificar
 * @returns {Promise<{
 *   disponivel: boolean,
 *   horario: { hora_inicio: string, hora_fim: string } | null,
 *   origem: 'excecao' | 'recorrente' | null,
 *   motivo?: string
 * }>}
 */
async function obterHorarioDia(fisioterapeutaId, data) {
  if (!fisioterapeutaId || !data) {
    return { disponivel: false, horario: null, origem: null, motivo: 'Sem dados.' };
  }

  const diaStr = dataLisboa(data);
  if (!diaStr) {
    return { disponivel: false, horario: null, origem: null, motivo: 'Data inválida.' };
  }

  const diaDate = new Date(diaStr + 'T00:00:00Z');
  const diaFim = new Date(diaDate.getTime() + 24 * 60 * 60 * 1000);

  // 1) Procura exceções para este dia específico.
  const excecoes = await HorarioFisioterapeuta.find({
    fisioterapeuta_id: fisioterapeutaId,
    tipo: 'excecao',
    data: { $gte: diaDate, $lt: diaFim },
    ativo: true,
  }).lean();

  if (excecoes.length > 0) {
    // Se houver uma exceção indisponivel, o fisio não trabalha.
    const indisponivel = excecoes.find((e) => e.disponivel === false);
    if (indisponivel) {
      return {
        disponivel: false,
        horario: null,
        origem: 'excecao',
        motivo: indisponivel.nota || 'Indisponível neste dia (exceção).',
      };
    }
    // Se houver exceção disponivel, usa essas horas (primeira encontrada).
    const exc = excecoes[0];
    return {
      disponivel: true,
      horario: { hora_inicio: exc.hora_inicio, hora_fim: exc.hora_fim },
      origem: 'excecao',
    };
  }

  // 2) Procura regra recorrente para o dia da semana.
  const d = new Date(diaStr + 'T12:00:00Z'); // meio-dia UTC para evitar DST
  const diaSemana = d.getUTCDay(); // 0=Dom...6=Sáb (em UTC, mas diaStr já é Lisboa)

  const recorrente = await HorarioFisioterapeuta.findOne({
    fisioterapeuta_id: fisioterapeutaId,
    tipo: 'recorrente',
    dia_semana: diaSemana,
    ativo: true,
  }).lean();

  if (recorrente) {
    return {
      disponivel: true,
      horario: { hora_inicio: recorrente.hora_inicio, hora_fim: recorrente.hora_fim },
      origem: 'recorrente',
    };
  }

  // 3) Sem regra → não trabalha nesse dia.
  return {
    disponivel: false,
    horario: null,
    origem: null,
    motivo: 'Sem horário definido para este dia.',
  };
}

/**
 * Verifica se uma consulta proposta colide com o horário de trabalho do
 * fisioterapeuta (a consulta tem de estar dentro do bloco de trabalho).
 *
 * @param {string|import('mongoose').Types.ObjectId} fisioterapeutaId
 * @param {Date} dataHoraInicio - instante de início da consulta
 * @param {number} duracaoMinutos - duração da consulta
 * @returns {Promise<{ ok: boolean, motivo?: string, horario?: { hora_inicio: string, hora_fim: string } }>}
 */
async function verificarConflitoHorario(fisioterapeutaId, dataHoraInicio, duracaoMinutos) {
  if (!fisioterapeutaId || !dataHoraInicio) {
    return { ok: false, motivo: 'Dados insuficientes.' };
  }

  // Obtém o horário do dia.
  const horarioDia = await obterHorarioDia(fisioterapeutaId, dataHoraInicio);
  if (!horarioDia.disponivel) {
    return { ok: false, motivo: horarioDia.motivo || 'Fora do horário de trabalho.' };
  }

  // Calcula a hora de início e fim da consulta (em hora local de Lisboa).
  const horaInicioConsulta = horaLisboa(dataHoraInicio);
  const fimConsulta = new Date(new Date(dataHoraInicio).getTime() + duracaoMinutos * 60000);
  const horaFimConsulta = horaLisboa(fimConsulta);

  if (!horaInicioConsulta || !horaFimConsulta) {
    return { ok: false, motivo: 'Não foi possível calcular as horas da consulta.' };
  }

  const { hora_inicio, hora_fim } = horarioDia.horario;

  // Verifica se a consulta está dentro do bloco de trabalho.
  if (compararHoras(horaInicioConsulta, hora_inicio) < 0) {
    return {
      ok: false,
      motivo: `Consulta começa às ${horaInicioConsulta} mas o fisioterapeuta só trabalha a partir das ${hora_inicio}.`,
      horario: horarioDia.horario,
    };
  }
  if (compararHoras(horaFimConsulta, hora_fim) > 0) {
    return {
      ok: false,
      motivo: `Consulta acaba às ${horaFimConsulta} mas o fisioterapeuta só trabalha até às ${hora_fim}.`,
      horario: horarioDia.horario,
    };
  }

  return { ok: true, horario: horarioDia.horario };
}

/**
 * Verificação COMPLETA de disponibilidade: ausências + folga fixa + horários.
 *
 * Consulta por ordem:
 *   1. Ausência aprovada (verificarDisponibilidadeUtilizador)
 *   2. Folga fixa semanal (dias_folga no Utilizador)
 *   3. Horário de trabalho (obterHorarioDia + verificarConflitoHorario)
 *
 * @param {object} utilizador - documento Utilizador completo (com dias_folga)
 * @param {Date} dataHoraInicio - instante de início da consulta
 * @param {number} duracaoMinutos - duração da consulta
 * @returns {Promise<{ ok: boolean, motivo?: string, horario?: object }>}
 */
async function verificarDisponibilidadeCompleta(utilizador, dataHoraInicio, duracaoMinutos) {
  if (!utilizador || !dataHoraInicio) {
    return { ok: false, motivo: 'Dados insuficientes.' };
  }

  // 1) Ausência aprovada.
  const ausenciaCheck = await verificarDisponibilidadeUtilizador(utilizador._id, dataHoraInicio);
  if (ausenciaCheck.indisponivel) {
    return { ok: false, motivo: mensagemIndisponivel(ausenciaCheck.ausencia) };
  }

  // 2) Folga fixa semanal (dias_folga).
  const diaStr = dataLisboa(dataHoraInicio);
  if (diaStr) {
    const d = new Date(diaStr + 'T12:00:00Z');
    const diaSemana = d.getUTCDay();
    if (Array.isArray(utilizador.dias_folga) && utilizador.dias_folga.includes(diaSemana)) {
      const nomesDias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      return { ok: false, motivo: `Folga fixa semanal (${nomesDias[diaSemana]}).` };
    }
  }

  // 3) Horário de trabalho + conflito.
  return verificarConflitoHorario(utilizador._id, dataHoraInicio, duracaoMinutos);
}
