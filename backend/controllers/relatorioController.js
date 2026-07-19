/**
 * Relatório Controller — FisioCell
 *
 * Endpoints de analytics / relatórios de produtividade.
 *
 * Autenticação: obrigatória (middleware `auth` aplicado nas rotas).
 * O `empresa_id` é lido do JWT (req.user.empresa_id).
 *
 * F8 — Limpeza: removido o import de Tarefa (eliminado). A função
 * getRelatorioProdutividade foi reescrita para usar Consulta (F4):
 *   - data → data_hora_inicio
 *   - utilizador_id → fisioterapeuta_id
 *   - propriedade_id → sala_id
 *   - tempo_limpeza_minutos → duracao_minutos
 *   - hora_conclusao → concluida_em
 * Estados: marcada/confirmada/em_curso/concluida/cancelada/faltou/nao_compareceu.
 */

const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Consulta = require('../models/Consulta');
const Utilizador = require('../models/Utilizador');
const Propriedade = require('../models/Propriedade');
const { obterEmpresaId } = require('./gestorController');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Normaliza um parâmetro de data (string ISO ou yyyy-mm-dd) para meia-noite
 * UTC. Devolve null se inválido.
 */
function normalizarDataUTC(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  if (isNaN(d.getTime())) return null;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

/**
 * Arredonda para 1 casa decimal (percentagens).
 */
function round1(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* GET /api/gestor/relatorios/produtividade                             */
/* ------------------------------------------------------------------ */

/**
 * Relatório de produtividade da empresa num intervalo de datas.
 *
 * F8 — Reescrito para usar Consulta (F4) em vez de Tarefa (eliminado).
 *
 * Query params:
 *   - inicio (yyyy-mm-dd | ISO) — início do período. Default: há 30 dias.
 *   - fim    (yyyy-mm-dd | ISO) — fim do período (inclusive). Default: hoje.
 *
 * Resposta 200:
 *   {
 *     periodo: { inicio, fim },
 *     resumo: {
 *       totalConsultas,           // exclui canceladas
 *       concluidas,
 *       taxaConclusao,            // 0..1
 *       emAtraso,                 // consultas não concluídas/canceladas cuja data já passou
 *       taxaAtraso,               // 0..1 (emAtraso / total)
 *       cargaTotalMinutos,        // soma de duracao_minutos (exclui canceladas)
 *       tempoMedioMinutos,        // média de duracao_minutos das concluídas
 *       tempoEstimadoMedioMinutos,// alias de tempoMedioMinutos
 *       tempoRealMedioMinutos     // média de (concluida_em - data_hora_inicio) das concluídas
 *     },
 *     porFisio: [{ utilizador_id, nome, total, concluidas, carga_minutos, taxaConclusao }],
 *     porDia:   [{ data, total, concluidas, carga_minutos }],
 *     porEstado:[{ estado, total }],
 *     porSala:  [{ sala_id, nome, total, carga_minutos }]
 *   }
 */
exports.getRelatorioProdutividade = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    // Período — default: últimos 30 dias.
    const agora = new Date();
    const hojeFim = new Date(
      Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()) +
        24 * 60 * 60 * 1000
    ); // amanhã 00:00 UTC (exclusive)
    const fim = normalizarDataUTC(req.query.fim) || hojeFim;
    const inicio =
      normalizarDataUTC(req.query.inicio) ||
      new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000);

    // O intervalo é [inicio, fim[ (fim exclusive — já é meia-noite do dia
    // seguinte se vier de normalizarDataUTC; se for hojeFim também).
    const matchBase = {
      empresa_id: new mongoose.Types.ObjectId(empresaId),
      data_hora_inicio: { $gte: inicio, $lt: fim },
    };

    /* ---- Resumo (contagens + somas em paralelo) ---- */
    const [
      totalConsultas,
      concluidas,
      emAtraso,
      cargaTotal,
      tempoMedioAgg,
      porEstadoAgg,
      tempoRealAgg,
    ] = await Promise.all([
      // Total (exclui canceladas).
      Consulta.countDocuments({ ...matchBase, estado: { $ne: 'cancelada' } }),
      // Concluídas.
      Consulta.countDocuments({ ...matchBase, estado: 'concluida' }),
      // Em atraso: não concluídas nem canceladas cuja data já passou.
      Consulta.countDocuments({
        ...matchBase,
        estado: { $nin: ['concluida', 'cancelada'] },
        data_hora_inicio: { $gte: inicio, $lt: new Date() },
      }),
      // Carga total (minutos) — exclui canceladas.
      Consulta.aggregate([
        { $match: { ...matchBase, estado: { $ne: 'cancelada' } } },
        { $group: { _id: null, total: { $sum: '$duracao_minutos' } } },
      ]),
      // Tempo médio estimado das concluídas (duracao_minutos).
      Consulta.aggregate([
        { $match: { ...matchBase, estado: 'concluida' } },
        { $group: { _id: null, media: { $avg: '$duracao_minutos' } } },
      ]),
      // Distribuição por estado.
      Consulta.aggregate([
        { $match: matchBase },
        { $group: { _id: '$estado', total: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
      // Tempo real médio: média da diferença entre concluida_em e
      // data_hora_inicio (em minutos) das consultas concluídas com
      // concluida_em definida.
      Consulta.aggregate([
        {
          $match: {
            ...matchBase,
            estado: 'concluida',
            concluida_em: { $ne: null, $type: 'date' },
          },
        },
        {
          $group: {
            _id: null,
            media: {
              $avg: {
                $divide: [
                  { $subtract: ['$concluida_em', '$data_hora_inicio'] },
                  60 * 1000, // ms → minutos
                ],
              },
            },
          },
        },
      ]),
    ]);

    const cargaTotalMinutos = cargaTotal[0]?.total || 0;
    const tempoMedioMinutos = tempoMedioAgg[0]?.media
      ? Math.round(tempoMedioAgg[0].media)
      : 0;
    // Tempo real médio em minutos — arredondado. Se não houver consultas
    // concluídas com concluida_em, devolve 0.
    const tempoRealMedioMinutos = tempoRealAgg[0]?.media
      ? Math.round(tempoRealAgg[0].media)
      : 0;

    /* ---- Por fisioterapeuta (produtividade individual) ---- */
    const porFisioAgg = await Consulta.aggregate([
      { $match: { ...matchBase, estado: { $ne: 'cancelada' } } },
      {
        $group: {
          _id: '$fisioterapeuta_id',
          total: { $sum: 1 },
          concluidas: {
            $sum: { $cond: [{ $eq: ['$estado', 'concluida'] }, 1, 0] },
          },
          carga_minutos: { $sum: '$duracao_minutos' },
        },
      },
      { $sort: { total: -1 } },
    ]);

    // Popula nomes (inclui consultas sem fisioterapeuta — fisioterapeuta_id
    // é required no schema, mas por segurança tratamos como "Desconhecido").
    const fisioIds = porFisioAgg
      .filter((s) => s._id)
      .map((s) => s._id);
    const fisioInfo = await Utilizador.find({ _id: { $in: fisioIds } })
      .select('nome')
      .lean();
    const fisioMap = new Map(fisioInfo.map((s) => [String(s._id), s.nome]));

    const porFisio = porFisioAgg.map((s) => ({
      utilizador_id: s._id ? String(s._id) : null,
      nome: s._id ? fisioMap.get(String(s._id)) ?? 'Desconhecido' : 'Sem fisioterapeuta',
      total: s.total,
      concluidas: s.concluidas,
      carga_minutos: s.carga_minutos,
      taxaConclusao: s.total > 0 ? round1(s.concluidas / s.total) : 0,
    }));

    /* ---- Por dia (série temporal) ---- */
    const porDiaAgg = await Consulta.aggregate([
      { $match: { ...matchBase, estado: { $ne: 'cancelada' } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$data_hora_inicio' },
          },
          total: { $sum: 1 },
          concluidas: {
            $sum: { $cond: [{ $eq: ['$estado', 'concluida'] }, 1, 0] },
          },
          carga_minutos: { $sum: '$duracao_minutos' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const porDia = porDiaAgg.map((d) => ({
      data: d._id,
      total: d.total,
      concluidas: d.concluidas,
      carga_minutos: d.carga_minutos,
    }));

    /* ---- Por sala (Propriedade) ---- */
    const porSalaAgg = await Consulta.aggregate([
      { $match: { ...matchBase, estado: { $ne: 'cancelada' } } },
      {
        $group: {
          _id: '$sala_id',
          total: { $sum: 1 },
          carga_minutos: { $sum: '$duracao_minutos' },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const salaIds = porSalaAgg.map((p) => p._id);
    const salaInfo = await Propriedade.find({ _id: { $in: salaIds } })
      .select('nome')
      .lean();
    const salaMap = new Map(salaInfo.map((p) => [String(p._id), p.nome]));

    const porSala = porSalaAgg.map((p) => ({
      sala_id: String(p._id),
      nome: salaMap.get(String(p._id)) ?? 'Desconhecida',
      total: p.total,
      carga_minutos: p.carga_minutos,
    }));

    /* ---- Resposta final ---- */
    const porEstado = porEstadoAgg.map((e) => ({ estado: e._id, total: e.total }));

    return res.status(200).json({
      periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
      resumo: {
        totalConsultas,
        concluidas,
        taxaConclusao: totalConsultas > 0 ? round1(concluidas / totalConsultas) : 0,
        emAtraso,
        taxaAtraso: totalConsultas > 0 ? round1(emAtraso / totalConsultas) : 0,
        cargaTotalMinutos,
        tempoMedioMinutos,
        tempoEstimadoMedioMinutos: tempoMedioMinutos,
        tempoRealMedioMinutos,
      },
      porFisio,
      porDia,
      porEstado,
      porSala,
    });
  } catch (err) {
    console.error('❌ getRelatorioProdutividade:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* POST /api/gestor/relatorios/ai-summary                              */
/* ------------------------------------------------------------------ */
/**
 * Gera um "Resumo Executivo" com IA a partir dos dados do relatório
 * (consultas totais, horas, faltas, produtividade por fisio, etc.).
 *
 * Estratégia (best-effort, Prompt 125):
 *   1. Se GEMINI_API_KEY existir  → chama Google Gemini (@google/generative-ai SDK).
 *   2. Else se OPENAI_API_KEY existir → chama OpenAI (gpt-4o-mini).
 *   3. Se nenhuma chave existir OU a chamada falhar → devolve um
 *      placeholder estruturado gerado localmente a partir dos dados
 *      (com secções "Visão Geral", "Tendências", "Recomendações").
 *
 * Body: payload do relatório (resumo + porFisio + porDia + ...).
 * Resposta 200: { resumo: "..." }
 */
exports.getResumoIA = async (req, res) => {
  try {
    const dados = req.body || {};

    // Payload normalizado para construir o prompt / o placeholder.
    const contexto = construirContexto(dados);

    /* ---- Tentativa LLM (best-effort) — Prompt 125: Gemini tem prioridade ---- */
    let resumoLLM = null;

    if (process.env.GEMINI_API_KEY) {
      try {
        resumoLLM = await chamarGemini(contexto);
      } catch (err) {
        console.warn('⚠️  Gemini falhou, a usar placeholder:', err.message);
      }
    } else if (process.env.OPENAI_API_KEY) {
      try {
        resumoLLM = await chamarOpenAI(contexto);
      } catch (err) {
        console.warn('⚠️  OpenAI falhou, a usar placeholder:', err.message);
      }
    }

    const resumo = resumoLLM || gerarPlaceholder(contexto);

    return res.status(200).json({ resumo });
  } catch (err) {
    console.error('❌ getResumoIA:', err.message);
    // Prompt 128 — Em caso de erro inesperado, devolve SEMPRE 200 OK com
    // um placeholder utilizável. Nunca devolve 500 — o frontend precisa de
    // um resumo para gerar o PDF, mesmo que seja o placeholder.
    try {
      const contexto = construirContexto(req.body || {});
      return res.status(200).json({ resumo: gerarPlaceholder(contexto) });
    } catch (err2) {
      // Último recurso: placeholder hardcoded (não depende de construirContexto).
      console.error('❌ getResumoIA fallback também falhou:', err2.message);
      return res.status(200).json({
        resumo: '## Visão Geral\n\nNão foi possível gerar o resumo executivo automaticamente. Consulte as métricas detalhadas abaixo para análise manual.\n\n## Recomendações\n\n- Verifique a configuração das chaves de API (GEMINI_API_KEY ou OPENAI_API_KEY).\n- Tente novamente mais tarde.',
      });
    }
  }
};

/* ------------------------------------------------------------------ */
/* Helpers — getResumoIA                                               */
/* ------------------------------------------------------------------ */

/**
 * Constrói um objecto normalizado a partir do body do pedido.
 * Suporta tanto a estrutura completa do /produtividade como um
 * subconjunto parcial (apenas resumo). Tudo é opcional e tem defaults.
 *
 * F8 — Aceita tanto os campos antigos (totalTarefas, etc.) como os novos
 * (totalConsultas, etc.) para retrocompatibilidade com o frontend.
 */
function construirContexto(dados) {
  const r = dados.resumo || {};
  const periodo = dados.periodo || {};

  // F8 — suporta ambos os nomes (consultas + legacy tarefas) para
  // retrocompatibilidade com payloads gerados pelo frontend antigo.
  const totalConsultas = r.totalConsultas ?? r.totalTarefas ?? dados.totalConsultas ?? dados.totalTarefas ?? 0;
  const porFisio = Array.isArray(dados.porFisio) ? dados.porFisio : (Array.isArray(dados.porStaff) ? dados.porStaff : []);
  const porSala = Array.isArray(dados.porSala) ? dados.porSala : (Array.isArray(dados.porPropriedade) ? dados.porPropriedade : []);

  return {
    periodoInicio: periodo.inicio || null,
    periodoFim: periodo.fim || null,
    totalConsultas,
    concluidas: r.concluidas ?? dados.concluidas ?? 0,
    taxaConclusao: r.taxaConclusao ?? dados.taxaConclusao ?? 0,
    emAtraso: r.emAtraso ?? dados.emAtraso ?? 0,
    taxaAtraso: r.taxaAtraso ?? dados.taxaAtraso ?? 0,
    cargaTotalMinutos: r.cargaTotalMinutos ?? dados.cargaTotalMinutos ?? 0,
    tempoMedioMinutos:
      r.tempoMedioMinutos ?? r.tempoEstimadoMedioMinutos ?? dados.tempoMedioMinutos ?? 0,
    tempoRealMedioMinutos:
      r.tempoRealMedioMinutos ?? dados.tempoRealMedioMinutos ?? 0,
    porFisio,
    porSala,
    porDia: Array.isArray(dados.porDia) ? dados.porDia : [],
    porEstado: Array.isArray(dados.porEstado) ? dados.porEstado : [],
  };
}

/**
 * Constrói um prompt em português europeu focado em gestão clínica
 * (tendências e eficiência), a partir do contexto normalizado.
 *
 * F8 — Texto adaptado ao domínio Fisioterapia (Consultas em vez de
 * Tarefas de limpeza).
 */
function construirPrompt(contexto) {
  const pctConclusao = Math.round(contexto.taxaConclusao * 100);
  const pctAtraso = Math.round(contexto.taxaAtraso * 100);
  const horasTotal = (contexto.cargaTotalMinutos / 60).toFixed(1);
  const tempoMedio = (contexto.tempoMedioMinutos / 60).toFixed(2);
  const tempoReal = (contexto.tempoRealMedioMinutos / 60).toFixed(2);

  const topFisio = [...contexto.porFisio]
    .sort((a, b) => b.taxaConclusao - a.taxaConclusao)
    .slice(0, 5)
    .map(
      (s) =>
        `- ${s.nome}: ${s.concluidas}/${s.total} concluídas (${Math.round(
          s.taxaConclusao * 100
        )}%), carga ${Math.round(s.carga_minutos / 60 * 10) / 10}h`
    )
    .join('\n') || '- (sem dados de fisioterapeutas)';

  const topSalas = [...contexto.porSala]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map(
      (p) =>
        `- ${p.nome}: ${p.total} consultas, carga ${
          Math.round((p.carga_minutos / 60) * 10) / 10
        }h`
    )
    .join('\n') || '- (sem dados de salas)';

  return `És um analista clínico de uma clínica de Fisioterapia (FisioCell).
Escreve um "Resumo Executivo" em português de Portugal, focado em gestão
clínica (tendências e eficiência), a partir dos seguintes dados do período.

Dados:
- Total de consultas: ${contexto.totalConsultas}
- Consultas concluídas: ${contexto.concluidas} (${pctConclusao}%)
- Consultas em atraso: ${contexto.emAtraso} (${pctAtraso}%)
- Carga total estimada: ${horasTotal}h
- Tempo médio estimado por consulta: ${tempoMedio}h
- Tempo real médio por consulta (concluídas): ${tempoReal}h

Top fisioterapeutas (por taxa de conclusão):
${topFisio}

Top salas (por nº de consultas):
${topSalas}

Estrutura obrigatória (usa exactamente estes títulos em markdown):
## Visão Geral
(parágrafo curto com os números-chave)

## Tendências
(2-4 bullets sobre padrões: picos de carga, atrasos, eficiência real vs estimada)

## Recomendações
(3-4 bullets acionáveis focados em gestão clínica: redistribuição de carga,
formação, revisão de estimativas, etc.)

Máximo 350 palavras. Tom profissional, conciso, sem clichés.`;
}

/**
 * Chama a API da OpenAI (gpt-4o-mini) e devolve o texto do resumo.
 * Lança erro se a resposta não for bem-sucedida.
 */
async function chamarOpenAI(contexto) {
  const prompt = construirPrompt(contexto);

  const resposta = await fetch(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'És um assistente de análise clínica para gestão de clínicas de Fisioterapia. Responde sempre em português de Portugal.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 700,
      }),
    }
  );

  if (!resposta.ok) {
    const txt = await resposta.text().catch(() => '');
    throw new Error(`OpenAI ${resposta.status}: ${txt.slice(0, 200)}`);
  }

  const json = await resposta.json();
  const texto = json?.choices?.[0]?.message?.content?.trim();
  if (!texto) throw new Error('OpenAI: resposta vazia.');
  return texto;
}

/**
 * Chama a API do Google Gemini (generateContent) e devolve o texto.
 * Modelo: gemini-2.0-flash (rápido e barato, equivalente ao gpt-4o-mini).
 *
 * Prompt 125 — refactorada para usar o SDK oficial @google/generative-ai
 * em vez do `fetch` cru. O SDK trata autenticação, retries e parsing.
 */
async function chamarGemini(contexto) {
  const prompt = construirPrompt(contexto);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // Gemini 2.0 Flash (free tier, disponível em todas as contas).
  // gemini-1.5-flash foi descontinuado — retorna 404.
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
  });

  const texto = result?.response?.text?.()?.trim();
  if (!texto) throw new Error('Gemini: resposta vazia.');
  return texto;
}

/**
 * Gera um resumo executivo estruturado localmente, sem chamar qualquer
 * API externa. Sempre útil e profissional (não é uma mensagem de erro).
 *
 * F8 — Texto adaptado ao domínio Fisioterapia (consultas em vez de tarefas).
 */
function gerarPlaceholder(contexto) {
  const pctConclusao = Math.round(contexto.taxaConclusao * 100);
  const pctAtraso = Math.round(contexto.taxaAtraso * 100);
  const horasTotal = (contexto.cargaTotalMinutos / 60).toFixed(1);
  const tempoMedio = (contexto.tempoMedioMinutos / 60).toFixed(2);
  const tempoReal = (contexto.tempoRealMedioMinutos / 60).toFixed(2);

  const periodoTxt =
    contexto.periodoInicio && contexto.periodoFim
      ? `no período de ${contexto.periodoInicio.slice(0, 10)} a ${contexto.periodoFim.slice(0, 10)}`
      : 'no período selecionado';

  /* ---- Visão Geral ---- */
  const visaoGeral = `Foram processadas **${contexto.totalConsultas} consultas** ${periodoTxt}, das quais **${contexto.concluidas} foram concluídas** (taxa de conclusão de ${pctConclusao}%). Registaram-se **${contexto.emAtraso} consultas em atraso** (${pctAtraso}% do total). A carga total estimada foi de **${horasTotal}h**, com um tempo médio estimado de ${tempoMedio}h por consulta${
    contexto.tempoRealMedioMinutos > 0
      ? ` e um tempo real médio de ${tempoReal}h nas concluídas`
      : ''
  }.`;

  /* ---- Tendências ---- */
  const tendencias = [];

  if (pctConclusao >= 90) {
    tendencias.push(
      `- **Alta taxa de conclusão (${pctConclusao}%)**: a equipa clínica está a cumprir a maioria das consultas planeadas, indicando boa capacidade de execução.`
    );
  } else if (pctConclusao >= 70) {
    tendencias.push(
      `- **Taxa de conclusão moderada (${pctConclusao}%)**: há espaço para otimização do fluxo de trabalho e melhor distribuição de carga.`
    );
  } else if (contexto.totalConsultas > 0) {
    tendencias.push(
      `- **Taxa de conclusão baixa (${pctConclusao}%)**: prioritário rever planeamento, atribuições e possíveis bloqueios operacionais.`
    );
  }

  if (pctAtraso > 15) {
    tendencias.push(
      `- **Taxa de atraso elevada (${pctAtraso}%)**: sinal de alerta — rever prazos, estimativas e capacidade da equipa.`
    );
  } else if (pctAtraso > 0) {
    tendencias.push(
      `- **Atrasos contidos (${pctAtraso}%)**: dentro de margens aceitáveis, mas convém monitorizar os casos pontuais.`
    );
  }

  if (
    contexto.tempoRealMedioMinutos > 0 &&
    contexto.tempoMedioMinutos > 0
  ) {
    const diff = contexto.tempoRealMedioMinutos - contexto.tempoMedioMinutos;
    const diffPct = Math.round((diff / contexto.tempoMedioMinutos) * 100);
    if (diff <= 0) {
      tendencias.push(
        `- **Eficiência acima do estimado**: o tempo real médio (${tempoReal}h) foi **${Math.abs(
          diffPct
        )}% inferior** ao estimado (${tempoMedio}h) — as estimativas podem estar conservadoras.`
      );
    } else {
      tendencias.push(
        `- **Tempo real acima do estimado** (${tempoReal}h vs ${tempoMedio}h, +${diffPct}%): rever precisão das estimativas ou identificar causas (formação, logística, casos mais complexos).`
      );
    }
  }

  // Tendência de carga por fisioterapeuta (concentração).
  if (contexto.porFisio.length > 1) {
    const cargas = contexto.porFisio
      .filter((s) => s.total > 0)
      .map((s) => s.total);
    if (cargas.length > 1) {
      const max = Math.max(...cargas);
      const min = Math.min(...cargas);
      if (max > min * 2) {
        tendencias.push(
          `- **Distribuição de carga desequilibrada**: o fisioterapeuta com mais consultas tem ${max} e o com menos tem ${min} — possível sobrecarga pontual.`
        );
      }
    }
  }

  if (tendencias.length === 0) {
    tendencias.push(
      `- Sem dados suficientes para identificar tendências significativas neste período.`
    );
  }

  /* ---- Recomendações ---- */
  const recomendacoes = [];

  if (pctConclusao < 90 && contexto.totalConsultas > 0) {
    recomendacoes.push(
      `Reforçar o acompanhamento das ${contexto.totalConsultas - contexto.concluidas} consultas não concluídas: identificar bloqueios e reatribuir sempre que necessário.`
    );
  } else {
    recomendacoes.push(
      `Manter o ritmo de execução atual e continuar a monitorizar indicadores de qualidade clínica (não apenas volume).`
    );
  }

  if (pctAtraso > 10) {
    recomendacoes.push(
      `Implementar revisão semanal de atrasos: analisar causas raiz (subdimensionamento de equipa, estimativas irrealistas, logística) e ajustar planeamento.`
    );
  }

  if (
    contexto.tempoRealMedioMinutos > 0 &&
    contexto.tempoRealMedioMinutos > contexto.tempoMedioMinutos * 1.1
  ) {
    recomendacoes.push(
      `Recalcular as estimativas de duração por consulta com base no tempo real observado — os valores atuais estão subestimados.`
    );
  } else if (
    contexto.tempoRealMedioMinutos > 0 &&
    contexto.tempoRealMedioMinutos < contexto.tempoMedioMinutos * 0.85
  ) {
    recomendacoes.push(
      `Rever as estimativas de duração (atualmente conservadoras) para otimizar o agendamento e a utilização da equipa.`
    );
  }

  if (contexto.porFisio.length > 1) {
    recomendacoes.push(
      `Avaliar redistribuição de carga entre fisioterapeutas: equilibrar consultas por capacidade e experiência, garantindo cobertura adequada das salas com maior volume.`
    );
  }

  if (contexto.porSala.length > 0) {
    const topSala = [...contexto.porSala].sort(
      (a, b) => b.total - a.total
    )[0];
    recomendacoes.push(
      `Focar otimização na sala "${topSala.nome}" (maior volume: ${topSala.total} consultas) — antecedar agendamentos e garantir disponibilidade de equipamentos.`
    );
  }

  // Limita a 4 recomendações.
  const recFinal = recomendacoes.slice(0, 4);

  return [
    '## Visão Geral',
    visaoGeral,
    '',
    '## Tendências',
    tendencias.join('\n'),
    '',
    '## Recomendações',
    recFinal.map((r) => `- ${r}`).join('\n'),
  ].join('\n');
}
