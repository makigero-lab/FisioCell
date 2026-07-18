# Arquitetura — FisioCell (v0.1)

> **Proposta de arquitetura v0.1** para o SaaS FisioCell (Clínicas de Fisioterapia).
> Este documento acompanha as fases **F0** (rename + remoção Smoobu), **F1**
> (migração de roles + `perfil_profissional` + `config` da empresa), **F2**
> (`Paciente` + CRUD + sanitização de dados clínicos), **F3**
> (`HorarioFisioterapeuta` + motor de disponibilidade em 3 camadas), **F4**
> (`Consulta` + validação de conflitos + cédula profissional + nota clínica SOAP
> imutável) e **F5** (`ModeloProtocolo` + snapshot imutável na Consulta),
> **F6** (calendário FullCalendar com Consultas) e define o roadmap de migração
> F0–F9. Os esquemas Mongoose abaixo são **propostas** — a implementação decorre
> fase a fase.

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
| `Utilizador` (admin/manager/staff)    | → | `Utilizador` (admin/diretor_clinico/fisioterapeuta/rececionista) | F1 ✅ |
| `Tarefa`                              | → | `Consulta`                       | F4 ✅ |
| `ModeloChecklist`                     | → | `ModeloProtocolo`                | F5 ✅ |
| `TarefaArquivo`                       | → | `ConsultaArquivo`                | F4 ✅ |
| `smoobuController.js`                 | → | ❌ **removido**                   | F0 ✅ |
| `webhookController.js`                | → | ❌ **removido**                   | F0 ✅ |
| `routes/webhookRoutes.js`             | → | ❌ **removido**                   | F0 ✅ |
| — (novo)                              | → | `Paciente`                       | F2 ✅ |
| — (novo)                              | → | `HorarioFisioterapeuta`          | F3 ✅ |
| — (novo)                              | → | `Documento`                      | F9 |

---

## 5. Modelos Propostos (v0.1)

> Os esquemas abaixo são **propostas** para implementação fase a fase. Os
> modelos atuais (`Propriedade`, `Tarefa`, etc.) continuam em produção até
> serem migrados.

### 5.1 `Empresa` (Clínica) — ✅ F0 + F1 concluídos

```js
const empresaSchema = new Schema({
  nome:        { type: String, required: true, trim: true, index: true },
  nif:         { type: String, trim: true },
  morada:      { type: String, trim: true, default: '' },     // F0
  telefone:    { type: String, trim: true, default: '' },     // F0
  email:       { type: String, trim: true, default: '' },     // F0
  logo_url:    { type: String, trim: true, default: '' },     // F1 — URL do logótipo da clínica
  plano_ativo: { type: Boolean, default: true },
  ativa:       { type: Boolean, default: true, index: true },
  apagada:     { type: Boolean, default: false, index: true },
  // F1 — Configuração operacional da clínica (sub-documento estruturado)
  config: {
    horario_padrao: [{
      dia_semana: { type: Number, min: 0, max: 6, required: true },  // 0=Dom…6=Sáb
      abertura:   { type: String, default: '09:00' },
      fecho:      { type: String, default: '19:00' },
    }],
    duracao_consulta_padrao: { type: Number, default: 45, min: 15 },
    tolerancia_atraso_min:    { type: Number, default: 10, min: 0 },
    fuso_horario:             { type: String, default: 'Europe/Lisbon' },
  },
}, { timestamps: true });
```

### 5.2 `Utilizador` — ✅ F1 concluído

