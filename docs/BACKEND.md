# Documentação Técnica — Backend (FisioCell)

> ⚠️ **F0 — Documentação em transição.** O projeto está a migrar de Alojamento Local para Fisioterapia. A integração Smoobu foi removida. Os modelos `Tarefa`/`Propriedade` serão transformados em `Consulta`/`Sala` nas próximas fases (ver [`docs/ARQUITETURA.md`](ARQUITETURA.md) para o roadmap completo F0–F9).

API REST do SaaS de gestão para Fisioterapia, construída com **Node.js**, **Express** e **MongoDB** (via **Mongoose**).

---

## 1. Stack tecnológica

| Camada            | Tecnologia      | Função                                                         |
|-------------------|-----------------|----------------------------------------------------------------|
| Runtime           | Node.js ≥ 18    | Execução do servidor JavaScript                                |
| Framework Web     | Express 4       | Definição de rotas e middlewares HTTP                          |
| ODM de Base Dados | Mongoose 8      | Modelação e ligação ao MongoDB                                 |
| Variáveis de env. | dotenv          | Carregamento de configuração a partir de `.env`                |
| CORS              | cors            | Permissão de pedidos cross-origin (Vercel → Render)            |
| Dev tooling       | nodemon         | Reinício automático do servidor durante o desenvolvimento      |

---

## 2. Estrutura de ficheiros

```
backend/
├── package.json              # Dependências e scripts (npm start → node server.js)
├── server.js                 # Ponto de entrada: middlewares, rotas, ligação à BD
├── .env.example              # Modelo das variáveis de ambiente (a copiar para .env)
├── .gitignore                # Ignora node_modules, .env, logs, etc.
├── controllers/
│   ├── adminController.js    # Painel de Administração + setup Cliente Zero
│   ├── authController.js     # Autenticação: login (JWT) + /me
│   ├── gestorController.js   # Painel do Gestor (dashboard, tarefas, equipa)
│   ├── horarioController.js # CRUD de HorarioFisioterapeuta (F3) + verificador de disponibilidade
│   ├── pacienteController.js # CRUD de Pacientes (F2) — permissões por role + sanitização de dados clínicos
│   ├── staffController.js    # Painel do Staff
│   ├── tarefaController.js   # CRUD de tarefas + atribuição manual
│   ├── ausenciaController.js # Ausências (folgas/férias)
│   ├── superAdminController.js # Gestão cross-tenant de empresas
│   ├── relatorioController.js # Relatórios/analytics
│   ├── checklistController.js # Modelos de checklist
│   └── notificacaoController.js # Notificações in-app
├── middleware/
│   ├── auth.js               # Verifica JWT (strito), injeta req.user — sem fallback legacy
│   └── requireRole.js        # Middlewares RBAC: isAdmin, isDiretorClinico, isClinico, isRececionista (F1)
├── models/                   # Modelos Mongoose (ODM do MongoDB)
│   ├── Empresa.js            #   Entidade principal (multi-tenant)
│   ├── Propriedade.js        #   Alojamento (será migrado para Sala em F3)
│   ├── Utilizador.js         #   Admin / Staff de uma empresa (email + password_hash)
│   ├── Ausencia.js           #   Indisponibilidade de Staff num dia
│   ├── Tarefa.js             #   Tarefa de limpeza (será migrada para Consulta em F4)
│   ├── Paciente.js           #   Paciente da clínica (F2) — soft delete + dados clínicos sanitizados
│   └── HorarioFisioterapeuta.js # Limites de agenda do fisio (F3) — recorrente/excecao + motor de disponibilidade
├── utils/
│   ├── loadBalancer.js       # Motor de atribuição (extraído do webhook em F0)
│   ├── geocoding.js          # Geocoding de moradas (Nominatim)
│   ├── scheduler.js          # Scheduler sequencial de horas
│   ├── disponibilidade.js    # Filtros de ausência/folga + motor de disponibilidade F3 (horários)
│   ├── distancia.js          # Haversine (tempo de viagem)
│   ├── notificar.js          # Notificações in-app + push
│   ├── push.js               # Web Push (VAPID)
│   └── auditoria.js          # Registo de auditoria
└── routes/
    ├── adminRoutes.js        # Rotas /api/admin/*
    ├── gestorRoutes.js       # Rotas /api/gestor/*
    ├── pacienteRoutes.js     # Rotas /api/gestor/pacientes/* (F2)
    ├── horarioRoutes.js      # Rotas /api/gestor/horarios/* (F3)
    ├── staffRoutes.js        # Rotas /api/staff/*
    ├── authRoutes.js         # POST /api/auth/login, GET /api/auth/me
    ├── ausenciaRoutes.js     # Rotas de ausências
    └── relatorioRoutes.js    # Rotas de relatórios
```

---

## 3. Arquitetura e lógica de arranque (`server.js`)

O fluxo de arranque segue uma sequência segura:

1. **Carregamento de configuração** — `require('dotenv').config()` lê o `.env` e expõe as variáveis em `process.env`.
2. **Instanciação da app Express** — cria a aplicação e define a porta (`process.env.PORT || 5000`).
3. **Middlewares:**
   - `cors()` — habilita respostas a pedidos vindos de outras origens (essencial para o frontend na Vercel comunicar com a API no Render).
   - `express.json()` — faz parse do corpo dos pedidos em JSON, disponibilizando-os em `req.body`.
4. **Rotas** — `GET /` (healthcheck), montagem de `/api/admin`, `/api/gestor`, `/api/staff`, `/api/auth` (ver secção 6).
5. **Ligação ao MongoDB** — `mongoose.connect(process.env.MONGODB_URI)`.
   - Em **caso de sucesso**: regista mensagem e **só depois** arranca o servidor HTTP com `app.listen(PORT)`. Isto garante que a API só recebe tráfego quando a base de dados está acessível.
   - Em **caso de erro**: regista o erro e termina o processo (`process.exit(1)`), evitando arrancar um servidor sem acesso à BD.

### Regra de processo importante
> O servidor HTTP **só arranca depois de a ligação ao MongoDB ser estabelecida**. Se a BD estiver indisponível, a aplicação termina imediatamente em vez de arrancar num estado inconsistente.

---

## 3.1. Modelos de dados (Mongoose)

O sistema gira em torno de 7 coleções. Todas usam `timestamps: true` (createdAt/updatedAt).

### `Empresa`
Entidade principal do SaaS (multi-tenant). Cada empresa agrupa Propriedades e Utilizadores.

> **F0:** Os campos `morada`, `telefone`, `email` foram adicionados (substituem o antigo `smoobu_api_key`).
> **F1:** Adicionado `logo_url` (URL do logótipo da clínica) e o bloco `config` (horário padrão, duração de consulta, tolerância de atraso, fuso horário).

| Campo         | Tipo    | Notas                                              |
|---------------|---------|----------------------------------------------------|
| `nome`        | String  | Obrigatório, trim, indexado.                       |
| `nif`         | String  | Opcional, trim.                                    |
| `morada`      | String  | Opcional, trim. Morada da clínica (F0).            |
| `telefone`    | String  | Opcional, trim. Telefone da clínica (F0).          |
| `email`       | String  | Opcional, trim. Email de contacto da clínica (F0). |
| `logo_url`    | String  | Opcional, trim. URL do logótipo da clínica (F1). Default `''`. |
| `plano_ativo` | Boolean | Default `true`.                                    |
| `ativa`       | Boolean | Default `true`, indexado. Empresa suspensa (`ativa: false`) bloqueia login (Prompt 116). |
| `apagada`     | Boolean | Default `false`, indexado. Soft delete (Lixeira) — restaurável (Prompt 122). |

#### `config` (sub-documento) — F1

Configuração operacional da clínica. Default: objeto vazio `{}`.

| Campo                      | Tipo     | Notas                                                              |
|----------------------------|----------|--------------------------------------------------------------------|
| `horario_padrao`           | [Object] | Default `[]`. Array de `{ dia_semana: 0-6, abertura: 'HH:mm', fecho: 'HH:mm' }` (0=Dom…6=Sáb). Regra semanal recorrente de funcionamento. |
| `duracao_consulta_padrao`  | Number   | Default `45`, `min: 15`. Duração padrão de uma consulta em minutos. |
| `tolerancia_atraso_min`    | Number   | Default `10`, `min: 0`. Tolerância de atraso do paciente em minutos (antes de marcar como "atrasado"). |
| `fuso_horario`             | String   | Default `'Europe/Lisbon'`. Fuso horário da clínica (calendário + lembretes). |

### `Propriedade`
Representa um alojamento. **F0:** o campo `smoobu_id` foi removido. Será migrado para `Sala` em F3.

| Campo                        | Tipo     | Notas                                                              |
|------------------------------|----------|--------------------------------------------------------------------|
| `nome`                       | String   | Obrigatório, trim.                                                 |
| `morada`                     | String   | Obrigatório, trim. Geocoding automático (Nominatim) ao criar/editar. |
| `coordenadas`                | Object   | `{ lat: Number, lng: Number }`. Preenchidas via geocoding (default null). |
| `empresa_id`                 | ObjectId | `ref: 'Empresa'`. Obrigatório, indexado.                           |
| `tempo_limpeza_minutos`      | Number   | Default `45`, `min: 0`. Unidade de carga.                          |
| `ativo`                      | Boolean  | Default `true`.                                                    |
| `checklist`                  | [String] | Default `[]`. Itens de limpeza definidos pelo gestor (v1.34.0).    |
| `capacidade_hospedes`        | Number   | Default `null`, `min: 0`. Capacidade (v1.61.0 / Prompt 84).        |
| `funcionario_preferencial_id`| ObjectId | `ref: 'Utilizador'`, default `null`, indexado. **Prompt 92 (Fase 1.5)** — staff preferencial da propriedade. |

### `Utilizador`
Admin, Diretor Clínico, Fisioterapeuta ou Rececionista de uma empresa (clínica). Credenciais de login (email + password_hash).

**Roles (hierarquia) — F1:**
- `admin` — Super Admin da plataforma (cross-tenant). Gere empresas, planos, sistema. **NÃO vê dados clínicos** por RGPD.
- `diretor_clinico` — acesso TOTAL à clínica: pacientes, consultas, equipa, relatórios. Pode atender pacientes (é um fisioterapeuta com poderes de gestão).
- `fisioterapeuta` — vê SÓ os seus pacientes e consultas. Regista notas SOAP. Não vê dados de outros fisioterapeutas.
- `rececionista` — gere marcações de TODOS os fisioterapeutas. **NÃO vê notas clínicas/SOAP** — princípio RGPD need-to-know.

> **F1:** O enum foi migrado de `['admin','manager','staff']` para `['admin','diretor_clinico','fisioterapeuta','rececionista']`. O middleware legacy `isGestor`/`requireStaff`/`requireManager`/`requireAdmin` foi substituído por `isAdmin`/`isDiretorClinico`/`isClinico`/`isRececionista` em `middleware/requireRole.js`.

| Campo            | Tipo     | Notas                                                              |
|------------------|----------|--------------------------------------------------------------------|
| `nome`           | String   | Obrigatório.                                                       |
| `email`          | String   | Obrigatório, lowercase, trim, **único** (indexado). Credencial de login. |
| `password_hash`  | String   | Hash bcrypt da password (nunca a password em claro). Opcional (utilizador migrado sem password → login recusa). |
| `empresa_id`     | ObjectId | `ref: 'Empresa'`. Obrigatório, indexado.                           |
| `role`           | String   | `enum: ['admin','diretor_clinico','fisioterapeuta','rececionista']`, default `'rececionista'`. Indexado. |
| `responsavel_id` | ObjectId | `ref: 'Utilizador'`, default `null`. Superior hierárquico (admin/diretor_clinico). O admin não tem responsavel_id (topo da hierarquia). Indexado. |
| `telefone`       | String   | Opcional, trim. Telemóvel para notificações (formato internacional). |
| `dias_folga`     | [Number] | Default `[]`. Folgas fixas semanais (0=Dom…6=Sáb). O load balancer exclui automaticamente o fisioterapeuta cujo dia da semana está neste array. |
| `ativo`          | Boolean  | Default `true`. Utilizador inativo é ignorado pelo login.         |
| `eliminado_em`   | Date     | Default `null`, indexado. Soft delete (preserva integridade referencial de consultas/notas históricas). |
| `pushSubscription` | Mixed  | Default `null`. Subscrição Web Push (VAPID) gerada pelo browser. |

#### `perfil_profissional` (sub-documento) — F1

Só faz sentido para `fisioterapeuta`/`diretor_clinico` (para `admin`/`rececionista` fica vazio).

| Campo            | Tipo     | Notas                                                              |
|------------------|----------|--------------------------------------------------------------------|
| `cedula`         | String   | Nº de cédula da Ordem dos Fisioterapeutas. Default `''`.            |
| `especialidades` | [String] | Default `[]`. Ex.: `'Desporto'`, `'Neurologia'`, `'Pediatria'`.     |
| `biografia`      | String   | Default `''`. Bio curta para mostrar no perfil público (futuro portal paciente). |
| `cor_calendario` | String   | Default `'#3b82f6'`. Cor (hex) do fisioterapeuta no FullCalendar.   |
| `ativo_clinico`  | Boolean  | Default `true`. `false` = inativo clinicamente (impede novas marcações) mas mantém o histórico. |

> **Regras de segurança (v1.7.0):** não é possível criar/editar utilizadores com role `admin` via `/api/admin/equipa` (403). Não é possível editar/eliminar/desativar utilizadores que já sejam `admin` (403 "Não é possível modificar um administrador"). O `responsavel_id` tem de ser um admin/diretor_clinico da mesma empresa (validado no backend).
>
> **Middlewares RBAC (F1):** definidos em `middleware/requireRole.js`:
> - `isAdmin` — só `admin` (ações sensíveis: criar admins, setup, gestão cross-tenant).
> - `isDiretorClinico` — `admin` + `diretor_clinico` (gestão operacional da clínica: propriedades/salas, equipa, ausências, consultas).
> - `isClinico` — `admin` + `diretor_clinico` + `fisioterapeuta` (ações clínicas: ver ficha de paciente, registar SOAP).
> - `isRececionista` — `admin` + `diretor_clinico` + `rececionista` (marcações, gestão admin de pacientes).

### `Ausencia`
Indisponibilidade (férias/folga) de um Staff num intervalo de datas. Todas as datas são **normalizadas para meia-noite UTC**.

| Campo           | Tipo     | Notas                                                              |
|-----------------|----------|--------------------------------------------------------------------|
| `utilizador_id` | ObjectId | `ref: 'Utilizador'`. Obrigatório, indexado.                        |
| `empresa_id`    | ObjectId | `ref: 'Empresa'`. Obrigatório, indexado.                           |
| `data_inicio`   | Date     | Obrigatório, indexado. Início do intervalo (inclusive, meia-noite UTC). |
| `data_fim`      | Date     | Obrigatório, indexado. Fim do intervalo (inclusive, meia-noite UTC). |
| `tipo`          | String   | `enum: ['ferias','folga']`, default `'folga'`. Obrigatório.        |
| `notas`         | String   | Opcional. Observações livres.                                      |
| `data`          | Date     | **Retrocompatibilidade** (v1.1.0). Preenchido automaticamente com `data_inicio` no `pre('save')`. Usado pelo webhook legacy. |
| `motivo`        | String   | **Legacy** (v1.1.0). Mantido para não partir registos antigos.    |

Índice único composto `{ utilizador_id, data_inicio }` → evita duplicar o mesmo início para o mesmo utilizador. A validação de **sobreposição de intervalos** é feita no controller (mensagem clara de 409).

> **v1.8.0:** o modelo passou de dia único (`data`) para intervalos (`data_inicio`/`data_fim`) com `tipo` e `notas`. A verificação de sobreposição de intervalos mantém a query `data` legacy para retrocompatibilidade.

### `Tarefa`
Tarefa de limpeza. **F0:** o campo `smoobu_reserva_id` foi removido. Será migrada para `Consulta` em F4.

| Campo                   | Tipo     | Notas                                                              |
|-------------------------|----------|--------------------------------------------------------------------|
| `empresa_id`            | ObjectId | Obrigatório, indexado.                                             |
| `propriedade_id`        | ObjectId | `ref: 'Propriedade'`. Obrigatório, indexado.                       |
| `utilizador_id`         | ObjectId | `ref: 'Utilizador'`, **default `null`** → tarefa por atribuir.     |
| `data`                  | Date     | Dia da tarefa (meia-noite UTC). Obrigatório, indexado.             |
| `tempo_limpeza_minutos` | Number   | Obrigatório, default `45`, `min: 0`. Unidade de carga.             |
| `tipo`                  | String   | `enum: ['limpeza','check_in','check_out','manutencao','outro']`.   |
| `estado`                | String   | `enum: ['por_atribuir','atribuida','em_curso','concluida','cancelada']`. |
| `observacoes`           | String   | Observações gerais (gestor/admin). Default `''`.                   |
| `observacoes_staff`     | String   | Observações do staff ao concluir (v1.34.0). Default `''`.          |
| `concluida_em`          | Date     | Data de conclusão (relatórios). Default `null`.                    |
| `hora_conclusao`        | Date     | Timestamp preciso de conclusão (v1.34.0, auditoria). Default `null`. |
| `avarias`               | [String] | Avarias reportadas pelo staff (v1.38.0). Default `[]`.             |
| `checklist`             | [String] | Snapshot da checklist da propriedade na criação (v1.55.0 / Prompt 77). Default `[]`. |
| `detalhes_reserva`      | Object   | **Prompt 92 (Fase 1.5)** — snapshot da reserva. Sub-campos: `checkin` (String), `checkout` (String), `pax` (Number), `nome_hospede` (String). |

