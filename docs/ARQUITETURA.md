# Arquitetura — FisioCell (v0.1)

> **Proposta de arquitetura v0.1** para o SaaS FisioCell (Clínicas de Fisioterapia).
> Este documento acompanha a fase **F0** (rename + remoção Smoobu) e define o
> roadmap de migração F0–F9. Os esquemas Mongoose abaixo são **propostas** — a
> implementação decorre fase a fase.

---

## 1. Visão Geral

O **FisioCell** é um SaaS B2B **multi-tenant** para **Clínicas de Fisioterapia**.
Cada clínica (= empresa = tenant) gere pacientes, fisioterapeutas, salas,
marcações de consultas, notas clínicas (SOAP) e lembretes.

### Stack tecnológica

| Camada          | Tecnologia                                         | Alojamento |
|-----------------|----------------------------------------------------|------------|
| Backend         | Node.js + Express + MongoDB (Mongoose)             | Render     |
| Frontend        | Next.js 14 + TypeScript + Tailwind CSS + shadcn/ui | Vercel     |
| Calendário      | FullCalendar v6                                    | (frontend) |
| Notificações    | Web Push (VAPID) + notificações in-app             | (backend)  |
| Auth            | JWT em cookie httpOnly                             | (backend)  |

---

## 2. Princípios Herdados do Código-Base

A arquitetura FisioCell herda os princípios já consolidados no código-base
Autocell. Estas convenções são **imutáveis** e aplicam-se a todos os modelos
e endpoints novos.

| Princípio                  | Descrição                                                                 |
|----------------------------|---------------------------------------------------------------------------|
| Multi-tenant via `empresa_id` | Todos os modelos de domínio têm `empresa_id` (ObjectId `ref: 'Empresa'`). O middleware `auth` injeta `req.user.empresa_id` a partir do JWT. |
| `timestamps: true`         | Todos os modelos Mongoose usam `timestamps: true` (createdAt/updatedAt automáticos). |
| Soft delete                | Registos eliminados são marcados (`eliminado_em` ou `apagada: true`) em vez de removidos fisicamente. Protege integridade referencial e permite restaurar. |
| Índices explícitos         | Todos os campos de query frequente (`empresa_id`, `utilizador_id`, `data`, etc.) têm `index: true` declarado explicitamente no schema. |
| RBAC via `requireRole`    | Middleware de controlo de acesso baseado em roles. Cada rota declara quais as roles permitidas. |
| JWT em cookie httpOnly    | O token JWT é guardado num cookie `fisiocell_token` (httpOnly, SameSite=Strict, Secure). O middleware Edge lê o cookie; o backend verifica a assinatura. |
| Cron jobs (node-cron)     | Jobs agendados com `timezone: 'Europe/Lisbon'`. Iniciados no arranque do `server.js` dentro de `if (require.main === module)` (não correm nos testes). |
| Snapshots imutáveis       | Dados contextuais no momento da criação (ex.: checklist da propriedade, detalhes da reserva) são copiados para o documento — não há `populate` retroativo que possa mudar o passado. |
| Modelo de arquivo         | Entidades concluídas/arquivadas são movidas para uma coleção `*Arquivo` (ex.: `TarefaArquivo` → `ConsultaArquivo`) com snapshot completo. Mantém a coleção principal leve. |

---

## 3. Hierarquia de Roles

O FisioCell define **4 roles** aprovadas:

| Role                | Escopo        | Descrição                                                                 |
|---------------------|---------------|---------------------------------------------------------------------------|
| `admin`             | Plataforma    | Super Admin da PLATAFORMA — cross-tenant. Gere empresas, planos, sistema. **NÃO vê dados clínicos** por RGPD. |
| `diretor_clinico`   | Clínica       | Acesso TOTAL à clínica: pacientes, consultas, equipa, relatórios. Pode atender pacientes (é um fisioterapeuta com poderes de gestão). |
| `fisioterapeuta`    | Clínica (próprio) | Vê SÓ os seus pacientes e consultas. Regista notas SOAP. Não vê dados de outros fisioterapeutas. |
| `rececionista`      | Clínica       | Gere marcações de TODOS os fisioterapeutas. **NÃO vê notas clínicas/SOAP** — princípio RGPD need-to-know. |

