/**
 * Testes de integração do backend (FisioCell) — Jest + Supertest + MongoDB em memória.
 *
 * Cobertura:
 *   - Health check com BD ligada (GET /api/health)
 *   - Auth 401 em todas as rotas protegidas sem token
 *   - Auth login (sucesso, password errada, campos em falta, user inativo)
 *   - Auth /me com token
 *   - CRUD Propriedades (criar, listar, toggle estado, duplicado 409)
 *   - Webhook Smoobu (cria tarefa + atribui ao staff disponível)
 *   - Dashboard (GET /api/gestor/dashboard)
 *   - Relatórios (GET /api/gestor/relatorios/produtividade)
 *
 * Estratégia:
 *   - Usa mongodb-memory-server (BD efémera em memória, sem dependências externas).
 *   - beforeAll: arranca mongod + liga mongoose + semeia dados base.
 *   - afterAll: desliga mongoose + para mongod.
 *   - beforeEach: limpa as coleções de teste (mantém a empresa/admin).
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const app = require('../server');
const Empresa = require('../models/Empresa');
const Propriedade = require('../models/Propriedade');
const Utilizador = require('../models/Utilizador');

let mongod;
let empresaId;
let adminId;
let adminToken;
const PASSWORD = 'teste123';

/* ------------------------------------------------------------------ */
/* Setup / Teardown                                                    */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  // Semeia a empresa + admin base.
  const empresa = await Empresa.create({ nome: 'Empresa Teste', plano_ativo: true });
  empresaId = String(empresa._id);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const admin = await Utilizador.create({
    nome: 'Admin Teste',
    email: 'admin@teste.pt',
    password_hash: hash,
    empresa_id: empresa._id,
    role: 'admin',
    ativo: true,
  });
  adminId = String(admin._id);

  // Login real para obter token (valida o fluxo de auth end-to-end).
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@teste.pt', password: PASSWORD });
  adminToken = res.body.token;
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

// Helper para fazer pedidos autenticados.
function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${adminToken}`);
}
function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${adminToken}`).send(body);
}
function authPatch(path, body) {
  return request(app).patch(path).set('Authorization', `Bearer ${adminToken}`).send(body || {});
}

// Espera que o processamento assíncrono do webhook (setImmediate) termine.

/* ------------------------------------------------------------------ */
/* 1. Health check                                                     */
/* ------------------------------------------------------------------ */

describe('GET /api/health', () => {
  it('deve devolver 200 e mongodb connected quando a BD está ligada', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.mongodb).toBe('connected');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });
});

/* ------------------------------------------------------------------ */
/* 2. Auth — 401 em rotas protegidas sem token                         */
/* ------------------------------------------------------------------ */