```js
const utilizadorSchema = new Schema({
  nome:            { type: String, required: true },
  email:           { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  password_hash:   { type: String },  // bcrypt (opcional — utilizador migrado sem password)
  empresa_id:      { type: ObjectId, ref: 'Empresa', required: true, index: true },
  role:            { type: String, enum: ['admin', 'diretor_clinico', 'fisioterapeuta', 'rececionista'], default: 'rececionista', index: true },
  responsavel_id:  { type: ObjectId, ref: 'Utilizador', default: null, index: true },
  ativo:           { type: Boolean, default: true },
  telefone:        { type: String, trim: true, default: '' },
  dias_folga:      [{ type: Number, min: 0, max: 6 }],  // 0=Dom…6=Sáb (legacy, será substituído por HorarioFisioterapeuta em F3)
  eliminado_em:    { type: Date, default: null, index: true },  // soft delete
  pushSubscription: { type: Schema.Types.Mixed, default: null },  // Web Push (VAPID)
  // Perfil profissional (F1) — só para fisioterapeuta/diretor_clinico
  perfil_profissional: {
    cedula:           { type: String, trim: true, default: '' },  // nº de cédula da Ordem dos Fisioterapeutas
    especialidades:   [{ type: String }],                          // ex.: 'Desporto', 'Neurologia', 'Pediatria'
    biografia:        { type: String, trim: true, default: '' },   // bio curta (futuro portal paciente)
    cor_calendario:   { type: String, default: '#3b82f6' },        // cor no FullCalendar
    ativo_clinico:    { type: Boolean, default: true },            // false = impede novas marcações, mantém histórico
  },
}, { timestamps: true });
```

### 5.3 `Paciente` — ✅ F2 concluído

```js
const pacienteSchema = new Schema({
  empresa_id:   { type: ObjectId, ref: 'Empresa', required: true, index: true },
  // Dados demográficos (RGPD: mínimo necessário)
  nome:         { type: String, required: true, trim: true, index: true },
  data_nascimento: { type: Date, default: null, index: true },
  genero:       { type: String, enum: ['M', 'F', 'Outro', 'NA'], default: 'NA' },
  num_utente:   { type: String, trim: true, default: '', index: true },  // SNS — Saúde 24
  nif:          { type: String, trim: true, default: '' },
  // Contactos
  telefone:     { type: String, trim: true, required: true },
  email:        { type: String, lowercase: true, trim: true, default: '' },
  morada:       { type: String, trim: true, default: '' },
  // Dados clínicos (acesso restrito a isClinico — sanitizado para rececionista)
  contacto_emergencia: {
    nome:    { type: String, default: '' },
    telefone:{ type: String, default: '' },
    relacao: { type: String, default: '' },  // "Filho", "Cônjuge", etc.
  },
  historico_medico: { type: String, default: '' },        // patologias, medicação
  alergias:     { type: [String], default: [] },
  // Consentimento RGPD (obrigatório em saúde)
  consentimento_dados: {
    concedido:      { type: Boolean, default: false },
    data:           { type: Date, default: null },        // preenchida quando concedido=true
    versao_termos:  { type: String, default: '1.0' },
  },
  // Estado
  ativo:        { type: Boolean, default: true, index: true },
  eliminado_em: { type: Date, default: null, index: true },  // soft delete (preserva histórico)
  // Metadados
  observacoes:  { type: String, default: '', trim: true },
  origem:       { type: String, enum: ['walk_in', 'referenciacao', 'online', 'outro'], default: 'walk_in' },
}, { timestamps: true });

// Índices compostos para queries frequentes.
pacienteSchema.index({ empresa_id: 1, nome: 1 });
pacienteSchema.index({ empresa_id: 1, num_utente: 1 });
pacienteSchema.index({ empresa_id: 1, ativo: 1, eliminado_em: 1 });
```

> **F2 — Implementação real:** o schema acima reflete o modelo `backend/models/Paciente.js` implementado. Em relação à proposta v0.1 inicial houve as seguintes alterações: o `genero` passou de `['M','F','Outro','Não especificado']` para `['M','F','Outro','NA']` (default `'NA'`); foram adicionados `num_utente` (SNS), `nif`, `morada`, `contacto_emergencia` estruturado e `origem`; o `consentimento_dados` passou de 3 booleans separados para um sub-documento `{ concedido, data, versao_termos }` (auditável); foram adicionados `ativo` (independente do soft delete) e `observacoes`. O índice composto `{ empresa_id, telefone }` foi substituído por `{ empresa_id, num_utente }` (procura por SNS) e `{ empresa_id, ativo, eliminado_em }` (listagem de ativos). Os campos clínicos (`historico_medico`, `alergias`, `contacto_emergencia`) são sanitizados na resposta para a `rececionista` via `pacienteController.sanitizarParaNaoClinico`.