### 3.1 Matriz de Permissões (recursos × roles)

| Recurso                 | `admin` | `diretor_clinico` | `fisioterapeuta` | `rececionista` |
|-------------------------|:-------:|:-----------------:|:----------------:|:--------------:|
| Empresas (cross-tenant) |   ✅    |        ❌          |        ❌         |       ❌        |
| Utilizadores da clínica |   ✅    |        ✅          |   ❌ (só o seu)   |       ❌        |
| Pacientes (CRUD)        |   ❌    |        ✅          |  ✅ (só os seus)  |  ✅ (dados demográficos + contactos) |
| Consultas (marcar)      |   ❌    |        ✅          |        ❌         |       ✅        |
| Consultas (ver todas)   |   ❌    |        ✅          |   ❌ (só as suas) |  ✅ (sem nota clínica) |
| Nota clínica SOAP       |   ❌    |        ✅          |  ✅ (só as suas)  |       ❌        |
| Salas                   |   ❌    |        ✅          |        👁️        |       👁️       |
| Horários fisio          |   ❌    |        ✅          |   ❌ (só o seu)   |  ✅ (todos, para marcações) |
| Relatórios              |   ❌    |        ✅          |   ❌ (só os seus) |       ❌        |
| Documentos (anexos)     |   ❌    |        ✅          |  ✅ (só os seus)  |       ❌        |

> Legenda: ✅ = acesso total · 👁️ = só leitura · ❌ = sem acesso

### 3.2 Middleware adaptado

```js
// middleware/auth.js (já existente) — requireRole continua a funcionar

const isDiretorClinico = requireRole('admin', 'diretor_clinico');
const isClinico        = requireRole('admin', 'diretor_clinico', 'fisioterapeuta');
const isRececionista   = requireRole('admin', 'diretor_clinico', 'rececionista');
```

- `isDiretorClinico` — rotas de gestão da clínica (CRUD de equipa, configuração, relatórios).
- `isClinico` — rotas que envolvem dados clínicos (notas SOAP, documentos clínicos).
- `isRececionista` — rotas de marcação (agenda, slots disponíveis) sem exposição de notas clínicas.

---

## 4. Mapa de Migração de Domínio

| Modelo/Controller (Alojamento Local) | → | Modelo/Controller (Fisioterapia) | Fase |
|---------------------------------------|---|----------------------------------|------|
| `Empresa`                             | → | `Empresa` (Clínica) — adiciona `morada`, `telefone`, `email` | F0 ✅ |
| `Propriedade`                         | → | `Sala`                           | F3 |
| `Utilizador` (admin/manager/staff)    | → | `Utilizador` (admin/diretor_clinico/fisioterapeuta/rececionista) | F1 |
| `Tarefa`                              | → | `Consulta`                       | F4 |
| `ModeloChecklist`                     | → | `ModeloProtocolo`                | F5 |
| `TarefaArquivo`                       | → | `ConsultaArquivo`                | F4 |
| `smoobuController.js`                 | → | ❌ **removido**                   | F0 ✅ |
| `webhookController.js`                | → | ❌ **removido**                   | F0 ✅ |
| `routes/webhookRoutes.js`             | → | ❌ **removido**                   | F0 ✅ |
| — (novo)                              | → | `Paciente`                       | F2 |
| — (novo)                              | → | `HorarioFisioterapeuta`          | F3 |
| — (novo)                              | → | `Documento`                      | F9 |

---

## 5. Modelos Propostos (v0.1)