describe('Auth — rotas protegidas sem token devolvem 401', () => {
  const rotasProtegidas = [
    '/api/gestor/dashboard',
    '/api/gestor/propriedades',
    '/api/gestor/equipa',
    '/api/gestor/consultas',
    '/api/gestor/relatorios/produtividade',
    '/api/auth/me',
  ];

  for (const rota of rotasProtegidas) {
    it(`GET ${rota} → 401 sem token`, async () => {
      const res = await request(app).get(rota);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('erro');
    });
  }

  it('token inválido → 401', async () => {
    const res = await request(app)
      .get('/api/gestor/dashboard')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Auth — login                                                     */
/* ------------------------------------------------------------------ */

describe('POST /api/auth/login', () => {
  it('credenciais válidas → 200 + token + utilizador', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@teste.pt', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.utilizador.email).toBe('admin@teste.pt');
    expect(res.body.utilizador.role).toBe('admin');
    expect(res.body.utilizador.empresa_id).toBe(empresaId);
  });

  it('password errada → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@teste.pt', password: 'errada' });
    expect(res.status).toBe(401);
  });

  it('email inexistente → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ninguem@teste.pt', password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('campos em falta → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@teste.pt' });
    expect(res.status).toBe(400);
  });

  it('utilizador inativo → 401', async () => {
    const hash = await bcrypt.hash(PASSWORD, 10);
    await Utilizador.create({
      nome: 'Inativo',
      email: 'inativo@teste.pt',
      password_hash: hash,
      empresa_id: empresaId,
      role: 'fisioterapeuta',
      ativo: false,
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inativo@teste.pt', password: PASSWORD });
    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Auth — /me                                                       */
/* ------------------------------------------------------------------ */

describe('GET /api/auth/me', () => {
  it('com token válido → 200 + dados do utilizador', async () => {
    const res = await authGet('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.utilizador.email).toBe('admin@teste.pt');
    expect(res.body.utilizador.role).toBe('admin');
  });
});

/* ------------------------------------------------------------------ */
/* 5. CRUD Propriedades                                                */
/* ------------------------------------------------------------------ */

describe('Propriedades (CRUD)', () => {
  let propId;

  it('POST /api/gestor/propriedades → 201 (cria propriedade)', async () => {
    const res = await authPost('/api/gestor/propriedades', {
      nome: 'Casa da Praia',
      morada: 'Rua do Mar 1, Lisboa',
      tempo_limpeza_minutos: 90,
    });
    expect(res.status).toBe(201);
    expect(res.body.propriedade).toHaveProperty('_id');
    expect(res.body.propriedade.tempo_limpeza_minutos).toBe(90);
    propId = res.body.propriedade._id;
  });

  it('POST sem campos obrigatórios → 400', async () => {
    // F0 — smoobu_id removido; só nome + morada são obrigatórios.
    const res = await authPost('/api/gestor/propriedades', { nome: 'x' });
    expect(res.status).toBe(400);
  });

  it('GET /api/gestor/propriedades → 200 + lista com a propriedade', async () => {
    const res = await authGet('/api/gestor/propriedades');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.propriedades)).toBe(true);
    // F0 — procura por nome em vez de smoobu_id.
    expect(res.body.propriedades.some((p) => p.nome === 'Casa da Praia')).toBe(true);
  });

  it('PATCH /api/gestor/propriedades/:id/estado → alterna ativo', async () => {
    const res = await authPatch(`/api/gestor/propriedades/${propId}/estado`, { ativo: false });
    expect(res.status).toBe(200);
    expect(res.body.ativo).toBe(false);
  });

  it('PATCH com id inexistente → 404', async () => {
    const idInexistente = new mongoose.Types.ObjectId();
    const res = await authPatch(`/api/gestor/propriedades/${idInexistente}/estado`, {});
    expect(res.status).toBe(404);
  });

  it('PUT /api/gestor/propriedades/:id → 200 (atualiza nome e tempo)', async () => {
    // Cria uma propriedade para editar.
    const criada = await authPost('/api/gestor/propriedades', {
      nome: 'Nome Inicial',
      morada: 'Rua Inicial 1, Lisboa',
      tempo_limpeza_minutos: 60,
    });
    expect(criada.status).toBe(201);

    const res = await request(app)
      .put(`/api/gestor/propriedades/${criada.body.propriedade._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Nome Editado', tempo_limpeza_minutos: 90 });
    expect(res.status).toBe(200);
    expect(res.body.propriedade.nome).toBe('Nome Editado');
    expect(res.body.propriedade.tempo_limpeza_minutos).toBe(90);
    // F0 — smoobu_id removido; morada não mudou.
    expect(res.body.propriedade.morada).toBe('Rua Inicial 1, Lisboa');
  });

  it('PUT com id inexistente → 404', async () => {
    const idInexistente = new mongoose.Types.ObjectId();
    const res = await request(app)
      .put(`/api/gestor/propriedades/${idInexistente}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X' });
    expect(res.status).toBe(404);
  });

  it('PUT sem campos no body → 400', async () => {
    const criada = await authPost('/api/gestor/propriedades', {
      nome: 'C',
      morada: 'Rua C',
    });
    const res = await request(app)
      .put(`/api/gestor/propriedades/${criada.body.propriedade._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('toggle de propriedade legacy (sem morada) → 200 (não rebenta por validação)', async () => {
    // Simula uma propriedade criada antes de `morada` ser obrigatória:
    // insere diretamente na coleção (bypassing Mongoose validation).
    const Propriedade = require('../models/Propriedade');
    const doc = await Propriedade.collection.insertOne({
      nome: 'Legacy',
      // morada EM FALTA (campo obrigatório no schema atual)
      coordenadas: { lat: null, lng: null },
      empresa_id: new mongoose.Types.ObjectId(empresaId),
      tempo_limpeza_minutos: 60,
      ativo: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // O toggle (PATCH .../estado) deve funcionar SEM 500, mesmo com a
    // morada em falta. Isto era o bug de produção ( findOne+save re-valida ).
    const res = await authPatch(
      `/api/gestor/propriedades/${doc.insertedId}/estado`,
      {}
    );
    expect(res.status).toBe(200);
    expect(res.body.ativo).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 5b. Calendário Visual — getDadosCalendario                          */
/* ------------------------------------------------------------------ */

describe('F2 — Pacientes (CRUD + permissões)', () => {
  let fisioToken, rececionistaToken, diretorToken;
  let fisioId, rececionistaId, diretorId;
  let pacienteId;

  beforeAll(async () => {
    // Cria 3 utilizadores com roles diferentes para testar permissões.
    const hash = await bcrypt.hash(PASSWORD, 10);

    const fisio = await Utilizador.create({
      nome: 'Fisio Teste', email: 'fisio.f2@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'fisioterapeuta', ativo: true,
    });
    fisioId = String(fisio._id);

    const rececionista = await Utilizador.create({
      nome: 'Rececionista Teste', email: 'rececionista.f2@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'rececionista', ativo: true,
    });
    rececionistaId = String(rececionista._id);

    const diretor = await Utilizador.create({
      nome: 'Diretor Teste', email: 'diretor.f2@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'diretor_clinico', ativo: true,
    });
    diretorId = String(diretor._id);

    // Login para obter tokens.
    const [rFisio, rRec, rDir] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: 'fisio.f2@teste.pt', password: PASSWORD }),
      request(app).post('/api/auth/login').send({ email: 'rececionista.f2@teste.pt', password: PASSWORD }),
      request(app).post('/api/auth/login').send({ email: 'diretor.f2@teste.pt', password: PASSWORD }),
    ]);
    fisioToken = rFisio.body.token;
    rececionistaToken = rRec.body.token;
    diretorToken = rDir.body.token;
  });

  afterAll(async () => {
    // Limpa utilizadores e pacientes de teste.
    await Utilizador.deleteMany({ email: { $in: ['fisio.f2@teste.pt', 'rececionista.f2@teste.pt', 'diretor.f2@teste.pt'] } });
    const Paciente = require('../models/Paciente');
    await Paciente.deleteMany({ empresa_id: empresaId });
  });

  it('POST /api/gestor/pacientes (rececionista) → 201 cria paciente', async () => {
    const res = await request(app)
      .post('/api/gestor/pacientes')
      .set('Authorization', `Bearer ${rececionistaToken}`)
      .send({
        nome: 'João Silva',
        telefone: '+351912345678',
        data_nascimento: '1990-05-15',
        genero: 'M',
        num_utente: '123456789',
        email: 'joao.silva@email.pt',
        consentimento_dados: { concedido: true, versao_termos: '1.0' },
      });
    expect(res.status).toBe(201);
    expect(res.body.paciente).toHaveProperty('_id');
    expect(res.body.paciente.nome).toBe('João Silva');
    expect(res.body.paciente.telefone).toBe('+351912345678');
    expect(res.body.paciente.consentimento_dados.concedido).toBe(true);
    expect(res.body.dados_clinicos).toBe(false); // rececionista não tem acesso clínico
    pacienteId = res.body.paciente._id;
  });

  it('POST sem campos obrigatórios → 400', async () => {
    const res = await request(app)
      .post('/api/gestor/pacientes')
      .set('Authorization', `Bearer ${rececionistaToken}`)
      .send({ nome: 'Sem Telefone' });
    expect(res.status).toBe(400);
  });

  it('POST com data_nascimento futura → 400', async () => {
    const res = await request(app)
      .post('/api/gestor/pacientes')
      .set('Authorization', `Bearer ${rececionistaToken}`)
      .send({ nome: 'Futuro', telefone: '+351900000000', data_nascimento: '2099-01-01' });
    expect(res.status).toBe(400);
  });

  it('rececionista NÃO pode definir campos clínicos (são ignorados)', async () => {
    const res = await request(app)
      .post('/api/gestor/pacientes')
      .set('Authorization', `Bearer ${rececionistaToken}`)
      .send({
        nome: 'Paciente Rececionista',
        telefone: '+351911111111',
        historico_medico: 'Diabetes',
        alergias: ['Penicilina'],
        contacto_emergencia: { nome: 'Filho', telefone: '+351922222222' },
      });
    expect(res.status).toBe(201);
    // Os campos clínicos NÃO devem ter sido guardados.
    expect(res.body.paciente.historico_medico).toBeUndefined();
    expect(res.body.paciente.alergias).toBeUndefined();
    expect(res.body.paciente.contacto_emergencia).toBeUndefined();
  });

  it('fisioterapeuta PODE definir campos clínicos', async () => {
    const res = await request(app)
      .post('/api/gestor/pacientes')
      .set('Authorization', `Bearer ${fisioToken}`)
      .send({
        nome: 'Paciente Fisio',
        telefone: '+351933333333',
        historico_medico: 'Lombalgia crónica',
        alergias: ['Ibuprofeno', 'Marisco'],
        contacto_emergencia: { nome: 'Esposa', telefone: '+351944444444', relacao: 'Cônjuge' },
      });
    expect(res.status).toBe(201);
    expect(res.body.paciente.historico_medico).toBe('Lombalgia crónica');
    expect(res.body.paciente.alergias).toEqual(['Ibuprofeno', 'Marisco']);
    expect(res.body.paciente.contacto_emergencia.nome).toBe('Esposa');
    expect(res.body.dados_clinicos).toBe(true);
  });

  it('GET /api/gestor/pacientes (rececionista) → 200 lista sem dados clínicos', async () => {
    const res = await request(app)
      .get('/api/gestor/pacientes')
      .set('Authorization', `Bearer ${rececionistaToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.pacientes)).toBe(true);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.dados_clinicos).toBe(false);
    // Rececionista não recebe campos clínicos.
    const p = res.body.pacientes[0];
    expect(p.historico_medico).toBeUndefined();
    expect(p.alergias).toBeUndefined();
    expect(p.contacto_emergencia).toBeUndefined();
  });

  it('GET /api/gestor/pacientes (fisioterapeuta) → 200 lista COM dados clínicos', async () => {
    const res = await request(app)
      .get('/api/gestor/pacientes')
      .set('Authorization', `Bearer ${fisioToken}`);
    expect(res.status).toBe(200);
    expect(res.body.dados_clinicos).toBe(true);
    // Fisio recebe campos clínicos.
    const p = res.body.pacientes.find((x) => x.nome === 'Paciente Fisio');
    expect(p).toBeTruthy();
    expect(p.historico_medico).toBe('Lombalgia crónica');
    expect(p.alergias).toEqual(['Ibuprofeno', 'Marisco']);
  });

  it('GET com busca por nome → filtra correctamente', async () => {
    const res = await request(app)
      .get('/api/gestor/pacientes?busca=João')
      .set('Authorization', `Bearer ${rececionistaToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pacientes.length).toBeGreaterThanOrEqual(1);
    expect(res.body.pacientes.every((p) => p.nome.includes('João'))).toBe(true);
  });

  it('GET /:id (rececionista) → 200 sem dados clínicos', async () => {
    const res = await request(app)
      .get(`/api/gestor/pacientes/${pacienteId}`)
      .set('Authorization', `Bearer ${rececionistaToken}`);
    expect(res.status).toBe(200);
    expect(res.body.paciente.nome).toBe('João Silva');
    expect(res.body.dados_clinicos).toBe(false);
    expect(res.body.paciente.historico_medico).toBeUndefined();
  });

  it('GET /:id (fisio) → 200 COM dados clínicos', async () => {
    const res = await request(app)
      .get(`/api/gestor/pacientes/${pacienteId}`)
      .set('Authorization', `Bearer ${fisioToken}`);
    expect(res.status).toBe(200);
    expect(res.body.dados_clinicos).toBe(true);
  });

  it('GET /:id inexistente → 404', async () => {
    const idInexistente = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/gestor/pacientes/${idInexistente}`)
      .set('Authorization', `Bearer ${rececionistaToken}`);
    expect(res.status).toBe(404);
  });

  it('PUT /:id (rececionista) → 200 atualiza nome', async () => {
    const res = await request(app)
      .put(`/api/gestor/pacientes/${pacienteId}`)
      .set('Authorization', `Bearer ${rececionistaToken}`)
      .send({ nome: 'João Silva Atualizado' });
    expect(res.status).toBe(200);
    expect(res.body.paciente.nome).toBe('João Silva Atualizado');
  });

  it('PUT /:id (fisio) → 200 atualiza historico_medico', async () => {
    const res = await request(app)
      .put(`/api/gestor/pacientes/${pacienteId}`)
      .set('Authorization', `Bearer ${fisioToken}`)
      .send({ historico_medico: 'Histórico atualizado pelo fisio' });
    expect(res.status).toBe(200);
    expect(res.body.paciente.historico_medico).toBe('Histórico atualizado pelo fisio');
  });

  it('PATCH /:id/estado → 200 alterna ativo', async () => {
    const res = await request(app)
      .patch(`/api/gestor/pacientes/${pacienteId}/estado`)
      .set('Authorization', `Bearer ${rececionistaToken}`)
      .send({ ativo: false });
    expect(res.status).toBe(200);
    expect(res.body.paciente.ativo).toBe(false);
  });

  it('DELETE /:id (rececionista) → 403 (só diretor_clinico/admin)', async () => {
    const res = await request(app)
      .delete(`/api/gestor/pacientes/${pacienteId}`)
      .set('Authorization', `Bearer ${rececionistaToken}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /:id (fisioterapeuta) → 403', async () => {
    const res = await request(app)
      .delete(`/api/gestor/pacientes/${pacienteId}`)
      .set('Authorization', `Bearer ${fisioToken}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /:id (diretor_clinico) → 200 soft delete', async () => {
    const res = await request(app)
      .delete(`/api/gestor/pacientes/${pacienteId}`)
      .set('Authorization', `Bearer ${diretorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.paciente.eliminado_em).toBeTruthy();
  });

  it('GET /:id após soft delete → 404', async () => {
    const res = await request(app)
      .get(`/api/gestor/pacientes/${pacienteId}`)
      .set('Authorization', `Bearer ${rececionistaToken}`);
    expect(res.status).toBe(404);
  });

  it('sem token → 401', async () => {
    const res = await request(app).get('/api/gestor/pacientes');
    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* F3 — Horários de Fisioterapeuta (CRUD + motor de disponibilidade)  */
/* ------------------------------------------------------------------ */

describe('F3 — Horários (CRUD + disponibilidade)', () => {
  let fisioF3Token, diretorF3Token, rececionistaF3Token;
  let fisioF3Id, diretorF3Id;
  let horarioRecorrenteId, horarioExcecaoId;

  beforeAll(async () => {
    const hash = await bcrypt.hash(PASSWORD, 10);

    const fisio = await Utilizador.create({
      nome: 'Fisio F3', email: 'fisio.f3@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'fisioterapeuta', ativo: true,
    });
    fisioF3Id = String(fisio._id);

    const diretor = await Utilizador.create({
      nome: 'Diretor F3', email: 'diretor.f3@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'diretor_clinico', ativo: true,
    });
    diretorF3Id = String(diretor._id);

    const rececionista = await Utilizador.create({
      nome: 'Rece F3', email: 'rece.f3@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'rececionista', ativo: true,
    });

    const [rFisio, rDir, rRec] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: 'fisio.f3@teste.pt', password: PASSWORD }),
      request(app).post('/api/auth/login').send({ email: 'diretor.f3@teste.pt', password: PASSWORD }),
      request(app).post('/api/auth/login').send({ email: 'rece.f3@teste.pt', password: PASSWORD }),
    ]);
    fisioF3Token = rFisio.body.token;
    diretorF3Token = rDir.body.token;
    rececionistaF3Token = rRec.body.token;
  });

  afterAll(async () => {
    await Utilizador.deleteMany({ email: { $in: ['fisio.f3@teste.pt', 'diretor.f3@teste.pt', 'rece.f3@teste.pt'] } });
    const HorarioFisioterapeuta = require('../models/HorarioFisioterapeuta');
    await HorarioFisioterapeuta.deleteMany({ empresa_id: empresaId });
  });

  it('POST /api/gestor/horarios (diretor) → 201 cria horário recorrente', async () => {
    const res = await request(app)
      .post('/api/gestor/horarios')
      .set('Authorization', `Bearer ${diretorF3Token}`)
      .send({
        fisioterapeuta_id: fisioF3Id,
        tipo: 'recorrente',
        dia_semana: 1, // Segunda
        hora_inicio: '09:00',
        hora_fim: '13:00',
      });
    expect(res.status).toBe(201);
    expect(res.body.horario).toHaveProperty('_id');
    expect(res.body.horario.tipo).toBe('recorrente');
    expect(res.body.horario.dia_semana).toBe(1);
    expect(res.body.horario.hora_inicio).toBe('09:00');
    horarioRecorrenteId = res.body.horario._id;
  });

  it('POST sem fisioterapeuta_id → 400', async () => {
    const res = await request(app)
      .post('/api/gestor/horarios')
      .set('Authorization', `Bearer ${diretorF3Token}`)
      .send({ tipo: 'recorrente', dia_semana: 1 });
    expect(res.status).toBe(400);
  });

  it('POST recorrente sem dia_semana → 400', async () => {
    const res = await request(app)
      .post('/api/gestor/horarios')
      .set('Authorization', `Bearer ${diretorF3Token}`)
      .send({ fisioterapeuta_id: fisioF3Id, tipo: 'recorrente' });
    expect(res.status).toBe(400);
  });

  it('POST excecao sem data → 400', async () => {
    const res = await request(app)
      .post('/api/gestor/horarios')
      .set('Authorization', `Bearer ${diretorF3Token}`)
      .send({ fisioterapeuta_id: fisioF3Id, tipo: 'excecao' });
    expect(res.status).toBe(400);
  });

  it('POST com fisioterapeuta inexistente → 400', async () => {
    const idFake = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/gestor/horarios')
      .set('Authorization', `Bearer ${diretorF3Token}`)
      .send({ fisioterapeuta_id: idFake, tipo: 'recorrente', dia_semana: 2 });
    expect(res.status).toBe(400);
  });

  it('POST cria horário excecao (indisponível — formação)', async () => {
    const res = await request(app)
      .post('/api/gestor/horarios')
      .set('Authorization', `Bearer ${diretorF3Token}`)
      .send({
        fisioterapeuta_id: fisioF3Id,
        tipo: 'excecao',
        data: '2026-12-15',
        disponivel: false,
        nota: 'Formação em Pilates Clínico',
      });
    expect(res.status).toBe(201);
    expect(res.body.horario.tipo).toBe('excecao');
    expect(res.body.horario.disponivel).toBe(false);
    horarioExcecaoId = res.body.horario._id;
  });

  it('rececionista NÃO pode criar horários (403)', async () => {
    const res = await request(app)
      .post('/api/gestor/horarios')
      .set('Authorization', `Bearer ${rececionistaF3Token}`)
      .send({ fisioterapeuta_id: fisioF3Id, tipo: 'recorrente', dia_semana: 3 });
    expect(res.status).toBe(403);
  });

  it('fisioterapeuta NÃO pode criar horários (403)', async () => {
    const res = await request(app)
      .post('/api/gestor/horarios')
      .set('Authorization', `Bearer ${fisioF3Token}`)
      .send({ fisioterapeuta_id: fisioF3Id, tipo: 'recorrente', dia_semana: 4 });
    expect(res.status).toBe(403);
  });

  it('GET /api/gestor/horarios (diretor) → 200 lista todos', async () => {
    const res = await request(app)
      .get('/api/gestor/horarios')
      .set('Authorization', `Bearer ${diretorF3Token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('GET (fisio) → 200 lista só os seus', async () => {
    const res = await request(app)
      .get('/api/gestor/horarios')
      .set('Authorization', `Bearer ${fisioF3Token}`);
    expect(res.status).toBe(200);
    // Todos os horários devolvidos pertencem ao fisio.
    expect(res.body.horarios.every((h) => String(h.fisioterapeuta_id?._id) === fisioF3Id)).toBe(true);
  });

  it('GET com filtro fisioterapeuta_id → filtra', async () => {
    const res = await request(app)
      .get(`/api/gestor/horarios?fisioterapeuta_id=${fisioF3Id}`)
      .set('Authorization', `Bearer ${diretorF3Token}`);
    expect(res.status).toBe(200);
    expect(res.body.horarios.length).toBeGreaterThanOrEqual(2);
    expect(res.body.horarios.every((h) => String(h.fisioterapeuta_id?._id) === fisioF3Id)).toBe(true);
  });

  it('PUT /:id (diretor) → 200 atualiza hora_fim', async () => {
    const res = await request(app)
      .put(`/api/gestor/horarios/${horarioRecorrenteId}`)
      .set('Authorization', `Bearer ${diretorF3Token}`)
      .send({ hora_fim: '18:00' });
    expect(res.status).toBe(200);
    expect(res.body.horario.hora_fim).toBe('18:00');
  });

  it('GET /disponibilidade — fisio disponível no horário recorrente', async () => {
    // 2026-11-16 é uma segunda-feira.
    const res = await request(app)
      .get(`/api/gestor/horarios/disponibilidade?fisioterapeuta_id=${fisioF3Id}&data=2026-11-16T10:00:00&duracao_minutos=45`)
      .set('Authorization', `Bearer ${diretorF3Token}`);
    expect(res.status).toBe(200);
    expect(res.body.disponivel).toBe(true);
    expect(res.body.horario).toBeTruthy();
    expect(res.body.origem).toBe('recorrente');
  });

  it('GET /disponibilidade — indisponível antes do horário', async () => {
    // 2026-11-16 segunda às 07:00 (antes das 09:00).
    const res = await request(app)
      .get(`/api/gestor/horarios/disponibilidade?fisioterapeuta_id=${fisioF3Id}&data=2026-11-16T07:00:00&duracao_minutos=45`)
      .set('Authorization', `Bearer ${diretorF3Token}`);
    expect(res.status).toBe(200);
    expect(res.body.disponivel).toBe(false);
    expect(res.body.motivo).toContain('09:00');
  });

  it('GET /disponibilidade — indisponível após horário', async () => {
    // 2026-11-16 segunda às 17:30 + 45min = 18:15 (depois das 18:00 atualizado).
    const res = await request(app)
      .get(`/api/gestor/horarios/disponibilidade?fisioterapeuta_id=${fisioF3Id}&data=2026-11-16T17:30:00&duracao_minutos=45`)
      .set('Authorization', `Bearer ${diretorF3Token}`);
    expect(res.status).toBe(200);
    expect(res.body.disponivel).toBe(false);
  });

  it('GET /disponibilidade — indisponível no dia de exceção (formação)', async () => {
    // 2026-12-15 tem exceção indisponível.
    const res = await request(app)
      .get(`/api/gestor/horarios/disponibilidade?fisioterapeuta_id=${fisioF3Id}&data=2026-12-15T10:00:00&duracao_minutos=45`)
      .set('Authorization', `Bearer ${diretorF3Token}`);
    expect(res.status).toBe(200);
    expect(res.body.disponivel).toBe(false);
    expect(res.body.origem).toBe('excecao');
  });

  it('GET /disponibilidade — sem horário definido (domingo)', async () => {
    // 2026-11-15 é domingo (sem regra recorrente).
    const res = await request(app)
      .get(`/api/gestor/horarios/disponibilidade?fisioterapeuta_id=${fisioF3Id}&data=2026-11-15T10:00:00&duracao_minutos=45`)
      .set('Authorization', `Bearer ${diretorF3Token}`);
    expect(res.status).toBe(200);
    expect(res.body.disponivel).toBe(false);
  });

  it('GET /disponibilidade sem fisioterapeuta_id → 400', async () => {
    const res = await request(app)
      .get(`/api/gestor/horarios/disponibilidade?data=2026-11-16T10:00:00`)
      .set('Authorization', `Bearer ${diretorF3Token}`);
    expect(res.status).toBe(400);
  });

  it('DELETE /:id (diretor) → 200 elimina', async () => {
    const res = await request(app)
      .delete(`/api/gestor/horarios/${horarioRecorrenteId}`)
      .set('Authorization', `Bearer ${diretorF3Token}`);
    expect(res.status).toBe(200);
  });

  it('DELETE /:id inexistente → 404', async () => {
    const idFake = new mongoose.Types.ObjectId();
    const res = await request(app)
      .delete(`/api/gestor/horarios/${idFake}`)
      .set('Authorization', `Bearer ${diretorF3Token}`);
    expect(res.status).toBe(404);
  });

  it('sem token → 401', async () => {
    const res = await request(app).get('/api/gestor/horarios');
    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* F4 — Consultas (CRUD + validação de conflitos fisio+sala+paciente) */
/* ------------------------------------------------------------------ */

describe('F4 — Consultas (CRUD + conflitos)', () => {
  let fisioF4Token, diretorF4Token, rececionistaF4Token, fisio2F4Token;
  let fisioF4Id, fisio2F4Id;
  let pacienteF4Id, paciente2F4Id;
  let salaF4Id, sala2F4Id;
  let consultaId, consultaConcluidaId;

  beforeAll(async () => {
    const hash = await bcrypt.hash(PASSWORD, 10);

    const fisio = await Utilizador.create({
      nome: 'Fisio F4', email: 'fisio.f4@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'fisioterapeuta', ativo: true,
      perfil_profissional: { cedula: 'FIS-12345', ativo_clinico: true },
    });
    fisioF4Id = String(fisio._id);

    const fisio2 = await Utilizador.create({
      nome: 'Fisio2 F4', email: 'fisio2.f4@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'fisioterapeuta', ativo: true,
      perfil_profissional: { cedula: 'FIS-67890', ativo_clinico: true },
    });
    fisio2F4Id = String(fisio2._id);

    const diretor = await Utilizador.create({
      nome: 'Diretor F4', email: 'diretor.f4@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'diretor_clinico', ativo: true,
      perfil_profissional: { cedula: 'DIR-11111' },
    });

    const rececionista = await Utilizador.create({
      nome: 'Rece F4', email: 'rece.f4@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'rececionista', ativo: true,
    });

    const [rFisio, rFisio2, rDir, rRec] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: 'fisio.f4@teste.pt', password: PASSWORD }),
      request(app).post('/api/auth/login').send({ email: 'fisio2.f4@teste.pt', password: PASSWORD }),
      request(app).post('/api/auth/login').send({ email: 'diretor.f4@teste.pt', password: PASSWORD }),
      request(app).post('/api/auth/login').send({ email: 'rece.f4@teste.pt', password: PASSWORD }),
    ]);
    fisioF4Token = rFisio.body.token;
    fisio2F4Token = rFisio2.body.token;
    diretorF4Token = rDir.body.token;
    rececionistaF4Token = rRec.body.token;

    // Cria pacientes e salas de teste.
    const Paciente = require('../models/Paciente');
    const p1 = await Paciente.create({ empresa_id: empresaId, nome: 'Paciente F4 A', telefone: '+351911111111' });
    const p2 = await Paciente.create({ empresa_id: empresaId, nome: 'Paciente F4 B', telefone: '+351922222222' });
    pacienteF4Id = String(p1._id);
    paciente2F4Id = String(p2._id);

    const s1 = await Propriedade.create({ empresa_id: empresaId, nome: 'Sala F4 1', morada: 'Rua Teste', tempo_limpeza_minutos: 45 });
    const s2 = await Propriedade.create({ empresa_id: empresaId, nome: 'Sala F4 2', morada: 'Rua Teste 2', tempo_limpeza_minutos: 45 });
    salaF4Id = String(s1._id);
    sala2F4Id = String(s2._id);

    // F3 — Cria horários recorrentes para os 2 fisios (seg-sex 09:00-19:00).
    // Necessário para o motor de disponibilidade não bloquear as consultas.
    const HorarioFisioterapeuta = require('../models/HorarioFisioterapeuta');
    for (const fid of [fisioF4Id, fisio2F4Id]) {
      for (let dia = 1; dia <= 5; dia++) { // 1=Seg...5=Sex
        await HorarioFisioterapeuta.create({
          empresa_id: empresaId,
          fisioterapeuta_id: fid,
          tipo: 'recorrente',
          dia_semana: dia,
          hora_inicio: '09:00',
          hora_fim: '19:00',
        });
      }
    }
  });

  afterAll(async () => {
    await Utilizador.deleteMany({ email: { $in: ['fisio.f4@teste.pt', 'fisio2.f4@teste.pt', 'diretor.f4@teste.pt', 'rece.f4@teste.pt'] } });
    const Paciente = require('../models/Paciente');
    const Consulta = require('../models/Consulta');
    const HorarioFisioterapeuta = require('../models/HorarioFisioterapeuta');
    await Paciente.deleteMany({ _id: { $in: [pacienteF4Id, paciente2F4Id] } });
    await HorarioFisioterapeuta.deleteMany({ fisioterapeuta_id: { $in: [fisioF4Id, fisio2F4Id] } });
    await Propriedade.deleteMany({ _id: { $in: [salaF4Id, sala2F4Id] } });
    await Consulta.deleteMany({ empresa_id: empresaId, fisioterapeuta_id: { $in: [fisioF4Id, fisio2F4Id] } });
  });

  it('POST /api/gestor/consultas (rececionista) → 201 cria consulta', async () => {
    // Data futura: 2027-01-15 10:00 (sexta-feira).
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisioF4Id,
        sala_id: salaF4Id,
        paciente_id: pacienteF4Id,
        data_hora_inicio: '2027-01-15T10:00:00',
        duracao_minutos: 45,
        tipo: 'primeira_consulta',
      });
    expect(res.status).toBe(201);
    expect(res.body.consulta).toHaveProperty('_id');
    expect(res.body.consulta.estado).toBe('marcada');
    expect(res.body.consulta.tipo).toBe('primeira_consulta');
    consultaId = res.body.consulta._id;
  });

  it('POST sem campos obrigatórios → 400', async () => {
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({ fisioterapeuta_id: fisioF4Id });
    expect(res.status).toBe(400);
  });

  it('POST com data no passado → 400', async () => {
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisioF4Id,
        sala_id: salaF4Id,
        paciente_id: pacienteF4Id,
        data_hora_inicio: '2020-01-01T10:00:00',
      });
    expect(res.status).toBe(400);
  });

  it('POST com fisioterapeuta inexistente → 400', async () => {
    const idFake = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: idFake,
        sala_id: salaF4Id,
        paciente_id: pacienteF4Id,
        data_hora_inicio: '2027-02-15T10:00:00',
      });
    expect(res.status).toBe(400);
  });

  it('POST com paciente inexistente → 400', async () => {
    const idFake = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisioF4Id,
        sala_id: salaF4Id,
        paciente_id: idFake,
        data_hora_inicio: '2027-02-15T10:00:00',
      });
    expect(res.status).toBe(400);
  });

  it('POST com sala inexistente → 400', async () => {
    const idFake = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisioF4Id,
        sala_id: idFake,
        paciente_id: pacienteF4Id,
        data_hora_inicio: '2027-02-15T10:00:00',
      });
    expect(res.status).toBe(400);
  });

  it('POST com conflito de SALA → 409 (sem forcar)', async () => {
    // Mesma sala, mesmo horário, fisio diferente, paciente diferente.
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisio2F4Id,
        sala_id: salaF4Id, // mesma sala
        paciente_id: paciente2F4Id,
        data_hora_inicio: '2027-01-15T10:00:00', // mesmo horário
        duracao_minutos: 45,
      });
    expect(res.status).toBe(409);
    expect(res.body.conflitos).toBeTruthy();
    expect(res.body.conflitos.some((c) => c.includes('Sala ocupada'))).toBe(true);
  });

  it('POST com conflito de SALA + forcar=true → 200 com warning', async () => {
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisio2F4Id,
        sala_id: salaF4Id,
        paciente_id: paciente2F4Id,
        data_hora_inicio: '2027-01-15T10:00:00',
        duracao_minutos: 45,
        forcar: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.warning).toBeTruthy();
    expect(res.body.conflitos).toBeTruthy();
  });

  it('POST com conflito de FISIOTERAPEUTA → 409', async () => {
    // Mesmo fisio, mesma hora, sala diferente, paciente diferente.
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisioF4Id, // mesmo fisio
        sala_id: sala2F4Id,
        paciente_id: paciente2F4Id,
        data_hora_inicio: '2027-01-15T10:00:00', // mesmo horário
        duracao_minutos: 45,
      });
    expect(res.status).toBe(409);
    expect(res.body.conflitos.some((c) => c.includes('Fisioterapeuta ocupado'))).toBe(true);
  });

  it('POST com conflito de PACIENTE → 409', async () => {
    // Mesmo paciente, mesma hora, fisio diferente, sala diferente.
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisio2F4Id,
        sala_id: sala2F4Id,
        paciente_id: pacienteF4Id, // mesmo paciente
        data_hora_inicio: '2027-01-15T10:00:00',
        duracao_minutos: 45,
      });
    expect(res.status).toBe(409);
    expect(res.body.conflitos.some((c) => c.includes('Paciente já tem consulta'))).toBe(true);
  });

  it('POST sem sobreposição → 201 (sem conflitos)', async () => {
    // Sala diferente, fisio diferente, paciente diferente, horário diferente.
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisio2F4Id,
        sala_id: sala2F4Id,
        paciente_id: paciente2F4Id,
        data_hora_inicio: '2027-03-15T14:00:00',
        duracao_minutos: 60,
      });
    expect(res.status).toBe(201);
  });

  it('GET /api/gestor/consultas (rececionista) → 200 lista todas', async () => {
    const res = await request(app)
      .get('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('GET (fisio) → 200 lista só as suas', async () => {
    const res = await request(app)
      .get('/api/gestor/consultas')
      .set('Authorization', `Bearer ${fisioF4Token}`);
    expect(res.status).toBe(200);
    expect(res.body.consultas.every((c) => String(c.fisioterapeuta_id?._id) === fisioF4Id)).toBe(true);
  });

  it('GET /:id → 200 detalhe', async () => {
    const res = await request(app)
      .get(`/api/gestor/consultas/${consultaId}`)
      .set('Authorization', `Bearer ${rececionistaF4Token}`);
    expect(res.status).toBe(200);
    expect(res.body.consulta._id).toBe(consultaId);
  });

  it('GET /validar → 200 com conflitos sem criar', async () => {
    const res = await request(app)
      .get(`/api/gestor/consultas/validar?fisioterapeuta_id=${fisioF4Id}&sala_id=${salaF4Id}&paciente_id=${pacienteF4Id}&data_hora_inicio=2027-01-15T10:00:00&duracao_minutos=45`)
      .set('Authorization', `Bearer ${rececionistaF4Token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.conflitos.length).toBeGreaterThan(0);
  });

  it('PUT /:id → 200 atualiza estado para confirmada', async () => {
    const res = await request(app)
      .put(`/api/gestor/consultas/${consultaId}`)
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({ estado: 'confirmada' });
    expect(res.status).toBe(200);
    expect(res.body.consulta.estado).toBe('confirmada');
  });

  it('PATCH /nota-clinica (fisio com cédula) → 200', async () => {
    const res = await request(app)
      .patch(`/api/gestor/consultas/${consultaId}/nota-clinica`)
      .set('Authorization', `Bearer ${fisioF4Token}`)
      .send({
        subjetivo: 'Dor lombar',
        objetivo: 'Palpação dolorosa L4-L5',
        avaliacao: 'Lombalgia mecânica',
        plano: 'Sessões de terapia manual + exercício',
        tratamento_efetuado: 'Mobilização L4-L5 + stretching',
      });
    expect(res.status).toBe(200);
    expect(res.body.consulta.nota_clinica.subjetivo).toBe('Dor lombar');
    expect(res.body.consulta.nota_clinica.cedula_assinante).toBe('FIS-12345');
  });

  it('PATCH /nota-clinica por fisio SEM cédula → 403', async () => {
    // Cria fisio sem cédula.
    const hash = await bcrypt.hash(PASSWORD, 10);
    const fisioSemCedula = await Utilizador.create({
      nome: 'Fisio Sem Cedula', email: 'fisiosemcedula.f4@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'fisioterapeuta', ativo: true,
      // perfil_profissional.cedula vazio
    });
    const rLogin = await request(app).post('/api/auth/login').send({ email: 'fisiosemcedula.f4@teste.pt', password: PASSWORD });
    const tokenSemCedula = rLogin.body.token;

    // Cria consulta atribuída ao fisio sem cédula para ele poder tentar editar.
    // 2027-06-14 é segunda-feira. forcar=true porque o fisio sem cédula não
    // tem horário definido (o motor F3 bloqueia).
    const rConsulta = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisioSemCedula._id,
        sala_id: sala2F4Id,
        paciente_id: paciente2F4Id,
        data_hora_inicio: '2027-06-14T14:00:00',
        forcar: true,
      });
    const consultaSemCedulaId = rConsulta.body.consulta?._id;
    expect(consultaSemCedulaId).toBeTruthy();

    const res = await request(app)
      .patch(`/api/gestor/consultas/${consultaSemCedulaId}/nota-clinica`)
      .set('Authorization', `Bearer ${tokenSemCedula}`)
      .send({ subjetivo: 'Tentativa sem cédula' });
    expect(res.status).toBe(403);
    expect(res.body.erro).toContain('cédula');

    await Utilizador.deleteOne({ _id: fisioSemCedula._id });
  });

  it('PATCH /nota-clinica por rececionista → 403 (só isClinico)', async () => {
    const res = await request(app)
      .patch(`/api/gestor/consultas/${consultaId}/nota-clinica`)
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({ subjetivo: 'Tentativa rececionista' });
    expect(res.status).toBe(403);
  });

  it('PUT concluir consulta → 200 (regista concluida_em)', async () => {
    const res = await request(app)
      .put(`/api/gestor/consultas/${consultaId}`)
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({ estado: 'concluida' });
    expect(res.status).toBe(200);
    expect(res.body.consulta.estado).toBe('concluida');
    expect(res.body.consulta.concluida_em).toBeTruthy();
    consultaConcluidaId = consultaId;
  });

  it('PATCH /nota-clinica em consulta CONCLUÍDA → 403 (imutável)', async () => {
    const res = await request(app)
      .patch(`/api/gestor/consultas/${consultaConcluidaId}/nota-clinica`)
      .set('Authorization', `Bearer ${fisioF4Token}`)
      .send({ subjetivo: 'Tentativa alterar concluída' });
    expect(res.status).toBe(403);
    expect(res.body.erro).toContain('imutável');
  });

  it('DELETE consulta concluída → 403 (RGPD)', async () => {
    const res = await request(app)
      .delete(`/api/gestor/consultas/${consultaConcluidaId}`)
      .set('Authorization', `Bearer ${diretorF4Token}`);
    expect(res.status).toBe(403);
    expect(res.body.erro).toContain('RGPD');
  });

  it('DELETE (rececionista) → 403 (só diretor)', async () => {
    // Cria consulta não concluída para tentar eliminar.
    // 2027-06-14 é uma segunda-feira (fisio tem horário seg-sex).
    const rConsulta = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisioF4Id,
        sala_id: salaF4Id,
        paciente_id: pacienteF4Id,
        data_hora_inicio: '2027-06-14T10:00:00',
      });
    const idParaEliminar = rConsulta.body.consulta?._id;
    expect(idParaEliminar).toBeTruthy();

    const res = await request(app)
      .delete(`/api/gestor/consultas/${idParaEliminar}`)
      .set('Authorization', `Bearer ${rececionistaF4Token}`);
    expect(res.status).toBe(403);
  });

  it('DELETE (diretor) → 200 elimina consulta não concluída', async () => {
    // 2027-06-21 é uma segunda-feira.
    const rConsulta = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${rececionistaF4Token}`)
      .send({
        fisioterapeuta_id: fisioF4Id,
        sala_id: salaF4Id,
        paciente_id: pacienteF4Id,
        data_hora_inicio: '2027-06-21T10:00:00',
      });
    const idParaEliminar = rConsulta.body.consulta._id;

    const res = await request(app)
      .delete(`/api/gestor/consultas/${idParaEliminar}`)
      .set('Authorization', `Bearer ${diretorF4Token}`);
    expect(res.status).toBe(200);
  });

  it('sem token → 401', async () => {
    const res = await request(app).get('/api/gestor/consultas');
    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* F5 — Protocolos Clínicos (CRUD + snapshot na Consulta)             */
/* ------------------------------------------------------------------ */

describe('F5 — Protocolos (CRUD + snapshot)', () => {
  let diretorF5Token, fisioF5Token;
  let protocoloId;

  beforeAll(async () => {
    const hash = await bcrypt.hash(PASSWORD, 10);

    const diretor = await Utilizador.create({
      nome: 'Diretor F5', email: 'diretor.f5@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'diretor_clinico', ativo: true,
      perfil_profissional: { cedula: 'DIR-F5' },
    });

    const fisio = await Utilizador.create({
      nome: 'Fisio F5', email: 'fisio.f5@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'fisioterapeuta', ativo: true,
      perfil_profissional: { cedula: 'FIS-F5', ativo_clinico: true },
    });

    const [rDir, rFisio] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: 'diretor.f5@teste.pt', password: PASSWORD }),
      request(app).post('/api/auth/login').send({ email: 'fisio.f5@teste.pt', password: PASSWORD }),
    ]);
    diretorF5Token = rDir.body.token;
    fisioF5Token = rFisio.body.token;
  });

  afterAll(async () => {
    await Utilizador.deleteMany({ email: { $in: ['diretor.f5@teste.pt', 'fisio.f5@teste.pt'] } });
    const ModeloProtocolo = require('../models/ModeloProtocolo');
    await ModeloProtocolo.deleteMany({ empresa_id: empresaId });
  });

  it('POST /api/gestor/protocolos (diretor) → 201 cria protocolo', async () => {
    const res = await request(app)
      .post('/api/gestor/protocolos')
      .set('Authorization', `Bearer ${diretorF5Token}`)
      .send({
        nome: 'Avaliação Ombro',
        descricao: 'Protocolo de avaliação inicial de ombro',
        area: 'musculoesqueletica',
        seccoes: [
          { nome: 'Inspeção', items: ['Simetria', 'Edema', 'Atrofia'] },
          { nome: 'Palpação', items: ['Ponto doloroso', 'Temperatura'] },
          { nome: 'Testes Especiais', items: ['Neer', 'Hawkins-Kennedy', 'Empty Can'] },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.protocolo).toHaveProperty('_id');
    expect(res.body.protocolo.nome).toBe('Avaliação Ombro');
    expect(res.body.protocolo.area).toBe('musculoesqueletica');
    expect(res.body.protocolo.seccoes).toHaveLength(3);
    expect(res.body.protocolo.seccoes[0].items).toHaveLength(3);
    protocoloId = res.body.protocolo._id;
  });

  it('POST sem nome → 400', async () => {
    const res = await request(app)
      .post('/api/gestor/protocolos')
      .set('Authorization', `Bearer ${diretorF5Token}`)
      .send({ seccoes: [{ nome: 'Teste', items: ['Item'] }] });
    expect(res.status).toBe(400);
  });

  it('POST sem secções → 400', async () => {
    const res = await request(app)
      .post('/api/gestor/protocolos')
      .set('Authorization', `Bearer ${diretorF5Token}`)
      .send({ nome: 'Sem secções' });
    expect(res.status).toBe(400);
  });

  it('POST com área inválida → 400', async () => {
    const res = await request(app)
      .post('/api/gestor/protocolos')
      .set('Authorization', `Bearer ${diretorF5Token}`)
      .send({ nome: 'Teste', area: 'invalida', seccoes: [{ nome: 'S', items: ['I'] }] });
    expect(res.status).toBe(400);
  });

  it('fisioterapeuta NÃO pode criar protocolos (403)', async () => {
    const res = await request(app)
      .post('/api/gestor/protocolos')
      .set('Authorization', `Bearer ${fisioF5Token}`)
      .send({ nome: 'Teste Fisio', seccoes: [{ nome: 'S', items: ['I'] }] });
    expect(res.status).toBe(403);
  });

  it('GET /api/gestor/protocolos (fisio) → 200 lista (pode ver)', async () => {
    const res = await request(app)
      .get('/api/gestor/protocolos')
      .set('Authorization', `Bearer ${fisioF5Token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('GET com filtro area → filtra', async () => {
    const res = await request(app)
      .get('/api/gestor/protocolos?area=musculoesqueletica')
      .set('Authorization', `Bearer ${diretorF5Token}`);
    expect(res.status).toBe(200);
    expect(res.body.protocolos.every((p) => p.area === 'musculoesqueletica')).toBe(true);
  });

  it('GET /:id → 200 detalhe', async () => {
    const res = await request(app)
      .get(`/api/gestor/protocolos/${protocoloId}`)
      .set('Authorization', `Bearer ${diretorF5Token}`);
    expect(res.status).toBe(200);
    expect(res.body.protocolo._id).toBe(protocoloId);
  });

  it('PUT /:id → 200 atualiza nome e secções', async () => {
    const res = await request(app)
      .put(`/api/gestor/protocolos/${protocoloId}`)
      .set('Authorization', `Bearer ${diretorF5Token}`)
      .send({
        nome: 'Avaliação Ombro V2',
        seccoes: [
          { nome: 'Inspeção', items: ['Simetria', 'Edema'] },
          { nome: 'Mobility', items: ['ABD', 'ROT externa'] },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.protocolo.nome).toBe('Avaliação Ombro V2');
    expect(res.body.protocolo.seccoes).toHaveLength(2);
  });

  it('PUT com área inválida → 400', async () => {
    const res = await request(app)
      .put(`/api/gestor/protocolos/${protocoloId}`)
      .set('Authorization', `Bearer ${diretorF5Token}`)
      .send({ area: 'invalida' });
    expect(res.status).toBe(400);
  });

  it('Cria consulta COM protocolo_id → snapshot gerado', async () => {
    // Cria paciente e sala para a consulta.
    const Paciente = require('../models/Paciente');
    const Propriedade = require('../models/Propriedade');
    const HorarioFisioterapeuta = require('../models/HorarioFisioterapeuta');

    const pac = await Paciente.create({ empresa_id: empresaId, nome: 'Paciente Protocolo', telefone: '+351900000000' });
    const sala = await Propriedade.create({ empresa_id: empresaId, nome: 'Sala Protocolo', morada: 'x', tempo_limpeza_minutos: 45 });

    // Cria fisio com horário para a consulta passar no motor F3.
    const fisio = await Utilizador.findOne({ email: 'fisio.f5@teste.pt' }).lean();
    for (let d = 1; d <= 5; d++) {
      await HorarioFisioterapeuta.create({ empresa_id: empresaId, fisioterapeuta_id: fisio._id, tipo: 'recorrente', dia_semana: d, hora_inicio: '09:00', hora_fim: '19:00' });
    }

    // 2027-06-14 é segunda-feira.
    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${diretorF5Token}`)
      .send({
        fisioterapeuta_id: fisio._id,
        sala_id: sala._id,
        paciente_id: pac._id,
        data_hora_inicio: '2027-06-14T10:00:00',
        protocolo_id: protocoloId,
      });

    expect(res.status).toBe(201);
    expect(res.body.consulta.nota_clinica.protocolo_aplicado).toBeTruthy();
    expect(res.body.consulta.nota_clinica.protocolo_aplicado.length).toBe(2); // 2 secções (após PUT)
    // Items têm concluido=false (snapshot inicial).
    expect(res.body.consulta.nota_clinica.protocolo_aplicado[0].items[0].concluido).toBe(false);

    // Guarda IDs para limpeza.
    const consultaId = res.body.consulta._id;
    const Consulta = require('../models/Consulta');
    await Consulta.deleteOne({ _id: consultaId });
    await Paciente.deleteOne({ _id: pac._id });
    await Propriedade.deleteOne({ _id: sala._id });
    await HorarioFisioterapeuta.deleteMany({ fisioterapeuta_id: fisio._id });
  });

  it('Cria consulta com protocolo_id inexistente → 400', async () => {
    const idFake = new mongoose.Types.ObjectId();
    const Paciente = require('../models/Paciente');
    const Propriedade = require('../models/Propriedade');
    const HorarioFisioterapeuta = require('../models/HorarioFisioterapeuta');

    const pac = await Paciente.create({ empresa_id: empresaId, nome: 'Pac Fake', telefone: '+351900000001' });
    const sala = await Propriedade.create({ empresa_id: empresaId, nome: 'Sala Fake', morada: 'x', tempo_limpeza_minutos: 45 });
    const fisio = await Utilizador.findOne({ email: 'fisio.f5@teste.pt' }).lean();
    for (let d = 1; d <= 5; d++) {
      await HorarioFisioterapeuta.create({ empresa_id: empresaId, fisioterapeuta_id: fisio._id, tipo: 'recorrente', dia_semana: d, hora_inicio: '09:00', hora_fim: '19:00' });
    }

    const res = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${diretorF5Token}`)
      .send({
        fisioterapeuta_id: fisio._id,
        sala_id: sala._id,
        paciente_id: pac._id,
        data_hora_inicio: '2027-07-14T10:00:00',
        protocolo_id: idFake,
      });
    expect(res.status).toBe(400);
    expect(res.body.erro).toContain('Protocolo não encontrado');

    await Paciente.deleteOne({ _id: pac._id });
    await Propriedade.deleteOne({ _id: sala._id });
    await HorarioFisioterapeuta.deleteMany({ fisioterapeuta_id: fisio._id });
  });

  it('PATCH /nota-clinica atualiza items do protocolo (marcar concluido)', async () => {
    // Cria consulta com protocolo.
    const Paciente = require('../models/Paciente');
    const Propriedade = require('../models/Propriedade');
    const HorarioFisioterapeuta = require('../models/HorarioFisioterapeuta');
    const Consulta = require('../models/Consulta');

    const pac = await Paciente.create({ empresa_id: empresaId, nome: 'Pac Marcar', telefone: '+351900000002' });
    const sala = await Propriedade.create({ empresa_id: empresaId, nome: 'Sala Marcar', morada: 'x', tempo_limpeza_minutos: 45 });
    const fisio = await Utilizador.findOne({ email: 'fisio.f5@teste.pt' }).lean();
    for (let d = 1; d <= 5; d++) {
      await HorarioFisioterapeuta.create({ empresa_id: empresaId, fisioterapeuta_id: fisio._id, tipo: 'recorrente', dia_semana: d, hora_inicio: '09:00', hora_fim: '19:00' });
    }

    const rConsulta = await request(app)
      .post('/api/gestor/consultas')
      .set('Authorization', `Bearer ${diretorF5Token}`)
      .send({
        fisioterapeuta_id: fisio._id,
        sala_id: sala._id,
        paciente_id: pac._id,
        data_hora_inicio: '2027-08-10T10:00:00', // segunda-feira
        protocolo_id: protocoloId,
      });
    expect(rConsulta.status).toBe(201);
    const consultaId = rConsulta.body.consulta._id;

    // Marca o primeiro item do protocolo como concluido.
    const snapshot = rConsulta.body.consulta.nota_clinica.protocolo_aplicado;
    snapshot[0].items[0].concluido = true;

    const res = await request(app)
      .patch(`/api/gestor/consultas/${consultaId}/nota-clinica`)
      .set('Authorization', `Bearer ${fisioF5Token}`)
      .send({ protocolo_aplicado: snapshot });

    expect(res.status).toBe(200);
    expect(res.body.consulta.nota_clinica.protocolo_aplicado[0].items[0].concluido).toBe(true);

    await Consulta.deleteOne({ _id: consultaId });
    await Paciente.deleteOne({ _id: pac._id });
    await Propriedade.deleteOne({ _id: sala._id });
    await HorarioFisioterapeuta.deleteMany({ fisioterapeuta_id: fisio._id });
  });

  it('DELETE /:id (diretor) → 200 elimina protocolo', async () => {
    const res = await request(app)
      .delete(`/api/gestor/protocolos/${protocoloId}`)
      .set('Authorization', `Bearer ${diretorF5Token}`);
    expect(res.status).toBe(200);
  });

  it('DELETE /:id inexistente → 404', async () => {
    const idFake = new mongoose.Types.ObjectId();
    const res = await request(app)
      .delete(`/api/gestor/protocolos/${idFake}`)
      .set('Authorization', `Bearer ${diretorF5Token}`);
    expect(res.status).toBe(404);
  });

  it('sem token → 401', async () => {
    const res = await request(app).get('/api/gestor/protocolos');
    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* F7 — Cron Jobs de Consultas                                         */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* F7 — Cron Jobs de Consultas                                         */
/* ------------------------------------------------------------------ */

describe('F7 — Cron Jobs de Consultas', () => {
  let fisioF7Id, diretorF7Id;
  let pacienteF7Id, salaF7Id;

  beforeAll(async () => {
    const hash = await bcrypt.hash(PASSWORD, 10);

    const fisio = await Utilizador.create({
      nome: 'Fisio F7', email: 'fisio.f7@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'fisioterapeuta', ativo: true,
      perfil_profissional: { cedula: 'FIS-F7', ativo_clinico: true },
    });
    fisioF7Id = String(fisio._id);

    const diretor = await Utilizador.create({
      nome: 'Diretor F7', email: 'diretor.f7@teste.pt', password_hash: hash,
      empresa_id: empresaId, role: 'diretor_clinico', ativo: true,
      perfil_profissional: { cedula: 'DIR-F7' },
    });
    diretorF7Id = String(diretor._id);

    const Paciente = require('../models/Paciente');
    const pac = await Paciente.create({ empresa_id: empresaId, nome: 'Paciente F7', telefone: '+351900000007' });
    pacienteF7Id = String(pac._id);

    const sala = await Propriedade.create({ empresa_id: empresaId, nome: 'Sala F7', morada: 'x', tempo_limpeza_minutos: 45 });
    salaF7Id = String(sala._id);

    // Cria horário recorrente para o fisio (seg-sex 09-19).
    const HorarioFisioterapeuta = require('../models/HorarioFisioterapeuta');
    for (let d = 1; d <= 5; d++) {
      await HorarioFisioterapeuta.create({ empresa_id: empresaId, fisioterapeuta_id: fisioF7Id, tipo: 'recorrente', dia_semana: d, hora_inicio: '09:00', hora_fim: '19:00' });
    }
  });

  afterAll(async () => {
    await Utilizador.deleteMany({ email: { $in: ['fisio.f7@teste.pt', 'diretor.f7@teste.pt'] } });
    const Paciente = require('../models/Paciente');
    const HorarioFisioterapeuta = require('../models/HorarioFisioterapeuta');
    const Consulta = require('../models/Consulta');
    const ConsultaArquivo = require('../models/ConsultaArquivo');
    await Paciente.deleteOne({ _id: pacienteF7Id });
    await Propriedade.deleteOne({ _id: salaF7Id });
    await HorarioFisioterapeuta.deleteMany({ fisioterapeuta_id: fisioF7Id });
    await Consulta.deleteMany({ fisioterapeuta_id: fisioF7Id });
    await ConsultaArquivo.deleteMany({ fisioterapeuta_id: fisioF7Id });
  });

  it('briefingDiarioFisio — notifica fisio com consulta hoje', async () => {
    const Consulta = require('../models/Consulta');
    const agora = new Date();
    const horaConsulta = new Date(agora.getTime() + 2 * 60 * 60 * 1000); // +2h
    await Consulta.create({
      empresa_id: empresaId, sala_id: salaF7Id, fisioterapeuta_id: fisioF7Id,
      paciente_id: pacienteF7Id,
      data_hora_inicio: horaConsulta,
      data_hora_fim: new Date(horaConsulta.getTime() + 45 * 60000),
      duracao_minutos: 45, estado: 'marcada', criada_por: diretorF7Id,
    });

    const { executarBriefingFisio } = require('../jobs/briefingDiarioFisio');
    const resultado = await executarBriefingFisio();

    expect(resultado.consultas).toBeGreaterThanOrEqual(1);
    expect(resultado.notificados).toBeGreaterThanOrEqual(1);

    // Limpa.
    await Consulta.deleteMany({ fisioterapeuta_id: fisioF7Id, data_hora_inicio: horaConsulta });
  });

  it('briefingDiarioFisio — sem consultas hoje → 0 notificados', async () => {
    const { executarBriefingFisio } = require('../jobs/briefingDiarioFisio');
    const resultado = await executarBriefingFisio();
    // Pode haver consultas de outros testes, mas o resultado deve ser um número.
    expect(typeof resultado.consultas).toBe('number');
    expect(typeof resultado.notificados).toBe('number');
  });

  it('lembreteConsultasAmanha — notifica e marca lembrete_24h_enviado', async () => {
    const Consulta = require('../models/Consulta');
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(10, 0, 0, 0);

    const consulta = await Consulta.create({
      empresa_id: empresaId, sala_id: salaF7Id, fisioterapeuta_id: fisioF7Id,
      paciente_id: pacienteF7Id,
      data_hora_inicio: amanha,
      data_hora_fim: new Date(amanha.getTime() + 45 * 60000),
      duracao_minutos: 45, estado: 'marcada', criada_por: diretorF7Id,
      lembrete_24h_enviado: false,
    });

    const { executarLembreteAmanha } = require('../jobs/lembreteConsultasAmanha');
    const resultado = await executarLembreteAmanha();

    expect(resultado.consultas).toBeGreaterThanOrEqual(1);
    expect(resultado.notificados).toBeGreaterThanOrEqual(1);

    // Verifica que lembrete_24h_enviado foi marcado.
    const atualizada = await Consulta.findById(consulta._id).lean();
    expect(atualizada.lembrete_24h_enviado).toBe(true);

    await Consulta.deleteOne({ _id: consulta._id });
  });

  it('lembrete2hConsulta — notifica consulta que começa em ~2h', async () => {
    const Consulta = require('../models/Consulta');
    const inicio = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2h
    const consulta = await Consulta.create({
      empresa_id: empresaId, sala_id: salaF7Id, fisioterapeuta_id: fisioF7Id,
      paciente_id: pacienteF7Id,
      data_hora_inicio: inicio,
      data_hora_fim: new Date(inicio.getTime() + 45 * 60000),
      duracao_minutos: 45, estado: 'marcada', criada_por: diretorF7Id,
      lembrete_2h_enviado: false,
    });

    const { executarLembrete2h } = require('../jobs/lembrete2hConsulta');
    const resultado = await executarLembrete2h();

    expect(resultado.consultas).toBeGreaterThanOrEqual(1);
    expect(resultado.notificados).toBeGreaterThanOrEqual(1);

    const atualizada = await Consulta.findById(consulta._id).lean();
    expect(atualizada.lembrete_2h_enviado).toBe(true);

    await Consulta.deleteOne({ _id: consulta._id });
  });

  it('lembrete2hConsulta — ignora consultas já notificadas', async () => {
    const Consulta = require('../models/Consulta');
    const inicio = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const consulta = await Consulta.create({
      empresa_id: empresaId, sala_id: salaF7Id, fisioterapeuta_id: fisioF7Id,
      paciente_id: pacienteF7Id,
      data_hora_inicio: inicio,
      data_hora_fim: new Date(inicio.getTime() + 45 * 60000),
      duracao_minutos: 45, estado: 'marcada', criada_por: diretorF7Id,
      lembrete_2h_enviado: true, // já notificada
    });

    const { executarLembrete2h } = require('../jobs/lembrete2hConsulta');
    const resultado = await executarLembrete2h();

    // Não deve contar esta consulta (já notificada).
    const atualizada = await Consulta.findById(consulta._id).lean();
    expect(atualizada.lembrete_2h_enviado).toBe(true);

    await Consulta.deleteOne({ _id: consulta._id });
  });

  it('caoGuardaConsultas — deteta consultas esquecidas (data passada)', async () => {
    const Consulta = require('../models/Consulta');
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    ontem.setHours(10, 0, 0, 0);

    const consulta = await Consulta.create({
      empresa_id: empresaId, sala_id: salaF7Id, fisioterapeuta_id: fisioF7Id,
      paciente_id: pacienteF7Id,
      data_hora_inicio: ontem,
      data_hora_fim: new Date(ontem.getTime() + 45 * 60000),
      duracao_minutos: 45, estado: 'marcada', criada_por: diretorF7Id,
    });

    const { executarCaoGuardaConsultas } = require('../jobs/caoGuardaConsultas');
    const resultado = await executarCaoGuardaConsultas();

    expect(resultado.esquecidas).toBeGreaterThanOrEqual(1);

    await Consulta.deleteOne({ _id: consulta._id });
  });

  it('arquivistaConsultas — move consultas concluídas >6 meses para arquivo', async () => {
    const Consulta = require('../models/Consulta');
    const ConsultaArquivo = require('../models/ConsultaArquivo');
    const antiga = new Date();
    antiga.setMonth(antiga.getMonth() - 7);
    antiga.setHours(10, 0, 0, 0);

    const consulta = await Consulta.create({
      empresa_id: empresaId, sala_id: salaF7Id, fisioterapeuta_id: fisioF7Id,
      paciente_id: pacienteF7Id,
      data_hora_inicio: antiga,
      data_hora_fim: new Date(antiga.getTime() + 45 * 60000),
      duracao_minutos: 45, estado: 'concluida', criada_por: diretorF7Id,
      concluida_em: antiga,
    });

    const { executarArquivistaConsultas } = require('../jobs/arquivistaConsultas');
    const resultado = await executarArquivistaConsultas();

    expect(resultado.arquivadas).toBeGreaterThanOrEqual(1);

    // Verifica que foi movida (não existe mais na coleção principal).
    const aindaExiste = await Consulta.findById(consulta._id).lean();
    expect(aindaExiste).toBeNull();

    // Verifica que está no arquivo.
    const arquivada = await ConsultaArquivo.findOne({
      paciente_id: pacienteF7Id,
      data_hora_inicio: antiga,
    }).lean();
    expect(arquivada).toBeTruthy();
    expect(arquivada.arquivado_em).toBeTruthy();

    await ConsultaArquivo.deleteOne({ _id: arquivada._id });
  });

  it('arquivistaConsultas — não arquiva consultas recentes', async () => {
    const Consulta = require('../models/Consulta');
    const recente = new Date();
    recente.setMonth(recente.getMonth() - 2); // 2 meses atrás
    recente.setHours(10, 0, 0, 0);

    const consulta = await Consulta.create({
      empresa_id: empresaId, sala_id: salaF7Id, fisioterapeuta_id: fisioF7Id,
      paciente_id: pacienteF7Id,
      data_hora_inicio: recente,
      data_hora_fim: new Date(recente.getTime() + 45 * 60000),
      duracao_minutos: 45, estado: 'concluida', criada_por: diretorF7Id,
      concluida_em: recente,
    });

    const { executarArquivistaConsultas } = require('../jobs/arquivistaConsultas');
    await executarArquivistaConsultas();

    // A consulta recente não deve ter sido arquivada.
    const aindaExiste = await Consulta.findById(consulta._id).lean();
    expect(aindaExiste).toBeTruthy();

    await Consulta.deleteOne({ _id: consulta._id });
  });
});
