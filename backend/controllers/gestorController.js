/**
 * Admin Controller — FisioCell
 *
 * Endpoints do Painel de Administração.
 *
 * Autenticação (v1.10.0): o `empresa_id` é lido do JWT (injetado pelo
 * middleware `auth` em `req.user.empresa_id`). O fallback legacy
 * `x-empresa-id` foi REMOVIDO — todos os pedidos têm de trazer token válido.
 *
 * F8 — Limpeza: removidas todas as funções que usavam Tarefa (eliminado em
 * F8): getTarefas, getDadosCalendario, exportarTarefasCSV, reportarFaltaSubita,
 * registarBaixaProlongada, getWebhooks, reprocessarWebhook. O dashboard foi
 * reescrito para usar Consulta (F4+). A lógica de desatribuição de Tarefas em
 * alternarEstadoPropriedade foi removida. A referência a ModeloChecklist em
 * atualizarPropriedade foi removida (campo modelo_checklist_id extinto).
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Empresa = require('../models/Empresa');
const Propriedade = require('../models/Propriedade');
const Utilizador = require('../models/Utilizador');
const Consulta = require('../models/Consulta');
const Ausencia = require('../models/Ausencia');
const Auditoria = require('../models/Auditoria');
const { obterCoordenadas } = require('../utils/geocoding');
const { registarAuditoria } = require('../utils/auditoria');

/* ------------------------------------------------------------------ */
/* Helper — obter empresa_id do JWT (req.user)                        */
/* ------------------------------------------------------------------ */

/**
 * Lê o `empresa_id` do JWT (injetado pelo middleware `auth` em `req.user`).
 *
 * v1.10.0: o fallback legacy `x-empresa-id` foi REMOVIDO. O middleware
 * `auth` já garante que `req.user` existe (caso contrário devolve 401 antes
 * de chegar aqui). Esta função apenas valida que o `empresa_id` está presente
 * e é um ObjectId válido.
 *
 * Devolve { ok, empresaId } — se `ok` for false, a resposta de erro já foi
 * enviada e o handler deve terminar imediatamente.
 */
function obterEmpresaId(req, res) {
  const empresaId = req.user && req.user.empresa_id;
  if (!empresaId) {
    res.status(400).json({ erro: 'empresa_id em falta no token.' });
    return { ok: false };
  }
  if (!mongoose.isValidObjectId(empresaId)) {
    res.status(400).json({ erro: 'empresa_id do token inválido.' });
    return { ok: false };
  }
  return { ok: true, empresaId };
}

// Exporta para reutilização noutros controllers (ex: relatorioController).
exports.obterEmpresaId = obterEmpresaId;

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

/**
 * GET /api/gestor/dashboard
 * Devolve estatísticas em tempo real para o dashboard do gestor.
 *
 * F8 — Reescrito para usar Consulta em vez de Tarefa (eliminado).
 *
 * Resposta 200: {
 *   totalPropriedades, propriedadesAtivas,
 *   membrosEquipaAtivos,
 *   consultasHoje, consultasMarcadasHoje, consultasConcluidasHoje,
 *   cargaPorFisio: [{ utilizador_id, nome, consultas, carga_minutos }]
 * }
 */