> Os esquemas abaixo são **propostas** para implementação fase a fase. Os
> modelos atuais (`Propriedade`, `Tarefa`, etc.) continuam em produção até
> serem migrados.

### 5.1 `Empresa` (Clínica) — ✅ F0 concluído

```js
const empresaSchema = new Schema({
  nome:        { type: String, required: true, trim: true, index: true },
  nif:         { type: String, trim: true },
  morada:      { type: String, trim: true },           // F0
  telefone:    { type: String, trim: true },           // F0
  email:       { type: String, trim: true },           // F0
  plano_ativo: { type: Boolean, default: true },
  ativa:       { type: Boolean, default: true },
  apagada:     { type: Boolean, default: false },
  config:      { type: Schema.Types.Mixed, default: {} }, // F1: duração padrão consulta, lembretes, etc.
}, { timestamps: true });
```

### 5.2 `Utilizador` — F1

```js
const utilizadorSchema = new Schema({
  nome:            { type: String, required: true },
  email:           { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  password_hash:   { type: String },  // bcrypt (opcional — utilizador migrado sem password)
  empresa_id:      { type: ObjectId, ref: 'Empresa', required: true, index: true },
  role:            { type: String, enum: ['admin', 'diretor_clinico', 'fisioterapeuta', 'rececionista'], default: 'fisioterapeuta' },
  ativo:           { type: Boolean, default: true },
  eliminado_em:    { type: Date, default: null },  // soft delete
  telefone:        { type: String, trim: true },
  dias_folga:      [{ type: Number, min: 0, max:6 }],  // 0=Dom…6=Sáb (legacy, será substituído por HorarioFisioterapeuta em F3)
  // Perfil profissional (F1) — só para fisioterapeuta/diretor_clinico
  perfil_profissional: {
    cedula:           { type: String, trim: true },           // nº de cédula profissional (APIF/Ordem)
    especialidades:   [{ type: String }],                      // ex.: 'Desporto', 'Neurologia', 'Pediatria'
    cor_calendario:   { type: String, default: '#3b82f6' },   // cor no FullCalendar
  },
  responsavel_id:  { type: ObjectId, ref: 'Utilizador', default: null, index: true },
}, { timestamps: true });
```

### 5.3 `Paciente` — F2

```js
const pacienteSchema = new Schema({
  empresa_id:   { type: ObjectId, ref: 'Empresa', required: true, index: true },
  // Dados demográficos
  nome:         { type: String, required: true, trim: true, index: true },
  data_nascimento: { type: Date },
  genero:       { type: String, enum: ['M', 'F', 'Outro', 'Não especificado'], default: 'Não especificado' },
  // Contactos
  email:        { type: String, lowercase: true, trim: true },
  telefone:     { type: String, trim: true, required: true },
  morada:       { type: String, trim: true },
  // Dados clínicos
  notas_gerais: { type: String, default: '' },          // alergias, medicação, observações gerais
  historico:    { type: String, default: '' },           // histórico clínico relevante
  // Consentimentos RGPD
  consentimento_dados:       { type: Boolean, default: false },  // tratamento de dados pessoais
  consentimento_marketing:   { type: Boolean, default: false },
  consentimento_fotografias: { type: Boolean, default: false },  // fotografias clínicas (F9)
  // Soft delete
  eliminado_em: { type: Date, default: null },
}, { timestamps: true });

pacienteSchema.index({ empresa_id: 1, nome: 1 });
pacienteSchema.index({ empresa_id: 1, telefone: 1 });
```

### 5.4 `Consulta` — F4 (substitui `Tarefa`)