> Nota: `empresa_id` é uma referência a `Empresa` (modelo criado na v1.2.0).

### `Paciente`
Paciente de uma clínica (empresa). **F2** — novo modelo do domínio Fisioterapia.

> **F2:** O `Paciente` é uma entidade **separada** do `Utilizador` — pacientes não fazem login (não têm JWT nem `password_hash`). Soft delete via `eliminado_em` para preservar histórico clínico (RGPD: direito ao esquecimento vs. integridade referencial de consultas/notas históricas). Os campos clínicos (`historico_medico`, `alergias`, `contacto_emergencia`) só são devolvidos a `isClinico` (admin/diretor_clinico/fisioterapeuta); a `rececionista` recebe uma versão sanitizada (ver `pacienteController.sanitizarParaNaoClinico`).

| Campo                   | Tipo     | Notas                                                              |
|-------------------------|----------|--------------------------------------------------------------------|
| `empresa_id`            | ObjectId | `ref: 'Empresa'`. Obrigatório, indexado.                           |
| `nome`                  | String   | Obrigatório, trim, indexado.                                       |
| `data_nascimento`       | Date     | Default `null`, indexado. Não pode ser futura (validado no controller). |
| `genero`                | String   | `enum: ['M','F','Outro','NA']`, default `'NA'`.                    |
| `num_utente`            | String   | Nº de Utente de Saúde (SNS). Default `''`, trim, indexado. Para futuras integrações com Saúde 24. |
| `nif`                   | String   | Default `''`, trim.                                                |
| `telefone`              | String   | Obrigatório, trim. Único contacto obrigatório.                    |
| `email`                 | String   | Default `''`, lowercase, trim.                                     |
| `morada`                | String   | Default `''`, trim.                                                |
| `contacto_emergencia`   | Object   | Sub-documento `{ nome, telefone, relacao }` (todos default `''`). **Dado clínico** — sanitizado para rececionista. |
| `historico_medico`      | String   | Default `''`. Histórico clínico relevante (patologias, medicação). **Dado clínico** — sanitizado para rececionista. |
| `alergias`              | [String] | Default `[]`. **Dado clínico** — sanitizado para rececionista.     |
| `consentimento_dados`   | Object   | Sub-documento RGPD (ver tabela abaixo).                            |
| `ativo`                 | Boolean  | Default `true`, indexado. `false` = paciente inativo (alta/férias clínicas) mas não eliminado. |
| `eliminado_em`          | Date     | Default `null`, indexado. **Soft delete** (RGPD: preserva histórico). |
| `observacoes`           | String   | Default `''`, trim. Notas administrativas livres.                  |
| `origem`                | String   | `enum: ['walk_in','referenciacao','online','outro']`, default `'walk_in'`. |

#### `consentimento_dados` (sub-documento) — F2

| Campo            | Tipo    | Notas                                                              |
|------------------|---------|--------------------------------------------------------------------|
| `concedido`      | Boolean | Default `false`. `true` = paciente consentiu o tratamento de dados. |
| `data`           | Date    | Default `null`. Preenchida com `new Date()` quando `concedido: true`. |
| `versao_termos`  | String  | Default `'1.0'`. Versão dos termos consentidos.                    |

**Índices compostos:**
- `{ empresa_id: 1, nome: 1 }` — listagem ordenada por nome.
- `{ empresa_id: 1, num_utente: 1 }` — procura por SNS.
- `{ empresa_id: 1, ativo: 1, eliminado_em: 1 }` — listagem de pacientes ativos (query mais frequente).

> **Permissões (F2):** o controller `pacienteController` exporta o helper `temAcessoClinico(req)` (true para admin/diretor_clinico/fisioterapeuta) e `sanitizarParaNaoClinico(p)` (remove `historico_medico`, `alergias` e `contacto_emergencia`). Todas as respostas incluem a flag `dados_clinicos: boolean` para o frontend saber se pode mostrar os campos clínicos. As rotas usam um middleware custom `podeVer` (todos os 4 roles) para GET/POST/PUT, `isRececionista` para `PATCH /:id/estado` e `isDiretorClinico` para `DELETE /:id` (soft delete).

### `HorarioFisioterapeuta`
Limites de agenda de cada fisioterapeuta. **F3** — novo modelo do domínio Fisioterapia, suporta dois tipos de regra:

- `tipo: 'recorrente'` — regra semanal (ex.: segundas 09:00–13:00, terças 14:00–19:00).
- `tipo: 'excecao'` — dia específico (ex.: "26/12 só manhã" ou "15/12 bloqueado por formação").

> **F3:** O modelo distingue-se do `dias_folga` (legacy em `Utilizador`, folga fixa semanal) por permitir definir janelas de trabalho em vez de apenas dia completo. Para um dia com manhã+tarde criam-se **dois** documentos `recorrente` com o mesmo `dia_semana` (ex.: 09:00–13:00 e 14:00–19:00). A coerência `tipo`/`dia_semana`/`data` é validada em `pre('validate')`. As exceções têm prioridade sobre a regra recorrente quando ambas existem no mesmo dia (ver `obterHorarioDia` em `utils/disponibilidade.js`).

| Campo                | Tipo     | Notas                                                              |
|----------------------|----------|--------------------------------------------------------------------|
| `empresa_id`         | ObjectId | `ref: 'Empresa'`. Obrigatório, indexado.                           |
| `fisioterapeuta_id`  | ObjectId | `ref: 'Utilizador'`. Obrigatório, indexado. Validado no controller como fisio/diretor_clinico ativo da empresa. |
| `tipo`               | String   | `enum: ['recorrente','excecao']`, default `'recorrente'`. Indexado. |
| `dia_semana`         | Number   | `min: 0, max: 6, default null`. 0=Dom…6=Sáb. **Obrigatório se `tipo='recorrente'`**; `null` se `tipo='excecao'` (forçado em `pre('validate')`). |
| `hora_inicio`        | String   | Default `'09:00'`. Formato `HH:mm` validado por regex `/^([01]\d|2[0-3]):([0-5]\d)$/`. Início da janela de trabalho. |
| `hora_fim`           | String   | Default `'19:00'`. Formato `HH:mm` (mesma regex). Fim da janela de trabalho. |
| `data`               | Date     | Default `null`. **Obrigatória se `tipo='excecao'`**; `null` se `tipo='recorrente'` (forçado em `pre('validate')`). |
| `disponivel`         | Boolean  | Default `true`. Só relevante para `tipo='excecao'`: `true` = horário extra disponível; `false` = bloqueio (formação, feriado, indisponibilidade pontual). |
| `ativo`              | Boolean  | Default `true`, indexado. Soft toggle: permite desativar uma regra sem a apagar (preserva histórico e facilita reativação). |
| `nota`               | String   | Default `''`, trim. Nota interna livre (ex.: "Formação em Pilates Clínico"). |

**Validação `pre('validate')`:**
- Se `tipo='recorrente'` → `dia_semana` obrigatório (0–6); `data` forçada a `null`.
- Se `tipo='excecao'` → `data` obrigatória; `dia_semana` forçada a `null`.

**Índices compostos:**
- `{ fisioterapeuta_id: 1, dia_semana: 1, ativo: 1 }` — lookup da regra recorrente de um fisio num dia da semana.
- `{ empresa_id: 1, fisioterapeuta_id: 1, tipo: 1 }` — listagens por fisioterapeuta filtradas por tipo.
- `{ fisioterapeuta_id: 1, data: 1 }` — procura de exceções de um fisio num dia específico.

> **Permissões (F3):** as routes (`routes/horarioRoutes.js`) usam um middleware custom `podeVer` (todos os 4 roles) para `GET /`, `GET /:id` e `GET /disponibilidade` — fisioterapeuta vê só os seus horários (filtro aplicado no controller), diretor_clinico/admin/rececionista vêem todos. As mutações (`POST`, `PUT`, `DELETE`) exigem `isDiretorClinico` (admin + diretor_clinico). O controller valida que `fisioterapeuta_id` corresponde a um utilizador com role `fisioterapeuta` ou `diretor_clinico` ativo (não eliminado) da mesma empresa. Auditoria registada em criar/atualizar/eliminar via `utils/auditoria.js` (`recurso: 'horario_fisioterapeuta'`).
>
> **Motor de disponibilidade:** este modelo é consultado pelo motor em `utils/disponibilidade.js` (funções `obterHorarioDia`, `verificarConflitoHorario`, `verificarDisponibilidadeCompleta` — ver secção 3.4).

---

## 3.2. Lógica central — Atribuição de tarefas

> **F0 — A integração Smoobu foi removida.** O motor de atribuição (load balancer) foi extraído para `utils/loadBalancer.js`. A lógica abaixo descreve o algoritmo que continua a ser usado pelos cron jobs (`caoGuarda`) e pela atribuição manual/reatribuição de tarefas. A criação automática de tarefas via webhook Smoobu foi descontinuada — na era Fisioterapia, as marcações de consultas serão criadas manualmente ou via motor de disponibilidade (F3–F4).

O motor de atribuição (`utils/loadBalancer.js`) implementa o seguinte fluxo **estrito** quando precisa de escolher um utilizador para uma tarefa/consulta:

1. **Procurar Fisioterapeutas** — lista todos os `Utilizador` elegíveis (`ativo: true`, `eliminado_em: null`) com `role: 'fisioterapeuta'` da empresa (F1: a role `staff` foi renomeada para `fisioterapeuta`; antes de v1.45.0 os gestores já não recebiam tarefas de limpeza).
2. **Filtro de Ausências + Folgas** — exclui os Staff que tenham uma `Ausencia` **aprovada** que cubra o dia (`data_inicio <= dia AND data_fim >= dia`) e os Staff cujo dia da semana esteja no seu `dias_folga` (folgas fixas semanais).
3. **Algoritmo VIP — Funcionário Preferencial (Prompt 93 / Fase 1.5)** — *antes* do load balancer geral, verifica se a propriedade tem `funcionario_preferencial_id`. Se tiver, e esse funcionário estiver **disponível** (passou os filtros de ausência + folga) e **dentro do SLA de 8h/dia** (`cargaLimpeza + tempoNovaTarefa ≤ CAPACIDADE_MAXIMA_MINUTOS` = 480 min), a tarefa é-lhe atribuída **obrigatoriamente**, ignorando o cálculo de distância/carga dos outros. Só se o preferencial não puder (folga/ausência/inativo ou excede o SLA) é que o sistema faz **fallback** para o load balancer geral.
4. **Cálculo de Carga + Tempo de Viagem (Load Balancing geral)** — para cada Staff disponível, soma `tempo_limpeza_minutos` das tarefas já atribuídas nesse dia (excluindo `cancelada`/`concluida`) + tempo de viagem (Haversine entre a última tarefa do dia e a nova propriedade) + tempo da nova tarefa. Se a `carga_total > 480 min` (SLA de 8h), o utilizador é excluído (v1.15.0).
5. **Atribuição** — a tarefa é atribuída ao Staff com **menor `carga_total`** (empate → primeiro encontrado).
6. **Sem disponíveis** — se não houver Staff disponível, a tarefa fica com `utilizador_id: null` e `estado: 'por_atribuir'`, para o gestor atribuir manualmente.
7. **Scheduler sequencial** — se a tarefa for atribuída, calcula a hora exata de início (11:00 por defeito; após a última tarefa do dia + viagem, com proteção de almoço 13h-14h).

### Regra de robustez
> A criação da Tarefa **nunca** é impedida por falhas na lógica de atribuição: se algo falhar ao determinar o utilizador, a tarefa é criada com `utilizador_id: null` e o erro é registado.

---

## 3.3. Cron Jobs (node-cron)

O backend tem três cron jobs diários, todos iniciados no arranque (`server.js`, dentro de `if (require.main === module)` — não correm nos testes):

| Job | Ficheiro | Agenda (cron) | Timezone | Descrição |
|-----|----------|---------------|----------|-----------|
| **Daily Briefing** | `jobs/dailyBriefing.js` | `0 8 * * *` | servidor (configurar `TZ=Europe/Lisbon` no Render) | 08:00 — envia via WhatsApp (mock) + push o plano de limpezas de **hoje** a cada staff. |
| **Cão de Guarda** (Prompt 96 + 98) | `jobs/caoGuarda.js` | `0 18 * * *` | `Europe/Lisbon` (opção nativa do node-cron) | 18:00 — **Fase A:** auto-atribui (load balancer) as tarefas órfãs de **amanhã** (Fail-Safe); **Fase B:** envia push por cada tarefa de limpeza de **hoje** ainda não concluída. |
| **Agenda de Amanhã** (Prompt 94) | `jobs/agendaAmanha.js` | `0 19 * * *` | `Europe/Lisbon` (opção nativa do node-cron) | 19:00 — envia push a cada staff com trabalho **amanhã**: `📅 Agenda de Amanhã: Tens X tarefa(s) agendada(s). Entra na app para ver o itinerário`. |

### Cão de Guarda (`jobs/caoGuarda.js`) — Prompt 96 + Prompt 98
Executa **duas fases** todos os dias às 18:00 (Europe/Lisbon):

**FASE A — Auto-Atribuição de Emergência (Fail-Safe, Prompt 98):** corre **antes** dos alertas.
1. Calcula o intervalo do dia **seguinte** (meia-noite UTC).
2. Procura todas as `Tarefa` com `data` nesse intervalo, `estado: 'por_atribuir'` e `utilizador_id: null` (órfãs), com populate de `propriedade_id` (nome + coordenadas).
3. Para cada tarefa órfã, invoca `determinarUtilizadorAtribuido` (load balancer: Algoritmo VIP + Haversine + SLA 8h) — o mesmo usado na auto-atribuição manual.
4. Se encontrar staff: recalcula a hora de início via scheduler sequencial (Haversine + almoço 13h-14h), atualiza a tarefa (`utilizador_id`, `estado: 'atribuida'`, nova `data`) e envia push `🧹 Nova Limpeza Atribuída` (fire-and-forget).
5. Se não houver staff disponível: mantém `por_atribuir` (órfã).
6. Devolve `{ encontradas, atribuidas, orfas }`.

> **Objetivo (Prompt 98):** garantir que o dia seguinte está sempre coberto **antes** do relógio das 19:00 (Agenda de Amanhã) correr. Assim, quando os funcionários recebem a notificação das 19:00, as escalas já estão 100% preenchidas. Complementa o Prompt 97 (desligar a histeria automática): as tarefas desatribuídas por ausências/falta súbita/baixa/desativação de propriedade são reatribuídas aqui de forma centralizada e controlada.

**FASE B — Alertas de Tarefas Incompletas (Prompt 96):** os alertas.
1. Calcula o intervalo do dia **atual** (meia-noite UTC).
2. Procura todas as `Tarefa` com `data` nesse intervalo, `tipo: 'limpeza'`, `utilizador_id` ≠ null e `estado` ∈ `{ atribuida, em_curso }` (atribuídas mas não concluídas), com populate de `propriedade_id` (nome) e `utilizador_id` (ativo, eliminado_em).
3. Para cada tarefa "esquecida", chama `notificarUtilizador(staffId, '⚠️ Tarefa Incompleta', 'Ainda não marcaste a limpeza da [nome da propriedade] como concluída. Por favor, atualiza a app!', '/staff')` (fire-and-forget; skip silencioso se não houver `pushSubscription` ou Web Push não configurado).
4. Ignora tarefas cujo staff foi entretanto desativado/eliminado.
5. Devolve `{ encontradas, notificadas }`.

> **Nota sobre estados:** o modelo `Tarefa` tem os estados `['por_atribuir','atribuida','em_curso','concluida','cancelada']`. Não existe `'pendente'` — o equivalente (atribuída mas ainda não iniciada) é `'atribuida'`. O prompt pede 'pendente' ou 'em_curso', pelo que o job usa `{ atribuida, em_curso }` (= atribuídas + não concluídas).
>
> **Uma push por tarefa (Fase B):** ao contrário do `Agenda de Amanhã` (que agrupa por staff), os alertas do Cão de Guarda enviam **uma push por tarefa esquecida** (a mensagem inclui o nome da propriedade, pelo que cada push é específica). Se um staff tiver 3 limpezas por concluir, recebe 3 pushes.

### Agenda de Amanhã (`jobs/agendaAmanha.js`) — Prompt 94
1. Calcula o intervalo do dia **seguinte** (meia-noite UTC).
2. Procura todas as `Tarefa` com `data` nesse intervalo e `estado` ∈ `{ atribuida, por_atribuir }`, com populate de `utilizador_id` (nome, ativo, eliminado_em).
3. Agrupa por `utilizador_id` — só interessam as atribuídas a staff **ativos** e não eliminados. Tarefas `por_atribuir` (sem utilizador) não têm destinatário → não geram push.
4. Para cada staff, chama `notificarUtilizador(staffId, '📅 Agenda de Amanhã', 'Tens X tarefa(s) agendada(s). Entra na app para ver o itinerário', '/staff')` (fire-and-forget; skip silencioso se não houver `pushSubscription` ou Web Push não configurado).
5. Devolve `{ processados, notificados, tarefas }` (estatísticas para testes/logs).