### 5.4 `Consulta` — ✅ F4 concluído (substitui `Tarefa`)

```js
const consultaSchema = new Schema({
  empresa_id:        { type: ObjectId, ref: 'Empresa', required: true, index: true },
  sala_id:           { type: ObjectId, ref: 'Propriedade', required: true, index: true },  // Propriedade alias Sala até F8
  fisioterapeuta_id: { type: ObjectId, ref: 'Utilizador', required: true, index: true },
  paciente_id:       { type: ObjectId, ref: 'Paciente', required: true, index: true },

  // Marcação temporal — timestamps exatos (não meia-noite).
  data_hora_inicio:  { type: Date, required: true, index: true },
  data_hora_fim:     { type: Date, required: true },                                // calculado: inicio + duracao_minutos
  duracao_minutos:   { type: Number, required: true, default: 45, min: 15 },

  // Tipo e estado
  tipo:              { type: String, enum: ['primeira_consulta', 'sessao', 'reavaliacao', 'alta', 'grupo'], default: 'sessao', index: true },
  estado:            { type: String, enum: ['marcada', 'confirmada', 'em_curso', 'concluida', 'cancelada', 'faltou', 'nao_compareceu'], default: 'marcada', index: true },
  motivo_cancelamento: { type: String, enum: ['paciente', 'clinica', 'fisio', 'outro'], default: null },
  presenca:          { type: String, enum: ['pendente', 'presente', 'ausente', 'atrasado'], default: 'pendente' },

  // Nota clínica SOAP — snapshot imutável após estado='concluida' (RGPD/legal).
  nota_clinica: {
    subjetivo:           { type: String, default: '' },   // S — queixas do paciente
    objetivo:            { type: String, default: '' },   // O — exame físico
    avaliacao:           { type: String, default: '' },   // A — diagnóstico clínico
    plano:               { type: String, default: '' },   // P — plano terapêutico
    tratamento_efetuado: { type: String, default: '' },   // o que foi feito nesta sessão
    protocolo_aplicado: [{                                       // snapshot de ModeloProtocolo (F5)
      nome:   { type: String, required: true },
      items:  [{ texto: String, concluido: Boolean }],
    }],
    cedula_assinante:    { type: String, default: '' },   // snapshot da cédula do fisio assinante (auditoria legal)
  },

  // Auditoria da marcação
  criada_por:     { type: ObjectId, ref: 'Utilizador', required: true },
  concluida_em:   { type: Date, default: null },
  cancelada_em:   { type: Date, default: null },
  cancelada_por:  { type: ObjectId, ref: 'Utilizador', default: null },

  // Lembretes (F7 — flags para os cron jobs)
  lembrete_24h_enviado: { type: Boolean, default: false },
  lembrete_2h_enviado:  { type: Boolean, default: false },

  // Observações administrativas (não clínicas — visíveis à rececionista).
  observacoes:    { type: String, default: '', trim: true },
}, { timestamps: true });

consultaSchema.index({ empresa_id: 1, fisioterapeuta_id: 1, data_hora_inicio: 1 });
consultaSchema.index({ empresa_id: 1, sala_id: 1, data_hora_inicio: 1 });
consultaSchema.index({ empresa_id: 1, paciente_id: 1, data_hora_inicio: -1 });  // histórico do paciente (desc)
consultaSchema.index({ estado: 1, data_hora_inicio: 1 });                        // queries operacionais
```