```js
const consultaSchema = new Schema({
  empresa_id:        { type: ObjectId, ref: 'Empresa', required: true, index: true },
  sala_id:           { type: ObjectId, ref: 'Sala', required: true, index: true },
  fisioterapeuta_id: { type: ObjectId, ref: 'Utilizador', default: null, index: true },  // null = por atribuir
  paciente_id:       { type: ObjectId, ref: 'Paciente', required: true, index: true },
  data_hora:         { type: Date, required: true, index: true },  // timestamp exacto (não meia-noite)
  duracao_minutos:   { type: Number, default: 60, min: 15 },       // duração prevista
  tipo:              { type: String, enum: ['primeira_consulta', 'consulta', 'reavaliacao', 'alta'], default: 'consulta' },
  estado:            { type: String, enum: ['agendada', 'confirmada', 'em_curso', 'concluida', 'cancelada', 'faltou'], default: 'agendada' },
  presenca:          { type: String, enum: ['pendente', 'presente', 'ausente', 'justificada'], default: 'pendente' },
  // Nota clínica SOAP (F5) — só fisioterapeuta/diretor_clinico vê/escreve
  nota_clinica: {
    subjetivo:  { type: String, default: '' },  // S — queixas do paciente
    objetivo:   { type: String, default: '' },  // O — observações/exame físico
    avaliacao:  { type: String, default: '' },  // A — diagnóstico clínico
    plano:      { type: String, default: '' },  // P — plano terapêutico
  },
  // Lembretes
  lembretes: [{
    tipo:    { type: String, enum: ['sms', 'email', 'push'] },
    enviado_em: { type: Date },
    estado:  { type: String, enum: ['pendente', 'enviado', 'falhou'] },
  }],
  observacoes: { type: String, default: '' },     // notas operacionais (visíveis a rececionista)
  concluida_em: { type: Date, default: null },
}, { timestamps: true });

consultaSchema.index({ empresa_id: 1, data_hora: 1 });
consultaSchema.index({ empresa_id: 1, fisioterapeuta_id: 1, data_hora: 1 });
consultaSchema.index({ empresa_id: 1, paciente_id: 1 });
```

### 5.5 `Sala` — F3 (substitui `Propriedade`)

```js
const salaSchema = new Schema({
  empresa_id:   { type: ObjectId, ref: 'Empresa', required: true, index: true },
  nome:         { type: String, required: true, trim: true },   // ex.: "Sala 1", "Sala de Pilates"
  capacidade:   { type: Number, default: 1, min: 1 },            // 1 = individual; >1 = grupo
  equipamentos: [{ type: String }],                              // ex.: 'cama de massagem', 'reformer'
  ativo:        { type: Boolean, default: true },
}, { timestamps: true });

salaSchema.index({ empresa_id: 1, nome: 1 }, { unique: true });
```

### 5.6 `HorarioFisioterapeuta` — F3

```js
const horarioSchema = new Schema({
  empresa_id:        { type: ObjectId, ref: 'Empresa', required: true, index: true },
  fisioterapeuta_id: { type: ObjectId, ref: 'Utilizador', required: true, index: true },
  tipo:              { type: String, enum: ['recorrente', 'excecao'], required: true },
  // Recorrente: dia da semana + janelas de disponibilidade
  dia_semana:        { type: Number, min: 0, max: 6 },  // 0=Dom…6=Sáb (só tipo 'recorrente')
  janelas: [{
    inicio: { type: String },  // "09:00"
    fim:    { type: String },  // "13:00"
  }],
  // Exceção: data específica (feriado, formação, indisponibilidade pontual)
  data:              { type: Date },                     // só tipo 'excecao'
  disponivel:        { type: Boolean, default: false },  // false = bloqueado (feriado), true = extra
  notas:             { type: String, default: '' },
}, { timestamps: true });

horarioSchema.index({ empresa_id: 1, fisioterapeuta_id: 1, dia_semana: 1 });
horarioSchema.index({ empresa_id: 1, fisioterapeuta_id: 1, data: 1 });
```

### 5.7 `Documento` — F9