> **Timezone:** o `Cão de Guarda` e o `Agenda de Amanhã` usam a opção `timezone: 'Europe/Lisbon'` do node-cron, pelo que os horários são estáveis mesmo que o servidor esteja em UTC (caso do Render) — acompanham automaticamente as mudanças legais de horário de Verão/Inverno de Portugal. O `Daily Briefing` usa o fuso do servidor (definir `TZ=Europe/Lisbon` no ambiente para alinhar).

---

## 3.4. Motor de Disponibilidade — F3

O utilitário `utils/disponibilidade.js` implementa o motor de disponibilidade que valida se um fisioterapeuta pode receber uma consulta numa dada data/hora. É consultado por `horarioController.verificarDisponibilidade` (endpoint `GET /api/gestor/horarios/disponibilidade`) e será reutilizado em F4 pela marcação de `Consulta`.

### 3 camadas (verificadas por ordem de prioridade)

A função `verificarDisponibilidadeCompleta(utilizador, dataHoraInicio, duracaoMinutos)` percorre as 3 camadas por ordem e **falha cedo** (devolve `{ ok: false, motivo }` assim que uma camada bloqueia):

1. **Ausência aprovada** — `verificarDisponibilidadeUtilizador(utilizador_id, data)` consulta `Ausencia` com `estado: 'aprovada'` que cubra o dia (intervalo `[data_inicio, data_fim]` em data de calendário de Lisboa). A janela de pesquisa é alargada ±1 dia para tolerar diferenças de fuso (UTC midnight vs local midnight); a comparação final é feita em JS pela data de Lisboa (`dataLisboa(instante)` via `Intl.DateTimeFormat` com `timeZone: 'Europe/Lisbon'`). Se houver ausência → indisponível, com mensagem humanizada ("Férias de YYYY-MM-DD a YYYY-MM-DD." via `mensagemIndisponivel`).
2. **Folga fixa semanal** — verifica `utilizador.dias_folga` (array de 0–6, legado do `Utilizador`). Se o dia da semana (calculado em Lisboa) estiver no array → indisponível ("Folga fixa semanal (Terça)."). Esta camada mantém-se por retrocompatibilidade — a médio prazo será substituída por regras `HorarioFisioterapeuta` recorrentes.
3. **Horário de trabalho** — `verificarConflitoHorario(fisioterapeuta_id, dataHoraInicio, duracaoMinutos)` chama `obterHorarioDia` para descobrir a janela de trabalho do dia (ver abaixo) e depois valida se a consulta proposta (`dataHoraInicio` + `duracaoMinutos`) cabe dentro do bloco `[hora_inicio, hora_fim]` (comparações via `compararHoras(a, b)` que converte `HH:mm` para minutos). Se a consulta começar antes de `hora_inicio` ou acabar depois de `hora_fim` → conflito.

> **Nota F3:** a 4.ª camada (conflito com **consultas já marcadas**) será adicionada em F4 quando o modelo `Consulta` existir. Atualmente a verificação só cobre "o fisioterapeuta trabalha neste dia e a esta hora?" — não valida sobreposição com outras consultas.

### `obterHorarioDia(fisioterapeutaId, data)` — 3 sub-camadas por prioridade

A função `obterHorarioDia` consulta o modelo `HorarioFisioterapeuta` para um dia específico e devolve `{ disponivel, horario: { hora_inicio, hora_fim } | null, origem: 'excecao' | 'recorrente' | null, motivo? }`:

1. **Exceções do dia** (`tipo='excecao'` com `data` = dia, `ativo: true`):
   - Se houver uma exceção com `disponivel: false` (bloqueio) → `{ disponivel: false, origem: 'excecao', motivo: nota || 'Indisponível neste dia (exceção).' }`.
   - Se houver exceção com `disponivel: true` (horário extra) → usa essas horas (`origem: 'excecao'`). Primeira encontrada vence.
2. **Regra recorrente** (`tipo='recorrente'` com `dia_semana` = dia da semana em Lisboa, `ativo: true`):
   - Devolve as horas da regra (`origem: 'recorrente'`).
3. **Sem regra** → `{ disponivel: false, origem: null, motivo: 'Sem horário definido para este dia.' }` (o fisioterapeuta não trabalha nesse dia).

### Helpers de fuso e horas

- `dataLisboa(instante)` — devolve `"YYYY-MM-DD"` no fuso de Lisboa (via `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' })`). Robusto a horário de Verão/Inverno.
- `horaLisboa(instante)` — devolve `"HH:mm"` no fuso de Lisboa (via `Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour12: false })`).
- `compararHoras(a, b)` — compara duas strings `"HH:mm"` (devolve `-1/0/1`); converte para minutos totais.

> **Robustez de fuso (herdada do Prompt 113):** todas as comparações de data usam a **data de calendário de Lisboa** (não o instante UTC midnight). Isto garante que uma tarefa/consulta criada às 00:00 local (23:00Z do dia anterior em UTC) conta como "mesmo dia" para efeitos de ausências/horários — mesmo quando o `Ausencia.data_inicio` está armazenado em UTC midnight.

---

## 4. Scripts disponíveis

| Script       | Comando            | Descrição                                          |
|--------------|--------------------|----------------------------------------------------|
| `npm start`  | `node server.js`   | Arranca a API em modo produção                     |
| `npm run dev`| `nodemon server.js`| Arranca em modo desenvolvimento (auto-restart)     |
| `npm test`   | `jest`             | Corre os testes unitários/integração (Jest + Supertest) |

### Testes (v1.9.0)

Os testes usam **Jest** + **Supertest** e estão em `backend/tests/`.

- `tests/server.test.js` — testa o healthcheck `GET /` (status 200, mensagem, Content-Type) e rota inexistente (404).
- A instância `app` é exportada por `server.js` (`module.exports = app`) e o `app.listen` + `mongoose.connect` estão isolados dentro de `if (require.main === module)`. Isto permite que os testes importem a app **sem** iniciar o servidor HTTP nem ligar ao MongoDB (sem conflitos de portas nem dependência de BD).
- Configuração do Jest no `package.json` (`jest.testEnvironment: node`, `testMatch: **/tests/**/*.test.js`).
- Para correr: `cd backend && npm test`.

### Integração Contínua (CI) — GitHub Actions

O workflow `.github/workflows/ci.yml` corre em todos os `push` e `pull_request` nas branches `main` e `dev`, com 2 jobs paralelos em `ubuntu-latest` + Node.js 18:

1. **Frontend** — `npm ci` → `npm run lint` → `npx tsc --noEmit` → `npm run build` (na diretoria `frontend/`).
2. **Backend** — `npm ci` → `npm test` (na diretoria `backend/`).

---

## 5. Variáveis de ambiente

Definidas no ficheiro `.env` (a criar a partir de `.env.example`). **Nunca** fazer commit do `.env`.

| Variável        | Obrigatória | Descrição                                                        |
|-----------------|-------------|------------------------------------------------------------------|
| `MONGODB_URI`   | ✅ Sim       | URI de ligação ao MongoDB (local, Atlas ou add-on do Render)     |
| `PORT`          | ❌ Não        | Porta de escuta. Por defeito `5000`. No Render é injetada.       |
| `JWT_SECRET`    | ✅ Sim (prod)| Segredo para assinar/verificar JWT. Em dev tem fallback. **Gerar valor aleatório longo em produção.** |
| `JWT_EXPIRACAO` | ❌ Não        | Tempo de expiração do JWT (formato jsonwebtoken: `7d`, `12h`). Default `7d`. |

---

## 6. API — Endpoints

### `GET /`
Rota de verificação de estado (healthcheck).

**Resposta (200 OK):**
```json
{
  "status": "API do FisioCell online e ligada à BD!"
}
```

### 6.1. Painel de Administração (`/api/admin`)

> **Autenticação (v1.10.0 — ESTRITA):** o middleware `auth` é aplicado **dentro de `adminRoutes.js`** apenas às rotas que precisam de proteção (`/propriedades`, `/equipa`). A rota `/setup` é **PÚBLICA** de propósito (bootstrap).
> - O middleware valida o JWT do header `Authorization: Bearer <token>` e injeta `req.user = { id, role, empresa_id }`. O `empresa_id` é lido do token.
> - **Sem token (ou token inválido/expirado) → `401`** (strito, sem fallback).
> - v1.10.0: o fallback legacy `x-empresa-id` foi **REMOVIDO**. O frontend está 100% com JWT, pelo que qualquer pedido sem token válido é recusado.

#### `GET /api/admin/propriedades`
Devolve as propriedades da empresa (ordenadas por `nome`).

- **Auth:** JWT (strito, sem fallback legacy). **Protegido.**
- **Resposta (200 OK):**
```json
{
  "propriedades": [
    { "_id": "...", "nome": "Casa Teste", "empresa_id": "...", "tempo_limpeza_minutos": 60, "ativo": true, "createdAt": "...", "updatedAt": "..." }
  ]
}
```
- **Erros:** `400` empresa_id em falta/inválido; `401` não autenticado; `500` erro interno.

#### `POST /api/admin/propriedades`
Cria uma propriedade para a empresa.

- **Auth:** JWT (strito, sem fallback legacy).
- **Body:**
```json
{
  "nome": "Casa Teste",
  "tempo_limpeza_minutos": 60
}
```
  - `nome` (obrigatório).
  - `tempo_limpeza_minutos` (opcional, default `60`, tem de ser `>= 0`).
- **Resposta (201 Created):** `{ "propriedade": { ... } }`
- **Erros:** `400` campos em falta / `tempo_limpeza_minutos` inválido; `401` não autenticado; `500` erro interno.

#### `GET /api/admin/equipa`
Lista todos os utilizadores da empresa (qualquer role), ordenados por `nome`.

- **Auth:** JWT (strito, sem fallback legacy). **Protegido.**
- **Resposta (200 OK):**
```json
{
  "utilizadores": [
    { "_id": "...", "nome": "João Fisioterapeuta", "email": "joao.fisio@fisiocell.pt", "empresa_id": "...", "role": "fisioterapeuta", "ativo": true, "createdAt": "...", "updatedAt": "..." }
  ]
}
```
- **Nota:** a `password_hash` **nunca** é devolvida (`.select('-password_hash')`).
- **Erros:** `400` empresa_id em falta/inválido; `401` não autenticado; `500` erro interno.

#### `POST /api/admin/equipa`
Cria um novo membro de equipa (Utilizador) para a empresa.

- **Auth:** JWT (strito, sem fallback legacy). **Protegido.**
- **Body:**
```json
{
  "nome": "Maria Ferreira",
  "email": "maria.ferreira@fisiocell.pt",
  "password": "segredo123",
  "role": "fisioterapeuta"
}
```
  - `nome` (obrigatório).
  - `email` (obrigatório, único global, normalizado para lowercase).
  - `password` (obrigatória, mín. 6 caracteres — guardada como hash bcrypt, nunca em claro).
  - `role` (opcional, default `'rececionista'` no modelo; o controller `/api/admin/equipa` usa `'fisioterapeuta'` quando omitido; enum `['admin','diretor_clinico','fisioterapeuta','rececionista']`).
- **Resposta (201 Created):** `{ "utilizador": { ... } }` (sem `password_hash`).
- **Erros:** `400` campos em falta / password < 6 / role inválido; `401` não autenticado; `409` email duplicado; `500` erro interno.

#### `PUT /api/admin/equipa/:id`
Atualiza Nome, Email e/ou Role de um utilizador, e opcionalmente a password.

- **Auth:** JWT (strito, sem fallback legacy). **Protegido.**
- **Body (todos opcionais, mas pelo menos um):**
```json
{ "nome": "Maria Ferreira", "email": "maria@x.pt", "role": "diretor_clinico", "password": "novapass123" }
```
  - `password`: se vier, é guardada como **nova hash bcrypt** (mín. 6 chars). Se não vier, a atual é mantida.
- **Regras de segurança:**
  - O utilizador tem de pertencer à mesma empresa do JWT (`findOne({ _id, empresa_id })`).
  - Se o email mudar, verifica unicidade global.
  - Não desativa via este endpoint (usar `PATCH /:id/estado`).
- **Resposta (200 OK):** `{ "utilizador": { ... } }` (sem `password_hash`).
- **Erros:** `400` ID inválido / nada para atualizar / password < 6 / role inválido; `401` não autenticado; `404` não encontrado / não pertence à empresa; `409` email duplicado; `500` erro.

#### `PATCH /api/admin/equipa/:id/estado`
Alterna o estado `ativo` do utilizador (ativa ↔ desativa).

- **Auth:** JWT (strito, sem fallback legacy). **Protegido.**
- **Body (opcional):** `{ "ativo": true }` — se não vier, alterna o estado atual.
- **Resposta (200 OK):** `{ "utilizador": { ... }, "ativo": boolean }`.
- **Comportamento:** um utilizador desativado **não consegue fazer login** (ver `authController.login` → 401 "Utilizador inativo").
- **Erros:** `400` ID inválido; `401` não autenticado; `404` não encontrado; `500` erro.

#### `DELETE /api/admin/equipa/:id`
Remove permanentemente o utilizador da base de dados.

- **Auth:** JWT (strito, sem fallback legacy). **Protegido.**
- **Regras de segurança:**
  - O utilizador tem de pertencer à mesma empresa do JWT.
  - **Não é possível eliminar-se a si próprio** (`req.user.id === id` → 400) — evita o admin ficar sem acesso.
- **Resposta (200 OK):** `{ "mensagem": "Utilizador \"X\" eliminado com sucesso.", "utilizador_id": "..." }`.
- **Erros:** `400` ID inválido / tentativa de auto-eliminação; `401` não autenticado; `404` não encontrado; `500` erro.

#### `GET /api/admin/setup`  *(PÚBLICO — sem auth)*
**Bootstrap do “Cliente Zero”** — cria dados iniciais para testes (idempotente):

- 1 **Empresa** «Clínica FisioCell Teste» (procura por `nome`).
- 3 **Utilizadores** (procura por `email` único), cada um com `password_hash` bcrypt:
  - `admin@fisiocell.pt` (admin — Super Admin da plataforma)
  - `gestor@fisiocell.pt` (diretor_clinico — acesso total à clínica)
  - `joao.fisio@fisiocell.pt` (fisioterapeuta — vê só os seus pacientes/consultas)
- 1 **Propriedade** «Casa Teste».

> **F1:** O `setupClienteZero` foi atualizado para os novos roles (`admin`/`diretor_clinico`/`fisioterapeuta`). O email `gestor@fisiocell.pt` é mantido por compatibilidade (a string do email não muda; só a role).

- **Resposta (200 OK):**
```json
{
  "mensagem": "Cliente Zero criado com sucesso.",
  "empresa_id": "<ObjectId>",
  "empresa":  { "id": "...", "nome": "Clínica FisioCell Teste", "plano_ativo": true, "criada": true },
  "utilizadores": [
    { "id": "...", "nome": "Diretor FisioCell", "email": "admin@fisiocell.pt", "role": "admin", "criado": true, "password_definida": true, "credenciais_teste": { "email": "admin@fisiocell.pt", "password": "fisiocell123" } },
    { "id": "...", "nome": "Responsável Clínico", "email": "gestor@fisiocell.pt", "role": "diretor_clinico", "criado": true, "password_definida": true, "credenciais_teste": { "email": "gestor@fisiocell.pt", "password": "fisiocell123" } },
    { "id": "...", "nome": "João Fisioterapeuta", "email": "joao.fisio@fisiocell.pt", "role": "fisioterapeuta", "criado": true, "password_definida": true, "credenciais_teste": { "email": "joao.fisio@fisiocell.pt", "password": "fisiocell123" } }
  ],
  "propriedade": { "id": "...", "nome": "Casa Teste", "criada": true }
}
```
- Se já existir tudo, devolve `mensagem: "Cliente Zero já existia (nada foi alterado)."` com `criada/criado: false`.
- **Retrocompatibilidade:** se um utilizador já existir sem `password_hash` (criado antes do auth), o setup define-lhe a password e garante o role correto.
- **Credenciais de teste (3 contas):** `admin@fisiocell.pt` (admin), `gestor@fisiocell.pt` (diretor_clinico), `joao.fisio@fisiocell.pt` (fisioterapeuta) — todas com password `fisiocell123` (remover em produção).

### 6.2. Autenticação (`/api/auth`)

#### `POST /api/auth/login` (público)
Login com email + password. Valida a hash bcrypt e devolve um JWT.