> **F4 — Implementação real:** em relação à proposta v0.1 inicial houve as seguintes alterações: o campo `data_hora` (timestamp único) foi dividido em `data_hora_inicio` + `data_hora_fim` (o backend calcula `fim = inicio + duracao_minutos`) para suportar a validação de sobreposição de intervalos na função `validarConflitos`; o `duracao_minutos` default passou de `60` para `45` (alinha com `Empresa.config.duracao_consulta_padrao`); o enum `tipo` ganhou `'grupo'` (embora a marcação continue 1:1 por enquanto); o enum `estado` passou de `['agendada','confirmada','em_curso','concluida','cancelada','faltou']` para `['marcada','confirmada','em_curso','concluida','cancelada','faltou','nao_compareceu']` (`'agendada'` → `'marcada'`, adicionado `'nao_compareceu'`); foi adicionado `motivo_cancelamento` (enum `'paciente'|'clinica'|'fisio'|'outro'`); o enum `presenca` ganhou `'atrasado'` (em vez de `'justificada'`); a `nota_clinica` ganhou `tratamento_efetuado`, `protocolo_aplicado[]` (snapshot de `ModeloProtocolo` — **F5 concluído**: povoado no `criarConsulta` via `gerarSnapshotProtocolo`, atualizado via `PATCH /nota-clinica`) e `cedula_assinante` (snapshot da cédula do fisio que assinou — auditoria legal); o array `lembretes[]` foi substituído por dois booleans simples `lembrete_24h_enviado`/`lembrete_2h_enviado` (flags para os futuros cron jobs F7); foram adicionados `criada_por` (auditoria), `cancelada_em`/`cancelada_por`. Os índices compostos foram expandidos para 4 (incluindo `{estado, data_hora_inicio}` para queries operacionais e `{empresa_id, paciente_id, data_hora_inicio: -1}` para histórico do paciente em ordem inversa). A imutabilidade da `nota_clinica` após `estado='concluida'` é enforced no controller (403 em PUT/PATCH/DELETE); a cédula do assinante é validada via `Utilizador.temCedulaValida()` em `PATCH /:id/nota-clinica` (403 sem cédula). A validação de conflitos (4 dimensões: fisio disponível + sala + fisio + paciente) é feita pela função interna `validarConflitos` no `consultaController` (não no schema), seguindo o padrão soft block (409 sem `forcar`, 200 com warning se `forcar: true`).

### 5.5 `ModeloProtocolo` — ✅ F5 concluído (substitui `ModeloChecklist`)

```js
const modeloProtocoloSchema = new Schema({
  empresa_id:   { type: ObjectId, ref: 'Empresa', required: true, index: true },
  nome:         { type: String, required: true, trim: true, index: true },
  descricao:    { type: String, default: '', trim: true },
  // F5 — Área clínica (para filtrar no formulário de marcação).
  area:         { type: String, enum: ['musculoesqueletica','neurologica','cardioresp','desporto','pediatria','outro'], default: 'musculoesqueletica', index: true },
  seccoes: [{
    nome:  { type: String, required: true, trim: true },
    items: [{ type: String, required: true, trim: true }],
  }],
  // F5 — Permite desativar um protocolo sem apagar (preserva snapshots antigos).
  ativo:        { type: Boolean, default: true, index: true },
}, { timestamps: true });

// Índice para listar protocolos ativos por empresa + área.
modeloProtocoloSchema.index({ empresa_id: 1, ativo: 1, area: 1 });
```