exports.getDashboard = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    // Datas de hoje (UTC).
    const agora = new Date();
    const hojeInicio = new Date(
      Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())
    );
    const amanhaInicio = new Date(hojeInicio.getTime() + 24 * 60 * 60 * 1000);

    // Contagens em paralelo (Consulta em vez de Tarefa).
    const [
      totalPropriedades,
      propriedadesAtivas,
      membrosEquipaAtivos,
      consultasHoje,
      consultasMarcadasHoje,
      consultasConcluidasHoje,
    ] = await Promise.all([
      Propriedade.countDocuments({ empresa_id: empresaId }),
      Propriedade.countDocuments({ empresa_id: empresaId, ativo: true }),
      Utilizador.countDocuments({
        empresa_id: empresaId,
        role: { $in: ['fisioterapeuta', 'diretor_clinico'] },
        ativo: true,
        eliminado_em: null,
      }),
      // Total de consultas de hoje (exceto canceladas).
      Consulta.countDocuments({
        empresa_id: empresaId,
        data_hora_inicio: { $gte: hojeInicio, $lt: amanhaInicio },
        estado: { $ne: 'cancelada' },
      }),
      // Consultas de hoje marcadas/confirmadas/em_curso (não concluídas nem canceladas).
      Consulta.countDocuments({
        empresa_id: empresaId,
        data_hora_inicio: { $gte: hojeInicio, $lt: amanhaInicio },
        estado: { $in: ['marcada', 'confirmada', 'em_curso'] },
      }),
      // Consultas de hoje concluídas.
      Consulta.countDocuments({
        empresa_id: empresaId,
        data_hora_inicio: { $gte: hojeInicio, $lt: amanhaInicio },
        estado: 'concluida',
      }),
    ]);

    // Carga por fisioterapeuta (aggregate sobre duracao_minutos).
    const cargasPorFisio = await Consulta.aggregate([
      {
        $match: {
          empresa_id: new mongoose.Types.ObjectId(empresaId),
          data_hora_inicio: { $gte: hojeInicio, $lt: amanhaInicio },
          estado: { $nin: ['cancelada'] },
          fisioterapeuta_id: { $ne: null },
        },
      },
      {
        $group: {
          _id: '$fisioterapeuta_id',
          consultas: { $sum: 1 },
          carga_minutos: { $sum: '$duracao_minutos' },
        },
      },
    ]);

    // Popula nomes dos fisioterapeutas.
    const fisioIds = cargasPorFisio.map((c) => c._id);
    const fisioInfo = await Utilizador.find({ _id: { $in: fisioIds } })
      .select('nome')
      .lean();
    const fisioMap = new Map(fisioInfo.map((s) => [String(s._id), s.nome]));

    const cargaPorFisio = cargasPorFisio.map((c) => ({
      utilizador_id: String(c._id),
      nome: fisioMap.get(String(c._id)) ?? '?',
      consultas: c.consultas,
      carga_minutos: c.carga_minutos,
    }));

    return res.status(200).json({
      totalPropriedades,
      propriedadesAtivas,
      membrosEquipaAtivos,
      consultasHoje,
      consultasMarcadasHoje,
      consultasConcluidasHoje,
      cargaPorFisio,
    });
  } catch (err) {
    console.error('❌ getDashboard:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* Propriedades                                                         */
/* ------------------------------------------------------------------ */

/**
 * GET /api/gestor/propriedades
 * Devolve as propriedades dessa empresa.
 */
exports.getPropriedades = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const propriedades = await Propriedade.find({ empresa_id: empresaId }).sort(
      { nome: 1 }
    );

    return res.status(200).json({ propriedades });
  } catch (err) {
    console.error('❌ getPropriedades:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * POST /api/gestor/propriedades
 * Cria uma propriedade/sala para essa empresa.
 * Valida: nome (obrigatório), morada (obrigatório),
 * tempo_limpeza_minutos (opcional, default 45).
 *
 * F0: smoobu_id removido (integração Smoobu eliminada).
 *
 * Body esperado:
 *   { nome, morada, tempo_limpeza_minutos? }
 */
exports.criarPropriedade = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { nome, morada, tempo_limpeza_minutos } = req.body || {};

    // Validações de presença.
    if (!nome || !morada) {
      return res.status(400).json({
        erro: 'Campos obrigatórios em falta: nome e morada.',
      });
    }

    // F0 — Validação de unicidade do smoobu_id removida.

    // Validação de tempo_limpeza_minutos (se vier, tem de ser número >= 0).
    let tempo = 45;
    if (tempo_limpeza_minutos !== undefined && tempo_limpeza_minutos !== null) {
      const n = Number(tempo_limpeza_minutos);
      if (Number.isNaN(n) || n < 0) {
        return res.status(400).json({
          erro: 'tempo_limpeza_minutos deve ser um número maior ou igual a 0.',
        });
      }
      tempo = n;
    }

    // Geocoding: converte a morada em coordenadas (lat, lng).
    // Prompt 114 — Se o Nominatim devolver vazio (morada complexa) ou falhar,
    // faz CATCH silenciosamente. A propriedade é criada com coordenadas null
    // (não bloqueia). Devolve flag `geocoding_falhou` para o frontend mostrar
    // um Toast de warning aconselhando a simplificar a morada.
    const moradaTrim = String(morada).trim();
    let coordenadas = { lat: null, lng: null };
    let geocodingFalhou = false;
    try {
      const coords = await obterCoordenadas(moradaTrim);
      if (coords) {
        coordenadas = coords;
      } else {
        geocodingFalhou = true;
      }
    } catch (err) {
      geocodingFalhou = true;
      console.error('⚠️  Geocoding falhou (propriedade criada sem coordenadas):', err.message);
    }

    const nova = await Propriedade.create({
      nome: String(nome).trim(),
      morada: moradaTrim,
      coordenadas,
      empresa_id: empresaId,
      tempo_limpeza_minutos: tempo,
      checklist: Array.isArray(req.body?.checklist)
        ? req.body.checklist.filter((s) => typeof s === 'string' && s.trim())
        : [],
    });

    // Auditoria.
    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Admin',
      empresa_id: empresaId,
      acao: 'criar',
      recurso: 'propriedade',
      recurso_id: nova._id,
      descricao: `Propriedade "${nova.nome}" criada`,
      detalhes: { morada: nova.morada },
    });

    const respostaCriar = { propriedade: nova };
    if (geocodingFalhou) {
      respostaCriar.warning = 'Não foi possível georreferenciar a morada (coordenadas ficam vazias). Tenta simplificar a morada para ativar o cálculo de distâncias.';
    }
    return res.status(201).json(respostaCriar);
  } catch (err) {
    console.error('❌ criarPropriedade:', err.message);

    // Erro de validação do Mongoose (campo obrigatório, etc.)
    if (err.name === 'ValidationError') {
      return res.status(400).json({ erro: err.message });
    }

    // Erro de chave duplicada (índice único)
    if (err.code === 11000) {
      return res.status(409).json({
        erro: 'Violação de unicidade.',
        detalhe: err.keyValue,
      });
    }

    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * PATCH /api/gestor/propriedades/:id/estado
 * Alterna o campo `ativo` da propriedade (true ↔ false).
 *
 * F8 — Limpeza: removida a lógica de desatribuição de Tarefas futuras
 * (Tarefa eliminado em F8). A propriedade é simplesmente ativada/desativada.
 *
 * Resposta 200: { propriedade: { ... }, ativo: boolean }
 */
exports.alternarEstadoPropriedade = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de propriedade inválido.' });
    }

    // Primeiro busca para validar pertença à empresa e saber o estado atual.
    const propriedade = await Propriedade.findOne({
      _id: id,
      empresa_id: empresaId,
    }).lean();
    if (!propriedade) {
      return res.status(404).json({
        erro: 'Propriedade não encontrada (ou não pertence a esta empresa).',
      });
    }

    // Se vier `ativo` no body, usa-o; senão alterna.
    const novoEstado =
      typeof req.body?.ativo === 'boolean' ? req.body.ativo : !propriedade.ativo;

    // Usa findOneAndUpdate com $set em vez de save() para NÃO re-validar o
    // documento inteiro. Isto evita 500s em propriedades legacy que possam
    // faltar campos que entretanto se tornaram obrigatórios (ex: morada).
    const atualizada = await Propriedade.findOneAndUpdate(
      { _id: id, empresa_id: empresaId },
      { $set: { ativo: novoEstado } },
      { new: true }
    ).lean();

    return res.status(200).json({
      propriedade: atualizada,
      ativo: novoEstado,
    });
  } catch (err) {
    console.error('❌ alternarEstadoPropriedade:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * PUT /api/gestor/propriedades/:id
 * Atualiza os dados de uma propriedade/sala (nome, morada,
 * tempo_limpeza_minutos). Se a morada mudar, re-faz geocoding para
 * atualizar as coordenadas.
 *
 * F0: smoobu_id removido (integração Smoobu eliminada).
 * F8: modelo_checklist_id removido (ModeloChecklist eliminado).
 *
 * Body (todos opcionais, mas pelo menos um tem de vir):
 *   { nome?, morada?, tempo_limpeza_minutos?, checklist?, funcionario_preferencial_id? }
 *
 * Regras:
 *   - Valida pertença à empresa (404 se não pertencer).
 *   - Se a morada mudar, re-faz geocoding (best-effort: se falhar, mantém
 *     as coordenadas antigas — não bloqueia a edição).
 *
 * Resposta 200: { propriedade }
 */
exports.atualizarPropriedade = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de propriedade inválido.' });
    }

    const propriedade = await Propriedade.findOne({
      _id: id,
      empresa_id: empresaId,
    });
    if (!propriedade) {
      return res.status(404).json({
        erro: 'Propriedade não encontrada (ou não pertence a esta empresa).',
      });
    }

    const { nome, morada, tempo_limpeza_minutos, funcionario_preferencial_id } = req.body || {};

    // Tem de haver pelo menos um campo para atualizar.
    if (
      nome === undefined &&
      morada === undefined &&
      tempo_limpeza_minutos === undefined &&
      funcionario_preferencial_id === undefined &&
      req.body?.checklist === undefined
    ) {
      return res.status(400).json({
        erro: 'Nenhum campo para atualizar. Envie nome, morada, tempo_limpeza_minutos, checklist ou funcionario_preferencial_id.',
      });
    }

    // Validações de formato (se vierem).
    if (nome !== undefined && !String(nome).trim()) {
      return res.status(400).json({ erro: 'nome não pode ser vazio.' });
    }
    if (morada !== undefined && !String(morada).trim()) {
      return res.status(400).json({ erro: 'morada não pode ser vazia.' });
    }
    if (tempo_limpeza_minutos !== undefined && tempo_limpeza_minutos !== null) {
      const n = Number(tempo_limpeza_minutos);
      if (Number.isNaN(n) || n < 0) {
        return res.status(400).json({
          erro: 'tempo_limpeza_minutos deve ser um número maior ou igual a 0.',
        });
      }
    }

    // Nome.
    if (nome !== undefined) {
      propriedade.nome = String(nome).trim();
    }

    // Tempo de limpeza.
    if (tempo_limpeza_minutos !== undefined && tempo_limpeza_minutos !== null) {
      propriedade.tempo_limpeza_minutos = Number(tempo_limpeza_minutos);
    }

    // Morada — se mudou, re-faz geocoding (best-effort).
    let geocodingFalhou = false;
    if (morada !== undefined) {
      const novaMorada = String(morada).trim();
      if (novaMorada !== propriedade.morada) {
        propriedade.morada = novaMorada;
        try {
          const coords = await obterCoordenadas(novaMorada);
          if (coords) {
            propriedade.coordenadas = coords;
          } else {
            geocodingFalhou = true;
          }
        } catch (err) {
          // Geocoding falhou → mantém coordenadas antigas (não bloqueia).
          geocodingFalhou = true;
          console.error(
            '⚠️  Geocoding falhou na edição (coordenadas mantidas):',
            err.message
          );
        }
      }
    }

    // Checklist (array de strings — lista de itens a verificar).
    if (req.body?.checklist !== undefined) {
      propriedade.checklist = Array.isArray(req.body.checklist)
        ? req.body.checklist.filter((s) => typeof s === 'string' && s.trim())
        : [];
    }

    // Funcionário preferencial (Algoritmo VIP).
    // Aceita null/empty para remover; caso contrário valida que é um staff
    // ativo da mesma empresa.
    if (funcionario_preferencial_id !== undefined) {
      const valor = funcionario_preferencial_id === null || funcionario_preferencial_id === ''
        ? null
        : String(funcionario_preferencial_id).trim();
      if (valor !== null) {
        if (!mongoose.isValidObjectId(valor)) {
          return res.status(400).json({ erro: 'funcionario_preferencial_id inválido.' });
        }
        const staffPref = await Utilizador.findOne({
          _id: valor,
          empresa_id: empresaId,
          role: 'fisioterapeuta',
          ativo: true,
          eliminado_em: null,
        }).lean();
        if (!staffPref) {
          return res.status(400).json({
            erro: 'Funcionário preferencial não encontrado (não é staff ativo desta empresa).',
          });
        }
      }
      propriedade.funcionario_preferencial_id = valor;
    }

    await propriedade.save();

    // Auditoria.
    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Admin',
      empresa_id: empresaId,
      acao: 'atualizar',
      recurso: 'propriedade',
      recurso_id: propriedade._id,
      descricao: `Propriedade "${propriedade.nome}" atualizada`,
      detalhes: { morada: propriedade.morada },
    });

    return res.status(200).json({
      propriedade,
      ...(geocodingFalhou
        ? { warning: 'Não foi possível georreferenciar a nova morada. Coordenadas antigas mantidas. Tenta simplificar a morada.' }
        : {}),
    });
  } catch (err) {
    console.error('❌ atualizarPropriedade:', err.message);

    if (err.name === 'ValidationError') {
      return res.status(400).json({ erro: err.message });
    }
    if (err.code === 11000) {
      return res.status(409).json({
        erro: 'Violação de unicidade.',
        detalhe: err.keyValue,
      });
    }

    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* Equipa (Utilizadores)                                               */
/* ------------------------------------------------------------------ */

/**
 * GET /api/gestor/equipa
 * Lista todos os utilizadores da empresa (qualquer role).
 * O `empresa_id` vem do JWT (via obterEmpresaId, que lê `req.user.empresa_id`).
 *
 * Resposta 200: { utilizadores: [...] } (sem password_hash).
 */
exports.getEquipa = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    // Prompt 116 — Filtro rigoroso da equipa:
    //   - só utilizadores ativos (ativo: true)
    //   - exclui ESTritamente o Super Admin (role: 'admin') — nunca pode
    //     aparecer nas listas do Gestor
    //   - exclui eliminados (soft delete)
    const utilizadores = await Utilizador.find({
      empresa_id: empresaId,
      eliminado_em: null,
      ativo: true,
      role: { $ne: 'admin' },
    })
      .select('-password_hash') // nunca expor a hash
      .populate({ path: 'responsavel_id', select: 'nome email role' })
      .sort({ nome: 1 })
      .lean();

    // Transforma responsavel_id (objeto populated) num campo `responsavel` limpo
    // e mantém responsavel_id como string (ou null) para o frontend.
    const transformados = utilizadores.map((u) => {
      const resp = u.responsavel_id;
      return {
        ...u,
        responsavel_id: resp ? String(resp._id) : null,
        responsavel: resp
          ? { _id: String(resp._id), nome: resp.nome, email: resp.email, role: resp.role }
          : null,
      };
    });

    return res.status(200).json({ utilizadores: transformados });
  } catch (err) {
    console.error('❌ getEquipa:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * POST /api/gestor/equipa
 * Cria um novo membro de equipa (Utilizador) para a empresa.
 *
 * Body: { nome, email, password, role }
 *   - nome      (obrigatório)
 *   - email     (obrigatório, único global)
 *   - password  (obrigatória, em claro — é guardada como hash bcrypt)
 *   - role      (opcional, default 'fisioterapeuta'; enum ['admin','diretor_clinico','fisioterapeuta','rececionista'])
 *
 * Resposta 201: { utilizador: { ... } } (sem password_hash).
 * Erros: 400 campos em falta / role inválido; 409 email duplicado; 500 erro.
 */
exports.criarMembroEquipa = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { nome, email, password, role, responsavel_id, dias_folga, telefone } = req.body || {};

    // Validações de presença.
    if (!nome || !email || !password) {
      return res.status(400).json({
        erro: 'Campos obrigatórios em falta: nome, email e password.',
      });
    }

    // Validação da password (mínimo 6 caracteres).
    if (String(password).length < 6) {
      return res.status(400).json({
        erro: 'A password deve ter pelo menos 6 caracteres.',
      });
    }

    // Validação do role (se vier, tem de ser um dos permitidos).
    // F1 — roles migrados: admin, diretor_clinico, fisioterapeuta, rececionista.
    const roleFinal = role || 'fisioterapeuta';
    if (!['diretor_clinico', 'fisioterapeuta', 'rececionista'].includes(roleFinal)) {
      return res.status(400).json({
        erro: 'Role inválido. Valores permitidos: diretor_clinico, fisioterapeuta, rececionista.',
      });
    }

    // SEGURANÇA: Não é possível criar utilizadores com role 'admin'.
    // O admin é criado apenas via /api/admin/setup (bootstrap) ou processo separado.
    if (roleFinal === 'admin') {
      return res.status(403).json({
        erro: 'Não é possível criar utilizadores com role "admin".',
      });
    }

    // Validação de unicidade do email (único global).
    const emailNormalizado = String(email).toLowerCase().trim();
    const existente = await Utilizador.findOne({ email: emailNormalizado });
    if (existente) {
      return res.status(409).json({
        erro: `Já existe um utilizador com o email "${emailNormalizado}".`,
      });
    }

    // SEGURANÇA: Valida responsavel_id se vier — tem de ser admin/gestor
    // da mesma empresa.
    let responsavelValidado = null;
    if (responsavel_id) {
      if (!mongoose.isValidObjectId(responsavel_id)) {
        return res.status(400).json({ erro: 'responsavel_id inválido.' });
      }
      const resp = await Utilizador.findOne({
        _id: responsavel_id,
        empresa_id: empresaId,
        role: { $in: ['admin', 'diretor_clinico'] },
      });
      if (!resp) {
        return res.status(400).json({
          erro: 'Responsável não encontrado (ou não é admin/gestor da empresa).',
        });
      }
      responsavelValidado = resp._id;
    }

    // Valida dias_folga se vier (array de inteiros 0-6).
    let diasFolgaFinal = [];
    if (dias_folga !== undefined && dias_folga !== null) {
      if (!Array.isArray(dias_folga)) {
        return res.status(400).json({ erro: 'dias_folga deve ser um array de inteiros (0-6).' });
      }
      diasFolgaFinal = dias_folga.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    }

    // Hash da password com bcrypt.
    const password_hash = await bcrypt.hash(String(password), 10);

    const novo = await Utilizador.create({
      nome: String(nome).trim(),
      email: emailNormalizado,
      password_hash,
      empresa_id: empresaId,
      role: roleFinal,
      responsavel_id: responsavelValidado,
      dias_folga: diasFolgaFinal,
      telefone: telefone ? String(telefone).trim() : '',
      ativo: true,
    });

    // Resposta sem password_hash.
    const utilizador = novo.toObject();
    delete utilizador.password_hash;

    // Auditoria.
    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Admin',
      empresa_id: empresaId,
      acao: 'criar',
      recurso: 'utilizador',
      recurso_id: utilizador._id,
      descricao: `Utilizador "${utilizador.nome}" criado`,
      detalhes: { email: utilizador.email, role: utilizador.role },
    });

    return res.status(201).json({ utilizador });
  } catch (err) {
    console.error('❌ criarMembroEquipa:', err.message);

    if (err.name === 'ValidationError') {
      return res.status(400).json({ erro: err.message });
    }
    if (err.code === 11000) {
      return res.status(409).json({
        erro: 'Violação de unicidade.',
        detalhe: err.keyValue,
      });
    }
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * PUT /api/gestor/equipa/:id
 * Atualiza Nome, Email e/ou Role de um utilizador, e opcionalmente a password.
 *
 * Body (todos opcionais, mas pelo menos um deve vir):
 *   { nome?, email?, role?, password? }
 *   - password: se vier, é guardada como NOVA hash bcrypt (mín. 6 chars).
 *               Se não vier, a password atual é mantida.
 *
 * Regras de segurança:
 *   - O utilizador tem de pertencer à mesma empresa do JWT.
 *   - Não é possível desativar via este endpoint (usar PATCH /:id/estado).
 *   - Se o email mudar, tem de continuar único.
 *
 * Resposta 200: { utilizador: { ... } } (sem password_hash).
 */
exports.atualizarMembroEquipa = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de utilizador inválido.' });
    }

    const { nome, email, role, password, responsavel_id, dias_folga, telefone } = req.body || {};
    if (
      nome === undefined &&
      email === undefined &&
      role === undefined &&
      password === undefined &&
      responsavel_id === undefined &&
      dias_folga === undefined &&
      telefone === undefined
    ) {
      return res.status(400).json({
        erro: 'Nada para atualizar. Envie nome, email, role, password, responsavel_id, dias_folga e/ou telefone.',
      });
    }

    // SEGURANÇA: Não é possível definir role 'admin' via edição.
    if (role !== undefined && role === 'admin') {
      return res.status(403).json({
        erro: 'Não é possível atribuir o role "admin" via edição.',
      });
    }

    // Procura o utilizador e garante que pertence à empresa do JWT.
    const utilizador = await Utilizador.findOne({ _id: id, empresa_id: empresaId });
    if (!utilizador) {
      return res.status(404).json({
        erro: 'Utilizador não encontrado (ou não pertence a esta empresa).',
      });
    }

    // SEGURANÇA: Não é possível modificar um administrador.
    if (utilizador.role === 'admin') {
      return res.status(403).json({
        erro: 'Não é possível modificar um administrador.',
      });
    }

    // --- Nome ---
    if (nome !== undefined) {
      const n = String(nome).trim();
      if (!n) {
        return res.status(400).json({ erro: 'nome não pode ser vazio.' });
      }
      utilizador.nome = n;
    }

    // --- Email (com verificação de unicidade se mudou) ---
    if (email !== undefined) {
      const emailNormalizado = String(email).toLowerCase().trim();
      if (!emailNormalizado) {
        return res.status(400).json({ erro: 'email não pode ser vazio.' });
      }
      if (emailNormalizado !== utilizador.email) {
        const existente = await Utilizador.findOne({ email: emailNormalizado });
        if (existente) {
          return res.status(409).json({
            erro: `Já existe um utilizador com o email "${emailNormalizado}".`,
          });
        }
        utilizador.email = emailNormalizado;
      }
    }

    // --- Role ---
    if (role !== undefined) {
      if (!['diretor_clinico', 'fisioterapeuta', 'rececionista'].includes(role)) {
        return res.status(400).json({
          erro: 'Role inválido. Valores permitidos via edição: diretor_clinico, fisioterapeuta, rececionista.',
        });
      }
      utilizador.role = role;
    }

    // --- Responsável (opcional: null = sem responsável) ---
    if (responsavel_id !== undefined) {
      if (responsavel_id === null || responsavel_id === '') {
        utilizador.responsavel_id = null;
      } else {
        if (!mongoose.isValidObjectId(responsavel_id)) {
          return res.status(400).json({ erro: 'responsavel_id inválido.' });
        }
        const resp = await Utilizador.findOne({
          _id: responsavel_id,
          empresa_id: empresaId,
          role: { $in: ['admin', 'diretor_clinico'] },
        });
        if (!resp) {
          return res.status(400).json({
            erro: 'Responsável não encontrado (ou não é admin/gestor da empresa).',
          });
        }
        // Não permitir atribuir o utilizador como responsável de si próprio.
        if (String(resp._id) === String(utilizador._id)) {
          return res.status(400).json({
            erro: 'Um utilizador não pode ser responsável de si próprio.',
          });
        }
        utilizador.responsavel_id = resp._id;
      }
    }

    // --- dias_folga (opcional: array de inteiros 0-6) ---
    if (dias_folga !== undefined) {
      if (!Array.isArray(dias_folga)) {
        return res.status(400).json({ erro: 'dias_folga deve ser um array de inteiros (0-6).' });
      }
      utilizador.dias_folga = dias_folga.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    }

    // --- telefone (opcional) ---
    if (telefone !== undefined) {
      utilizador.telefone = String(telefone).trim();
    }

    // --- Password (opcional: só se vier, faz hash nova) ---
    if (password !== undefined && password !== null && String(password) !== '') {
      if (String(password).length < 6) {
        return res.status(400).json({
          erro: 'A password deve ter pelo menos 6 caracteres.',
        });
      }
      utilizador.password_hash = await bcrypt.hash(String(password), 10);
    }

    await utilizador.save();

    // Resposta sem password_hash.
    const resp = utilizador.toObject();
    delete resp.password_hash;
    return res.status(200).json({ utilizador: resp });
  } catch (err) {
    console.error('❌ atualizarMembroEquipa:', err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ erro: err.message });
    }
    if (err.code === 11000) {
      return res.status(409).json({
        erro: 'Violação de unicidade.',
        detalhe: err.keyValue,
      });
    }
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * PATCH /api/gestor/equipa/:id/estado
 * Alterna o estado `ativo` do utilizador (ativa ↔ desativa).
 *
 * Um utilizador desativado NÃO consegue fazer login (ver authController.login).
 *
 * Body (opcional): { ativo: boolean } — se não vier, alterna o estado atual.
 *
 * Resposta 200: { utilizador: { ... }, ativo: boolean } (sem password_hash).
 */