```js
const documentoSchema = new Schema({
  empresa_id:    { type: ObjectId, ref: 'Empresa', required: true, index: true },
  paciente_id:   { type: ObjectId, ref: 'Paciente', required: true, index: true },
  consulta_id:   { type: ObjectId, ref: 'Consulta', default: null, index: true },  // se associado a uma consulta
  tipo:          { type: String, enum: ['anexo', 'fotografia_clinica', 'receita', 'relatorio', 'outro'], required: true },
  nome_ficheiro: { type: String, required: true },
  storage_url:   { type: String, required: true },   // S3 / Cloudinary URL
  storage_key:   { type: String, required: true },   // chave interna para delete
  content_type:  { type: String },                    // ex.: 'application/pdf', 'image/jpeg'
  tamanho_bytes: { type: Number },
  // RGPD
  consentimento_fotografias: { type: Boolean, default: false },  // confirma consentimento do paciente
  uploaded_by:   { type: ObjectId, ref: 'Utilizador', required: true },
  eliminado_em:  { type: Date, default: null },  // soft delete
}, { timestamps: true });

documentoSchema.index({ empresa_id: 1, paciente_id: 1, tipo: 1 });
```

---

## 6. Cron Jobs — Adaptação

Os cron jobs do Alojamento Local são adaptados para o domínio Fisioterapia.
Todos mantêm `timezone: 'Europe/Lisbon'`.

| Job (Alojamento Local)   | → | Job (Fisioterapia)              | Agenda       | Descrição |
|--------------------------|---|---------------------------------|--------------|-----------|
| `dailyBriefing`          | → | `briefingDiarioFisio`           | `0 8 * * *` (08:00) | Envia via push o plano de consultas de **hoje** a cada fisioterapeuta. |
| `agendaAmanha`           | → | `lembreteConsultasAmanha`       | `0 19 * * *` (19:00) | Envia push a cada fisioterapeuta com as consultas de **amanhã**. |
| — (novo)                 | → | `lembrete2hConsulta`            | `*/15 * * * *` (a cada 15 min) | Envia lembrete (SMS/push) ao paciente 2h antes da consulta. Corre de 15 em 15 min e filtra as consultas cuja `data_hora` cai nos próximos 15 min a contar de +1h45. |
| `caoGuarda`              | → | `caoGuardaConsultas`            | `0 2 * * *` (02:00) | Auto-confirma consultas de amanhã que estejam `agendada` → `confirmada` (se houver política de confirmação automática). Alerta consultas de hoje não concluídas. |
| `arquivista`             | → | `arquivistaConsultas`           | semanal (`0 3 * * 0`, domingo 03:00) | Move consultas concluídas há > 90 dias para `ConsultaArquivo` (mantém a coleção `Consulta` leve). |

---

## 7. Decisões de Design

| # | Decisão | Justificação |
|---|---------|--------------|
| 1 | **Fisioterapeuta = `Utilizador`** (não modelo separado) | Herda auth, JWT, RBAC, soft delete, notificações push. O `perfil_profissional` (cédula, especialidades, cor) é um sub-documento — não justifica uma coleção separada. |
| 2 | **Paciente = modelo separado** (não `Utilizador`) | Pacientes não fazem login, não têm JWT, não pertencem à equipa. Têm consentimentos RGPD próprios. Isolar `Paciente` de `Utilizador` protege dados clínicos do acesso administrativo da plataforma. |
| 3 | **Nota clínica SOAP embutida na `Consulta`** | A nota SOAP é inseparável da consulta — sempre lida em conjunto. Evita join desnecessário. O sub-documento é opaco para `rececionista` (filtrado no controller). |
| 4 | **Sala como entidade de 1.º nível** (não sub-documento de `Empresa`) | Múltiplas salas por clínica, cada uma com capacidade/equipamentos próprios. As consultas referenciam `sala_id` — permite conflito de sala (duas consultas na mesma sala ao mesmo tempo). |
| 5 | **Horário do fisio = modelo dedicado** (`HorarioFisioterapeuta`) | O horário recorrente (seg–sex, 09–13, 14–19) é diferente do `dias_folga` legacy. As exceções (feriados, formação) precisam de data específica. Um modelo dedicado suporta ambos (`tipo: 'recorrente'` vs `'excecao'`). |
| 6 | **`admin` não vê dados clínicos** | RGPD: o Super Admin da plataforma gere infraestrutura (empresas, planos, sistema), mas dados clínicos (pacientes, notas SOAP) são do tenant. O `admin` nunca tem acesso a `Paciente`, `Consulta.nota_clinica`, `Documento`. Separação no middleware `requireRole`. |
| 7 | **Soft delete em tudo** | Pacientes eliminados podem ter consultas históricas. Fisioterapeutas eliminados podem ter notas SOAP. O soft delete (`eliminado_em`) preserva integridade referencial e permite auditoria. |
| 8 | **3 camadas de disponibilidade** | (1) Horário base do fisio (`HorarioFisioterapeuta` recorrente). (2) Exceções (feriados, formação, férias via `Ausencia`). (3) Consultas já marcadas (conflito de horário). O motor de disponibilidade cruza as 3 camadas para calcular slots livres. |