> **F5 — Implementação real:** o `ModeloProtocolo` evolui o `ModeloChecklist` (Prompt 133) com dois campos novos: `area` (área clínica — enum de 6 valores, default `'musculoesqueletica'`, indexado individualmente e no composto) e `ativo` (soft toggle — permite desativar um protocolo sem apagar, preservando os snapshots já guardados em `Consulta.nota_clinica.protocolo_aplicado`). O `nome` é indexado individualmente para pesquisa. Cada secção tem `nome` (obrigatório) + `items` (array de strings não vazias). O índice composto `{ empresa_id, ativo, area }` otimiza a query mais frequente: listar protocolos ativos por área para o select no formulário de marcação de consulta. O controller `protocoloController.js` exporta o helper `gerarSnapshotProtocolo(protocoloId, empresaId)` (devolve array de `{ nome, items: [{ texto, concluido: false }] }` ou `null` se não existir/não pertencer à empresa) — invocado por `consultaController.criarConsulta` quando o body traz `protocolo_id`, guardando o snapshot imutável em `nota_clinica.protocolo_aplicado`. O `PATCH /:id/nota-clinica` aceita `protocolo_aplicado` para marcar items `concluido` durante a sessão. O `DELETE` é hard delete (não há soft delete — para "desativar" sem perder histórico usa-se `PUT` com `ativo: false`). Permissões: middleware custom `podeVer` (4 roles) para GET/listar/detalhe (fisio precisa de ver para aplicar; rececionista para selecionar ao marcar); `isDiretorClinico` para POST/PUT/DELETE.

### 5.6 `Sala` — F3 (substitui `Propriedade`)

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

### 5.7 `HorarioFisioterapeuta` — ✅ F3 concluído

```js
const horarioFisioterapeutaSchema = new Schema({
  empresa_id:        { type: ObjectId, ref: 'Empresa', required: true, index: true },
  fisioterapeuta_id: { type: ObjectId, ref: 'Utilizador', required: true, index: true },
  tipo:              { type: String, enum: ['recorrente', 'excecao'], required: true, default: 'recorrente', index: true },
  // Para tipo='recorrente': dia da semana (0=Dom…6=Sáb). Null se 'excecao'.
  dia_semana:        { type: Number, min: 0, max: 6, default: null },
  // Janela de trabalho (formato "HH:mm", validado por regex).
  hora_inicio:       { type: String, default: '09:00' },  // /^([01]\d|2[0-3]):([0-5]\d)$/
  hora_fim:          { type: String, default: '19:00' },
  // Para tipo='excecao': data específica do dia. Null se 'recorrente'.
  data:              { type: Date, default: null },
  // Excecao: true = horário extra disponível; false = bloqueio (formação, feriado).
  disponivel:        { type: Boolean, default: true },
  // Soft toggle: permite desativar uma regra sem a apagar.
  ativo:             { type: Boolean, default: true, index: true },
  // Nota interna livre (ex.: "Formação em Pilates Clínico").
  nota:              { type: String, default: '', trim: true },
}, { timestamps: true });

// Validação pre('validate'):
//   - tipo='recorrente' → dia_semana obrigatório (0-6) e data=null.
//   - tipo='excecao'    → data obrigatória e dia_semana=null.
horarioFisioterapeutaSchema.pre('validate', function (next) { /* … */ });

// Índices compostos.
horarioFisioterapeutaSchema.index({ fisioterapeuta_id: 1, dia_semana: 1, ativo: 1 });
horarioFisioterapeutaSchema.index({ empresa_id: 1, fisioterapeuta_id: 1, tipo: 1 });
horarioFisioterapeutaSchema.index({ fisioterapeuta_id: 1, data: 1 });
```

> **F3 — Implementação real:** em relação à proposta v0.1 inicial houve as seguintes alterações: o array `janelas: [{ inicio, fim }]` foi substituído por uma única janela por documento (`hora_inicio` + `hora_fim`) — para representar um dia com manhã+tarde criam-se dois documentos `recorrente` com o mesmo `dia_semana`; o campo `notas` (plural) passou a `nota` (singular); o default de `disponivel` (exceção) passou de `false` para `true` (na prática o controller valida o tipo e o frontend oferece o toggle); foi adicionado o campo `ativo` (soft toggle, indexado) para desativar uma regra sem a apagar. Os índices compostos também foram ajustados: `{ fisioterapeuta_id, dia_semana, ativo }` para queries de regra recorrente, `{ empresa_id, fisioterapeuta_id, tipo }` para listagens por fisioterapeuta, e `{ fisioterapeuta_id, data }` para procura de exceções por dia. A validação de coerência entre `tipo`/`dia_semana`/`data` é feita em `pre('validate')` (não em validadores de campo isolados). O motor de disponibilidade (`utils/disponibilidade.js`) consulta este modelo nas funções `obterHorarioDia`, `verificarConflitoHorario` e `verificarDisponibilidadeCompleta`.