- **Body:**
```json
{ "email": "joao.fisio@fisiocell.pt", "password": "fisiocell123" }
```
- **Resposta (200 OK):**
```json
{
  "token": "<jwt>",
  "utilizador": {
    "id": "...",
    "nome": "João Fisioterapeuta",
    "email": "joao.fisio@fisiocell.pt",
    "role": "fisioterapeuta",
    "empresa_id": "..."
  }
}
```
- **JWT payload:** `{ id, role, empresa_id }` assinado com `JWT_SECRET`, expira em `JWT_EXPIRACAO` (default `7d`).
- **Erros:** `400` email/password em falta; `401` credenciais inválidas / utilizador inativo / sem password definida; `429` muitas tentativas de login (rate limit); `500` erro interno.
- **Rate limiting (v1.11.0):** a rota de login está protegida por `express-rate-limit` — máximo de **5 tentativas por IP a cada 15 minutos**. Ultrapassado o limite → `429` com `{ "erro": "Muitas tentativas de login. Tente novamente mais tarde." }`. Mitiga ataques de força bruta e credential stuffing. Headers `RateLimit-*` (standard) são enviados na resposta para o cliente saber quando pode tentar novamente.

#### `GET /api/auth/me` (requer JWT)
Devolve os dados do utilizador autenticado (a partir do token).

- **Header:** `Authorization: Bearer <token>`
- **Resposta (200 OK):** `{ "utilizador": { id, nome, email, role, empresa_id } }`
- **Erros:** `401` não autenticado / token inválido; `404` utilizador não encontrado; `500` erro interno.

### 6.3. Ausências — Folgas e Férias (`/api/admin/ausencias`)

> **Auth:** JWT (strito, sem fallback legacy). Todas as rotas **protegidas** por `auth`.

#### `GET /api/admin/ausencias`
Lista as ausências da empresa, com o utilizador populado.

- **Query param opcional:** `?futuras=true` — só ausências com `data_fim >= hoje` (úteis para o calendário).
- **Resposta (200 OK):**
```json
{
  "ausencias": [
    {
      "_id": "...",
      "utilizador_id": "...",
      "utilizador": { "_id": "...", "nome": "João Fisioterapeuta", "email": "...", "role": "fisioterapeuta" },
      "empresa_id": "...",
      "data_inicio": "2024-07-15T00:00:00.000Z",
      "data_fim": "2024-07-20T00:00:00.000Z",
      "tipo": "ferias",
      "notas": "férias pagas"
    }
  ]
}
```

#### `POST /api/admin/ausencias`
Regista uma nova ausência (folga ou férias).

- **Body:**
```json
{
  "utilizador_id": "...",
  "data_inicio": "2024-07-15",
  "data_fim": "2024-07-20",
  "tipo": "ferias",
  "notas": "férias pagas"
}
```
  - `utilizador_id` (obrigatório) — tem de ser fisioterapeuta/diretor_clinico da empresa (não admin).
  - `data_inicio` / `data_fim` (obrigatórias) — `data_fim >= data_inicio`.
  - `tipo` (opcional, default `'folga'`) — `enum: ['ferias','folga']`.
  - `notas` (opcional).
- **Validações:**
  - Utilizador existe e pertence à empresa com role fisioterapeuta/diretor_clinico.
  - **Sem sobreposição** com outra ausência do mesmo utilizador (409 se houver).
- **Resposta (201 Created):** `{ "ausencia": { ... } }` (com utilizador populado).
- **Erros:** `400` campos em falta / datas inválidas / utilizador não encontrado; `409` sobreposição; `500` erro.

#### `DELETE /api/admin/ausencias/:id`
Elimina uma ausência.

- **Regras:** a ausência tem de pertencer à empresa do JWT.
- **Resposta (200 OK):** `{ "mensagem": "Ausência eliminada com sucesso.", "ausencia_id": "..." }`.
- **Erros:** `400` ID inválido; `404` não encontrada; `500` erro.

> **Integração com o motor de atribuição (load balancer):** as ausências registadas aqui são consultadas automaticamente pelo `utils/loadBalancer.js` (passo 2 do fluxo de atribuição) para excluir fisioterapeutas indisponíveis da atribuição automática de tarefas.

---

### 6.4. Relatórios / Analytics (`/api/admin/relatorios`)

*Protegido por JWT (middleware `auth`).*

#### `GET /api/admin/relatorios/produtividade`

Métricas de produtividade da empresa num intervalo de datas.

**Query params (opcionais):**
- `inicio` (`yyyy-mm-dd` | ISO) — início do período. Default: há 30 dias.
- `fim` (`yyyy-mm-dd` | ISO) — fim do período (inclusive). Default: hoje.

**Resposta 200:**
```json
{
  "periodo": { "inicio": "...", "fim": "..." },
  "resumo": {
    "totalTarefas": 100,
    "concluidas": 80,
    "taxaConclusao": 0.8,
    "emAtraso": 5,
    "taxaAtraso": 0.05,
    "cargaTotalMinutos": 6000,
    "tempoMedioMinutos": 75
  },
  "porStaff": [{ "utilizador_id", "nome", "total", "concluidas", "carga_minutos", "taxaConclusao" }],
  "porDia": [{ "data": "yyyy-mm-dd", "total", "concluidas", "carga_minutos" }],
  "porEstado": [{ "estado", "total" }],
  "porPropriedade": [{ "propriedade_id", "nome", "total", "carga_minutos" }]
}
```

> **"emAtraso"** = tarefas não concluídas nem canceladas cuja `data` já passou (proxy operacional de atraso — não há campo dedicado no modelo). **"tempoMedioMinutos"** = média de `tempo_limpeza_minutos` das concluídas.

---

### 6.5–6.9. ⚠️ F0 — Removidos

> As secções 6.5–6.9 documentavam os endpoints de webhooks e sincronização Smoobu (`POST /webhooks/smoobu`, `GET/POST /api/admin/webhooks`, `POST /api/admin/smoobu/sincronizar`, `GET /api/admin/smoobu/propriedades`, `POST /api/admin/smoobu/sincronizar-propriedades`). Foram **removidos em F0** juntamente com `controllers/smoobuController.js`, `controllers/webhookController.js` e `routes/webhookRoutes.js`. A variável de ambiente `SMOOBU_API_KEY` deixou de ser necessária.

---

### 6.10. Calendário Visual Avançado — v1.23.0

*Protegido por JWT (middleware `auth`).*

#### `GET /api/admin/calendario/dados`

Endpoint unificado para alimentar a página de Calendário Visual Avançado. Devolve as tarefas da empresa num intervalo de datas, com filtros opcionais e populate de propriedade (nome + morada + coordenadas) e utilizador (nome).

**Query params:**
| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `inicio` | yyyy-mm-dd \| ISO | Início do período |
| `fim` | yyyy-mm-dd \| ISO | Fim do período (inclusive) |
| `propriedadeId` | ObjectId | Filtra por propriedade (opcional) |
| `utilizadorId` | ObjectId \| `null` | Filtra por funcionário; `null` = tarefas por atribuir (opcional) |
| `estado` | string | `por_atribuir` \| `atribuida` \| `em_curso` \| `concluida` \| `cancelada` (opcional) |

**Diferença para o `GET /api/admin/tarefas`:**
- Não exclui canceladas por defeito (o calendário pode mostrá-las a tracejado). Use `?estado=atribuida` para excluir.
- Aceita filtros opcionais por `propriedadeId`, `utilizadorId` e `estado`.
- Populate inclui `morada` e `coordenadas` da propriedade (para tooltip e futuro mapa de rotas).

**Resposta 200:** `{ tarefas: [...] }` (cada tarefa tem `propriedade_id: { nome, morada, coordenadas }` e `utilizador_id: { nome } | null`)

**Erros:** `401` (sem token), `500` (erro interno).

---

### 6.11. Fluxo de aprovação de ausências — v1.24.0

#### Modelo `Ausencia` (campos novos)

| Campo | Tipo | Valores | Default |
|-------|------|---------|---------|
| `estado` | String | `pendente` \| `aprovada` \| `rejeitada` | `pendente` |
| `tipo` | String | `ferias` \| `doenca` \| `outro` | `ferias` |

> O enum do `tipo` mudou de `['ferias','folga']` para `['ferias','doenca','outro']`. As "folgas" fixas semanais continuam no campo `dias_folga` do Utilizador.

#### Endpoints do Staff (`/api/staff/ausencias`)