---

## 8. Roadmap de Migração

| Fase | Escopo | Estado |
|------|--------|--------|
| **F0** | Rename Autocell→FisioCell + remoção Smoobu + `ARQUITETURA.md` | ✅ Concluído |
| **F1** | Adaptar `Empresa` (já tem `morada`/`telefone`/`email`) + `Utilizador` (novos roles + `perfil_profissional`) | Pendente |
| **F2** | Criar `Paciente` + CRUD + permissões (diretor_clinico vê todos; fisio vê só os seus; rececionista vê dados demográficos) | Pendente |
| **F3** | `Sala` (de `Propriedade`) + `HorarioFisioterapeuta` + motor de disponibilidade (3 camadas) | Pendente |
| **F4** | `Consulta` (de `Tarefa`) + CRUD de marcação + validação de conflitos (sala + fisio + paciente) | Pendente |
| **F5** | Nota clínica SOAP + `ModeloProtocolo` (de `ModeloChecklist`) | Pendente |
| **F6** | Adaptar frontend: calendário FullCalendar mostra `Consultas` em vez de `Tarefas` | Pendente |
| **F7** | Cron jobs novos (`briefingDiarioFisio`, `lembreteConsultasAmanha`, `lembrete2hConsulta`, `caoGuardaConsultas`, `arquivistaConsultas`) | Pendente |
| **F8** | Limpeza: remover `Tarefa`, `TarefaArquivo`, `Propriedade`, `ModeloChecklist` antigos | Pendente |
| **F9** | `Documento` (anexos + fotografias clínicas) com storage S3/Cloudinary + consentimento RGPD | Pendente |

---

## 9. Questões Respondidas pelo Utilizador

| # | Questão | Resposta | Impacto |
|---|---------|----------|---------|
| 1 | Faturação (emitar recibos/faturas)? | **Não** (futuro) | Sem modelo de faturação nesta versão. |
| 2 | Portal do paciente (auto-marcação)? | **Não** (futuro) | Sem área pública para pacientes. Marcações só via rececionista/diretor_clinico. |
| 3 | Múltiplas clínicas por fisioterapeuta? | **Não** (uma clínica) | `fisioterapeuta_id` pertence a uma só `empresa_id`. Não há cross-tenant para clínicos. |
| 4 | Documentos + fotografias clínicas? | **Sim** | Modelo `Documento` (F9) com storage S3/Cloudinary + consentimento RGPD obrigatório. |
| 5 | Sessões em grupo (vários pacientes)? | **Não** | `Consulta` tem 1 `paciente_id`. `Sala.capacidade` existe para future-proofing, mas a marcação é 1:1. |

---

> **Nota final:** Esta proposta v0.1 será refinada à medida que cada fase é
> implementada. Alterações a este documento devem ser registadas no
> `WORKLOG.md` com o Task ID correspondente à fase.