exports.alternarEstadoMembro = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de utilizador inválido.' });
    }

    const utilizador = await Utilizador.findOne({ _id: id, empresa_id: empresaId });
    if (!utilizador) {
      return res.status(404).json({
        erro: 'Utilizador não encontrado (ou não pertence a esta empresa).',
      });
    }

    // SEGURANÇA: Não é possível desativar/ativar um administrador.
    if (utilizador.role === 'admin') {
      return res.status(403).json({
        erro: 'Não é possível modificar o estado de um administrador.',
      });
    }

    // Se vier `ativo` no body, usa-o; senão alterna.
    const novoEstado =
      typeof req.body?.ativo === 'boolean' ? req.body.ativo : !utilizador.ativo;

    utilizador.ativo = novoEstado;
    await utilizador.save();

    const resp = utilizador.toObject();
    delete resp.password_hash;
    return res.status(200).json({ utilizador: resp, ativo: novoEstado });
  } catch (err) {
    console.error('❌ alternarEstadoMembro:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/**
 * DELETE /api/gestor/equipa/:id
 * Remove permanentemente o utilizador da base de dados.
 *
 * Regras de segurança:
 *   - O utilizador tem de pertencer à mesma empresa do JWT.
 *   - Não é possível eliminar-se a si próprio (req.user.id) — evita
 *     o admin ficar sem acesso à conta.
 *
 * Resposta 200: { mensagem, utilizador_id }.
 */
exports.eliminarMembroEquipa = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID de utilizador inválido.' });
    }

    // Proteção: não permitir eliminar-se a si próprio.
    if (req.user && req.user.id && String(req.user.id) === String(id)) {
      return res.status(400).json({
        erro: 'Não podes eliminar a tua própria conta.',
      });
    }

    const utilizador = await Utilizador.findOne({ _id: id, empresa_id: empresaId });
    if (!utilizador) {
      return res.status(404).json({
        erro: 'Utilizador não encontrado (ou não pertence a esta empresa).',
      });
    }

    // SEGURANÇA: Não é possível eliminar um administrador.
    if (utilizador.role === 'admin') {
      return res.status(403).json({
        erro: 'Não é possível eliminar um administrador.',
      });
    }

    const nomeEliminado = utilizador.nome;
    // Soft delete: marca eliminado_em em vez de remover fisicamente.
    // Isto protege o histórico de Consultas antigas de ficarem com
    // fisioterapeuta_id órfão (o histórico de consultas continua a
    // referenciar o utilizador).
    utilizador.eliminado_em = new Date();
    utilizador.ativo = false; // garante que não consegue fazer login
    await utilizador.save();

    // Auditoria.
    registarAuditoria({
      utilizador_id: req.user.id,
      utilizador_nome: req.user.nome || 'Admin',
      empresa_id: empresaId,
      acao: 'eliminar',
      recurso: 'utilizador',
      recurso_id: id,
      descricao: `Utilizador "${nomeEliminado}" eliminado (soft delete)`,
    });

    return res.status(200).json({
      mensagem: `Utilizador "${nomeEliminado}" eliminado com sucesso.`,
      utilizador_id: id,
    });
  } catch (err) {
    console.error('❌ eliminarMembroEquipa:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* Auditoria                                                           */
/* ------------------------------------------------------------------ */

/**
 * GET /api/gestor/auditoria
 * Lista os registos de auditoria da empresa (ordenados por data desc).
 *
 * Query params: ?limit=50 (default 50, máx 200)
 *
 * Resposta 200: { auditoria: [...] }
 */
exports.getAuditoria = async (req, res) => {
  try {
    const { ok, empresaId } = obterEmpresaId(req, res);
    if (!ok) return;

    const limit = Math.min(Number(req.query?.limit) || 50, 200);

    const auditoria = await Auditoria.find({ empresa_id: empresaId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({ auditoria });
  } catch (err) {
    console.error('❌ getAuditoria:', err.message);
    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};

/* ------------------------------------------------------------------ */
/* Setup do "Cliente Zero" (bootstrap do ambiente de testes)          */
/* ------------------------------------------------------------------ */

/**
 * GET /api/gestor/setup
 *
 * Cria o "Cliente Zero" — dados iniciais para testes:
 *   - 1 Empresa: "Clínica FisioCell Teste"
 *   - 1 Utilizador Staff: "João Fisioterapeuta"
 *   - 1 Propriedade/Sala: "Sala Teste"
 *
 * F0: Removido smoobu_id (integração Smoobu eliminada).
 *
 * Idempotente: antes de criar, verifica se a empresa já existe (por nome).
 * Se já existir, reutiliza-a e cria apenas o que faltar.
 *
 * Devolve o `empresa_id` gerado/reutilizado no JSON de resposta.
 */
exports.setupClienteZero = async (req, res) => {
  try {
    const NOME_EMPRESA = 'Clínica FisioCell Teste';
    const NOME_PROPRIEDADE = 'Sala Teste';
    const PASSWORD_TESTE = 'fisiocell123';

    // Utilizadores a garantir (admin + gestor + staff).
    // F0 — renomeado para o novo domínio (Fisioterapia).
    const UTILIZADORES_TESTE = [
      {
        nome: 'Diretor FisioCell', // admin — para ti (dono da conta)
        email: 'admin@fisiocell.pt',
        role: 'admin',
      },
      {
        nome: 'Responsável Clínico', // gestor — gere a equipa
        email: 'gestor@fisiocell.pt',
        role: 'diretor_clinico',
      },
      {
        nome: 'João Fisioterapeuta', // staff — executante
        email: 'joao.fisio@fisiocell.pt',
        role: 'fisioterapeuta',
      },
    ];

    // 1) Empresa — não duplicar (procura por nome).
    let empresa = await Empresa.findOne({ nome: NOME_EMPRESA });
    let empresaCriada = false;
    if (!empresa) {
      empresa = await Empresa.create({
        nome: NOME_EMPRESA,
        plano_ativo: true,
      });
      empresaCriada = true;
    }

    // 2) Utilizadores (admin + gestor + staff) — não duplicar (email único).
    //    Para cada um: cria se não existir, ou define password se existir sem.
    const utilizadores = [];
    for (const u of UTILIZADORES_TESTE) {
      let user = await Utilizador.findOne({ email: u.email });
      let criado = false;
      let passwordDefinida = false;

      if (!user) {
        const password_hash = await bcrypt.hash(PASSWORD_TESTE, 10);
        user = await Utilizador.create({
          nome: u.nome,
          email: u.email,
          password_hash,
          empresa_id: empresa._id,
          role: u.role,
          ativo: true,
        });
        criado = true;
        passwordDefinida = true;
      } else if (!user.password_hash) {
        // Retrocompatibilidade: utilizador criado antes do auth, sem password.
        const password_hash = await bcrypt.hash(PASSWORD_TESTE, 10);
        user.empresa_id = user.empresa_id || empresa._id;
        user.password_hash = password_hash;
        // Garante que o role está correto (caso tenha sido criado com role antigo).
        user.role = u.role;
        await user.save();
        passwordDefinida = true;
      }

      utilizadores.push({
        id: user._id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        criado,
        password_definida: passwordDefinida,
        credenciais_teste: {
          email: u.email,
          password: PASSWORD_TESTE,
        },
      });
    }

    // 3) Propriedade/Sala — não duplicar (procura por nome + empresa).
    let propriedade = await Propriedade.findOne({ nome: NOME_PROPRIEDADE, empresa_id: empresa._id });
    let propriedadeCriada = false;
    if (!propriedade) {
      propriedade = await Propriedade.create({
        nome: NOME_PROPRIEDADE,
        empresa_id: empresa._id,
        tempo_limpeza_minutos: 45,
      });
      propriedadeCriada = true;
    }

    const algoCriado =
      empresaCriada ||
      utilizadores.some((u) => u.criado) ||
      propriedadeCriada;

    return res.status(200).json({
      mensagem: algoCriado
        ? 'Cliente Zero criado com sucesso.'
        : 'Cliente Zero já existia (nada foi alterado).',
      empresa_id: empresa._id,
      empresa: {
        id: empresa._id,
        nome: empresa.nome,
        plano_ativo: empresa.plano_ativo,
        criada: empresaCriada,
      },
      // 3 utilizadores: admin (dono), gestor (responsável clínico), staff (executante).
      utilizadores,
      propriedade: {
        id: propriedade._id,
        nome: propriedade.nome,
        criada: propriedadeCriada,
      },
    });
  } catch (err) {
    console.error('❌ setupClienteZero:', err.message);

    if (err.code === 11000) {
      return res.status(409).json({
        erro: 'Conflito de dados duplicados.',
        detalhe: err.keyValue,
      });
    }

    return res.status(500).json({ erro: 'Erro interno do servidor.' });
  }
};