### 5.8 `Documento` — F9

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
| 3 | **Nota clínica SOAP embutida na `Consulta`** (F4: imutável após conclusão + cédula obrigatória) | A nota SOAP é inseparável da consulta — sempre lida em conjunto. Evita join desnecessário. O sub-documento é opaco para `rececionista` (filtrado no controller). **F4:** uma vez `estado='concluida'`, a `nota_clinica` torna-se **imutável** (RGPD/legal — 403 em PUT/PATCH/DELETE); o assinante tem de ter cédula profissional válida (`Utilizador.temCedulaValida()`) — o nº de cédula é guardado como snapshot em `nota_clinica.cedula_assinante` para auditoria legal (rastreabilidade de quem assinou). Endpoint dedicado `PATCH /:id/nota-clinica` com `isClinico` (separado do `PUT /:id` que é `isRececionista`). |
| 4 | **Sala como entidade de 1.º nível** (não sub-documento de `Empresa`) | Múltiplas salas por clínica, cada uma com capacidade/equipamentos próprios. As consultas referenciam `sala_id` — permite conflito de sala (duas consultas na mesma sala ao mesmo tempo). |
| 5 | **Horário do fisio = modelo dedicado** (`HorarioFisioterapeuta`) | O horário recorrente (seg–sex, 09–13, 14–19) é diferente do `dias_folga` legacy. As exceções (feriados, formação) precisam de data específica. Um modelo dedicado suporta ambos (`tipo: 'recorrente'` vs `'excecao'`). |
| 6 | **`admin` não vê dados clínicos** | RGPD: o Super Admin da plataforma gere infraestrutura (empresas, planos, sistema), mas dados clínicos (pacientes, notas SOAP) são do tenant. O `admin` nunca tem acesso a `Paciente`, `Consulta.nota_clinica`, `Documento`. Separação no middleware `requireRole`. |
| 7 | **Soft delete em tudo** (F4: `Consulta` é exceção — hard delete só para marcações erradas) | Pacientes eliminados podem ter consultas históricas. Fisioterapeutas eliminados podem ter notas SOAP. O soft delete (`eliminado_em`) preserva integridade referencial e permite auditoria. **F4 — exceção da `Consulta`:** a `Consulta` não tem `eliminado_em` (não faz sentido preservar marcações erradas); o `DELETE /:id` é hard delete, mas **bloqueia consultas concluídas** (403 RGPD — a `nota_clinica` SOAP é um documento legal que tem de ser preservado). Para "anular" uma consulta concluída usa-se o cancelamento. |
| 8 | **3 camadas de disponibilidade** (F4: + 4.ª camada de conflitos de marcação) | O motor de disponibilidade (`utils/disponibilidade.js` — `verificarDisponibilidadeCompleta`) cruza por ordem de prioridade: (1) **Ausência aprovada** (`Ausencia` com `estado: 'aprovada'` que cubra o dia) — se houver, o fisioterapeuta está indisponível. (2) **Folga fixa semanal** (`Utilizador.dias_folga`) — se o dia da semana estiver no array, está indisponível. (3) **Horário de trabalho** (`HorarioFisioterapeuta`): `obterHorarioDia` consulta primeiro as **exceções do dia** (`tipo='excecao'` com `data` = dia; se `disponivel: false` → bloqueio; se `disponivel: true` → janela extra); se não houver exceção, consulta a **regra recorrente** (`tipo='recorrente'` com `dia_semana`); se não houver regra, o fisioterapeuta não trabalha nesse dia. Por fim, `verificarConflitoHorario` valida se a consulta proposta cabe dentro do bloco de trabalho. **F4 — 4.ª camada (conflitos de marcação):** a função interna `consultaController.validarConflitos` cruza ainda, em simultâneo, (4a) fisioterapeuta disponível (camadas 1–3 via `verificarDisponibilidadeCompleta`), (4b) sala sem sobreposição temporal, (4c) fisioterapeuta sem sobreposição temporal, (4d) paciente sem sobreposição temporal. Sobreposições consideram só consultas **ativas** (`estado: { $nin: ['cancelada','faltou','nao_compareceu'] }`). |
| 9 | **Soft block de conflitos (F4)** | A validação de conflitos não bloqueia a marcação — devolve 409 (sem `forcar`) ou 200 com `warning` + `conflitos` (com `forcar: true`). O gestor pode forçar marcações em situações excecionais (ex.: 2 pacientes em grupo na mesma sala, sobreposição curta por atraso). As marcações forçadas ficam sinalizadas em `Auditoria.detalhes.conflitos_forcados: true` para revisão posterior. O frontend mostra warnings em tempo real via `GET /validar` (debounce 400ms). |
| 10 | **Cédula profissional obrigatória para assinar SOAP (F4)** | A cédula da Ordem dos Fisioterapeutas é legalmente obrigatória para assinar documentos clínicos. O método `Utilizador.temCedulaValida()` devolve `true` para `admin`/`rececionista` (não aplicável — não assinam SOAP) e exige `perfil_profissional.cedula` preenchido para `fisioterapeuta`/`diretor_clinico`. O endpoint `PATCH /:id/nota-clinica` valida esta condição (403 sem cédula) e guarda snapshot do nº de cédula em `nota_clinica.cedula_assinante` (auditoria legal — rastreabilidade mesmo que o fisio mude de cédula ou seja eliminado). |