*Protegido por JWT. O staff só gere as SUAS ausências.*

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET`  | `/api/staff/ausencias` | Histórico de ausências do próprio utilizador |
| `POST` | `/api/staff/ausencias` | Criar pedido de ausência (sempre `estado: 'pendente'`) |

**POST Body:** `{ data_inicio, data_fim, tipo?, notas? }`

O staff **não pode aprovar** os próprios pedidos — só o admin.

#### Endpoint de Aprovação (Admin)

`PATCH /api/admin/ausencias/:id/estado` — aprovar ou rejeitar um pedido do staff.

**Body:** `{ estado: 'aprovada' | 'rejeitada' }`

**Lógica crítica:**
- **Aprovar** → redistribui automaticamente as tarefas futuras do utilizador no período `[data_inicio, data_fim]` usando o load balancer (`determinarUtilizadorAtribuido`). Tarefas com staff disponível são reatribuídas; as sem staff disponível ficam `por_atribuir`.
- **Rejeitar** → apenas atualiza o estado (não mexe nas tarefas).

**Resposta 200:**
```json
{
  "mensagem": "Ausência aprovada. 2 tarefa(s) reatribuída(s), 0 órfã(s).",
  "ausencia": { ... },
  "redistribuicao": { "total": 2, "reatribuidas": 2, "orfas": 0, "detalhes": [...] }
}
```

#### Impacto no motor de atribuição (load balancer)

O load balancer (`utils/loadBalancer.js`) e a reatribuição de tarefas agora só consideram ausências com `estado: 'aprovada'` para excluir staff da atribuição. Pedidos pendentes ou rejeitados **não bloqueiam** a atribuição (o staff pode ainda trabalhar).

#### Ações do admin que criam ausências

As ações diretas do admin (falta súbita, baixa prolongada, registo manual) criam ausências com `estado: 'aprovada'` (não precisam de aprovação — o admin já decidiu).

---

### 6.12. Pacientes (`/api/gestor/pacientes`) — F2

> **Auth:** JWT (strito, sem fallback legacy). Todas as rotas protegidas por `auth` (em `pacienteRoutes.js`).
>
> **Permissões (F2):**
> - `podeVer` (middleware custom) — todos os 4 roles (`admin`, `diretor_clinico`, `fisioterapeuta`, `rececionista`) podem aceder a GET (listar/obter), POST (criar) e PUT (atualizar). Como o Express não tem middleware "OR" nativo entre `isClinico` e `isRececionista`, define-se um `podeVer` inline que valida `req.user.role` contra o conjunto dos 4 roles.
> - `isRececionista` (admin + diretor_clinico + rececionista) — `PATCH /:id/estado` (alternar ativo). O fisioterapeuta **não** pode alterar o estado do paciente.
> - `isDiretorClinico` (admin + diretor_clinico) — `DELETE /:id` (soft delete). Só o diretor clínico/admin podem eliminar pacientes (RGPD).
>
> **Sanitização de dados clínicos:** o controller `pacienteController` decide consoante a role quais os campos a devolver:
> - `temAcessoClinico(req)` → `true` para admin/diretor_clinico/fisioterapeuta → devolve `historico_medico`, `alergias` e `contacto_emergencia`.
> - Rececionista → `sanitizarParaNaoClinico(p)` remove esses 3 campos da resposta.
> - Todas as respostas incluem a flag `dados_clinicos: boolean` para o frontend saber se pode mostrar os campos clínicos.
>
> **Nota F2:** o filtro "fisioterapeuta vê só os seus pacientes" será implementado em F4 (Consulta com `paciente_id` + `fisioterapeuta_id`). Por agora, todos os clínicos vêem todos os pacientes ativos da empresa.

#### `GET /api/gestor/pacientes`
Lista pacientes da empresa do utilizador autenticado (exclui soft-deleted).

- **Auth:** JWT + `podeVer` (4 roles).
- **Query params (opcionais):**
  - `busca` — filtra por `nome`, `num_utente`, `telefone` ou `email` (regex case-insensitive, com escape de caracteres especiais para evitar injeção).
  - `ativo` — `'true'`/`'false'` filtra por `ativo`.
  - `limit` — default `200`, máx `500`.
- **Resposta (200 OK):**
```json
{
  "pacientes": [ { "_id": "...", "nome": "...", "telefone": "...", "ativo": true, ... } ],
  "total": 42,
  "dados_clinicos": true
}
```
  - `dados_clinicos: true` para isClinico (resposta com `historico_medico`/`alergias`/`contacto_emergencia`); `false` para rececionista (versão sanitizada).
- **Erros:** `401` não autenticado; `403` role sem permissão; `500` erro interno.

#### `GET /api/gestor/pacientes/:id`
Devolve o detalhe de um paciente.

- **Auth:** JWT + `podeVer` (4 roles).
- **Resposta (200 OK):** `{ "paciente": { ... }, "dados_clinicos": boolean }`.
- **Erros:** `400` ID inválido; `401` não autenticado; `404` não encontrado / não pertence à empresa / eliminado; `500` erro.

#### `POST /api/gestor/pacientes`
Cria um novo paciente na empresa do utilizador autenticado.

- **Auth:** JWT + `podeVer` (4 roles).
- **Body:**
```json
{
  "nome": "Ana Silva",
  "telefone": "912345678",
  "data_nascimento": "1990-05-12",
  "genero": "F",
  "num_utente": "123456789",
  "nif": "123456789",
  "email": "ana.silva@email.pt",
  "morada": "Rua das Flores, 12, Lisboa",
  "contacto_emergencia": { "nome": "Rui Silva", "telefone": "913000000", "relacao": "Cônjuge" },
  "historico_medico": "Lombalgia crónica (2022).",
  "alergias": ["Penicilina", "Látex"],
  "consentimento_dados": { "concedido": true, "versao_termos": "1.0" },
  "observacoes": "Prefere consultas matinais.",
  "origem": "walk_in"
}
```
  - `nome` (obrigatório), `telefone` (obrigatório).
  - `genero` — `enum: ['M','F','Outro','NA']`.
  - `origem` — `enum: ['walk_in','referenciacao','online','outro']`.
  - `data_nascimento` — não pode ser futura.
  - **Campos clínicos** (`contacto_emergencia`, `historico_medico`, `alergias`) — só `isClinico` os pode definir; se a rececionista os enviar, são **ignorados**.
- **Resposta (201 Created):** `{ "paciente": { ... }, "dados_clinicos": boolean }` (sanitizada para rececionista).
- **Auditoria:** registada via `utils/auditoria.js` (`acao: 'criar'`, `recurso: 'paciente'`).
- **Erros:** `400` campos em falta / enums inválidos / `data_nascimento` futura; `401` não autenticado; `500` erro.

#### `PUT /api/gestor/pacientes/:id`
Atualiza um paciente existente.

- **Auth:** JWT + `podeVer` (4 roles).
- **Body (todos opcionais, mas pelo menos um):** qualquer campo do modelo exceto `empresa_id`. `ativo` também pode ser alternado aqui (além do `PATCH /:id/estado`).
  - **Regras:** `nome` e `telefone` não podem ficar vazios. `data_nascimento` não pode ser futura. `genero` e `origem` validados contra os enums.
  - **Campos clínicos** — só `isClinico` os pode editar; se a rececionista os enviar, são **ignorados**.
- **Resposta (200 OK):** `{ "paciente": { ... }, "dados_clinicos": boolean }` (sanitizada para rececionista).
- **Auditoria:** registada (`acao: 'atualizar'`).
- **Erros:** `400` ID inválido / campos vazios / enums inválidos; `401` não autenticado; `404` não encontrado; `500` erro.

#### `PATCH /api/gestor/pacientes/:id/estado`
Alterna o estado `ativo` do paciente (ativa ↔ desativa). Útil para pacientes que receberam alta mas podem voltar.

- **Auth:** JWT + `isRececionista` (admin + diretor_clinico + rececionista). O fisioterapeuta **não** tem acesso.
- **Body (opcional):** `{ "ativo": true }` — se não vier, alterna o estado atual.
- **Resposta (200 OK):** `{ "message": "Paciente ativado." | "Paciente desativado.", "paciente": { "_id", "nome", "ativo" } }`.
- **Erros:** `400` ID inválido; `401` não autenticado; `403` role sem permissão; `404` não encontrado; `500` erro.

#### `DELETE /api/gestor/pacientes/:id` (soft delete)
**Soft delete** do paciente — marca `eliminado_em = now()` e `ativo = false` (RGPD: preserva histórico).

- **Auth:** JWT + `isDiretorClinico` (admin + diretor_clinico). Só o diretor clínico/admin podem eliminar pacientes.
- **Resposta (200 OK):** `{ "message": "Paciente \"X\" eliminado.", "paciente": { "_id", "eliminado_em" } }`.
- **Auditoria:** registada (`acao: 'soft-delete'`).
- **Erros:** `400` ID inválido; `401` não autenticado; `403` role sem permissão; `404` não encontrado; `500` erro.

---

### 6.13. Horários de Fisioterapeuta (`/api/gestor/horarios`) — F3

> **Auth:** JWT (strito, sem fallback legacy). Todas as rotas protegidas por `auth` (em `horarioRoutes.js`).
>
> **Permissões (F3):**
> - `podeVer` (middleware custom) — todos os 4 roles (`admin`, `diretor_clinico`, `fisioterapeuta`, `rececionista`) podem aceder a `GET /` (listar), `GET /:id` (detalhe) e `GET /disponibilidade` (verificador). Como o Express não tem middleware "OR" nativo entre `isClinico` e `isRececionista`, define-se um `podeVer` inline que valida `req.user.role` contra o conjunto dos 4 roles. O fisioterapeuta vê apenas os seus próprios horários (filtro `fisioterapeuta_id = req.user.id` aplicado no controller); os restantes roles vêem todos os horários da empresa.
> - `isDiretorClinico` (admin + diretor_clinico) — `POST`, `PUT`, `DELETE` (mutações). Só o diretor clínico/admin gerem horários; o fisioterapeuta não pode criar/editar/eliminar horários (nem os seus).
>
> **Validação do fisioterapeuta:** em `POST` e no verificador de disponibilidade, o controller valida que `fisioterapeuta_id` corresponde a um utilizador com role `fisioterapeuta` ou `diretor_clinico`, `ativo: true`, `eliminado_em: null` e pertencente à mesma empresa. Isto permite definir horários tanto para fisioterapeutas como para diretores clínicos que também atendem pacientes.
>
> **Auditoria:** todas as mutações (`POST`/`PUT`/`DELETE`) registam em `utils/auditoria.js` (`recurso: 'horario_fisioterapeuta'`, `acao: 'criar' | 'atualizar' | 'eliminar'`).

#### `GET /api/gestor/horarios`
Lista horários de fisioterapeutas da empresa.

- **Auth:** JWT + `podeVer` (4 roles). Fisioterapeuta vê só os seus.
- **Query params (opcionais):**
  - `fisioterapeuta_id` — filtra por fisioterapeuta (ignorado se o `req.user.role === 'fisioterapeuta'`, que vê só os seus).
  - `tipo` — `'recorrente'` ou `'excecao'`.
  - `ativo` — `'true'`/`'false'` filtra por `ativo`.
- **Ordenação:** `fisioterapeuta_id`, `tipo`, `dia_semana`, `data` (asc).
- **Populate:** `fisioterapeuta_id` → `{ nome, email, role }`.
- **Resposta (200 OK):**
```json
{
  "horarios": [
    {
      "_id": "...",
      "empresa_id": "...",
      "fisioterapeuta_id": { "_id": "...", "nome": "João Fisioterapeuta", "email": "joao.fisio@fisiocell.pt", "role": "fisioterapeuta" },
      "tipo": "recorrente",
      "dia_semana": 1,
      "hora_inicio": "09:00",
      "hora_fim": "13:00",
      "data": null,
      "disponivel": true,
      "ativo": true,
      "nota": "",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 7
}
```
- **Erros:** `401` não autenticado; `403` role sem permissão; `500` erro interno.

#### `GET /api/gestor/horarios/disponibilidade`
Verifica se um fisioterapeuta está disponível para uma consulta numa dada data/hora. Não invoca `verificarDisponibilidadeCompleta` (que exige o documento `Utilizador` completo) — usa diretamente `obterHorarioDia` + `verificarConflitoHorario`. **Nota:** esta rota está registada **antes** de `GET /:id` para não ser apanhada como path param.

- **Auth:** JWT + `podeVer` (4 roles). Útil sobretudo para rececionista marcar consultas.
- **Query params (obrigatórios):**
  - `fisioterapeuta_id` — ObjectId do fisioterapeuta.
  - `data` — ISO string (instante de início da consulta).
- **Query params (opcionais):**
  - `duracao_minutos` — default `45`. Duração prevista da consulta.
- **Resposta (200 OK):**
```json
{
  "disponivel": true,
  "horario": { "hora_inicio": "09:00", "hora_fim": "13:00" },
  "motivo": null,
  "origem": "recorrente"
}
```
  - `disponivel: false` com `motivo` explicativo quando o fisioterapeuta não trabalha nesse dia (sem regra), está bloqueado por exceção (`disponivel: false`), ou a consulta não cabe dentro do bloco de trabalho (começa antes de `hora_inicio` ou acaba depois de `hora_fim`).
  - `origem` — `'excecao'` (janela extra do dia), `'recorrente'` (regra semanal) ou `null` (sem horário definido).
- **Erros:** `400` `fisioterapeuta_id`/`data` em falta ou `data` inválida; `401` não autenticado; `404` fisioterapeuta não encontrado; `500` erro.

#### `GET /api/gestor/horarios/:id`
Devolve o detalhe de um horário.

- **Auth:** JWT + `podeVer` (4 roles). Fisioterapeuta só vê os seus (403 caso contrário).
- **Resposta (200 OK):** `{ "horario": { ... } }` (com `fisioterapeuta_id` populado).
- **Erros:** `400` ID inválido; `401` não autenticado; `403` fisioterapeuta a tentar ver horário de outro; `404` não encontrado / não pertence à empresa; `500` erro.

#### `POST /api/gestor/horarios`
Cria um novo horário (recorrente ou exceção).

- **Auth:** JWT + `isDiretorClinico` (admin + diretor_clinico).
- **Body:**
```json
{
  "fisioterapeuta_id": "65f...",
  "tipo": "recorrente",
  "dia_semana": 1,
  "hora_inicio": "09:00",
  "hora_fim": "13:00",
  "nota": "Manhãs de segunda"
}
```
  - `fisioterapeuta_id` (obrigatório).
  - `tipo` — `'recorrente'` (default) ou `'excecao'`.
  - `dia_semana` — 0–6, **obrigatório se `tipo='recorrente'`**.
  - `hora_inicio` / `hora_fim` — default `'09:00'`/`'19:00'`, formato `HH:mm`.
  - `data` — **obrigatória se `tipo='excecao'`** (ISO string).
  - `disponivel` — boolean, default `true` (só relevante para `excecao`).
  - `nota` — string, default `''`.
  - `ativo` — boolean, default `true`.
- **Validações:**
  - `fisioterapeuta_id` tem de ser fisioterapeuta/diretor_clinico ativo (não eliminado) da mesma empresa.
  - `hora_inicio`/`hora_fim` validados por regex `/^([01]\d|2[0-3]):([0-5]\d)$/`.
  - `tipo='recorrente'` exige `dia_semana` inteiro 0–6; `data` é rejeitada (forçada a `null` pelo `pre('validate')`).
  - `tipo='excecao'` exige `data` válida; `dia_semana` é rejeitado (forçado a `null`).
- **Resposta (201 Created):** `{ "horario": { ... } }`.
- **Auditoria:** registada (`acao: 'criar'`).
- **Erros:** `400` campos em falta / `tipo` inválido / `dia_semana` fora de 0–6 / `data` inválida / `hora_inicio`/`hora_fim` mal formatados / fisioterapeuta não encontrado / `ValidationError` do `pre('validate')`; `401` não autenticado; `403` role sem permissão; `500` erro.

#### `PUT /api/gestor/horarios/:id`
Atualiza um horário existente.

- **Auth:** JWT + `isDiretorClinico` (admin + diretor_clinico).
- **Body (todos opcionais, mas pelo menos um):** `dia_semana`, `hora_inicio`, `hora_fim`, `data`, `disponivel`, `nota`, `ativo`. Pode enviar `null` para limpar `dia_semana`/`data`.
- **Regras:** `hora_inicio`/`hora_fim` validadas por regex; `dia_semana` inteiro 0–6 (ou `null`); `data` válida (ou `null`).
- **Resposta (200 OK):** `{ "horario": { ... } }`.
- **Auditoria:** registada (`acao: 'atualizar'`).
- **Erros:** `400` ID inválido / `hora_inicio`/`hora_fim` inválidas / `dia_semana`/`data` inválidas; `401` não autenticado; `403` role sem permissão; `404` não encontrado; `500` erro.

#### `DELETE /api/gestor/horarios/:id`
**Hard delete** do horário (ao contrário do `Paciente`, os horários não usam soft delete — não há necessidade de preservar histórico de regras de agenda).

- **Auth:** JWT + `isDiretorClinico` (admin + diretor_clinico).
- **Resposta (200 OK):** `{ "message": "Horário eliminado." }`.
- **Auditoria:** registada (`acao: 'eliminar'`).
- **Erros:** `400` ID inválido; `401` não autenticado; `403` role sem permissão; `404` não encontrado; `500` erro.

---

## 7. Deploy no Render

| Definição        | Valor                        |
|------------------|------------------------------|
| Root Directory   | `backend`                    |
| Build Command    | `npm install`                |
| Start Command    | `npm start`                  |
| Environment Vars | `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRACAO` (e `PORT` opcional) |

> O Render injeta automaticamente a variável `PORT`. A aplicação lê essa variável, pelo que não é necessário defini-la manualmente.

---

## 8. Regras e convenções do projeto

- **Branch de desenvolvimento:** `dev` (todos os commits de funcionalidades vão para aqui).
- **Documentação:** sempre que o código do backend é alterado, este ficheiro (`docs/BACKEND.md`) e o `README.md` da raiz devem ser atualizados.
- **Segredos:** nenhum segredo (URIs com credenciais, tokens, etc.) deve ser commitado. Usar sempre `.env` localmente e as variáveis de ambiente do Render em produção.
- **Linguagem:** os comentários de código e a documentação são redigidos em **pt-pt**.

---

## 9. Histórico de alterações (backend)

> ⚠️ **F0 + F1 — Notas históricas:**
> - **F0:** As entradas abaixo anteriores a F0 descrevem a era Alojamento Local. Referências a Smoobu/webhooks/sincronização correspondem a funcionalidade **removida em F0**.
> - **F1:** As entradas entre F0 e F1 referem-se aos roles antigos `admin`/`manager`/`staff`/`gestor` e ao middleware legacy `isGestor`/`requireStaff`/`requireManager`/`requireAdmin` — todos **substituídos em F1** pelos roles `admin`/`diretor_clinico`/`fisioterapeuta`/`rececionista` e pelos middlewares `isAdmin`/`isDiretorClinico`/`isClinico`/`isRececionista` (ver `middleware/requireRole.js`).
> - O histórico completo (incluindo commits Smoobu) está preservado no `git log`.

| Data       | Versão | Alteração                                                            |
|------------|--------|----------------------------------------------------------------------|
| **F3**     | —      | **Horários de Fisioterapeuta + motor de disponibilidade:** (1) Novo modelo `models/HorarioFisioterapeuta.js` — `empresa_id`, `fisioterapeuta_id`, `tipo` (`enum ['recorrente','excecao']` default `'recorrente'`), `dia_semana` (0-6, `null` se `excecao`), `hora_inicio`/`hora_fim` (formato `HH:mm` validado por regex), `data` (Date, `null` se `recorrente`), `disponivel` (boolean default `true` — para `excecao`), `ativo` (boolean default `true` indexado — soft toggle), `nota` (string). Validação `pre('validate')`: `recorrente` exige `dia_semana` e força `data=null`; `excecao` exige `data` e força `dia_semana=null`. Índices compostos `{fisioterapeuta_id, dia_semana, ativo}`, `{empresa_id, fisioterapeuta_id, tipo}`, `{fisioterapeuta_id, data}`. (2) `utils/disponibilidade.js` expandido — adicionadas `horaLisboa(instante)` (devolve `HH:mm` no fuso de Lisboa via `Intl.DateTimeFormat`), `compararHoras(a, b)` (compara `HH:mm` em minutos), `obterHorarioDia(fisioId, data)` (3 sub-camadas: exceção do dia → regra recorrente → sem horário), `verificarConflitoHorario(fisioId, dataHoraInicio, duracaoMin)` (valida se a consulta cabe no bloco de trabalho), `verificarDisponibilidadeCompleta(utilizador, dataHoraInicio, duracaoMin)` (ausência aprovada → folga fixa semanal → horário de trabalho, com falha cedo). (3) Novo `controllers/horarioController.js` — CRUD completo (`listarHorarios`, `obterHorario`, `criarHorario`, `atualizarHorario`, `eliminarHorario` hard delete, `verificarDisponibilidade`); valida `fisioterapeuta_id` como fisio/diretor_clinico ativo da empresa; fisioterapeuta vê só os seus; auditoria registada. (4) Novas `routes/horarioRoutes.js` montadas em `/api/gestor/horarios` — middleware custom `podeVer` (4 roles) para GET/listar/disponibilidade, `isDiretorClinico` para POST/PUT/DELETE. (5) `server.js` — mount `app.use('/api/gestor/horarios', horarioRoutes)`. 151/151 testes ✓ (+21 testes de Horário: CRUD, permissões, motor de disponibilidade com exceções, conflitos de horário, dia sem regra). |
| **F2**     | —      | **Pacientes (Fisioterapia):** (1) Novo modelo `models/Paciente.js` — `empresa_id`, `nome`, `data_nascimento`, `genero` (`enum ['M','F','Outro','NA']` default `'NA'`), `num_utente` (SNS), `nif`, `telefone` (obrigatório), `email`, `morada`, `contacto_emergencia` (`{nome, telefone, relacao}`), `historico_medico`, `alergias` (`[String]`), `consentimento_dados` (`{concedido, data, versao_termos}`), `ativo`, `eliminado_em` (soft delete), `observacoes`, `origem` (`enum ['walk_in','referenciacao','online','outro']` default `'walk_in'`). Índices compostos `{empresa_id, nome}`, `{empresa_id, num_utente}`, `{empresa_id, ativo, eliminado_em}`. (2) Novo `controllers/pacienteController.js` — CRUD completo (`listarPacientes`, `obterPaciente`, `criarPaciente`, `atualizarPaciente`, `eliminarPaciente` soft delete, `alternarEstadoPaciente`) + helpers `temAcessoClinico` e `sanitizarParaNaoClinico` (remove `historico_medico`/`alergias`/`contacto_emergencia` para rececionistas) + auditoria via `utils/auditoria.js`. (3) Novas `routes/pacienteRoutes.js` montadas em `/api/gestor/pacientes` — middleware custom `podeVer` (4 roles) para GET/POST/PUT, `isRececionista` para `PATCH /:id/estado`, `isDiretorClinico` para `DELETE /:id` (soft delete). (4) `server.js` — mount `app.use('/api/gestor/pacientes', pacienteRoutes)`. Respostas incluem flag `dados_clinicos: boolean`. 130/130 testes ✓ (+19 testes de Paciente). |
| **F1**     | —      | **Migração de roles (Fisioterapia):** (1) Modelo `Utilizador` — enum migrado de `['admin','manager','staff']` para `['admin','diretor_clinico','fisioterapeuta','rececionista']` (default `'rececionista'`); adicionado bloco `perfil_profissional` (`cedula`, `especialidades`, `biografia`, `cor_calendario` default `'#3b82f6'`, `ativo_clinico` default `true`). (2) Modelo `Empresa` — adicionado `logo_url` e bloco `config` (`horario_padrao`, `duracao_consulta_padrao` default `45`/min `15`, `tolerancia_atraso_min` default `10`, `fuso_horario` default `'Europe/Lisbon'`). (3) `middleware/requireRole.js` — removidos `isGestor`/`requireStaff`/`requireManager`/`requireAdmin` (legacy); adicionados `isAdmin` (só admin), `isDiretorClinico` (admin+diretor_clinico), `isClinico` (admin+diretor_clinico+fisioterapeuta), `isRececionista` (admin+diretor_clinico+rececionista). (4) `utils/loadBalancer.js` + controllers — queries de role: `'staff'` → `'fisioterapeuta'`; `'gestor'` → `'diretor_clinico'`; `['staff','gestor']` → `['fisioterapeuta','diretor_clinico']`; `isGestor` → `isDiretorClinico` em todas as routes (`gestorRoutes.js`, `ausenciaRoutes.js`). (5) `setupClienteZero` atualizado: 3 utilizadores (`admin@fisiocell.pt` admin, `gestor@fisiocell.pt` diretor_clinico, `joao.fisio@fisiocell.pt` fisioterapeuta). 111/111 testes ✓. |
| Inicial    | 1.0.0  | Criação da estrutura base: `package.json`, `server.js`, `.env.example`, `.gitignore`. Ligação ao MongoDB e rota de teste `GET /`. |
| v1.1.0     | 1.1.0  | Lógica central: modelos `Propriedade`, `Utilizador`, `Ausencia`, `Tarefa`; `controllers/webhookController.js` (fluxo estrito de atribuição com filtro de ausências + load balancing); `routes/webhookRoutes.js` (`POST /webhooks/smoobu`); resposta 200 imediata + processamento assíncrono; tratamento de erros robusto. |
| v1.2.0     | 1.2.0  | Painel de Administração: modelo `Empresa` (nome, nif, plano_ativo); `controllers/adminController.js` (`getPropriedades`, `criarPropriedade`, `setupClienteZero`); `routes/adminRoutes.js` (`GET/POST /api/admin/propriedades`, `GET /api/admin/setup`); montagem em `server.js`. `empresa_id` via header `x-empresa-id` (sem JWT ainda). |
| v1.3.0     | 1.3.0  | **Autenticação JWT:** dependências `jsonwebtoken` + `bcryptjs`; modelo `Utilizador` com `email` único + `password_hash`; `middleware/auth.js` (verifica JWT, injeta `req.user`, fallback legacy `x-empresa-id`); `controllers/authController.js` (`login` com bcrypt + JWT, `/me`); `routes/authRoutes.js` (`POST /api/auth/login`, `GET /api/auth/me`); `/api/admin` protegido por `auth` com `empresa_id` do token; `setupClienteZero` cria Staff com `password_hash` (`joao.limpezas@fisiocell.pt` / `fisiocell123`); `.env.example` com `JWT_SECRET` + `JWT_EXPIRACAO`. |
| v1.3.1     | 1.3.1  | **Fix bootstrap:** o `auth` deixou de ser aplicado a todo `/api/admin` e passou a ser aplicado apenas às rotas `/propriedades` (dentro de `adminRoutes.js`). A rota `/api/admin/setup` voltou a ser **PÚBLICA** (era o endpoint de bootstrap que criava o primeiro utilizador — não podia exigir token). Corrige o erro `401 Autenticação obrigatória` ao chamar `/setup`. |
| v1.4.0     | 1.4.0  | **Novo role `manager`:** modelo `Utilizador` enum `['admin','manager','staff']`; `webhookController` inclui managers na atribuição de tarefas (load balancing); `setupClienteZero` cria 3 utilizadores (admin `admin@fisiocell.pt` + manager `manager@fisiocell.pt` + staff `joao.limpezas@fisiocell.pt`, todos com password `fisiocell123`). |
| v1.4.1     | 1.4.1  | **Payload Smoobu oficial:** `extrairDadosReserva` atualizada para a estrutura documentada (`{ action, data: { id, arrival, apartment: { id, name } } }`). Mapeamento primário: `payload.data.apartment.id`, `payload.data.arrival`, `payload.data.id`. Fallbacks `??` mantidos para variantes (`content.*`, campos achatados). |
| v1.5.0     | 1.5.0  | **Gestão de Equipa:** `adminController` com `getEquipa` (lista utilizadores, `.select('-password_hash')`) e `criarMembroEquipa` (valida nome/email/password/role, hash bcrypt, email único); `adminRoutes` com `GET/POST /api/admin/equipa` (protegidos por `auth`). |
| v1.6.0     | 1.6.0  | **CRUD completo de Utilizadores:** `adminController` com `atualizarMembroEquipa` (PUT — nome/email/role/password opcional com nova hash bcrypt), `alternarEstadoMembro` (PATCH — ativa/desativa, inativos não fazem login), `eliminarMembroEquipa` (DELETE — não permite auto-eliminação); `adminRoutes` com `PUT/PATCH/DELETE /api/admin/equipa/:id` (protegidos por `auth`). Validação de pertença à empresa em todas as operações. |
| v1.7.0     | 1.7.0  | **Segurança hierárquica + `responsavel_id`:** modelo `Utilizador` com campo `responsavel_id` (ObjectId ref Utilizador, superior hierárquico); `getEquipa` faz `populate('responsavel_id')` e devolve campo `responsavel` preenchido; regras 403 em criar/editar (bloqueia role `admin`), editar/eliminar/desativar (bloqueia se alvo é `admin`); `responsavel_id` validado (admin/manager da mesma empresa, não pode ser si próprio). |
| v1.8.0     | 1.8.0  | **Sistema de Folgas e Férias:** modelo `Ausencia` expandido para intervalos (`data_inicio`/`data_fim`/`tipo`/`notas`, com `data` retrocompatível via `pre('save')`); `controllers/ausenciaController.js` (`listarAusencias` com `?futuras=true` + populate, `registarAusencia` com validação de sobreposição, `eliminarAusencia`); `routes/ausenciaRoutes.js` (`GET/POST/DELETE /api/admin/ausencias`); `webhookController` atualizado para excluir staff com ausência no intervalo (sobreposição `data_inicio <= dia AND data_fim >= dia` + query `data` legacy). |
| v1.9.0     | 1.9.0  | **Testes + CI:** dependências dev `jest` + `supertest`; script `npm test`; `tests/server.test.js` (healthcheck GET / → 200 + mensagem, rota inexistente → 404); `server.js` refactorizado para exportar `app` (`module.exports = app`) e isolar `app.listen` + `mongoose.connect` em `if (require.main === module)` (permite testes sem BD/porta); workflow GitHub Actions `.github/workflows/ci.yml` (2 jobs paralelos: frontend lint+tsc+build, backend test). |
| v1.10.0    | 1.10.0 | **Remoção do fallback legacy `x-empresa-id`:** `middleware/auth.js` agora é **ESTRITO** — só aceita JWT válido, sem token → 401 (sem fallback). `adminController` + `ausenciaController`: helper `extrairEmpresaId` (com fallback) substituído por `obterEmpresaId` (lê apenas `req.user.empresa_id` do JWT). Frontend `lib/api.ts`: removido `EMPRESA_ID` e fallback `x-empresa-id` do `adminHeaders` — se não houver token, não envia header (backend devolve 401). Proteção de rotas (middleware.ts + RouteGuard) já garante que só utilizadores autenticados chegam às páginas privadas. |
| v1.11.0    | 1.11.0 | **Rate limiting no login (anti-força bruta):** dependência `express-rate-limit`; `loginLimiter` em `authRoutes.js` aplicado apenas em `POST /api/auth/login` — máximo 5 tentativas por IP a cada 15 minutos, excedido → `429 { erro: "Muitas tentativas de login. Tente novamente mais tarde." }`. Headers `RateLimit-*` (standard) ativados. Mitiga força bruta e credential stuffing. |
| v1.12.0    | 1.12.0 | **Cookie httpOnly + proxy routes (segurança anti-XSS):** o token JWT deixou de chegar ao browser. O login (`/api/auth/login` no Next.js) define um cookie `httpOnly` + `Secure` + `SameSite=Strict`. As chamadas admin vão para same-origin (`/api/admin/...`) e o catch-all proxy (`app/api/admin/[...path]`) injeta o header `Authorization` ao encaminhar para o backend. CORS trancado a `FRONTEND_URL`. Error handler global sem stack trace vazada. |
| v1.13.0    | 1.13.0 | **WebhookLog + Soft Delete:** modelo `WebhookLog` (payload bruto + status `recebido`/`processado`/`erro`) para idempotência/auditoria do webhook Smoobu. Soft delete de utilizadores (`eliminado_em`) — em vez de `deleteOne`, marca-se a data; protege Tarefas antigas de `utilizador_id` órfão. `getEquipa` exclui `eliminado_em: null`. |
| v1.14.0    | 1.14.0 | **PWA + Folgas Fixas Semanais + WhatsApp:** frontend convertido em PWA (`next-pwa`, manifest, service worker, theme `#B8860B`). Modelo `Utilizador` com `dias_folga` (array 0–6); webhook exclui staff cujo dia da semana do check-in está no array. Campo `telefone` para Daily Briefing via WhatsApp. Cron `0 8 * * *` (`node-cron`) — mock de envio. |
| v1.15.0    | 1.15.0 | **Calendários + Geolocalização + Haversine:** `GET /api/admin/tarefas` (calendário geral de operações com filtro de datas). `GET /api/auth/me/calendario` (calendário pessoal). Geocoding de moradas via Nominatim/OpenStreetMap (`utils/geocoding.js`). Load balancer com tempo de viagem (Haversine) entre propriedades. Logout seguro em todas as áreas. |
| v1.16.0    | 1.16.0 | **Emergências + SLA + Atrasos:** `POST /api/admin/equipa/:id/falta-subita` (reatribuição de emergência das tarefas do dia). `POST /api/admin/equipa/:id/baixa` (baixa prolongada/férias — redistribui tarefas futuras). SLA de capacidade máxima no load balancer (420 min = 7h). `POST /api/admin/tarefas/:id/atraso` (reportar atraso). Remoção do campo legacy `data` do modelo `Ausencia` (queries agora só usam `data_inicio`/`data_fim`). Pausar/desativar propriedades (`ativo: false`) — webhook respeita. Gestão manual de tarefas (`POST /api/admin/tarefas`, `PATCH /:id/atribuir`, `PATCH /:id/estado`). |
| v1.16.1    | 1.16.1 | **Dashboard real + Auditoria + Health + Rate limit global + Modo escuro + CSV:** dashboard do admin com dados reais (`GET /api/admin/dashboard` com contagens em paralelo + aggregate carga por staff). Modelo `Auditoria` + `utils/auditoria.js` (fire-and-forget) + `GET /api/admin/auditoria`. `GET /api/health` (estado BD + uptime). Rate limiting global (100 req/15min em `/api/`). Modo escuro funcional (toggle no sidebar, CSS vars). Exportação CSV (`GET /api/admin/tarefas/export`). |
| v1.17.0    | 1.17.0 | **Relatórios/Analytics + Paginação + Testes de integração + Fix bug webhook:** `GET /api/admin/relatorios/produtividade` (aggregations: resumo, por staff, por dia, por estado, por propriedade) com filtro de período. Página `/admin/relatorios` com gráficos recharts (linha, barras, pie). Paginação client-side nas listagens de equipa e tarefas (componente reutilizável `PaginationBar`). Suite de testes expandida de 4 para 29 testes com `mongodb-memory-server` (auth 401, login, /me, CRUD propriedades, webhook com atribuição real, dashboard, relatórios). **Fix bug crítico:** `tempoLimpeza` era usado antes da declaração (TDZ `const`) em `processarReservaSmoobu` → `ReferenceError` silenciado pelo try/catch → tarefas ficavam sempre sem atribuição. Corrigido reordenando a computação de `tempoLimpeza` antes da chamada ao load balancer. |
| v1.18.0    | 1.18.0 | **Webhook Smoobu para produção:** (1) **Idempotência** — antes de criar tarefa, verifica se já existe `Tarefa` com o mesmo `smoobu_reserva_id`; se sim, não duplica (o Smoobu faz retries). (2) **Robustez de ações** — só `newReservation` (e variantes) cria tarefa; outras ações (`updateReservation`, `cancellation`, etc.) são ignoradas graciosamente (log + 200, sem erro). (3) **Visibilidade** — novos endpoints `GET /api/admin/webhooks` (lista logs com filtro `?status=` + `?limit=`) e `POST /api/admin/webhooks/:id/reprocessar` (reprocessa webhook que falhou, reutiliza o payload guardado). Função interna `processarReservaSmoobu` exportada como `_processarReservaSmoobu` para o reproccessamento. Página `/admin/webhooks` no frontend (cartões de filtro por estado + lista expandível com payload bruto + erro + botão reprocessar). 6 novos testes (35 no total): idempotência, ação desconhecida, listagem com/sem token, filtro status, reproccessamento. |
| v1.19.0    | 1.19.0 | **Reação a cancelamentos e edições do Smoobu:** o webhook deixa de ignorar `cancellation` e `updateReservation` — agora **reage**. `processarReservaSmoobu` refactorizada num **dispatcher** que chama 3 handlers: `criarTarefaPorReserva` (newReservation, com re-activação se a tarefa estava cancelada), `cancelarTarefaPorReserva` (cancellation → `estado='cancelada'`, respeita concluídas, idempotente) e `atualizarTarefaPorReserva` (updateReservation → atualiza `data`/`propriedade_id`/`tempo_limpeza_minutos`; se a data mudou, **reavalia a atribuição** verificando folgas fixas + ausências + ativo — mantém o funcionário se ainda for disponível, senão passa a `por_atribuir`; se a tarefa estava cancelada, re-activa; se não existir tarefa, cai para o fluxo de criação por fallback). Update sem tarefa existente agora cria (em vez de ignorar). 6 novos testes (41 no total): cancellation, cancellation idempotente, cancellation sem tarefa, update de data, update sem tarefa (fallback), re-activação após cancelamento. |
| v1.19.1    | 1.19.1 | **Edição de propriedades:** novo endpoint `PUT /api/admin/propriedades/:id` (`atualizarPropriedade`) que permite editar `nome`, `smoobu_id`, `morada` e `tempo_limpeza_minutos`. Valida pertença à empresa (404); valida unicidade global do `smoobu_id` (409 se outra propriedade já o tiver); se a `morada` mudar, **re-faz geocoding** (best-effort — se falhar, mantém coordenadas antigas, não bloqueia). Auditoria registada. No frontend, página `/admin/propriedades` tem agora botão "Editar" (ícone Pencil) que abre modal com os 4 campos. 4 novos testes (45 no total): atualizar nome+tempo, smoobu_id duplicado 409, id inexistente 404, body vazio 400. |
| v1.20.0    | 1.20.0 | **Sincronização em massa do Smoobu (REST API pull):** novo endpoint `POST /api/admin/smoobu/sincronizar` (`controllers/smoobuController.js` → `sincronizarReservas`) que vai buscar todas as reservas **futuras** (a partir de hoje) ao Smoobu via REST API (`fetch https://login.smoobu.com/api/reservations?from=YYYY-MM-DD` com header `Api-Key`) e cria as tarefas correspondentes reutilizando `_processarReservaSmoobu` (idempotente — não cria duplicados). Cada reserva é mapeada do formato REST API para o formato do webhook e processada individualmente com try/catch (se uma falhar, ex: propriedade inexistente, as outras continuam). Devolve contadores: `totalRecebidas`, `importadas` (criadas + existentes), `criadas`, `existentes`, `erros`, `detalheErros`. Requer variável de ambiente `SMOOBU_API_KEY` (documentada em `.env.example` + topo do `server.js`); sem ela → `400`. Erros de fetch/timeout/JSON → `502`. Reutiliza a função já exportada `_processarReservaSmoobu` (sem duplicar lógica). 6 novos testes (51 no total) com mock de `global.fetch`: sem token 401, sem API key 400, contadores corretos, idempotência (2x não duplica), erro 500 do Smoobu → 502, reserva com propriedade inexistente → erro isolado. |
| v1.20.1    | 1.20.1 | **Fix 500 no toggle de propriedades + PWA:** (1) Bug crítico — `PATCH /api/admin/propriedades/:id/estado` dava 500 em propriedades legacy sem `morada` porque `findOne` + `save()` re-valida o documento inteiro. Corrigido com `findOneAndUpdate` + `$set` (não re-valida). Teste de regressão: propriedade inserida sem morada → toggle 200. (2) PWA — meta `mobile-web-app-capable` adicionada (apple-* deprecated). (3) Ícones 1x1 placeholder substituídos por ícones reais 192/512/180 (gerados com image-generation + sharp, fundo dourado #B8860B). |
| v1.21.0    | 1.21.0 | **Listar propriedades do Smoobu:** novo endpoint `GET /api/admin/smoobu/propriedades` (`smoobuController` → `getPropriedadesSmoobu`) que faz `fetch https://login.smoobu.com/api/apartments` com header `Api-Key` e devolve `{ propriedadesSmoobu: [{ id, name }, ...] }` de forma limpa (só os campos úteis, não vaza dados sensíveis/volumosos do Smoobu). Facilita o mapeamento no fluxo de criação de propriedades — o frontend pode mostrar um dropdown com os apartamentos do Smoobu em vez de o Admin ter de digitar o `smoobu_id` manualmente. Mesmo padrão de robustez do `sincronizarReservas`: valida `SMOOBU_API_KEY` (400), trata erros de fetch/HTTP/JSON (502), aceita variantes da resposta (`body.apartments` ou `body.data.apartments`). 4 novos testes (56 no total): sem token 401, sem API key 400, fetch mockado devolve lista limpa (verifica que só id+name, não vaza other fields, e que o fetch foi chamado com URL+header corretos), erro 401 do Smoobu → 502. |
| v1.22.0    | 1.22.0 | **Sincronizar propriedades do Smoobu (upsert em massa):** novo endpoint `POST /api/admin/smoobu/sincronizar-propriedades` (`smoobuController` → `sincronizarPropriedades`) que faz `fetch https://login.smoobu.com/api/apartments` e faz upsert de cada apartamento com `$setOnInsert` — **insere só as que não existem**, não altera as existentes (preserva edições manuais do Admin: nome, morada, tempo, coordenadas, ativo). `empresa_id` vem do JWT. Devolve contadores: `totalRecebidas`, `criadas`, `existentes`, `erros`, `detalheErros`. Caso de uso: configuração inicial (importar todas as propriedades de uma vez). O endpoint `PUT /api/admin/propriedades/:id` (`atualizarPropriedade`) **já existia** desde a v1.19.1 (nome, smoobu_id, morada, tempo + re-geocoding) — não foi duplicado. 5 novos testes (61 no total): sem token 401, sem API key 400, cria propriedades novas, idempotente (2x não duplica), preserva edições manuais (propriedade com nome/tempo/ativo editados não é sobreposta). |
| v1.23.0    | 1.23.0 | **Calendário Visual Avançado — endpoint unificado:** novo endpoint `GET /api/admin/calendario/dados` (`adminController` → `getDadosCalendario`) que devolve tarefas da empresa num intervalo de datas com filtros opcionais (`propriedadeId`, `utilizadorId`, `estado`) + populate de propriedade (`nome`, `morada`, `coordenadas`) e utilizador (`nome`). Diferença para `getTarefas`: não exclui canceladas por defeito (calendário pode mostrá-las a tracejado), aceita `utilizadorId=null` para filtrar tarefas por atribuir, e o populate inclui `morada`+`coordenadas` (para tooltips e futuro mapa de rotas). 8 novos testes (69 no total): sem token 401, sem filtros (inclui canceladas), populate (nome+morada+utilizador), filtro por propriedade, filtro por utilizador, filtro utilizadorId=null (por atribuir), filtro por estado=concluida, combina filtros. Fix de teste existente: o teste do webhook assumia que só havia 1 staff (quebrado pelo `beforeAll` do calendário que cria 2 staff extra) — corrigido para verificar apenas que a tarefa foi atribuída a algum staff ativo (não null), que é o comportamento correto do load balancer. |
| v1.24.0    | 1.24.0 | **Fluxo de aprovação de ausências:** (1) Modelo `Ausencia` — novo campo `estado` (`pendente`\|`aprovada`\|`rejeitada`, default `pendente`); enum do `tipo` alargado para `ferias`\|`doenca`\|`outro` (as "folgas" fixas semanais continuam em `dias_folga` do Utilizador). (2) **Staff routes** — novo `controllers/staffController.js` + `routes/staffRoutes.js` montado em `/api/staff`: `GET /ausencias` (histórico próprio) + `POST /ausencias` (cria pedido sempre `pendente`; staff não pode auto-aprovar). (3) **Aprovação** — `PATCH /api/admin/ausencias/:id/estado` (`ausenciaController` → `aprovarRejeitarAusencia`): aprovar → redistribui tarefas do período via load balancer (helper `redistribuirTarefasPeriodo` extraído e reutilizável); rejeitar → só atualiza estado. (4) **Webhook** — `determinarUtilizadorAtribuido` e `atualizarTarefaPorReserva` agora só consideram ausências `aprovada` (pendentes/rejeitadas não bloqueiam atribuição). (5) Ações diretas do admin (falta súbita, baixa prolongada, registo manual) criam ausências com `estado: 'aprovada'`. 7 novos testes (76 no total): staff cria pedido (pendente), staff vê suas ausências, staff sem token 401, admin aprova (redistribui — verifica utilizador_id mudou), admin rejeita (não mexe em tarefas), estado inválido 400, ausência inexistente 404. |
| Prompt 92  | —      | **Upgrade de modelos + force-update do Smoobu (Fase 1.5):** (1) Modelo `Propriedade` — novo campo `funcionario_preferencial_id` (ObjectId `ref: 'Utilizador'`, default `null`, indexado) para suportar staff preferencial por propriedade (lógica de prioridade no load balancer será ativada num prompt seguinte). (2) Modelo `Tarefa` — novo objeto `detalhes_reserva` com sub-campos `checkin` (String), `checkout` (String), `pax` (Number), `nome_hospede` (String) — snapshot da reserva Smoobu (preenchimento via webhook/sincronização num prompt seguinte). (3) `sincronizarPropriedades` (`smoobuController`) — deixa de preservar a morada/capacidade antigas: para propriedades já existentes, atualiza **SEMPRE** a `morada` e a `capacidade_hospedes` quando o Smoobu as trouxer no payload, refazendo o geocoding da morada nova e guardando com `await existente.save()`. Os restantes campos (`nome`, `tempo_limpeza_minutos`, `ativo`, `checklist`, `funcionario_preferencial_id`) continuam preservados. 1 novo teste (104 no total): força update de morada + capacidade em propriedade existente; o teste "preserva edições manuais" foi renomeado/refinado para "preserva nome/tempo/ativo quando o Smoobu não traz morada/capacidade no payload". |
| Prompt 93  | —      | **Algoritmo VIP + Detalhes da Reserva (Fase 1.5):** (1) `webhookController.extrairDadosReserva` — extrai agora `detalhesReserva` ({ checkin, checkout, pax, nome_hospede }) do payload do Smoobu (variantes: arrival/departure, guests/numPeople/adults+children, guestName/firstName+lastName/guest.name). (2) `criarTarefaPorReserva` — guarda `detalhes_reserva` no `Tarefa.create`; ao re-activar tarefa cancelada, atualiza também os detalhes. (3) `atualizarTarefaPorReserva` — atualiza `detalhes_reserva` no update (reserva editada). (4) **Algoritmo VIP** em `determinarUtilizadorAtribuido` — novo parâmetro `propriedadeId`; antes do load balancer geral, se a propriedade tiver `funcionario_preferencial_id` e esse staff estiver disponível (passou filtros de ausência aprovada + folga fixa) e dentro do SLA de 8h/dia (`cargaLimpeza + novaTarefa ≤ 480min`), atribui obrigatoriamente a ele; só faz fallback para o load balancer geral (Haversine + menor carga) se o preferencial não puder. Novo helper `calcularCargaLimpezaDia`. (5) `tarefaController.autoAtribuirTarefas` — passa `propriedade_id._id` ao load balancer para o VIP também aplicar às tarefas órfãs. 4 novos testes (108 no total): guarda detalhes_reserva; VIP atribui ao preferencial; VIP fallback se exceder SLA; VIP fallback se tiver folga. |
| Prompt 94  | —      | **Cron Job "Agenda de Amanhã" (19h):** novo ficheiro `jobs/agendaAmanha.js` — cron `0 19 * * *` com `timezone: 'Europe/Lisbon'` (estável mesmo em servidor UTC, acompanha horário de Verão/Inverno de PT). Lógica: calcula o intervalo do dia seguinte → procura `Tarefa` com `estado ∈ { atribuida, por_atribuir }` → agrupa por `utilizador_id` (só staff ativos não eliminados; `por_atribuir` sem utilizador não gera push) → para cada staff chama `notificarUtilizador(staffId, '📅 Agenda de Amanhã', 'Tens X tarefa(s) agendada(s). Entra na app para ver o itinerário', '/staff')` (fire-and-forget). `server.js` importa e inicia o job no arranque (dentro de `require.main === module`, não corre nos testes). `notificarUtilizador` carregado via `require` lazy dentro da função para permitir `jest.spyOn` nos testes. Nova secção 3.3 (Cron Jobs) no BACKEND.md. 4 novos testes (112 no total): notifica cada staff agrupado (verifica título, singular/plural, URL); ignora `por_atribuir`/concluídas/canceladas; sem tarefas → não notifica; ignora staff inativo. |
| Prompt 95  | —      | **`atualizarPropriedade` aceita `funcionario_preferencial_id`:** o `PUT /api/gestor/propriedades/:id` (`gestorController`) passa a aceitar o campo `funcionario_preferencial_id` no body. Aceita `null`/string vazia (remove o preferencial) ou um ObjectId; valida que é um staff ativo (`role: 'staff'`, `ativo: true`, `eliminado_em: null`) da mesma empresa (400 se não for). Mensagem de "Nenhum campo para atualizar" atualizada para incluir o novo campo. Sem novos testes (coberto pelos testes existentes do PUT + a validação é inline). 112 testes mantêm-se a passar. |
| Prompt 96  | —      | **Cron Job "Cão de Guarda" (18h):** novo ficheiro `jobs/caoGuarda.js` — cron `0 18 * * *` com `timezone: 'Europe/Lisbon'`. Lógica: calcula o intervalo do dia atual → procura `Tarefa` com `tipo: 'limpeza'`, `utilizador_id` ≠ null e `estado ∈ { atribuida, em_curso }` (atribuídas mas não concluídas; nota: o modelo não tem `'pendente'` — `'atribuida'` é o equivalente) → populate de `propriedade_id` (nome) + `utilizador_id` (ativo, eliminado_em) → para cada tarefa esquecida chama `notificarUtilizador(staffId, '⚠️ Tarefa Incompleta', 'Ainda não marcaste a limpeza da [nome da propriedade] como concluída. Por favor, atualiza a app!', '/staff')` (fire-and-forget; uma push por tarefa, não agrupado por staff). Ignora staff inativo/eliminado. `server.js` importa e inicia no arranque (`require.main === module`). `notificarUtilizador` via require lazy (permite `jest.spyOn` nos testes). Secção 3.3 (Cron Jobs) atualizada com a tabela dos 3 jobs + descrição detalhada do Cão de Guarda. 4 novos testes (116 no total): notifica por tarefa esquecida (verifica título/corpo com nome da propriedade/link); ignora concluídas/canceladas/por_atribuir/manutencao; sem tarefas → não notifica; ignora staff inativo. |
| Prompt 97  | —      | **"Desligar a Histeria Automática":** deixa de haver reatribuição automática via load balancer em resposta a ausências/desativação — as tarefas afetadas passam apenas a `utilizador_id = null` + `estado = 'por_atribuir'`, ficando o recálculo a cargo do Gestor (manual, via "Auto-Atribuir Pendentes") ou do Fail-Safe noturno. Alterações: (1) `ausenciaController.registarAusencia` — ao criar ausência aprovada, chama o novo helper `desatribuirTarefasPeriodo` (resposta inclui `desatribuicao`). (2) `ausenciaController.aprovarRejeitarAusencia` — aprovar deixa de chamar o load balancer; usa `desatribuirTarefasPeriodo` (resposta `redistribuicao = { total, desatribuidas }`). (3) Novo helper `desatribuirTarefasPeriodo(utilizadorId, inicio, fim)` substitui o antigo `redistribuirTarefasPeriodo` (removido). (4) `gestorController.reportarFaltaSubita` — desatribui tarefas de hoje (resposta `desatribuidas` em vez de `reatribuidas/orfas`). (5) `gestorController.registarBaixaProlongada` — desatribui tarefas do período (resposta `desatribuidas`). (6) `gestorController.alternarEstadoPropriedade` — ao DESATIVAR propriedade, deixa de APAGAR tarefas futuras (v1.35.0/Prompt 73) e passa a DESATRIBUIR (`updateMany` com `utilizador_id: null, estado: 'por_atribuir'`); resposta `tarefasDesatribuidas` em vez de `tarefasApagadas`. Frontend `gestor/propriedades/page.tsx` atualizado para o novo campo. 3 novos testes (119 no total): desativar propriedade desatribui (não apaga); falta súbita desatribui (não reatribui); baixa prolongada desatribui (não reatribui). 1 teste existente atualizado ("admin aprova ausência" passa a verificar desatribuição). |
| Prompt 98  | —      | **"Rede de Segurança das 18h" — Auto-Atribuição de Emergência (Fail-Safe):** o cron job `caoGuarda` (18:00) passa a ter **duas fases**: **Fase A (Fail-Safe, nova — ANTES dos alertas):** procura as `Tarefa` de amanhã com `estado: 'por_atribuir'` + `utilizador_id: null` e invoca `determinarUtilizadorAtribuido` (load balancer: Algoritmo VIP + Haversine + SLA 8h) para as atribuir; recalcula a hora via scheduler sequencial + envia push `🧹 Nova Limpeza Atribuída` (fire-and-forget). Se não houver staff, mantém `por_atribuir` (órfã). **Fase B (Prompt 96, os alertas):** inalterada — push por cada tarefa de limpeza de hoje não concluída. Objetivo: garantir que o dia seguinte está 100% coberto antes do relógio das 19:00 (Agenda de Amanhã) correr; complementa o Prompt 97 (as tarefas desatribuídas por ausências/falta/desativação são reatribuídas aqui de forma centralizada). `executarCaoGuarda` passa a devolver `{ failSafe: {encontradas, atribuidas, orfas}, alertas: {encontradas, notificadas} }`. Função `autoAtribuicaoEmergencia` exportada para testes. 4 novos testes (123 no total): atribui órfãs de amanhã via load balancer (verifica push + estado); sem órfãs → não faz nada; sem staff → mantém órfã; não mexe em tarefas de hoje nem em já atribuídas. 4 testes existentes do Prompt 96 atualizados para `resultado.alertas.*` (a estrutura mudou). |
| Prompt 100 | —      | **Garantir os Dados para o Excel:** confirmação e testes de que o `GET /api/gestor/calendario/dados` (`getDadosCalendario`) já devolve o objeto `detalhes_reserva` (usa `.lean()` sem `.select()`, pelo que todos os campos do modelo Tarefa são incluídos — `detalhes_reserva` foi adicionado no Prompt 92). Os `.populate('propriedade_id')` (nome + morada + coordenadas) e `.populate('utilizador_id')` (nome) já estavam presentes. 2 novos testes (125 no total): (1) tarefa com `detalhes_reserva` preenchido → endpoint devolve os 4 sub-campos (checkin, checkout, pax, nome_hospede); (2) tarefa de manutenção SEM `detalhes_reserva` → campo existe (objeto com defaults null) mas sem dados reais (não quebra o frontend/Excel). Sem alterações de código no backend — só testes de regressão. |
| Ajuste | —      | **Override do admin na impersonação (empresa sem gestor ativo):** `superAdminController.impersonarGestor` — quando a empresa não tem um gestor ativo (role 'gestor', ativo, não eliminado), deixou de devolver 404 ("Não foi encontrado um gestor ativo para a empresa X"). Agora o Super Admin (role 'admin') que faz o pedido tem **override total**: o sistema gera um token JWT com o id/nome/email do próprio admin, `empresa_id` da empresa alvo e `role: 'gestor'` (o admin impersona um gestor). Como o middleware `isGestor` permite 'gestor', o token funciona no painel `/gestor/*` (dashboard, propriedades, tarefas) baseando-se apenas no `empresa_id`. O id real do admin fica no token para auditoria (`registarAuditoria` usa `req.user.id`). Nota: o `/api/auth/me` continua a devolver o `empresa_id` real do utilizador na BD (o admin), mas os endpoints do gestor usam `req.user.empresa_id` do token (override). 1 novo teste (126 no total): empresa sem gestor ativo → admin impersona com 200 + token de override + acesso ao dashboard da empresa alvo. |
| Prompt 101 | —      | **Gestão de utilizadores de empresas terceiras (Super Admin):** 3 novos endpoints exclusivos do admin (auth + `isAdmin`) em `superAdminController` + `adminRoutes`: (1) `GET /api/admin/empresas/:empresaId/utilizadores` — lista todos os utilizadores (gestores + staff, `eliminado_em: null`) da empresa, sem `password_hash`, ordenados por role + nome. (2) `POST /api/admin/empresas/:empresaId/utilizadores` — cria gestor/staff nessa empresa; `empresa_id` vem do URL (garante associação correta); rejeita role 'admin' (403), valida email único global (409), password ≥ 6 caracteres; default role 'gestor' (caso de uso: empresa sem gestor). Auditoria registada com `empresa_id` da empresa alvo. (3) `PATCH /api/admin/empresas/:empresaId/utilizadores/:utilizadorId/estado` — alterna ativo/inativo (ou `{ ativo: boolean }` explícito); rejeita modificar admins (403); valida que o utilizador pertence à empresa do URL (404 caso contrário). Helper `carregarEmpresa(empresaId)` partilhado. 5 novos testes (131 no total): lista (401 sem token + 200 admin); cria gestor (201 + associação correta); rejeita role admin (403) + email duplicado (409); toggle alterna (3x); toggle com empresa errada (404). Frontend: botão "Gerir Utilizadores" + modal com tabela + toggle + formulário criar gestor. |
| Correção | —      | **Calendário não mostra ausências de eliminados + importarPropriedades atualiza sempre:** (1) `getDadosCalendario` (`gestorController`) — o `populate('utilizador_id')` das ausências aprovadas passou a incluir `eliminado_em` no select e as ausências cujo utilizador tem `eliminado_em` != null são filtradas (não aparecem no calendário). Antes, ausências de staff eliminado (soft delete) continuavam visíveis como férias no calendário. (2) `importarPropriedades` (`smoobuController`) — alinhado com `sincronizarPropriedades` (Prompt 92): para propriedades já existentes, atualiza **SEMPRE** a `morada` (quando o Smoobu traz uma morada real) e a `capacidade_hospedes` (quando o Smoobu traz um valor), com re-geocoding da morada nova. Antes (Prompt 90), só preenchia a morada se estivesse `'A definir'` — pelo que propriedades com morada já definida não eram atualizadas ("0 atualizadas, 36 já existiam"). Os restantes campos (nome, tempo, ativo, checklist, funcionario_preferencial_id) continuam preservados. 2 novos testes (133 no total): calendário não mostra ausência de eliminado; importarPropriedades atualiza morada + capacidade de propriedade existente (não só 'A definir'). |
| Prompt 113 | —      | **Mega Prompt de Correção (Alpha):** (1) **Fix de fuso horário (Lisboa/WEST)** — `tarefaController.criarTarefa` deixou de normalizar a data para meia-noite UTC (`Date.UTC(d.getUTC...)`); agora armazena o instante enviado pelo frontend diretamente. O frontend (`tarefas` + `calendário`) passa a enviar `new Date("YYYY-MM-DD"+"T00:00:00").toISOString()` (meia-noite LOCAL) em vez de `"YYYY-MM-DD"` (que o JS interpretava como UTC midnight → aparecia 01:00 em Lisboa e ficava invisível abaixo do slotMinTime 08:00). (2) `utils/disponibilidade.js` (`verificarDisponibilidadeUtilizador` + `mensagemIndisponivel`) — tornado robusto a offset: a comparação passa a ser feita pela **data de calendário de Lisboa** (`Intl.DateTimeFormat` com `timeZone: 'Europe/Lisbon'`, formato `YYYY-MM-DD`) em vez do instante UTC midnight. Isto garante que uma tarefa às 00:00 local (23:00Z do dia anterior em UTC) conta como "mesmo dia" para férias/ausências — funciona tanto para tarefas antigas (UTC midnight) como novas (local midnight). Janela de pesquisa ±1 dia + filtragem JS pela data de Lisboa. (3) **Novo endpoint `POST /api/gestor/propriedades/default-checklist`** — aplica o checklist padrão (`['Esvaziar lixo','Trocar roupa da cama','Trocar Toalhas','Limpar chão','Limpar vidros','Limpar pó']`) a TODAS as propriedades da empresa via `updateMany`. Substitui o existente. Devolve `{ sucesso, message, checklist, modificadas, correspondidas }`. 136 testes mantêm-se a passar (a reescrita da disponibilidade é retrocompatível — `dataLisboa` de um instante UTC midnight devolve a mesma data de calendário). |
| Prompt 114 | —      | **Notificações In-App, Bugs Alpha e Lógica de Distâncias:** (1) **Push Notifications** — confirmado que o fluxo já estava completo: `push-notification-setup.tsx` (staff+gestor) faz `pushManager.subscribe` + `POST /api/auth/me/push-subscribe` (proxy via catch-all `/api/auth/me/[...path]`); backend `authController.pushSubscribe` guarda em `Utilizador.pushSubscription` (campo Mixed, existente desde v1.27.0). `utils/notificar.js` estendido para criar também notificação in-app. (2) **Centro de Notificações In-App (O Sino)** — novo modelo `Notificacao` (`utilizador_id`, `empresa_id`, `mensagem`, `tipo` enum, `url`, `lida`, `data`, timestamps; índice composto `{ utilizador_id, lida, createdAt }`). Novo `notificacaoController.js` com 4 endpoints (montados em `/api/auth/me/notificacoes`): `GET /` (lista, query `?lidas=`), `GET /contagem` (count não-lidas), `PATCH /marcar-lidas` (todas), `PATCH /:id/lida` (uma). `utils/notificar.js` `notificarUtilizador()` agora envia push (se configurado) E cria registo `Notificacao` (fire-and-forget); `criarNotificacaoInApp` helper exportado. `tarefaController` (criarTarefa, atribuirTarefa, reatribuirTarefa) + `webhookController.criarTarefaPorReserva` passam `opts.tipo` (`tarefa_atribuida`/`tarefa_reatribuida`) e `empresa_id` — notificação gerada sempre que uma tarefa é atribuída ao staff. (3) **Fix Staff Inativo** — `getEquipa` já devolve todos; frontend (`tarefas/page.tsx` + `calendario/page.tsx`) agora filtra `u.role === "staff" && u.ativo === true` nos dropdowns de atribuição (antes só filtrava role). (4) **Capacidade no detalhe** — `authController.minhaTarefaDetalhe` + `gestorController.getTarefas`/`getDadosCalendario` passam a fazer populate de `capacidade_hospedes` (antes só `nome`/`morada`/`coordenadas`). (5) **Tolerância de Geocoding** — `gestorController.criarPropriedade` + `atualizarPropriedade` devolvem flag `warning` quando o Nominatim falha/devolve vazio (coordenadas null/mantidas); `utils/geocoding.js` já fazia catch silencioso (confirmado). (6) **Haversine** — novo `utils/distancia.js` (`distanciaHaversine(origem, destino)` em km, raio 6371km, robusto a null/NaN). `tarefaController` novo helper `verificarDistanciaTarefasDia(utilizadorId, data, propriedadeId)` que busca outras tarefas do staff no mesmo dia, popula coordenadas, calcula a distância máxima, e se > 15km (`LIMITE_DISTANCIA_KM`) devolve mensagem de warning. Integrado em `criarTarefa`, `atribuirTarefa`, `reatribuirTarefa` — resposta JSON inclui `warning` (não bloqueia). 7 novos testes (143 total): Haversine (Lisboa→Porto ≈274km, mesma=0, inválidas=0), contagem notificações, criar tarefa gera notif + contagem incrementa + marcar lidas, criar 2 tarefas distantes devolve warning, criar propriedade com morada (201 mesmo se Nominatim falhar). |
| Prompt 115 | — | **Separação ABSOLUTA de menus + fix loop 401 (sem alterações de backend):** o trabalho foi exclusivamente frontend (`GestorSidebar`/`AdminSidebar` dedicados, `route-guard.tsx` com redirect HARD via `fazerLogout()`). Backend sem alterações — o `POST /api/auth/logout` (limpeza do cookie httpOnly) já existia. |
| Prompt 116 | — | **Fundação SaaS + Lógica de negócio:** (1) Modelo `Empresa` ganhou campo `ativa` (boolean + índice) — empresas suspensas (`ativa: false`) ficam bloqueadas para o gestor/staff. (2) Novos endpoints de Super Admin em `adminRoutes`: `PATCH /api/admin/empresas/:id/toggle-status` (ativa/suspende) e `POST /api/admin/empresas/:id/hard-reset` **scoped à empresa** (apaga Propriedades + Tarefas + Ausências + Webhooks + Notificações dessa empresa, sem tocar noutras — substitui o `DELETE /api/admin/hard-reset` global). (3) `gestorController.getEquipa` passou a filtrar `ativo === true` e excluir `role === 'admin'`. (4) Sobreposição de ausências (`staffController.criarAusencia` + `faltaHoje`) passou a **excluir ausências rejeitadas** (só `aprovada`/`pendente` bloqueiam). (5) `criarTarefa` alargado para aceitar `hora`, `check_in`, `check_out`, `hospedes` (detalhes de reserva manuais). (6) Modelo `Notificacao` ganhou `tarefa_id` (referência à tarefa geradora). (7) Modelo `Propriedade` ganhou `observacoes` (texto livre). |
| Prompt 117 | — | **Endpoints de gestão de empresa (Super Admin):** novos endpoints em `adminRoutes` (auth + `isAdmin`): `GET /api/admin/empresas/:id/config` + `PUT /api/admin/empresas/:id/config` (ler/atualizar config da empresa — nome, NIF, API key Smoobu), `POST /api/admin/empresas/:id/sincronizar-propriedades` (importa apartamentos Smoobu da empresa), `POST /api/admin/empresas/:id/sincronizar-reservas` (sincroniza reservas Smoobu da empresa), `POST /api/admin/empresas/:id/registrar-webhooks` (registar webhooks Smoobu para a empresa). Reutilizam os controllers do `smoobuController`/`gestorController` com override do `empresa_id` a partir do URL. `geocoding.js` devolve flag `warning` (já existia desde Prompt 114) consumida agora inline no frontend. |
| Prompt 118 | — | **Sem alterações de backend:** trabalho exclusivamente frontend (staff dashboard agrupado por dia, `NotificationBell` com `max-h`, feedback de push, Exportar PDF via `window.print`). Os endpoints de notificações (`/api/auth/me/notificacoes/*`) e tarefas já existiam. |
| Prompt Extra | — | **Vacina Anti-Safari (sem alterações de backend):** helpers `parsearDataSegura` + `extrairHoraISO` introduzidos no **frontend** (`lib/utils.ts`). Backend sem alterações — a robustez de parsing é toda client-side. |
| Prompt 119 | — | **Resiliência PWA (sem alterações de backend):** configuração do Service Worker (`next-pwa`) é inteiramente frontend (`skipWaiting`, `clientsClaim`, runtime caching `NetworkFirst` em chunks, handler de `ChunkLoadError`). Backend sem alterações. |
| Prompt 120 | — | **Sem alterações de backend:** remoção do loop de reload (guard `sessionStorage`) e `mounted` guard na staff page — ambos frontend. |
| Prompt 121 | — | **Sem alterações de backend:** reposição de fábrica do layout + `next.config` minimalista — ambos frontend. |
| Prompt 122 | — | **Soft delete de empresas (Lixeira):** (1) Modelo `Empresa` ganhou campo `apagada` (boolean, default `false`). (2) `GET /api/admin/empresas` passou a suportar query `?inclui_apagadas=` — por defeito **exclui** empresas `apagada: true`. (3) Novo `DELETE /api/admin/empresas/:id` (soft delete — marca `apagada: true, ativa: false`, auditoria registada). (4) Novo `PATCH /api/admin/empresas/:id/restaurar` (desfaz soft delete — `apagada: false`; `ativa` mantém-se `false` — o admin deve reativar manualmente). Auditoria registada em ambos. |
| Prompt 123 | — | **Soft block de conflitos + Gemini SDK:** (1) `criarTarefa`/`atribuirTarefa`/`reatribuirTarefa` deixaram de devolver `409` em sobreposição horária do staff; agora devolvem `200` com flag `warning` (não bloqueia). O `warning` inclui o **tempo de viagem** estimado entre a tarefa anterior e a nova (Haversine + velocidade média). (2) **Gemini SDK** (`@google/generative-ai`) introduzido no `relatorioController.getResumoIA` (substitui fetch manual à API REST do Gemini). (3) Redistribuição de ausências aprovadas passou a **excluir ausências rejeitadas** (só `aprovada` contam para reatribuição). (4) `Propriedade.observacoes` exposto no detalhe de tarefa. (5) Validação de sobreposição robusta a fusos (data de calendário de Lisboa via `Intl`). |
| Prompt 124 | — | **Resumo IA exportável (PDF):** o `relatorioController.getResumoIA` (já existente desde Prompt 123) é consumido pelo frontend para gerar PDF via `html2pdf.js`. Backend sem alterações estruturais — apenas o endpoint `POST /api/gestor/relatorios/ai-summary` continua a devolver o resumo em linguagem natural. |
| Prompt 125 | — | **Gemini SDK consolidado + fuso de manutenção local:** (1) `getResumoIA` consolidado com o SDK `@google/generative-ai` + fallback gracioso se a API key estiver em falta (devolve mensagem padrão em vez de crashar). (2) Tarefas de manutenção geradas pelo sistema passam a ser criadas com instante local (não UTC midnight) para alinhar com o dia de calendário real. (3) Soft block de conflitos mantido (warning não-bloqueante). (4) `Propriedade.observacoes` passível de edição via `PUT /api/gestor/propriedades/:id`. |
| Prompt 126 | — | **Sem alterações de backend significativas:** UX logística (modais "Forçar Agendamento"/"Confirmar Morada"), PDF delay, Logs Smoobu e `/gestor/notificacoes` são todos frontend. O backend continua a devolver `warning` (não-bloqueante) no `criarTarefa` para o modal de double-check. |
| Prompt 127 | — | **Sem alterações de backend:** fix de timezone (`extrairHoraISO` sem `new Date()`) é frontend. `AlertDialog` e loading do relatório também frontend. |
| Prompt 128 | — | **Blindagem backend — fuso Portugal + Gemini nunca crasha:** (1) Novo helper de offset que usa `Intl.DateTimeFormat` com `timeZone: 'Europe/Lisboa'` para calcular o offset de Lisboa (incluindo DST) — substitui a dependência do fuso do servidor (Render em UTC). Aplicado na normalização de datas de tarefas/ausências. (2) `getResumoIA` envolvido em try/catch abrangente — se a chamada ao Gemini falhar (quota, rede, JSON inválido), devolve um **placeholder hardcoded** ("Resumo temporariamente indisponível.") em vez de `500`. O relatório de produtividade principal (`getRelatorioProdutividade`) continua a funcionar mesmo com IA em baixo. |
| Prompt 129 | — | **Sem alterações de backend:** fix de timezone do calendário (strings locais sem `Z`) é frontend. A config do Service Worker (`publicExcludes /api/`) também frontend — garante que o SW não interceta pedidos à API (dados sempre frescos do backend). |
| Prompt 130 | — | **Fix definitivo de ausências (filtro de estado + remoção de índice único):** (1) `staffController.criarAusencia` passou a filtrar por `estado` ao verificar sobreposição de ausências — antes considerava TODAS (incluindo rejeitadas) e bloqueava a criação com `409`. Agora só `aprovada`/`pendente` contam para sobreposição. (2) `faltaHoje` recebeu o mesmo fix (filtro de estado na verificação de ausência existente). (3) **Root cause do 409 persistente:** identificado um **índice único MongoDB** legado (`utilizador_id_1_data_1`, sobre o campo `data`) que continuava ativo em produção e rejeitava ausências legítimas. O arranque do servidor passou a **remover o índice único** automaticamente (sem eliminar ausências existentes). Várias iterações de debug/logs (`55a7f00`, `48a985c`, `9afe73e`, `34a60c8`, `d8b395f`) até ao root cause final (`1a483f9` — índice era sobre `data`, não `data_inicio`). |
| Prompt 131 | — | **Staff notificações + nome_hospede + dias anteriores + remoção de índice único:** (1) Índice único MongoDB legado (`utilizador_id_1_data_1`) **removido definitivamente** no arranque do backend (script de migração que identifica e elimina o índice se existir). (2) `nome_hospede` (de `detalhes_reserva`) passou a ser populado/devolvido nos endpoints de tarefas do staff (`minhasTarefas`, `minhaTarefaDetalhe`). (3) Endpoints de tarefas do staff (`/api/auth/me/tarefas`) alargados para suportar navegação **até 30 dias para trás** (histórico de tarefas concluídas), além dos dias futuros. (4) Endpoints de notificações (`/api/auth/me/notificacoes/*`) consumidos pela nova página `/staff/notificacoes` (sem alteração de contrato). |

| Prompt 132 | — | **Cancelamento de ausências (soft cancel):** novo endpoint `PATCH /api/staff/ausencias/:id/cancelar` (em `ausenciaController.cancelarAusencia`) que marca `estado: 'cancelada'` e mantém o registo para auditoria (em vez de `DELETE` que apagava). A ausência cancelada deixa de contar para sobreposição mas o histórico fica visível. |
| Prompt 133 | — | **Arquitetura de checklists dinâmicas:** novo modelo `ModeloChecklist` (`empresa_id`, `nome`, `descricao`, `seccoes[{nome, items[]}]`). `Propriedade` ganhou `modelo_checklist_id`. `Tarefa` ganhou `checklist_dinamica` (snapshot). `criarTarefa` injeta o snapshot do modelo na criação. `minhaTarefaDetalhe` injeta on-the-fly se a tarefa não tem snapshot mas a propriedade tem modelo. Novo `checklistController` com CRUD (`/api/gestor/checklists`). `toggleChecklistItem` (PATCH) para marcar/desmarcar items individuais. |
| Prompt 134 | — | **Sem alterações de backend significativas:** ecrãs de configuração (`/gestor/configuracoes/checklists`) e interface do staff são frontend. O backend já tinha o CRUD de `ModeloChecklist` (Prompt 133) e o `toggleChecklistItem`. |
| Prompt 135 | — | **Seed de checklists:** novo script `scripts/seedChecklists.js` + endpoint `POST /api/admin/seed-checklists` que cria 2 modelos base (Limpeza Standard + Detalhada V2) e associa o Standard às propriedades sem modelo. Idempotente. |
| Prompt 136 | — | **Sem alterações de backend:** fix do PDF (abandono do `html2pdf.js` → `window.print()`) é inteiramente frontend. |
| Prompt 137 | — | **Sem alterações de backend:** fix do `nome_hospede` nos cartões do staff (repassar `detalhes_reserva` ao `TaskCard`) é frontend. O backend já guardava o campo corretamente. |
| Prompt 137b | — | **Fix nome_hospede sempre vazio nas tarefas via webhook Smoobu:** (1) `processarReservaSmoobu` passou a chamar `enriquecerReservaSmoobu` **sempre que `nome_hospede` estiver em falta** (antes só chamava quando `!departure`, deixando o nome vazio se o webhook já trouxesse departure — o webhook oficial não envia `guestName`). (2) `enriquecerReservaSmoobu` agora cobre mais variantes do nome no Smoobu REST API: `guest.name`, `guest.firstName + guest.lastName`, `customerName`, `customer.name`, `bookedForName`, `name`. (3) `sincronizarReservas` (smoobuController) agora extrai o nome do hóspede do payload REST API com a mesma cobertura exaustiva, evitando fetches extra durante a sincronização em lote. (4) Novo endpoint `POST /api/admin/backfill-nomes-hospedes` que percorre as tarefas com `smoobu_reserva_id` mas sem `nome_hospede` e busca o nome via REST API. (5) Debug logs em `criarTarefa`, `minhaTarefaDetalhe` e `enriquecerReservaSmoobu`. |

| Prompt 138 (136 V2) | — | **Cérebro do Scheduler e Gravação da Viagem:** (1) **Fix Matemática SLA (480 min)** — `carga_total` agora envolvida em `Number(...)` com validação `Number.isFinite()` (bugs de concatenação de strings do aggregate). Se TODOS os staff excederem 480 min, a tarefa é gravada com `estado: 'nao_atribuida'` (novo estado, distinto de `por_atribuir`). `determinarUtilizadorAtribuido` agora devolve `{ utilizadorId, tempoViagem }`. `reatribuirTarefa` e Algoritmo VIP também com `Number()`. (2) **Cap de GPS** — `calcularTempoViagem` (scheduler.js) impõe `Math.min(tempo, 60)` (teto 1h) e fallback de 30 min se coordenadas inválidas (antes devolvia 0). (3) **Campo `tempo_viagem_minutos`** — novo campo no modelo `Tarefa` (Number, default 0). Guardado pelo webhook (criarTarefaPorReserva), `reatribuirTarefa`, `autoAtribuirTarefas` e `caoGuarda.js` (Fail-Safe). (4) `atualizarEstadoTarefa` aceita `nao_atribuida` no enum. 151/151 testes ✓. |