---

## 8. Roadmap de Migração

| Fase | Escopo | Estado |
|------|--------|--------|
| **F0** | Rename Autocell→FisioCell + remoção Smoobu + `ARQUITETURA.md` | ✅ Concluído |
| **F1** | Adaptar `Empresa` (já tem `morada`/`telefone`/`email`) + `Utilizador` (novos roles + `perfil_profissional`) | ✅ Concluído |
| **F2** | Criar `Paciente` + CRUD + permissões (diretor_clinico vê todos; fisio vê só os seus; rececionista vê dados demográficos) | ✅ Concluído |
| **F3** | `Sala` (de `Propriedade`) + `HorarioFisioterapeuta` + motor de disponibilidade (3 camadas) | ✅ Concluído\* |
| **F4** | `Consulta` (de `Tarefa`) + CRUD de marcação + validação de conflitos (sala + fisio + paciente) + nota clínica SOAP imutável + cédula profissional | ✅ Concluído |
| **F5** | `ModeloProtocolo` (de `ModeloChecklist`) + CRUD + snapshot imutável na Consulta (`protocolo_id` em `criarConsulta`, `protocolo_aplicado` em `PATCH /nota-clinica`) | ✅ Concluído |
| **F6** | Adaptar frontend: calendário FullCalendar mostra `Consultas` em vez de `Tarefas` (nova rota `/gestor/calendario-consultas` com cores por fisioterapeuta, filtros, legenda e modal de detalhe) | ✅ Concluído |
| **F7** | Cron jobs novos (`briefingDiarioFisio`, `lembreteConsultasAmanha`, `lembrete2hConsulta`, `caoGuardaConsultas`, `arquivistaConsultas`) | Pendente |
| **F8** | Limpeza: remover `Tarefa`, `TarefaArquivo`, `Propriedade`, `ModeloChecklist` antigos | Pendente |
| **F9** | `Documento` (anexos + fotografias clínicas) com storage S3/Cloudinary + consentimento RGPD | Pendente |

> *\*F3 — Implementação efetiva:* o modelo `HorarioFisioterapeuta` + motor de disponibilidade (3 camadas) + endpoints `/api/gestor/horarios` + página `/gestor/equipa/horarios` estão concluídos. A migração `Propriedade` → `Sala` foi adiada (continua em `Propriedade`) — será retomada numa fase posterior quando o modelo `Consulta` exigir o `sala_id` (F4).

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
