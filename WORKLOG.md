# Worklog — Autocell

Worklog interno do projeto Autocell. Regista a evolução técnica do trabalho
efetuado (análises, melhorias, correções). Complementa o histórico do git
(`git log`) e a documentação técnica (`docs/BACKEND.md`, `docs/FRONTEND.md`).

> **Convenções do projeto** (definidas pelo utilizador):
> - Branch ativa: **`dev`**.
> - Linguagem: **pt-pt** (código, comentários, documentação, commits).
> - Sempre que o código é alterado, atualizar: `README.md`, `docs/BACKEND.md`,
>   `docs/FRONTEND.md` e este `WORKLOG.md`.
> - Commits no formato: `feat|fix|chore(escopo): descrição (Prompt N)`.

---

Task ID: A0
Agent: Z.ai Code
Task: Clonar o repositório Autocell (branch dev), guardar credenciais e analisar código + documentação + worklog para entender regras de processo e lógica.

Work Log:
- Clonado `https://github.com/makigero-lab/Autocell.git` na branch `dev` para `/home/z/Autocell` (127 commits, até "Prompt 91").
- Configurado `git config user.name "Makigero Lab"` + `user.email makigerorr@gmail.com`; remote `origin` já tem o token embutido (URL-encoded) → push/pull funcionam sem re-pedir credenciais.
- Credenciais guardadas em `/home/z/.autocell-config` (FORA do repo, para evitar commit de segredos).
- Lido `README.md`, `docs/BACKEND.md`, `docs/FRONTEND.md`, `agent-ctx/56-z-ai-code.md` (registo da Task 56).
- Analisada estrutura real de rotas (`frontend/src/app/`) e `frontend/src/middleware.ts`.
- Lidos `backend/.env.example`, `backend/package.json`, `frontend/.env.example`.

Stage Summary (regras de processo e lógica identificadas):
- **Stack:** Backend Node.js+Express+MongoDB (Mongoose) no Render · Frontend Next.js 14+TS+Tailwind+shadcn/ui na Vercel.
- **Multi-tenant SaaS** para Alojamento Local. Entidades: Empresa → (Propriedades, Utilizadores, Tarefas, Ausências, WebhookLog, Auditoria).
- **Roles:** `admin` (super admin, cross-tenant, painel `/admin`), `gestor` (gestor operacional, painel `/gestor/*`), `staff` (executante, painel `/staff/*` mobile-first).
- **Lógica central — Webhook Smoobu (`POST /webhooks/smoobu`):** responde 200 imediato e processa assíncrono. Fluxo: extrair dados da reserva → encontrar empresa via propriedade (`smoobu_id`) → listar staff+gestores ativos → filtrar ausências aprovadas + folgas fixas (`dias_folga`) → load balancing (carga do dia + tempo de viagem Haversine + SLA 420min) → atribuir ao menor carregado → se nenhum disponível, tarefa criada `por_atribuir`. Reage a `newReservation`/`cancellation`/`updateReservation`. Idempotente por `smoobu_reserva_id`. Propriedades inativas são ignoradas.
- **Ausências:** intervalos `data_inicio`/`data_fim` com `estado` (pendente/aprovada/rejeitada). Staff cria pedidos (sempre pendente); gestor aprova (→ redistribui tarefas via load balancer) ou rejeita. Só ausências `aprovada` bloqueiam atribuição. Falta súbita/baixa criam ausência aprovada + redistribuem.
- **Segurança:** JWT em cookie httpOnly (SameSite=Strict+Secure); proxy routes (`/api/gestor/[...path]`, `/api/staff/[...path]`) injetam `Authorization`; sem localStorage; rate limiting no login (5/15min) + global (100/15min); RBAC por role; CORS trancado a `FRONTEND_URL`.
- **Proteção de rotas:** middleware Edge (lê cookie, descodifica JWT sem verificar assinatura, valida role por área) + `RouteGuard` client-side. Login redireciona por role.
- **Push notifications:** Web Push API (VAPID); dispara em atribuição de tarefa, avarias reportadas, falta de emergência, daily briefing.
- **Avarias:** staff reporta avaria no detalhe da tarefa → cria tarefa de manutenção `por_atribuir` (SLA 480min) + notifica gestores.
- **Testes:** Jest+Supertest+mongodb-memory-server (103 testes na Task 56). CI GitHub Actions (frontend lint+tsc+build, backend test) nas branches main/dev.
- **Gaps de documentação identificados (a corrigir quando houver alterações):**
  1. `docs/FRONTEND.md` secções 3 e 11 ainda usam rotas `/admin/*` para a área do gestor — desatualizado desde a v1.30/v1.31 (rename `/admin`→`/gestor` + novo `/admin` super admin). As rotas reais são `/gestor/*` (gestor) e `/admin` (super admin).
  2. `docs/FRONTEND.md` ainda referencia role `manager` em alguns pontos; o role real é `gestor`.
  3. Tabelas de histórico param atrás: `BACKEND.md` em v1.24.0, `FRONTEND.md` em v1.13.0 — o git já vai até Prompt 91. Prompts 73-91 (FullCalendar, radar de risco, auto-atribuição, push, menu Ausências, etc.) não estão nas tabelas de histórico.
- **Pronto para receber prompts de melhoria/correção.** Próximo passo aguardar instruções do utilizador.

---

Task ID: A1 (Prompt 92)
Agent: Z.ai Code
Task: Upgrade dos modelos de dados (Propriedade + Tarefa) e forçar a atualização do Smoobu na Fase 1.5.

Work Log:
- Lido o worklog (Task A0) e os 3 ficheiros-alvo: `backend/models/Propriedade.js`, `backend/models/Tarefa.js`, `backend/controllers/smoobuController.js`.
- Lidos os testes existentes de `sincronizarPropriedades` em `backend/tests/integration.test.js` (secção 11b) e o `utils/geocoding.js` para perceber o impacto da alteração.
- **Alteração 1 — `models/Propriedade.js`:** adicionado `funcionario_preferencial_id` (ObjectId `ref: 'Utilizador'`, default `null`, indexado) com comentário a explicar que a lógica de prioridade no load balancer será ativada num prompt seguinte (preparação Fase 1.5).
- **Alteração 2 — `models/Tarefa.js`:** adicionado o objeto `detalhes_reserva` com sub-campos `checkin` (String), `checkout` (String), `pax` (Number, min 0), `nome_hospede` (String, trim). Comentário a explicar que o preenchimento via webhook/sincronização será feito num prompt seguinte.
- **Alteração 3 — `controllers/smoobuController.js` (`sincronizarPropriedades`):** no ramo "já existe", removida a guarda que só atualizava a morada quando estava `'A definir'`. Agora, para propriedades existentes, atualiza **SEMPRE** a `morada` (quando o Smoobu traz uma morada real, i.e. `moradaTexto !== 'A definir'`) e a `capacidade_hospedes` (quando o Smoobu traz um valor), refazendo o geocoding da morada nova e guardando com `await existente.save()`. Os restantes campos (nome, tempo_limpeza_minutos, ativo, checklist, funcionario_preferencial_id) continuam preservados. JSDoc da função reescrito para refletir o novo comportamento.
- **Testes:** o teste "preserva edições manuais" foi renomeado para "preserva nome/tempo/ativo quando o Smoobu não traz morada/capacidade no payload" (continua a passar — o mock não traz location/rooms) e adicionada a asserção `atualizadas === 0`. Adicionado novo teste "Prompt 92 — força update de morada + capacidade em propriedade existente" que cria uma propriedade com morada/capacidade antigas + edits manuais, sincroniza com um payload que traz morada nova + capacidade nova, e verifica que morada/capacidade foram sobrescritas mas nome/tempo/ativo foram preservados.
- **Documentação atualizada:** `docs/BACKEND.md` (tabelas dos modelos Propriedade e Tarefa repostas com todos os campos atuais + novos; secção 6.9 `sincronizar-propriedades` reescrita com o novo comportamento + nota a distinguir do `importarPropriedades`; entrada "Prompt 92" adicionada à tabela de histórico da secção 9), `README.md` (linha do endpoint `sincronizar-propriedades` atualizada).
- **Validação:** `npm test` no backend → **104/104 ✓** (15.0s), incluindo o novo teste e todos os anteriores. (O `sincronizarPropriedades` mocka `global.fetch`, pelo que o geocoding é tratado graciosamente — `obterCoordenadas` recebe um JSON não-array e devolve `null` sem afetar o teste.)

Stage Summary:
- 3 alterações de código entregues conforme o pedido do Prompt 92 (Fase 1.5).
- Campos novos (`funcionario_preferencial_id`, `detalhes_reserva`) ficam no schema mas **ainda não são populados/usados** pela lógica de negócio — ficam preparados para prompts seguintes (prioridade no load balancer + preenchimento de detalhes da reserva a partir do webhook/sincronização).
- `sincronizarPropriedades` passou de "preservar tudo" para "fonte de verdade = Smoobu para morada + capacidade_hospedes". Isto é mais agressivo que o `importarPropriedades` (que mantém o comportamento conservador de só preencher moradas `'A definir'`) — diferença documentada no BACKEND.md.
- Documentação (`README.md` + `docs/BACKEND.md` + `WORKLOG.md`) atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A2 (Prompt 93)
Agent: Z.ai Code
Task: Injetar detalhes_reserva no webhook + Algoritmo VIP (funcionário preferencial) no motor de atribuição.

Work Log:
- Lido o worklog (Tasks A0 + A1) e o `backend/controllers/webhookController.js` por completo (extrairDadosReserva, determinarUtilizadorAtribuido, criarTarefaPorReserva, atualizarTarefaPorReserva, webhookSmoobu).
- Lidos os testes do webhook em `backend/tests/integration.test.js` (secção 5) e o uso partilhado do load balancer em `tarefaController.autoAtribuirTarefas`.
- **Alteração 1 — `extrairDadosReserva`:** passa a extrair `detalhesReserva` ({ checkin, checkout, pax, nome_hospede }) do payload do Smoobu, cobrindo variantes: `arrival`/`departure` (webhook) e `start_date`/`end_date` (REST); `guests`/`numPeople`/`numberOfGuests`/`pax`/`adults+children` para pax; `guestName`/`guest_name`/`guest.name`/`firstName+lastName`/`name` para nome_hospede. `pax` normalizado a Number (null se inválido); `nome_hospede` com trim + slice(0,200).
- **Alteração 2 — `processarReservaSmoobu`:** propaga `detalhesReserva` para `criarTarefaPorReserva` e `atualizarTarefaPorReserva` (novas assinaturas).
- **Alteração 3 — `criarTarefaPorReserva`:** guarda `detalhes_reserva` no `Tarefa.create`; ao re-activar tarefa cancelada (reserva re-criada), atualiza também os detalhes.
- **Alteração 4 — `atualizarTarefaPorReserva`:** atualiza `detalhes_reserva` no update (reserva editada pode ter novos dados de hóspede/datas).
- **Alteração 5 — Algoritmo VIP em `determinarUtilizadorAtribuido`:** novo parâmetro opcional `propriedadeId`. Antes do load balancer geral, se a propriedade tiver `funcionario_preferencial_id` e esse staff estiver no conjunto de `disponiveis` (passou filtros de ausência aprovada + folga fixa), valida o SLA de 8h/dia via novo helper `calcularCargaLimpezaDia` (`cargaLimpeza + tempoNovaTarefa ≤ CAPACIDADE_MAXIMA_MINUTOS`). Se OK → atribui obrigatoriamente ao VIP (log `⭐`). Se o VIP não puder (indisponível ou excede SLA) → fallback para o load balancer geral (Haversine + menor carga), com log explicativo.
- **Alteração 6 — `criarTarefaPorReserva`:** passa `propriedade._id` ao `determinarUtilizadorAtribuido` para ativar o VIP.
- **Alteração 7 — `tarefaController.autoAtribuirTarefas`:** passa `tarefa.propriedade_id._id` ao load balancer partilhado, para o VIP também aplicar às tarefas órfãs (auto-atribuição em lote).
- **Testes:** adicionados 4 novos testes ao describe do webhook: (1) guarda detalhes_reserva (checkin/checkout/pax/nome_hospede); (2) VIP atribui ao preferencial quando disponível; (3) VIP fallback se o preferencial exceder o SLA de 8h (cria tarefa de 450 min + nova de 60 = 510 > 480); (4) VIP fallback se o preferencial tiver folga fixa no dia. As asserções de fallback verificam `not.toBe(preferencial._id)` (o load balancer geral pode escolher qualquer outro staff disponível, não necessariamente o criado no teste).
- **Validação:** `npm test` no backend → **108/108 ✓** (14.7s), incluindo os 4 novos testes.
- **Documentação atualizada:** `docs/BACKEND.md` (secção 3.2 reescrita com o fluxo atualizado de 9 passos incluindo o VIP + detalhes_reserva; entrada "Prompt 93" no histórico), `README.md` (linha do webhook atualizada).

Stage Summary:
- Detalhes da reserva (checkin, checkout, pax, nome_hospede) passam a ser extraídos do payload do Smoobu e guardados no campo `detalhes_reserva` da Tarefa, tanto na criação como no update e na re-activação.
- Algoritmo VIP ativo: o `funcionario_preferencial_id` da Propriedade (adicionado no Prompt 92) é agora respeitado pelo motor de atribuição. Se o preferencial estiver disponível e dentro do SLA de 8h/dia, a tarefa é-lhe atribuída obrigatoriamente; só há fallback para o load balancer geral se ele não puder.
- O VIP aplica-se tanto ao webhook (criação de tarefa por nova reserva) como à auto-atribuição em lote de tarefas órfãs.
- 108 testes a passar (+4). Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A3 (Prompt 94)
Agent: Z.ai Code
Task: Cron job "Agenda de Amanhã" — às 19:00 envia push ao staff com trabalho no dia seguinte.

Work Log:
- Lido o worklog (Tasks A0–A2), `backend/jobs/dailyBriefing.js` (padrão de cron job existente), `backend/utils/notificar.js` (`notificarUtilizador` fire-and-forget), `backend/server.js` (registo do dailyBriefing no arranque) e o final do ficheiro de testes.
- Confirmado que `node-cron` (^4.5.0) já é dependência — não foi preciso instalar.
- **Criado `backend/jobs/agendaAmanha.js`:**
  - `executarAgendaAmanha()` — calcula o intervalo do dia seguinte (meia-noite UTC) → procura `Tarefa` com `data` nesse intervalo e `estado ∈ { atribuida, por_atribuir }` → populate de `utilizador_id` (nome, ativo, eliminado_em) → agrupa por utilizador (só staff ativos não eliminados; `por_atribuir` sem utilizador não gera push) → para cada staff chama `notificarUtilizador(staffId, '📅 Agenda de Amanhã', 'Tens X tarefa(s) agendada(s). Entra na app para ver o itinerário', '/staff')` (singular/plural conforme o count). Devolve `{ processados, notificados, tarefas }`.
  - `iniciarAgendaAmanha()` — `cron.schedule('0 19 * * *', ..., { timezone: 'Europe/Lisbon' })`. Timezone estável (acomanha horário Verão/Inverno de PT mesmo em servidor UTC como o Render).
  - `notificarUtilizador` carregado via `require` lazy dentro da função (não no topo) para permitir `jest.spyOn` nos testes.
- **`backend/server.js`:** importado `iniciarAgendaAmanha` e chamado no arranque (dentro de `if (require.main === module)`, logo após `iniciarDailyBriefing()`, para não correr nos testes).
- **Testes (4 novos, secção 17 do `integration.test.js`):** spy em `notificarUtilizador` (mockResolvedValue) para validar chamadas sem depender do Web Push configurado. (1) notifica cada staff agrupado (staff1 com 2 → "2 tarefas agendadas"; staff2 com 1 → "1 tarefa agendada"; título + URL verificados); (2) ignora `por_atribuir` (sem utilizador), `concluida` e `cancelada` (só a atribuída conta); (3) sem tarefas amanhã → não notifica; (4) ignora staff inativo mesmo com tarefa atribuída.
- **Problema encontrado e resolvido:** os primeiros 2 testes falhavam porque o `agendaAmanha` importava `notificarUtilizador` no topo (referência fechada/closed-over) → o `jest.spyOn` no módulo não era usado. Solução: require lazy dentro de `executarAgendaAmanha` — o spy passa a interceptar corretamente. Comentário explicativo adicionado no topo do ficheiro.
- **Validação:** `npm test` no backend → **112/112 ✓** (14.7s), incluindo os 4 novos testes.
- **Documentação atualizada:** `docs/BACKEND.md` (nova secção 3.3 "Cron Jobs" com tabela dos 2 jobs + descrição detalhada do Agenda de Amanhã + nota sobre timezone; entrada "Prompt 94" no histórico).

Stage Summary:
- Novo cron job "Agenda de Amanhã" ativo: todos os dias às **19:00 (Europe/Lisbon)**, cada staff com trabalho no dia seguinte recebe uma push `📅 Agenda de Amanhã: Tens X tarefa(s) agendada(s). Entra na app para ver o itinerário`.
- Apenas dispara para staff ativos não eliminados com tarefas `atribuidas`. Tarefas `por_atribuir` (sem utilizador), `concluidas` e `canceladas` não contam.
- `notificarUtilizador` continua fire-and-forget (skip silencioso se não houver `pushSubscription` ou Web Push não configurado) — o staff sem subscrição ativa não gera erro.
- Timezone `Europe/Lisbon` nativo do node-cron → robusto em servidores UTC (Render).
- 112 testes a passar (+4). Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A4 (Prompt 95)
Agent: Z.ai Code
Task: Ecrã de Férias/Ausências definitivo + Staff Preferencial nas Propriedades + Card de Detalhes da Reserva (gestor + staff).

Work Log:
- Lido o worklog (Tasks A0–A3) e os ficheiros: `gestor/ausencias/page.tsx` (era redirect), `admin-sidebar.tsx` (menu já tinha o link), `gestor/propriedades/page.tsx` (modal de edição), `staff/detalhe-tarefa-client.tsx`, `staff/tarefas/[id]/page.tsx`, `gestor/tarefas/page.tsx`, `lib/api.ts`, `gestorController.atualizarPropriedade`, `ausenciaController.listarAusencias`, `authController.minhaTarefaDetalhe`.
- **Backend — `atualizarPropriedade` (gestorController.js):** passa a aceitar `funcionario_preferencial_id` no body. Aceita `null`/string vazia (remove) ou ObjectId; valida que é staff ativo (`role: 'staff'`, `ativo: true`, `eliminado_em: null`) da mesma empresa (400 caso contrário). Mensagem de "nenhum campo" atualizada. `npm test` → 112/112 ✓ (sem regressões).
- **Frontend `lib/api.ts`:** `PropriedadeDTO` + `funcionario_preferencial_id`; `TarefaMock` + `detalhes_reserva`; novo tipo `DetalhesReservaDTO`.
- **(1) Ecrã Ausências (`gestor/ausencias/page.tsx`):** substituído o redirect por uma **tabela definitiva** com TODAS as ausências (sem filtros): colunas Funcionário, Tipo (ícone Plane/Stethoscope/CalendarX/CircleDot), Período (formatado pt-PT), Estado (Badge: pendente/amarela, pendente_emergencia/vermelha, aprovada/verde, rejeitada/cinza), Notas (line-clamp-2), Ações (botão Trash → modal de confirmação → `DELETE /api/gestor/ausencias/:id` com otimismo). O menu lateral já apontava para `/gestor/ausencias` (mantido). Estados: loading, erro, vazio.
- **(2) Propriedades — Staff Preferencial (`gestor/propriedades/page.tsx`):** modal de Editar ganhou um **select de Funcionário Preferencial**. Lista staff ativo da empresa (carregado via `GET /api/gestor/equipa`, filtrado `role==='staff' && ativo`); opção "Nenhum (usar load balancer geral)" com value="" → null. `editForm` + `abrirEdicao` + `handleEditar` atualizados; grava via `PUT /api/gestor/propriedades/:id` com `funcionario_preferencial_id` (string vazia → null).
- **(3) Detalhes da Reserva — componente partilhado `components/detalhes-reserva-card.tsx`:** Card de destaque (border primary, bg primary/5) com 4 células: Check-in (LogIn verde), Check-out (LogOut vermelho), Hóspedes/pax (Users), Nome do Hóspede (User). Datas formatadas pt-PT. Só renderiza se `detalhes_reserva` existir e tiver pelo menos um campo (devolve `null` caso contrário).
- **(3a) Staff:** `staff/tarefas/[id]/page.tsx` passa `detalhes_reserva` da tarefa real para o `DetalheTarefaClient`; o card é renderizado no topo do `<main>` (antes da checklist).
- **(3b) Gestor:** criado `components/gestor/detalhe-tarefa-modal.tsx` — modal completo com propriedade/tipo/estado, metadados (data/hora, tempo, morada, staff), o `DetalhesReservaCard`, observações do gestor, observações do staff e avarias reportadas. Integrado na `gestor/tarefas/page.tsx`: novo botão Eye (Ver detalhe) na coluna de Ações de cada tarefa + estado `detalheTarefa`. Interface `TarefaAdmin` alargada com `observacoes_staff` e `detalhes_reserva`.
- **Erros de TypeScript corrigidos:** (a) `AusenciaAmp extends Omit<AusenciaDTO, "tipo">` (o `tipo` amplo `ferias|doenca|folga|outro` não é compatível com o `TipoAusencia` estrito do api.ts); (b) typo `a.tipo` → `aEliminar.tipo` no modal de confirmação.
- **Validação:** `npm run lint` ✓ No ESLint warnings or errors · `npx tsc --noEmit` ✓ sem erros · `npm run build` ✓ todas as rotas compilaram (`/gestor/ausencias` 4.91 kB, `/gestor/propriedades` 7 kB, `/gestor/tarefas` 8.14 kB, `/staff/tarefas/[id]` 4.7 kB).
- **Documentação atualizada:** `docs/FRONTEND.md` (entrada "Prompt 95" no histórico), `docs/BACKEND.md` (entrada "Prompt 95" no histórico — `atualizarPropriedade` aceita `funcionario_preferencial_id`).

Stage Summary:
- **Ecrã de Ausências definitivo** ativo: `/gestor/ausencias` mostra TODAS as ausências da empresa em tabela, com eliminação direta (modal de confirmação + otimismo). O menu lateral já apontava para lá.
- **Staff Preferencial configurável**: o gestor pode, no modal de Editar Propriedade, escolher o funcionário preferencial (Algoritmo VIP do Prompt 93). O backend valida que é staff ativo da empresa.
- **Card de Detalhes da Reserva** visível para gestor (no novo modal de detalhe de tarefa, aberto via botão Eye na tabela de tarefas) e para staff (no topo do ecrã de detalhe da tarefa no mobile). Mostra check-in, check-out, hóspedes (pax) e nome do hóspede quando existirem.
- Lint + tsc + build ✓. 112 testes backend ✓. Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A5 (Prompt 96)
Agent: Z.ai Code
Task: Cron job "Cão de Guarda" — às 18:00 lembra o staff das tarefas de limpeza de hoje ainda não concluídas.

Work Log:
- Lido o worklog (Tasks A0–A4) e `backend/jobs/agendaAmanha.js` (padrão de cron job com require lazy + timezone Europe/Lisbon).
- **Criado `backend/jobs/caoGuarda.js`:**
  - `executarCaoGuarda()` — calcula o intervalo do dia ATUAL (meia-noite UTC) → procura `Tarefa` com `tipo: 'limpeza'`, `utilizador_id ≠ null`, `estado ∈ { atribuida, em_curso }` (atribuídas mas não concluídas) → populate de `propriedade_id` (nome) + `utilizador_id` (ativo, eliminado_em) → para cada tarefa esquecida chama `notificarUtilizador(staffId, '⚠️ Tarefa Incompleta', 'Ainda não marcaste a limpeza da [nome da propriedade] como concluída. Por favor, atualiza a app!', '/staff')` (fire-and-forget). Ignora staff inativo/eliminado. Devolve `{ encontradas, notificadas }`.
  - `iniciarCaoGuarda()` — `cron.schedule('0 18 * * *', ..., { timezone: 'Europe/Lisbon' })`.
  - `notificarUtilizador` via require lazy (permite `jest.spyOn` nos testes, mesmo padrão do `agendaAmanha`).
  - **Nota sobre estados:** o modelo `Tarefa` tem `['por_atribuir','atribuida','em_curso','concluida','cancelada']` — não existe `'pendente'`. O prompt pede 'pendente' ou 'em_curso'; `'atribuida'` é o equivalente (atribuída mas ainda não iniciada). Comentário explicativo no ficheiro.
  - **Uma push por tarefa:** ao contrário do `Agenda de Amanhã` (agrupa por staff), o Cão de Guarda envia uma push POR TAREFA esquecida (a mensagem inclui o nome da propriedade, pelo que cada push é específica). Documentado.
- **`backend/server.js`:** importado `iniciarCaoGuarda` e chamado no arranque (dentro de `if (require.main === module)`, logo após `iniciarAgendaAmanha()`).
- **Testes (4 novos, secção 18 do `integration.test.js`):** spy em `notificarUtilizador`. (1) notifica por cada tarefa esquecida (staff1 com 1 atribuída + 1 em_curso → 2 pushes; staff2 com 1 → 1 push; total 3; verifica título/corpo com nome da propriedade/link); (2) ignora concluídas, canceladas, por_atribuir (sem utilizador) e manutencao (não é limpeza) — só 1 conta; (3) sem tarefas → não notifica; (4) ignora staff inativo mesmo com tarefa de limpeza atribuída (encontrada=1, notificadas=0).
- **Validação:** `npm test` no backend → **116/116 ✓** (15.6s), incluindo os 4 novos testes.
- **Documentação atualizada:** `docs/BACKEND.md` (secção 3.3 atualizada: tabela dos 3 jobs + nova subsecção "Cão de Guarda" com nota sobre estados + nota "uma push por tarefa"; entrada "Prompt 96" no histórico).

Stage Summary:
- Novo cron job "Cão de Guarda" ativo: todos os dias às **18:00 (Europe/Lisbon)**, cada tarefa de limpeza de HOJE ainda não concluída (estado `atribuida` ou `em_curso`) gera uma push `⚠️ Tarefa Incompleta — Ainda não marcaste a limpeza da [propriedade] como concluída. Por favor, atualiza a app!` à funcionária responsável.
- Filtro: `tipo: 'limpeza'` + `utilizador_id ≠ null` + `estado ∈ { atribuida, em_curso }` + data no dia atual. Ignora concluídas, canceladas, por_atribuir, outros tipos e staff inativo/eliminado.
- Uma push POR TAREFA (não agrupado por staff) — cada push menciona a propriedade específica.
- Horário do dia completo: 08h Daily Briefing → 18h Cão de Guarda → 19h Agenda de Amanhã.
- 116 testes a passar (+4). Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A6 (Prompt 97)
Agent: Z.ai Code
Task: Desligar a reatribuição automática — ausências e desativação de propriedades passam a apenas desatribuir (sem load balancer).

Work Log:
- Lido o worklog (Tasks A0–A5) e os 4 sítios que reatribuíam via load balancer: `ausenciaController.aprovarRejeitarAusencia` (+ helper `redistribuirTarefasPeriodo`), `gestorController.reportarFaltaSubita`, `gestorController.registarBaixaProlongada`. Confirmado que `gestorController.alternarEstadoPropriedade` apagava as tarefas futuras (v1.35.0/Prompt 73). Confirmado que `staffController` cria ausências como 'pendente'/'pendente_emergencia' (não disparam reatribuição).
- **`ausenciaController.js`:**
  - `registarAusencia` (POST): passou a chamar o novo helper `desatribuirTarefasPeriodo` após criar a ausência aprovada (resposta inclui `desatribuicao: { total, desatribuidas }`).
  - `aprovarRejeitarAusencia` (PATCH): aprovar deixa de chamar o load balancer — usa `desatribuirTarefasPeriodo` (resposta `redistribuicao = { total, desatribuidas }`).
  - Novo helper `desatribuirTarefasPeriodo(utilizadorId, inicio, fim)`: procura tarefas `atribuida` no período e passa a `utilizador_id = null + estado = 'por_atribuir'`. Devolve `{ total, desatribuidas }`. **NÃO chama o load balancer.** Substitui o antigo `redistribuirTarefasPeriodo` (removido).
- **`gestorController.js`:**
  - `reportarFaltaSubita`: deixou de reatribuir via `determinarUtilizadorAtribuido`; agora desatribui cada tarefa de hoje do staff (`utilizador_id = null + estado = 'por_atribuir'`). Resposta `desatribuidas` (em vez de `reatribuidas/orfas`).
  - `registarBaixaProlongada`: mesma mudança — desatribui as tarefas do período em vez de reatribuir. Resposta `desatribuidas`.
  - `alternarEstadoPropriedade`: ao DESATIVAR, deixou de APAGAR tarefas futuras e passou a DESATRIBUIR (`updateMany` com `utilizador_id: null, estado: 'por_atribuir'`). Resposta `tarefasDesatribuidas` (em vez de `tarefasApagadas`).
- **Frontend `gestor/propriedades/page.tsx`:** `handleToggleAtivo` atualizado para ler `tarefasDesatribuidas` (em vez de `tarefasApagadas`) e mostrar feedback "desatribuída(s) (por atribuir)".
- **Testes:**
  - Atualizado o teste "admin aprova ausência" (secção 12) — agora verifica `redistribuicao.desatribuidas` + `utilizador_id === null` + `estado === 'por_atribuir'`.
  - Adicionados 3 novos testes (secção 19 "Prompt 97"): (1) desativar propriedade desatribui (não apaga — a tarefa continua a existir, `por_atribuir`); (2) falta súbita desatribui (não reatribui ao outro staff disponível); (3) baixa prolongada desatribui (não reatribui ao outro staff).
- **Validação:** `npm test` backend → **119/119 ✓** (15.2s). Frontend: `npm run lint` ✓ · `npx tsc --noEmit` ✓ · `npm run build` ✓.
- **Documentação atualizada:** `docs/BACKEND.md` (entrada "Prompt 97" no histórico).

Stage Summary:
- **Fim da reatribuição automática:** ausências (criar ou aprovar), falta súbita e baixa prolongada deixam de chamar o load balancer. As tarefas afetadas passam apenas a `utilizador_id = null` + `estado = 'por_atribuir'` — o recálculo fica a cargo do Gestor (manual, via "Auto-Atribuir Pendentes" do Prompt 86) ou do Fail-Safe noturno (futuro).
- **Desativação de propriedades:** deixou de apagar tarefas futuras (v1.35.0/Prompt 73) — agora desatribui (mantém as tarefas no calendário como `por_atribuir`, prontas para reatribuição manual).
- Isto evita disparos automáticos e spam de notificações push quando há mudanças de última hora (falta súbita, férias aprovadas, propriedade suspensa).
- O load balancer (`determinarUtilizadorAtribuido` + Algoritmo VIP) mantém-se ativo **apenas** no webhook (criação de tarefa por nova reserva) e na auto-atribuição manual em lote (`tarefaController.autoAtribuirTarefas`).
- 119 testes a passar (+3). Lint + tsc + build ✓. Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A7 (Prompt 98)
Agent: Z.ai Code
Task: Rede de Segurança das 18h — auto-atribuição de emergência das tarefas órfãs de amanhã no cron job do Cão de Guarda (antes dos alertas).

Work Log:
- Lido o worklog (Tasks A0–A6), o `backend/jobs/caoGuarda.js` (Prompt 96 — alertas de tarefas incompletas) e o `backend/controllers/tarefaController.autoAtribuirTarefas` (padrão de uso do load balancer + scheduler + notificação para reatribuir órfãs).
- **Refactorização do `backend/jobs/caoGuarda.js` em duas fases:**
  - **FASE A — `autoAtribuicaoEmergencia()` (nova, Prompt 98):** calcula o intervalo do dia SEGUINTE (meia-noite UTC) → procura `Tarefa` com `estado: 'por_atribuir'` + `utilizador_id: null` (órfãs) → populate de `propriedade_id` (nome + coordenadas) → para cada tarefa, invoca `determinarUtilizadorAtribuido` (load balancer: Algoritmo VIP + Haversine + SLA 8h) passando `empresa_id`, `range`, `coordenadas`, `tempoNovaTarefa`, `propriedadeId` → se encontrar staff: recalcula hora via `calcularInicioTarefaUtilizador` (scheduler sequencial, best-effort), `Tarefa.updateOne` com `utilizador_id + estado 'atribuida' + nova data`, e envia push `🧹 Nova Limpeza Atribuída` (fire-and-forget) → se não houver staff: mantém `por_atribuir` (órfã). Devolve `{ encontradas, atribuidas, orfas }`.
  - **FASE B — `alertasTarefasIncompletas()` (Prompt 96, extraída para função própria):** inalterada — push `⚠️ Tarefa Incompleta` por cada tarefa de limpeza de hoje não concluída. Devolve `{ encontradas, notificadas }`.
  - **`executarCaoGuarda()`** agora corre **Fase A antes da Fase B** (o prompt é explícito: a auto-atribuição corre ANTES dos alertas) e devolve `{ failSafe, alertas }`.
  - `determinarUtilizadorAtribuido` e `notificarUtilizador` carregados via `require` lazy dentro das funções (permite `jest.spyOn` nos testes, mesmo padrão do `agendaAmanha`).
  - `module.exports` agora inclui `autoAtribuicaoEmergencia` e `alertasTarefasIncompletas` para testes isolados.
- **Testes:**
  - 4 testes existentes do Prompt 96 atualizados para `resultado.alertas.*` (a estrutura de retorno mudou de `{ encontradas, notificadas }` para `{ failSafe, alertas }`).
  - 4 novos testes (secção 20 "Prompt 98"): (1) atribui órfãs de amanhã via load balancer (verifica `atribuidas`, `estado 'atribuida'`, push `🧹 Nova Limpeza Atribuída` com nome da propriedade); (2) sem órfãs → não faz nada; (3) sem staff disponível (desativa todos os staff da empresa) → tarefa mantém-se `por_atribuir` (órfã); (4) não mexe em tarefas de hoje nem em já atribuídas de amanhã.
  - **Problema encontrado e resolvido:** o teste "sem staff disponível" falhava inicialmente porque staff de testes anteriores (e.g. `staff.webhook@teste.pt`) ficavam na `empresaId`. Solução: `Utilizador.updateMany({ empresa_id: empresaId, role: 'staff' }, { $set: { ativo: false } })` no início do teste para garantir que não há staff ativo.
- **Validação:** `npm test` backend → **123/123 ✓** (15.6s), incluindo os 4 novos testes e os 4 atualizados.
- **Documentação atualizada:** `docs/BACKEND.md` (secção 3.3 — Cão de Guarda agora descreve as 2 fases em detalhe com nota sobre o objetivo do Fail-Safe e a complementaridade com o Prompt 97; linha da tabela atualizada; entrada "Prompt 98" no histórico).

Stage Summary:
- **Fail-Safe ativo às 18:00:** o cron job do Cão de Guarda agora começa por **auto-atribuir** as tarefas órfãs de amanhã (`por_atribuir`) via load balancer (Algoritmo VIP + Haversine + SLA 8h + scheduler sequencial + push de notificação), e só **depois** envia os alertas de tarefas de hoje incompletas (Prompt 96).
- **Objetivo cumprido:** quando o relógio das 19:00 (Agenda de Amanhã, Prompt 94) correr uma hora depois, as escalas do dia seguinte já estão 100% preenchidas — os funcionários recebem a notificação com as atribuições completas.
- **Complementa o Prompt 97:** as tarefas desatribuídas por ausências (criar/aprovar), falta súbita, baixa prolongada e desativação de propriedades (que deixaram de ser reatribuídas automaticamente) são agora reatribuídas aqui de forma **centralizada e controlada**, uma única vez por dia, evitando disparos automáticos e spam de notificações durante o dia.
- O load balancer mantém-se ativo em 3 sítios: webhook (nova reserva), auto-atribuição manual em lote (gestor) e **Fail-Safe noturno (novo)**.
- 123 testes a passar (+4). Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A8 (Ajuste — ocultar indisponíveis do dropdown)
Agent: Z.ai Code
Task: No modal de atribuição de tarefas, os staff indisponíveis (férias/doença/ausência) não devem aparecer na lista de seleção.

Work Log:
- Re-clonado o repositório (o `/home/z/Autocell` tinha sido removido) na branch `dev` (commit ff78b19, Prompt 98).
- Lido o modal "Atribuir Tarefa" em `frontend/src/app/gestor/tarefas/page.tsx` (linhas 818-855): o `<select>` mostrava TODOS os staff com `staff.map()`, marcando os indisponíveis como `<option disabled>` com label "— 🌴 Indisponível (Férias/Doença/Ausência)" e um aviso amarelo abaixo.
- Confirmado o mesmo padrão no modal de reatribuição do Calendário (`frontend/src/app/gestor/calendario/page.tsx` linhas 858-881) — mesmo comportamento com `equipa.map()`.
- **Alteração 1 — `/gestor/tarefas/page.tsx`:** o `<select>` agora faz `.filter((u) => !indisponiveis.some((i) => i.utilizador_id === u._id))` antes do `.map()`, pelo que os indisponíveis **não aparecem** na lista. Removida a lógica de `disabled`/label especial. Aviso amarelo atualizado: "foram omitidos da lista" (era "não podem receber tarefas").
- **Alteração 2 — `/gestor/calendario/page.tsx`:** mesma correção aplicada ao modal de reatribuição do calendário (`.filter()` antes do `.map()`, sem `disabled`, aviso atualizado).
- **Validação:** `npm run lint` ✓ · `npx tsc --noEmit` ✓ · `npm run build` ✓ (todas as rotas compilaram).
- **Documentação atualizada:** `docs/FRONTEND.md` (entrada "Ajuste" no histórico).

Stage Summary:
- Nos modais de atribuição/reatribuição (Tarefas e Calendário), a lista de staff só mostra quem está disponível nesse dia. Os indisponíveis (férias/doença/ausência aprovada) são omitidos do dropdown em vez de aparecem a cinzento/desativados.
- O aviso amarelo mantém-se, agora a informar quantos foram omitidos.
- Lint + tsc + build ✓. Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A9 (Prompt 99)
Agent: Z.ai Code
Task: Ecrã de Relatório no Calendário — Toggle Vista Calendário/Tabela + botão Exportar Excel (xlsx).

Work Log:
- Lido o worklog (Tasks A0–A8) e a página `frontend/src/app/gestor/calendario/page.tsx` (estrutura, filtros, FullCalendar, modal de detalhe, interface `TarefaCalendario`).
- Confirmado que `xlsx` não estava instalado → `npm install xlsx` (^0.18.5) no `frontend/`.
- **Interface `TarefaCalendario`:** alargada com `detalhes_reserva?: { checkin, checkout, pax, nome_hospede } | null` (para a coluna Reserva).
- **Helpers da Vista Tabela** (junto aos helpers existentes): `ESTADO_LABEL_TAB`, `ESTADO_VARIANT_TAB` (mapeamento para variantes do Badge: por_atribuir=destructive, atribuida=default, em_curso=warning, concluida=success, cancelada=outline), `formatarDataDMY` (DD/MM/YYYY), `formatarDataHoraCurta` (DD/MM/YYYY ou DD/MM/YYYY HH:mm), `formatarReserva` (`In: [checkin] Out: [checkout] - [pax] pax`), `formatarHorario` (`HH:mm - HH:mm`).
- **Estado:** adicionado `vista: "calendario" | "tabela"` (default "calendario") + `exportando` (loading do botão).
- **`tarefasTabela`** (useMemo): filtra `tipo !== "ausencia" && tipo !== "folga_fixa"` (só tarefas reais) + ordena por data crescente.
- **`exportarExcel`** (useCallback): `await import("xlsx")` (import dinâmico para não entrar no bundle inicial) → `json_to_sheet` com colunas Data/Propriedade/Reserva/Funcionário/Horário/Estado → `!cols` com larguras estimadas → `book_new` + `book_append_sheet` ("Limpezas") → `writeFile(wb, "Relatorio_Limpezas.xlsx")`. Todos os campos como texto (datas DD/MM/YYYY). Estado `exportando` para feedback.
- **Cabeçalho:** adicionado o **Toggle de vistas** (botões "Vista Calendário" / "Vista Tabela" com `aria-pressed`, estilo segmented control) e o botão **Exportar Excel** (ícone Download, desativado se `tarefasTabela.length === 0`).
- **JSX:** FullCalendar envolvido em `{vista === "calendario" && (...)}`. Adicionada a **Vista Tabela** em `{vista === "tabela" && (...)}`: estados loading/vazio/tabela. A tabela tem 6 colunas (Data, Propriedade, Reserva, Funcionário, Horário, Estado com Badge), linhas clicáveis (abrem o modal de detalhe existente), e um rodapé com a contagem e o período.
- **Ícones:** importados `Table` e `Download` do lucide-react.
- **Removido um `</div>` extra** que ficou do wrapper original do FullCalendar após a refactorização.
- **Validação:** `npm run lint` ✓ No ESLint warnings or errors · `npx tsc --noEmit` ✓ sem erros · `npm run build` ✓ todas as rotas compilaram (`/gestor/calendario` 88.1 kB — o xlsx é importado dinamicamente, não entra no bundle inicial).
- **Documentação atualizada:** `docs/FRONTEND.md` (entrada "Prompt 99" no histórico).

Stage Summary:
- **Toggle de vistas** ativo no Calendário Operacional: o gestor alterna entre "Vista Calendário" (FullCalendar, comportamento original) e "Vista Tabela" (Data Table com as 6 colunas pedidas).
- **Vista Tabela:** Data (DD/MM/YYYY), Propriedade, Reserva (`In: [checkin] Out: [checkout] - [pax] pax` usando `detalhes_reserva`), Funcionário (nome ou "Por Atribuir" a amarelo), Horário (`HH:mm - HH:mm`), Estado (Badge colorido). Linhas clicáveis abrem o modal de detalhe. Respeita os filtros e o período do calendário.
- **Exportar Excel:** botão que gera `Relatorio_Limpezas.xlsx` com os dados visíveis na tabela, todos formatados como texto (datas DD/MM/YYYY). Usa `xlsx` (^0.18.5) importado dinamicamente.
- Lint + tsc + build ✓. Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A10 (Prompt 100)
Agent: Z.ai Code
Task: Garantir os dados para o Excel — endpoint traz detalhes_reserva; células de reserva em branco se não houver; estados traduzidos para PT.

Work Log:
- Lido o worklog (Tasks A0–A9) e o `backend/controllers/gestorController.getDadosCalendario` (endpoint `GET /api/gestor/calendario/dados`).
- **Verificação do backend:** o endpoint já faz `.populate('propriedade_id', 'nome morada coordenadas')` + `.populate('utilizador_id', 'nome')` e usa `.lean()` **sem `.select()`**, pelo que **todos os campos do modelo Tarefa são devolvidos** — incluindo `detalhes_reserva` (adicionado no Prompt 92). Não foi preciso alterar o código do endpoint.
- **Testes backend (2 novos, secção 5 "GET /api/gestor/calendario/dados"):**
  - (1) Cria tarefa com `detalhes_reserva` preenchido (checkin/checkout/pax/nome_hospede) → verifica que o endpoint devolve os 4 sub-campos.
  - (2) Cria tarefa de manutenção SEM `detalhes_reserva` → verifica que o campo existe (objeto com defaults null) mas sem dados reais (não quebra o frontend/Excel).
- **Frontend `gestor/calendario/page.tsx`:**
  - Novo helper `formatarReservaExcel` (variante do `formatarReserva`): devolve **string vazia** quando não há `detalhes_reserva` (ex: manutenção) — a célula do Excel fica em branco em vez de "—". Sub-campos em falta também vazios; se nenhum preenchido, devolve vazio (não "In:  Out:  - ").
  - `exportarExcel` atualizada para usar `formatarReservaExcel` + deixar em branco Propriedade/Horário em falta (string vazia em vez de "—"). Funcionário mantém "Por Atribuir" (informativo).
  - `ESTADO_LABEL_TAB`: `em_curso` passa a "Em Curso" (C maiúsculo, capitalização de título) para corresponder ao pedido do prompt. Restantes estados já estavam traduzidos: Por Atribuir, Atribuída, Concluída, Cancelada.
- **Validação:** backend `npm test` → **125/125 ✓** (+2 novos). Frontend: `npm run lint` ✓ · `npx tsc --noEmit` ✓ · `npm run build` ✓.
- **Documentação atualizada:** `docs/BACKEND.md` (entrada "Prompt 100" no histórico — confirmação + testes), `docs/FRONTEND.md` (entrada "Prompt 100" — robustez do Excel + tradução).

Stage Summary:
- **Backend:** o `GET /api/gestor/calendario/dados` já traz `detalhes_reserva` (e os populates de propriedade/utilizador) — confirmado com 2 novos testes de regressão. Sem alterações de código.
- **Excel robusto:** tarefas sem `detalhes_reserva` (ex: manutenção) ficam com a célula de Reserva **em branco** no Excel (não "—"), não quebrando a exportação. Propriedade/Horário em falta também ficam em branco.
- **Estados traduzidos:** no Excel, `em_curso` → "Em Curso", `por_atribuir` → "Por Atribuir", `atribuida` → "Atribuída", `concluida` → "Concluída", `cancelada` → "Cancelada".
- O cliente pode agora descarregar o Excel mensal e responder a perguntas como "Quantas casas a Maria limpou?" ou "A que horas aconteceram as limpezas de checkout?".
- 125 testes backend (+2). Lint + tsc + build ✓. Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A11 (Ajuste — override admin na impersonação)
Agent: Z.ai Code
Task: Corrigir erro "Não foi encontrado um gestor ativo para a empresa X" ao impersonar empresa sem gestor — admin deve ter override total.

Work Log:
- Lido o worklog (Tasks A0–A10) e `backend/controllers/superAdminController.impersonarGestor` (linha 109 devolvia 404 quando a empresa não tinha gestor ativo).
- Verificado o middleware `isGestor` (`backend/middleware/requireRole.js`): permite `admin` e `gestor`. Ou seja, um token com `role: 'gestor'` passa em todos os endpoints do painel `/gestor/*`.
- Verificado o middleware do frontend (`frontend/src/middleware.ts`): redireciona `admin` para `/admin` se tentar aceder a `/gestor` (linha 89-91). Por isso, o token de override **não pode** ter `role: 'admin'` — tem de ter `role: 'gestor'` (o admin impersona um gestor) para o frontend deixar entrar no `/gestor`.
- Verificado `obterEmpresaId` (`backend/controllers/gestorController.js`): lê `req.user.empresa_id` do token (não da BD). Os endpoints do gestor usam este `empresa_id` para filtrar os dados.
- **Correção em `superAdminController.impersonarGestor`:** quando a empresa não tem gestor ativo, em vez de devolver 404, o sistema gera um token JWT com:
  - `id`: o id real do admin (req.user.id) — para auditoria (`registarAuditoria` usa `req.user.id`).
  - `nome`/`email`: do admin (carregado via `Utilizador.findById(req.user.id)`).
  - `role`: `'gestor'` (o admin impersona um gestor; o frontend middleware e o `isGestor` do backend deixam passar).
  - `empresa_id`: o id da empresa alvo (override).
  - Log informativo: `ℹ️ [impersonarGestor] Empresa "X" sem gestor ativo — admin "email" a aceder em modo override`.
  - JSDoc atualizado a documentar o override.
- **Teste novo (secção 14 "Super Admin"):** cria uma empresa sem gestor (só staff) → admin faz POST /api/admin/empresas/:id/impersonar → 200 (não 404) + token + `utilizador.role === 'gestor'` + `utilizador.empresa_id === empSemGestor._id` + `utilizador.id === adminId` (o próprio admin). Verifica ainda que o token dá acesso ao `/api/gestor/dashboard` da empresa alvo (200).
- **Nota sobre `/api/auth/me`:** o endpoint `me` lê o utilizador da BD pelo `id` do token (o admin) e devolve o `empresa_id` REAL do admin, não o override. Isto é esperado — o override só afeta `req.user.empresa_id` (lido do token) nos endpoints do painel gestor. O teste documenta isto num comentário.
- **Validação:** `npm test` backend → **126/126 ✓** (+1 novo). Frontend: `npm run lint` ✓ · `npx tsc --noEmit` ✓ (sem alterações de código no frontend — o proxy route e o redirect para `/gestor` já funcionam com o token de role 'gestor').
- **Documentação atualizada:** `docs/BACKEND.md` (entrada "Ajuste" no histórico).

Stage Summary:
- **Erro corrigido:** ao impersonar uma empresa sem gestor ativo, o admin deixou de receber "Não foi encontrado um gestor ativo para a empresa X" (404). Agora recebe 200 + um token de override (role 'gestor' + empresa_id da empresa alvo) que lhe dá acesso ao painel `/gestor/*` (dashboard, propriedades, tarefas) dessa empresa.
- **Override total do admin:** o admin consegue aceder aos dados de qualquer empresa baseando-se apenas no `empresa_id`, ignorando a necessidade de existir um gestor ativo. O id real do admin fica no token para auditoria.
- O frontend não precisou de alterações — o proxy route substitui o cookie pelo novo token e o redirect para `/gestor` funciona (role 'gestor' passa no middleware).
- 126 testes backend (+1). Lint + tsc ✓. Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A12 (Prompt 101)
Agent: Z.ai Code
Task: Controlo de utilizadores no painel de Admin — admin gere utilizadores de qualquer empresa (lista, toggle estado, criar gestor).

Work Log:
- Lido o worklog (Tasks A0–A11), `backend/controllers/superAdminController.js`, `backend/routes/adminRoutes.js`, `frontend/src/app/admin/page.tsx`, o proxy route das empresas e o `criarMembroEquipa`/`alternarEstadoMembro` do gestorController (para reutilizar padrões).
- **Backend — `superAdminController.js` (3 novos endpoints):**
  - `listarUtilizadoresEmpresa` (GET `/api/admin/empresas/:empresaId/utilizadores`): lista todos os utilizadores (`eliminado_em: null`) da empresa, sem `password_hash`, ordenados por role + nome.
  - `criarUtilizadorEmpresa` (POST): cria gestor/staff nessa empresa; `empresa_id` vem do URL (garante associação correta); rejeita role 'admin' (403, verificado antes da validação genérica para devolver 403 específico), valida email único global (409), password ≥ 6 caracteres; default role 'gestor' (caso de uso: empresa sem gestor). Auditoria registada com `empresa_id` da empresa alvo. Hash bcrypt.
  - `alternarEstadoUtilizadorEmpresa` (PATCH `.../utilizadores/:utilizadorId/estado`): alterna ativo/inativo (ou `{ ativo: boolean }` explícito); rejeita modificar admins (403); valida que o utilizador pertence à empresa do URL (404 caso contrário). Auditoria.
  - Helper `carregarEmpresa(empresaId)` partilhado pelos 3 endpoints.
  - Imports adicionados: `bcrypt`, `registarAuditoria`.
- **Backend — `adminRoutes.js`:** registadas as 3 novas rotas (todas protegidas por `auth + isAdmin` já aplicado via `router.use`).
- **Backend — testes (5 novos, secção 14 "Super Admin"):** (1) GET lista utilizadores (401 sem token + 200 admin + sem password_hash); (2) POST cria gestor (201 + associação correta + sem password_hash); (3) POST rejeita role admin (403) + email duplicado (409); (4) PATCH toggle alterna 3x (true→false→true→false); (5) PATCH com empresa errada (404). `npm test` → **131/131 ✓**.
- **Frontend — proxy routes (2 novos):**
  - `api/admin/empresas/[empresaId]/utilizadores/route.ts` (GET + POST) — injeta token do cookie, encaminha para o backend.
  - `api/admin/empresas/[empresaId]/utilizadores/[utilizadorId]/estado/route.ts` (PATCH).
- **Frontend — `admin/page.tsx`:**
  - Botão **"Gerir Utilizadores"** (ícone Users) na coluna de Ações de cada empresa.
  - **Modal** (Dialog) que lista utilizadores via GET: tabela com Nome, Email, Role (Badge), Estado (Badge) + botão **Ativar/Desativar** (ícone Power, com loading + disabled para admins).
  - Botão **"Criar Novo Gestor"** no fundo → mini-formulário (Nome, Email, Password) → POST com `role: 'gestor'`. Validações client-side (obrigatórios, password ≥ 6). Toast de sucesso.
  - Tipo `UtilizadorEmpresaDTO`. Imports: `Users`, `Power`, `UserPlus` (lucide), `Dialog`, `Input`.
  - Após toggle/criar, recarrega a lista de empresas (o gestor pode ter mudado).
- **Validação:** backend 131/131 ✓. Frontend: `npm run lint` ✓ · `npx tsc --noEmit` ✓ · `npm run build` ✓.
- **Documentação atualizada:** `README.md` (3 novos endpoints na tabela), `docs/BACKEND.md` (entrada "Prompt 101" no histórico), `docs/FRONTEND.md` (entrada "Prompt 101").

Stage Summary:
- **Painel de Admin supremo:** o Super Admin consegue agora gerir os utilizadores de qualquer empresa diretamente do `/admin`, sem precisar de impersonar. Botão "Gerir Utilizadores" por empresa → modal com lista completa + toggle ativo/inativo + criar gestor.
- **3 novos endpoints backend** (todos `auth + isAdmin`): listar, criar (gestor/staff), toggle estado. `empresa_id` sempre do URL (associação correta). Auditoria registada na empresa alvo.
- **Caso de uso principal resolvido:** empresa que ficou com 0 gestores → o admin abre o modal, carrega em "Criar Novo Gestor", preenche nome/email/password, e o gestor fica criado nessa empresa (depois pode impersonar ou a empresa passa a ter gestor para o Fail-Safe noturno).
- 131 testes backend (+5). Lint + tsc + build ✓. Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A13 (Correções — calendário eliminados + importar atualiza)
Agent: Z.ai Code
Task: Corrigir 2 bugs reportados: calendário mostra férias de utilizadores eliminados; importarPropriedades não atualiza propriedades existentes.

Work Log:
- Re-clonado o repositório (estava removido) na branch `dev` (commit 4f7bbd4, Prompt 101).
- **Bug 1 — Calendário mostra ausências de eliminados:** Em `gestorController.getDadosCalendario`, o `Ausencia.find()` (linha 545) fazia `.populate('utilizador_id', 'nome')` sem filtrar `eliminado_em`. As ausências aprovadas de staff eliminado (soft delete) continuavam visíveis no calendário como férias. **Correção:** o `populate` passou a incluir `eliminado_em` no select e as ausências cujo utilizador tem `eliminado_em` != null são filtradas antes de converter em eventos (`ausenciasFiltradas = ausenciasAprovadas.filter(a => a.utilizador_id && !a.utilizador_id.eliminado_em)`). O `.map()` agora usa `ausenciasFiltradas` em vez de `ausenciasAprovadas`.
- **Bug 2 — importarPropriedades não atualiza:** O `importarPropriedades` (`smoobuController`, POST /api/gestor/smoobu/propriedades) ainda tinha o comportamento conservador do Prompt 90 — só preenchia a morada se estivesse `'A definir'` (linha 630: `existente.morada === 'A definir'`). O `sincronizarPropriedades` foi alterado no Prompt 92 para SEMPRE atualizar, mas o `importarPropriedades` não foi alinhado. Resultado: "36 recebidas, 0 criadas, 0 atualizadas, 36 já existiam". **Correção:** alinhado com `sincronizarPropriedades` — para propriedades existentes, atualiza SEMPRE a morada (quando o Smoobu traz uma morada real, i.e. `moradaTexto !== 'A definir'`) e a capacidade_hospedes (quando o Smoobu traz um valor), com re-geocoding da morada nova. Os restantes campos (nome, tempo, ativo, checklist, funcionario_preferencial_id) continuam preservados.
- **Testes (2 novos, secção 21):** (1) calendário não mostra ausência de eliminado (cria staff eliminado + staff ativo, ambos com ausência aprovada amanhã → só a do ativo aparece); (2) importarPropriedades atualiza morada + capacidade de propriedade existente (cria prop com morada antiga + capacidade 2, Smoobu devolve morada nova + capacidade 6 → `atualizadas: 1`, morada e capacidade sobrescritas na BD).
- **Validação:** `npm test` → **133/133 ✓** (+2 novos).
- **Documentação atualizada:** `docs/BACKEND.md` (entrada "Correção" no histórico).

Stage Summary:
- **Calendário:** ausências de utilizadores eliminados (soft delete) já não aparecem no calendário. O `populate` inclui `eliminado_em` e as ausências são filtradas.
- **Importar Propriedades:** o botão "Importar do Smoobu" agora atualiza SEMPRE a morada + capacidade das propriedades existentes (alinhado com o "Sincronizar Smoobu" do Prompt 92). O resultado agora mostra "36 atualizadas" em vez de "0 atualizadas, 36 já existiam".
- 133 testes backend (+2). Documentação atualizada. Próximo passo: commit + push para a branch `dev`.



---

Task ID: A14 (Prompt 113)
Agent: Z.ai Code
Task: Mega Prompt de Correção (Alpha) — 5 fixes: (1) loop 401 + separação layouts + banner impersonação vermelho; (2) limpar cockpit admin; (3) Nova Tarefa no calendário + fix fuso horário; (4) bloquear tarefa concluída; (5) endpoint default-checklist.

Work Log:
- Lido o worklog (até A13), `lib/auth.ts`, `route-guard.tsx`, `middleware.ts`, `gestor/layout.tsx`, `admin-sidebar.tsx`, `admin/sistema/page.tsx`, `gestor/calendario/page.tsx`, `staff/detalhe-tarefa-client.tsx`, `gestor/tarefas/page.tsx`, `tarefaController.criarTarefa`, `utils/disponibilidade.js`, `gestorRoutes.js`, `Propriedade` model, proxy routes (impersonar/login/logout) e os testes de integração.
- **Fix 1 — Loop 401 + Layouts + Impersonação:**
  - `lib/auth.ts` `lerUtilizador()` — removido o side-effect `window.location.href=/login` em 401 (a função é agora PURA, devolve `null`). Adicionado cache **in-flight** (`inFlight` Promise): callers paralelos partilham 1 fetch em vez de N. Isto elimina o burst de 401s quando RouteGuard + página + sub-componentes chamam `lerUtilizador()` em simultâneo.
  - `components/auth/route-guard.tsx` — redirect ÚNICO com flag `redirecionado`; se `!user` → `/login`; se role errado → painel certo desse role.
  - `gestor/layout.tsx` mantém `AdminSidebar mode="gestor"` (nunca mostra menu de admin).
  - **Banner de impersonação** — novo client component `components/gestor/impersonation-banner.tsx` (lê `sessionStorage` em `useEffect` — evita problemas de hidratação do antigo banner inline em server component). Botão **VERMELHO** "Voltar a Admin" que chama `POST /api/auth/exit-impersonation`.
  - `api/admin/impersonar/[id]/route.ts` — guarda o token de admin atual num cookie httpOnly separado `autocell_admin_token` (antes de o substituir pelo do gestor).
  - Novo `api/auth/exit-impersonation/route.ts` — copia `autocell_admin_token` de volta para `autocell_token` e apaga o backup. 400 se não houver backup.
  - `api/auth/login/route.ts` e `api/auth/logout/route.ts` — limpam `autocell_admin_token` (não deixa sessões de impersonação órfãs).
- **Fix 2 — Cockpit Admin limpo:** `admin/sistema/page.tsx` reescrito. Removidas as Tabs e TODAS as opções de Smoobu (Importar Propriedades, Sincronizar Reservas, Registrar Webhooks) e a tab Configuração (nome empresa + smoobu_api_key). Fica só: Forçar Cron Jobs globais (Daily Briefing, Cão de Guarda, Agenda de Amanhã) + Push Notifications de teste + Zona de Perigo (Hard Reset). Adicionado um Card-aviso a explicar que integrações estão em `/gestor/configuracoes`. Imports mortos removidos (Building2, Calendar, Webhook, Settings, Save, Tabs).
- **Fix 3 — Calendário + timezone:**
  - `lib/utils.ts` — novos helpers `paraIsoMeiaNoiteLocal("YYYY-MM-DD")` (constrói `new Date("YYYY-MM-DDT00:00:00")` = LOCAL, devolve `.toISOString()`) e `temHoraReal(iso)` (hora local ≥ 8).
  - `gestor/calendario/page.tsx` — botão **"Nova Tarefa"** no cabeçalho abre modal (Propriedade, Data, Tempo, Tipo, Staff opcional) que faz POST com `paraIsoMeiaNoiteLocal(form.data)`. `eventos` mapping: se `!temHoraReal(t.data)` → evento **all-day** (`allDay: true`, start = YYYY-MM-DD); senão → evento timed (como antes). `horaTarefa`/`horaFimTarefa` devolvem "—" para tarefas sem hora real. Isto garante que tarefas manuais aparecem na faixa all-day das vistas semanal/diária (em vez de invisíveis abaixo do slotMinTime 08:00) e na Vista Tabela sem "01:00".
  - `gestor/tarefas/page.tsx` — `handleSubmeter` envia `paraIsoMeiaNoiteLocal(form.data)` em vez de `form.data`.
  - **Backend** `tarefaController.criarTarefa` — removida a normalização `Date.UTC(d.getUTCYear(), ...)` (que destruía a intenção de "meia-noite local" e empurrava a data para o dia anterior em UTC). Agora armazena o instante enviado pelo frontend diretamente (`dataNormalizada = d`). Comentário extenso a explicar o fix.
  - **Backend** `utils/disponibilidade.js` — `verificarDisponibilidadeUtilizador` reescrito para ser **robusto a offset**: usa `Intl.DateTimeFormat` com `timeZone: 'Europe/Lisbon'` para extrair a data de calendário de Lisboa (YYYY-MM-DD) do instante, e compara datas de Lisboa da tarefa vs ausências. Janela de pesquisa ±1 dia + filtragem JS. `mensagemIndisponivel` também usa `dataLisboa`. Retrocompatível: para dados antigos (UTC midnight), `dataLisboa` devolve a mesma data de calendário → testes existentes continuam a passar.
- **Fix 4 — Bloquear tarefa concluída:**
  - `components/staff/detalhe-tarefa-client.tsx` — `jaConcluida = tarefa.estado === "concluida"`. Inicializa `itensMarcados` todos a `true` e `concluida = jaConcluida` (bloqueia UI). Checkbox `disabled={jaConcluida}`, Textarea `disabled={jaConcluida}`. Os botões Concluir/Atraso/Avaria ficam escondidos (via `!concluida &&`) e o banner "Limpeza Concluída!" mostra.
  - `gestor/calendario/page.tsx` modal — botão "Reatribuir" e select de staff `disabled` quando `tarefaSelecionada.estado === "concluida"` (com `title` explicativo).
- **Fix 5 — Endpoint default-checklist:** `gestorRoutes.js` — novo `POST /propriedades/default-checklist` (auth + isGestor) que faz `Propriedade.updateMany({ empresa_id }, { $set: { checklist: CHECKLIST_PADRAO } })` com o array pedido. Devolve `{ sucesso, message, checklist, modificadas, correspondidas }`. Frontend `/gestor/propriedades` ganhou botão **"Checklist Padrão"** (ícone ListChecks) com `confirm()` que chama o endpoint.
- **Validação:** backend `npm test` → **136/136 ✓** (a reescrita da disponibilidade não partiu nenhum teste — é retrocompatível). Frontend `npm run lint` ✓ · `npx tsc --noEmit` ✓ (após fix de optional chaining no DialogFooter) · `npm run build` ✓ (todas as rotas built, incluindo o novo `/api/auth/exit-impersonation`).
- **Documentação:** `README.md` (2 novos endpoints na tabela), `docs/BACKEND.md` (entrada Prompt 113 no histórico), `docs/FRONTEND.md` (entrada Prompt 113).

Stage Summary:
- **Loop 401 resolvido:** `lerUtilizador()` é pura + cache in-flight → 1 fetch por mount (em vez de N). RouteGuard faz o redirect único. Sem mais cascata de 401s no console.
- **Impersonação reversível sem re-login:** o admin volta ao painel `/admin` com 1 clique no botão vermelho "Voltar a Admin" (token de admin restaurado de cookie de backup). Antes era preciso logout + login.
- **Cockpit Admin limpo:** `/admin/sistema` só tem operações globais (cron jobs + push + hard reset). Smoobu/sync/webhooks/config vivem só em `/gestor/configuracoes`.
- **Timezone corrigido:** tarefas manuais deixam de ser gravadas como 01:00 (UTC midnight → Lisboa 01:00). Agora são meia-noite LOCAL; renderizam como all-day no calendário (visíveis em todas as vistas) e como "—" na Vista Tabela. Disponibilidade (férias/ausências) continua a funcionar (comparação por data de Lisboa, robusta a offset).
- **Tarefas concluídas bloqueadas:** staff não consegue editar checklists/observações nem concluir/reatribuir uma tarefa já concluída.
- **Checklist padrão:** 1 clique aplica os 6 itens a todas as propriedades da empresa.
- 136 testes backend (mantidos). Lint + tsc + build ✓. Documentação atualizada. Próximo passo: commit + push para a branch `dev`.

---

Task ID: A15 (Prompt 113 — iteração 2: loop 401 robusto)
Agent: Z.ai Code
Task: O loop 401 em /api/auth/me continuava em produção mesmo após o Prompt 113. Investigação e fix mais robusto do cache de auth.

Work Log:
- Lido o erro de produção do utilizador (dezenas de GET /api/auth/me 401 em cascata no console de www.autocell.pt). Auditados TODOS os callers de lerUtilizador() e fetch("/api/auth/me"):
  - `components/auth/route-guard.tsx` — useEffect [role, router] ✓ (1x por mount)
  - `app/page.tsx` (landing /) — useEffect [router] ✓ (1x por mount)
  - `app/login/page.tsx` — useEffect [router, from] + handleLogin ✓
  - `app/admin/page.tsx` — useEffect ✓ (dentro de RouteGuard, só corre após auth OK)
  - `app/admin/sistema/page.tsx` — useEffect ✓ (dentro de RouteGuard)
  - `app/admin/webhooks/page.tsx` — useEffect ✓ (dentro de RouteGuard)
  - `app/staff/page.tsx` — **PROBLEMA**: chamava `fetch("/api/auth/me")` DIRETAMENTE (bypass do cache) + `window.location.href = "/login"` em 401 (hard redirect, fonte de loop)
- **Root cause do loop residual:** o cache in-flight do Prompt 113 só deduplicava chamadas CONCORRENTES (mesmo tick). Chamadas SEQUENCIAIS rápidas (ex.: redirect /admin → /login em milissegundos) cada uma fazia um fetch novo ao backend. Com um token expirado, isto gera N 401s durante a cascata de redirects.
- **Fix — Cache temporal em `lib/auth.ts`:**
  - `cache: { user, expiraEm }` — resultado POSITIVO cached 60s, NEGATIVO (null/401) cached 3s.
  - `lerUtilizador()` verifica o cache ANTES de fazer fetch. Se válido, devolve sem ir ao backend.
  - `limparCacheAuth()` exportada — limpa cache + in-flight. Deve ser chamada quando o cookie muda (login, logout, exit-impersonation).
  - `fazerLogout()` já chama `limparCacheAuth()` internamente.
- **Fix — `app/login/page.tsx`:** `handleLogin` chama `limparCacheAuth()` APÓS o login com sucesso (cookie definido) e ANTES do `router.push(destino)`. Isto garante que o RouteGuard no painel de destino vá ao backend buscar o user real (em vez de devolver um null cached de antes do login).
- **Fix — `components/gestor/impersonation-banner.tsx`:** `handleVoltarAdmin` chama `limparCacheAuth()` após exit-impersonation (cookie mudou de gestor → admin).
- **Fix — `app/staff/page.tsx`:** `carregar()` deixou de fazer `fetch("/api/auth/me")` direto. Agora usa `lerUtilizador()` (cached). Removido o `window.location.href = "/login"` em 401 — o RouteGuard do layout já trata do redirect; a página simplesmente não atualiza o user se lerUtilizador() devolver null. Isto elimina a fonte do loop no painel do staff.
- Cenários validados mentalmente:
  - (1) User válido em /admin: RouteGuard faz 1 fetch → cache 60s → admin/page.tsx e admin/sistema usam cache (0 fetches extra). Navegação entre páginas admin: 0 fetches (cache HIT).
  - (2) Token expirado em /admin: RouteGuard faz 1 fetch → 401 → cache null 3s → redirect /login. /login chama lerUtilizador() → cache HIT (null) → 0 fetches extra. Só 1 401 em vez de N.
  - (3) Login: form submit → cookie definido → limparCacheAuth() → redirect /admin → RouteGuard faz 1 fetch (cache limpo) → 200 → cache user 60s. Login não é bloqueado pelo negative cache.
  - (4) Refresh (F5): cache in-memory perdido → 1 fetch novo. Expected.
  - (5) Sessão expira mid-session (após 60s): próximo lerUtilizador() → 401 → cache null 3s → redirect /login (1 fetch). Sem burst.
- **Nota sobre deploy:** o utilizador pode estar a ver o loop porque a produção (www.autocell.pt) ainda não tem o código do Prompt 113 (push para `dev`). Se o Verceldeploya do `main`, é preciso merge `dev` → `main`. Esta iteração torna o fix ainda mais robusto para quando for deployed.
- **Validação:** backend 136/136 ✓. Frontend lint ✓ · tsc ✓ · build ✓.

Stage Summary:
- **Loop 401 resolvido de forma robusta:** cache temporal (positivo 60s, negativo 3s) em `lerUtilizador()` garante que, mesmo com múltiplas chamadas sequenciais rápidas (redirects em cascata), só 1 fetch vai ao backend por janela de 3s. O `inFlight` (Prompt 113) continua a deduplicar chamadas concorrentes.
- **`limparCacheAuth()`** chamada em todos os pontos onde o cookie muda: login (após cookie definido), logout, exit-impersonation. Isto previne que o negative cache bloqueie o login.
- **Staff page** deixou de fazer fetch direto a /api/auth/me + hard redirect — agora usa `lerUtilizador()` (cached) e delega o redirect para o RouteGuard.
- 136 testes backend ✓. Lint + tsc + build ✓. Próximo passo: commit + push para `dev`. O utilizador deve fazer merge/deploy para produção.

---

Task ID: A16 (Prompt 114)
Agent: Z.ai Code
Task: Notificações In-App, Bugs Alpha e Lógica de Distâncias — 6 fixes: (1) Push; (2) Centro de Notificações (Sino); (3) Isolamento Menu Admin; (4) Staff ativo + capacidade; (5) Tolerância geocoding; (6) Haversine + warning.

Work Log:
- Lido o worklog (até A15), `push-notification-setup.tsx`, `Utilizador.js` (campo `pushSubscription`), `authController.pushSubscribe`, `gestor/layout.tsx`, `admin-sidebar.tsx`, `geocoding.js`, `tarefaController` (criar/atribuir/reatribuir), `gestorController` (getEquipa, criarPropriedade, atualizarPropriedade), `webhookController` (notificar), componentes de detalhe (gestor + staff).
- **Fix 1 — Push:** Confirmado que o fluxo já estava completo. `push-notification-setup.tsx` faz `pushManager.subscribe` + `POST /api/auth/me/push-subscribe` (via catch-all proxy). Backend `pushSubscribe` guarda em `Utilizador.pushSubscription`. `utils/notificar.js` estendido para criar também notificação in-app (ver Fix 2).
- **Fix 2 — Centro de Notificações (Sino):**
  - Novo modelo `backend/models/Notificacao.js` (`utilizador_id`, `empresa_id`, `mensagem`, `tipo` enum [tarefa_atribuida, tarefa_reatribuida, tarefa_cancelada, aviso, sistema], `url`, `lida`, `data`, timestamps; índice composto `{ utilizador_id, lida, createdAt }`).
  - Novo `backend/controllers/notificacaoController.js` (4 endpoints): `listarNotificacoes` (GET, query `?lidas=`), `contagemNotificacoes` (GET `/contagem`), `marcarTodasLidas` (PATCH `/marcar-lidas`), `marcarUmaLida` (PATCH `/:id/lida`). Rotas registadas em `authRoutes.js` montadas em `/api/auth/me/notificacoes` (qualquer utilizador autenticado).
  - `utils/notificar.js` `notificarUtilizador()` agora envia push (se configurado + tiver subscrição) E cria registo `Notificacao` (fire-and-forget). Novo helper `criarNotificacaoInApp`. Assinatura estendida com `opts: { tipo, mensagem, empresa_id }`.
  - `tarefaController` (criarTarefa, atribuirTarefa, reatribuirTarefa) + `webhookController.criarTarefaPorReserva` passam `opts.tipo` (`tarefa_atribuida`/`tarefa_reatribuida`) e `empresa_id`. Notificação gerada sempre que uma tarefa é atribuída ao staff.
  - Frontend: novo `components/notification-bell.tsx` — ícone Bell com badge vermelho (count não-lidas), dropdown com lista, polling 30s, marca todas como lidas ao abrir. Renderizado no `GestorSidebar` (desktop + mobile) e no header do `/staff` (ao lado do logout).
- **Fix 3 — Isolamento Menu Admin:** `/gestor/layout.tsx` deixou de importar `AdminSidebar` (partilhado, com `mode="gestor"`). Novo `components/gestor/gestor-sidebar.tsx` dedicado — NÃO importa nem renderiza nada de admin. Itens: Dashboard, Propriedades, Tarefas, Equipa, Ausências, Calendário, Relatórios, Webhooks, Configurações + Sino + Tema + Logout. Isolamento agora claro e auditável.
- **Fix 4 — Staff ativo + Capacidade:**
  - `/gestor/tarefas/page.tsx` e `/gestor/calendario/page.tsx` filtram `u.role === "staff" && u.ativo === true` nos dropdowns de atribuição (antes só filtravam role — staff inativos apareciam).
  - `authController.minhaTarefaDetalhe` + `gestorController.getTarefas` + `getDadosCalendario` passam a fazer populate de `capacidade_hospedes`.
  - `TarefaMock` (lib/api.ts) + `TarefaDetalheGestor` (gestor modal) ganham `capacidade_hospedes`.
  - `components/gestor/detalhe-tarefa-modal.tsx` + `components/staff/detalhe-tarefa-client.tsx` mostram badge âmbar "Lotação máxima: N hóspede(s)" (ícone Users) — destacado no topo do detalhe.
  - `/staff/tarefas/[id]/page.tsx` passa `capacidade_hospedes` do populate para o `DetalheTarefaClient`.
- **Fix 5 — Tolerância Geocoding:** `geocoding.js` já fazia catch silencioso (return null). `gestorController.criarPropriedade` + `atualizarPropriedade` agora devolvem flag `warning` (string) quando o Nominatim falha/devolve vazio. Frontend (`propriedades/page.tsx`) captura `res.warning` e mostra Card âmbar a aconselhar simplificar a morada. Não bloqueia a criação/edição.
- **Fix 6 — Haversine + Warning:**
  - Novo `backend/utils/distancia.js` — `distanciaHaversine(origem, destino)` em km (raio 6371, fórmula `a = sin²(Δφ/2) + cos(φ1)·cos(φ2)·sin²(Δλ/2)`, `c = 2·atan2(√a, √(1−a))`, `d = R·c`). Robusto a null/NaN (return 0).
  - `tarefaController` novo helper `verificarDistanciaTarefasDia(utilizadorId, data, propriedadeId)` — busca outras tarefas do staff no mesmo dia (excluindo canceladas/concluídas), popula coordenadas, calcula a distância máxima entre a propriedade atual e as outras. Se > `LIMITE_DISTANCIA_KM` (15km), devolve mensagem `Atenção: A tarefa anterior deste funcionário fica a X km de distância (em "Nome").`
  - Integrado em `criarTarefa` (201 response), `atribuirTarefa` (200), `reatribuirTarefa` (200) — resposta JSON inclui `warning` se aplicável. NÃO bloqueia.
  - Frontend: `/gestor/tarefas/page.tsx` (criar + atribuir), `/gestor/calendario/page.tsx` (criar + reatribuir) capturam `res.warning` e mostram Card âmbar (`border-amber-500/50 bg-amber-50`) com botão Fechar.
- **Testes (7 novos, secção 22 "Prompt 114"):** (1) Haversine Lisboa→Porto ≈274km; (2) mesma coordenada = 0; (3) coordenadas inválidas = 0 (não crasha); (4) contagem notificações = 0 (sem notif); (5) criar tarefa atribuída gera notificação in-app + contagem incrementa + marcar lidas volta a 0; (6) criar 2 tarefas com propriedades distantes (Lisboa + Sintra ~28km) devolve warning com "km"; (7) criar propriedade com morada = 201 (mesmo se Nominatim falhar). `npm test` → **143/143 ✓**.
- **Validação:** backend 143/143 ✓. Frontend `npm run lint` ✓ · `npx tsc --noEmit` ✓ · `npm run build` ✓.
- **Documentação:** `README.md` (4 novos endpoints notificações), `docs/BACKEND.md` (entrada Prompt 114), `docs/FRONTEND.md` (entrada Prompt 114).

Stage Summary:
- **Push Notifications:** fluxo completo confirmado (subscribe + POST + guarda em Utilizador.pushSubscription).
- **Centro de Notificações (Sino):** modelo `Notificacao` + 4 endpoints + `NotificationBell` (badge vermelho, dropdown, polling 30s, marcar lidas). Notificação gerada sempre que uma tarefa é atribuída ao staff (criar/atribuir/reatribuir/webhook).
- **Isolamento Menu Admin:** `GestorSidebar` dedicado — `/gestor/layout.tsx` não importa nada de admin.
- **Staff ativo:** dropdowns só mostram `ativo === true`. Capacidade destacada no detalhe (gestor + staff).
- **Geocoding tolerante:** catch silencioso + flag `warning` na resposta + toast âmbar no frontend.
- **Haversine:** `utils/distancia.js` + warning logístico >15km entre tarefas do mesmo dia do mesmo staff (não bloqueia, toast âmbar).
- 143 testes backend (+7). Lint + tsc + build ✓. Documentação atualizada. Próximo passo: commit + push para `dev`.

---

Task ID: A17 (Prompt 115)
Agent: Z.ai Code
Task: Separação ABSOLUTA de menus e layouts (frontend) + fix definitivo do loop 401. 4 replaces completos: gestor-sidebar, admin-sidebar, layouts, route-guard.

Work Log:
- Re-clonado o repo (clone anterior foi removido) na branch `dev` (commit 31833e5, Prompt 114).
- Lido o estado atual: `gestor-sidebar.tsx` (já dedicado mas com Webhooks e ordem errada), `admin-sidebar.tsx` (componente partilhado com `mode` prop + array `gestorNavItems`), `admin/layout.tsx` (usa `<AdminSidebar mode="admin" />`), `gestor/layout.tsx` (já usa `GestorSidebar`), `route-guard.tsx` (usa `lerUtilizador` + `router.replace` soft).
- **Fix 1 — GestorSidebar (replace completo):** `gestor-sidebar.tsx` reescrito. `gestorNavItems` contém APENAS: Dashboard (/gestor), Calendário (/gestor/calendario), Tarefas (/gestor/tarefas), Propriedades (/gestor/propriedades), Equipa (/gestor/equipa), Ausências (/gestor/ausencias), Relatórios (/gestor/relatorios), Configurações (/gestor/configuracoes). Removido Webhooks (não estava na lista do Prompt 115). Brand label mudado de "Admin" para "Gestor" (era confuso). NENHUM link para Sistema/Empresas/Admin.
- **Fix 2 — AdminSidebar (replace completo):** `admin-sidebar.tsx` reescrito. Removido o `mode` prop e o array `gestorNavItems` (o componente partilhado foi eliminado). `adminNavItems` contém APENAS: Empresas (/admin), Sistema/Webhooks (/admin/sistema), Webhooks (/admin/webhooks). Componente dedicado — não importa nem renderiza nada do gestor.
- **Fix 3 — Layouts isolados:** `admin/layout.tsx` agora usa `<AdminSidebar />` (sem `mode` prop). `gestor/layout.tsx` já usava `<GestorSidebar />` (confirmado, sem alterações necessárias além do comentário). Ambos importam EXCLUSIVAMENTE o seu sidebar dedicado.
- **Fix 4 — RouteGuard (loop 401 definitivo):** `route-guard.tsx` reescrito. Antes: `lerUtilizador()` → null → `router.replace("/login")` (soft redirect) → re-mount → novo fetch → 401 → loop. Agora: `lerUtilizador()` → null → `limparCacheAuth()` + `fazerLogout()` (POST /api/auth/logout que limpa cookie httpOnly + `window.location.href = "/login"` — redirect HARD). O redirect HARD reinicia o estado do cliente (não há re-mount do guard, não há cache obsoleto). Sem retry: em 401 não volta a tentar o fetch. Role errado → redirect HARD (`window.location.href`) para o painel certo. Usa `lerUtilizador()` (em vez de fetch cru) para popular o cache temporal — as páginas que também chamam `lerUtilizador()` acertam no cache (1 fetch total, não 2).
- **Validação:** `npm run lint` ✓ · `npx tsc --noEmit` ✓ · `npm run build` ✓ (todas as rotas built, middleware 26.8kB).

Stage Summary:
- **Separação ABSOLUTA:** `GestorSidebar` e `AdminSidebar` são componentes totalmente separados, sem código partilhado, sem `mode` prop. O gestor vê SÓ operações (8 items); o admin vê SÓ gestão (3 items).
- **Loop 401 resolvido definitivamente:** RouteGuard faz `fazerLogout()` (redirect HARD via `window.location.href`) em vez de `router.replace` (soft). O estado do cliente é reiniciado — não há re-mount, não há loop.
- Lint + tsc + build ✓. Commit `368dd94` pushed para `dev`.

---

Task ID: A18 (Prompts 115-131)
Agent: Z.ai Code
Task: Atualização consolidada de documentação — Prompts 115 a 131 (~20 prompts). Esta entrada resume a evolução técnica desde o Prompt 114 (última vez que os docs foram atualizados). Não houve trabalho de código nesta task; é um registo retroativo baseado no `git log` e no conteúdo dos commits.

Work Log:

### Prompt 115 — Separação ABSOLUTA de menus/layouts + fix loop 401
- `GestorSidebar` (`components/gestor/gestor-sidebar.tsx`) reescrito como componente **dedicado** (8 items operacionais, sem links de admin); `AdminSidebar` reescrito **sem `mode` prop** e sem `gestorNavItems` partilhado (3 items: Empresas, Sistema/Webhooks, Webhooks). Layouts isolados (`admin/layout.tsx` usa `<AdminSidebar />`, `gestor/layout.tsx` usa `<GestorSidebar />`).
- `route-guard.tsx` reescrito: em 401 faz `limparCacheAuth()` + `fazerLogout()` (POST `/api/auth/logout` que limpa cookie httpOnly) + `window.location.href = "/login"` (redirect HARD), em vez de `router.replace` (soft). Elimina re-mount/re-fetch em cascata. Sem retry em 401. Role errado → redirect HARD para o painel certo.
- Validação: lint ✓ · tsc ✓ · build ✓ (middleware 26.8kB). Commit `368dd94`.

### Prompt 116 — Fundação SaaS, Notificações e Lógica de Negócio
- **Multi-tenant SaaS:** modelo `Empresa` ganhou campo `ativa` (boolean) + índice. Novos endpoints de Super Admin: `PATCH /api/admin/empresas/:id/toggle-status` (ativa/suspende empresa), `POST /api/admin/empresas/:id/hard-reset` (scoped à empresa — apaga Propriedades + Tarefas + Ausências + Webhooks + Notificações dessa empresa, sem tocar noutras). `getEquipa` passou a filtrar `ativo === true` e excluir `role === 'admin'`.
- **Lógica de ausências e tarefas:** sobreposição de ausências passou a **excluir ausências rejeitadas** (só `aprovada`/`pendente` bloqueiam). `criarTarefa` alargado para aceitar `hora`, `check_in`, `check_out` e `hospedes` (detalhes de reserva manuais). Modelo `Notificacao` ganhou `tarefa_id` (referência à tarefa geradora). Modelo `Propriedade` ganhou `observacoes` (texto livre).
- Frontend: `/admin` ganhou gestões de empresa (criar, ativar/suspender); isolamento visual admin vs gestor consolidado. Commit `5d56679`.

### Prompt 117 — Remodelar UI/UX: isolar Super Admin do Gestor
- Nova **gaveta da empresa** em `/admin/empresas/[id]` — página de gestão dedicada por empresa com botões **Apagar**, **Suspender/Ativar** e **Gerir Config** (nome, NIF, API key Smoobu).
- **Geocoding warning inline** — ao criar/editar propriedade, se o Nominatim falhar, mostra aviso âmbar inline no formulário (em vez de toast solto) a aconselhar simplificar a morada.
- **Nova Tarefa com hora/hóspedes** — modal de criação de tarefa (`/gestor/tarefas` + `/gestor/calendario`) alargado com campos de hora (check-in/out) e nome/nº de hóspedes (popula `detalhes_reserva`). Commit `f03a205`.

### Prompt 118 — UX Staff, Notificações e Exportação PDF
- **Staff dashboard agrupado por dia** — `/staff` reorganizado: tarefas agrupadas por data (hoje, amanhã, ...) em vez de lista única; labels passaram a **"Nº Hóspedes"** e **"Nome Hóspede"**; **Data da Limpeza** destacada no topo de cada cartão.
- `NotificationBell` com `max-h-[80vh]` e scroll interno (lista longa de notificações deixou de estourar o viewport). Push notifications passaram a mostrar **feedback de sucesso/erro** ao subscreber.
- **Exportar PDF** — novo botão "Exportar PDF" no `/staff` e no relatório do gestor que usa `window.print()` (estilos `@media print` dedicados) para gerar PDF via o diálogo de impressão do browser. Commit `f84a8d0`.

### Prompt Extra — Vacina Anti-Safari (parsing de datas iOS/Safari)
- Novos helpers em `lib/utils.ts`: **`parsearDataSegura(valor)`** (aceita `YYYY-MM-DD`, `DD/MM/YYYY`, ISO com/sem timezone; devolve `Date` válido ou `null` — robusto ao parser do Safari que devolve `Invalid Date` em formatos não-ISO) e **`extrairHoraISO(iso)`** (extrai `HH:mm` de uma string ISO sem depender de `new Date()` — evita o shift de fuso do Safari).
- Substituídas todas as construções `new Date("YYYY-MM-DD")` e formatações baseadas em `Date` nos componentes de staff/gestor pelos helpers seguros. Resolveu datas a aparecer como `Invalid Date` / `NaN/NaN/NaN` no iOS Safari. Commit `2e70a52`.

### Prompt 119 — Resiliência PWA (Service Worker)
- `next-pwa` configurado com `skipWaiting: true` + `clientsClaim: true` — nova versão do SW assume o controlo imediatamente (sem precisar de fechar todos os separadores).
- **Runtime caching** com estratégia `NetworkFirst` para os chunks JS (`/_next/static/chunks/`) — fallback para cache se a rede falhar (mitiga `ChunkLoadError` em ligações instáveis). **Handler global de `ChunkLoadError`** no cliente que faz reload limpo (uma só vez) + limpeza de caches antigos do SW ao ativar.
- Resolveu ecrã branco em produção após deploy quando o browser tinha chunks obsoletos em cache. Commit `f3c0884`.

### Prompt 120 — Remover loop de reload + fix hidratação de datas
- **Remoção do Script agressivo** — o handler de `ChunkLoadError` do Prompt 119 estava a entrar em loop de reload (recarregava indefinidamente se o chunk continuasse a falhar). Substituído por um guard com `sessionStorage` (só tenta reload 1x por sessão) e remoção do `window.location.reload` em cascata.
- **`mounted` guard na staff page** — `/staff/page.tsx` passou a verificar se o componente ainda está montado (`isMountedRef`) antes de fazer `setState` após fetch assíncrono (evita warnings de hidratação e updates em componentes desmontados). Fix de datas que apareciam trocadas na hidratação inicial (server vs client). Commit `ef90a3e`.

### Prompt 121 — Reposição de fábrica do layout + next.config minimalista
- **Reposição de fábrica do layout** — revertidos overrides CSS agressivos que causavam inconsistências visuais (reset do `globals.css` ao estado base do Tailwind/shadcn). Removidos estilos experimentais que se tinham acumulado.
- `next.config.mjs` **minimalista** — removidas configurações experimentais de PWA/webpack que conflituavam com o `next-pwa`; mantido apenas o estritamente necessário (`next-pwa` wrapper + `reactStrictMode`). Estabilizou o build em produção. Commit `49d3585`.

### Prompt 122 — Limpeza Admin + Soft Delete (Lixeira de Empresas)
- **Soft delete de empresas:** modelo `Empresa` ganhou campo `apagada` (boolean, default `false`). `GET /api/admin/empresas` passou a suportar query `?inclui_apagadas=` e por defeito **exclui** empresas `apagada: true`. Novo `DELETE /api/admin/empresas/:id` (soft delete — marca `apagada: true, ativa: false`) e `PATCH /api/admin/empresas/:id/restaurar` (desfaz — `apagada: false`).
- Frontend `/admin` ganhou **Tabs "Ativas" / "Reciclagem"** — a tab Reciclagem lista empresas eliminadas com botão "Restaurar". `AdminSidebar` simplificado para mostrar **só Empresas** (Webhooks passou para dentro da gaveta da empresa).
- Auditoria registada em ambos os movimentos (soft-delete + restaurar). Commit `aa40992`.

### Prompt 123 — Correções de lógica (soft delete, conflito horário, ausências, tempo viagem)
- **Soft block de conflitos:** `criarTarefa`/`atribuirTarefa`/`reatribuirTarefa` deixaram de devolver `409` quando há sobreposição horária do staff; agora devolvem `200` com flag `warning` (não bloqueia — o gestor pode forçar). Mensagem de warning inclui o **tempo de viagem** estimado entre a tarefa anterior e a nova (via Haversine + velocidade média).
- **Gemini SDK** introduzido (`@google/generative-ai`) para o resumo de relatório IA (substitui fetch manual). Ausências rejeitadas passam a ser excluídas da redistribuição de tarefas (só `aprovada` contam para reatribuição). `Propriedade.observacoes` exposto no detalhe de tarefa.
- Validação de sobreposição robusta a fusos (usa data de calendário de Lisboa). Commit `b02b63e`.

### Prompt 124 — Interface móvel, navegação dias, relatório IA, CSS sino
- **Staff navegação por dias** — `/staff` ganhou setas ‹ › para navegar entre dias (hoje ←/→ amanhã, ontem, etc.) em vez de mostrar só o dia atual. **IA resumo** do relatório de produtividade exportável como **PDF** via `html2pdf.js` (botão "Exportar PDF" no `/gestor/relatorios`).
- **CSS sino mobile** — `NotificationBell` redesenhado para mobile (dropdown full-width, posicionamento fixo, z-index corrigido para não ficar por baixo de modais). **Task-card morada** — cartões de tarefa do staff passaram a mostrar a morada da propriedade (antes só o nome).
- Commit `5af5370`.

### Prompt 125 — Gemini SDK, fuso manutenção local, soft block, observacoes Propriedade
- **Gemini SDK `@google/generative-ai`** consolidado no `relatorioController.getResumoIA` (gera resumo em linguagem natural do relatório de produtividade). Fallback gracioso se a API key estiver em falta (devolve mensagem padrão em vez de crashar).
- **Fuso de manutenção local** — tarefas de manutenção geradas pelo sistema passam a ser criadas com instante local (não UTC midnight) para alinhar com o dia de calendário real. **Soft block** de conflitos mantido (warning não-bloqueante). `Propriedade.observacoes` passível de edição no `/gestor/propriedades`.
- Commit `c3393ae`.

### Prompt 126 — UX logística, PDF fix, frontend responsivo, notificações
- **Double-check logístico:** ao criar tarefa sobreposta, modal de confirmação com botão **"Forçar Agendamento"** (ignora o warning de conflito) e **"Confirmar Morada"** (re-confirma a morada antes de agendar — previne tarefas com morada errada). PDF do relatório IA com **delay** para garantir renderização completa do `html2pdf` antes do download.
- **Logs Smoobu** — `/gestor/webhooks` melhorado (tabela de logs com filtros por status, payload expandível). Nova página **`/gestor/notificacoes`** — vista full-page do centro de notificações (além do sino dropdown).
- Frontend responsivo: ajustes de breakpoints em tabelas e modais para tablet/mobile. Commit `aaf9a16`.

### Prompt 127 — Fix timezone (time shift), AlertDialog cancelar, loading relatório
- **Fix timezone (time shift):** `extrairHoraISO` reescrito para **não usar `new Date()`** (que aplicava fuso e deslocava a hora mostrada). Agora faz parse direto da string ISO (`"YYYY-MM-DDTHH:mm"`) — a hora exibida é a armazenada, sem shift. Resolveu tarefas a aparecerem 1h adiantadas/atrasadas.
- **AlertDialog "Cancelar"** — modais de confirmação (eliminar, suspender) passaram a usar `AlertDialog` (shadcn) com botão explícito "Cancelar" que fecha sem ação (antes um clique fora podia confirmar). **Loading do relatório IA** — spinner visível durante a geração do resumo (impede duplo-click).
- Commit `48dc87b`.

### Prompt 128 — Blindagem backend: fuso Portugal + Gemini nunca crasha
- **Fuso Portugal:** novo helper de offset que usa `Intl.DateTimeFormat` com `timeZone: 'Europe/Lisboa'` para calcular o offset de Lisboa (incluindo DST) em vez de depender do fuso do servidor (Render pode estar em UTC). Aplicado na normalização de datas de tarefas/ausências.
- **Gemini nunca crasha:** o `getResumoIA` envolvido em try/catch abrangente — se a chamada ao Gemini falhar (quota, rede, JSON inválido), devolve um **placeholder hardcoded** ("Resumo temporariamente indisponível.") em vez de 500. O relatório de produtividade principal continua a funcionar mesmo com IA em baixo.
- Commit `23cc959`.

### Prompt 129 — Fix calendário timezone + SW não interceta /api/
- **Calendário timezone:** eventos do FullCalendar passam a ser construídos com **strings locais sem sufixo `Z`** (`"YYYY-MM-DDTHH:mm:ss"`) em vez de ISO UTC (`...Z`) — o calendar interpreta como hora local e não aplica conversão de fuso. Resolveu eventos a aparecerem no dia/hora errada em fusos não-UTC.
- **SW `publicExcludes /api/`:** o Service Worker (runtime caching) configurado para **não interceta** pedidos a `/api/` (passa sempre à rede). Antes, o `NetworkFirst` podia servir respostas cached obsoletas da API (ex.: notificações, tarefas). Garantia de dados sempre frescos do backend.
- Commit `42c5536`.

### Prompt 130 — Fix definitivo ausências: staffController filtra estado
- **`staffController.criarAusencia`:** passou a filtrar por `estado` ao verificar sobreposição de ausências (antes considerava TODAS as ausências do staff, incluindo rejeitadas, e bloqueava a criação com 409). Agora só `aprovada`/`pendente` contam para sobreposição. **`faltaHoje`** recebeu o mesmo fix (filtro de estado na verificação de ausência existente).
- **Root cause do 409 persistente:** identificado que existia um **índice único MongoDB** legado (`utilizador_id_1_data_1`) que continuava ativo em produção e rejeitava ausências legítimas. O arranque do servidor passou a **remover o índice único** automaticamente (sem eliminar ausências existentes). Investigação detalhada via logs de debug no `criarAusencia`.
- Commits `55a7f00`, `48a985c`, `9afe73e`, `34a60c8`, `d8b395f`, `1a483f9` (root cause final — índice era `utilizador_id_1_data_1` sobre o campo `data`, não `data_inicio`).

### Prompt 131 — Staff notificacoes + nome_hospede + dias anteriores + ausencias
- **Página de notificações do staff** — novo `/staff/notificacoes` (vista full-page, além do sino). **`nome_hospede`** passou a ser exibido nos cartões e detalhes de tarefa do staff (populado a partir de `detalhes_reserva.nome_hospede`).
- **Dias anteriores (30 dias)** — `/staff` passou a permitir navegar não só para a frente mas também **até 30 dias para trás** (histórico de tarefas concluídas), além dos dias futuros. Útil para o staff consultar tarefas passadas.
- **Índice único MongoDB removido definitivamente** no arranque do backend (script de migração que identifica e elimina o índice `utilizador_id_1_data_1` se existir). Commit `4f65c0a`.

### Prompt 132 — Cancelamento de ausências (soft cancel)
- **`cancelarAusencia`** (PATCH `/api/staff/ausencias/:id/cancelar`) — em vez de `DELETE` (que apagava o registo), passou a fazer soft cancel: marca `estado: 'cancelada'` e mantém o histórico. A ausência cancelada deixa de contar para sobreposição, mas o registo fica visível para auditoria. Commit associado.

### Prompt 133 — Arquitetura de checklists dinâmicas (backend)
- **Modelo `ModeloChecklist`** — template com `empresa_id`, `nome`, `descricao`, `seccoes[{nome, items[]}]`. Permite criar modelos reutilizáveis por empresa.
- **`Propriedade.modelo_checklist_id`** — associação de um modelo a cada propriedade.
- **`Tarefa.checklist_dinamica`** — snapshot da checklist no momento da criação da tarefa (para histórico imutável). Injeção on-the-fly no `minhaTarefaDetalhe` se a tarefa não tem snapshot mas a propriedade tem modelo associado.

### Prompt 134 — Ecrãs de configuração e interface do staff (frontend)
- **`/gestor/configuracoes/checklists`** — CRUD completo de modelos de checklist (criar/editar/eliminar, secções e items dinâmicos).
- **Select `modelo_checklist_id`** no formulário de `/gestor/propriedades`.
- **`detalhe-tarefa-client.tsx`** — renderiza `checklist_dinamica` por secções; botão "Concluir" bloqueado até 100% dos items marcados; `jaConcluida` desativa inputs.

### Prompt 135 — Injeção das checklists (seed de base de dados)
- **Script `seedChecklists.js`** — cria 2 modelos base (Limpeza Standard + Detalhada V2) e associa-os às propriedades existentes.
- **Botão "Correr Seed de Checklists"** na gaveta da empresa (`/admin/empresas/[id]`) → `POST /api/admin/empresas/:id/seed-checklists`.

### Prompt 136 — Fix PDF sempre visível + abandono do html2pdf.js
- **PDF em branco resolvido** — o `exportarPDF` do `/gestor/relatorios` passou a usar **`window.open()` + `document.write()` + `printWindow.print()`** (diálogo de impressão nativo do browser) em vez do `html2pdf.js` (que produzia PDFs de 3KB completamente vazios, mesmo com o div de exportação a ter conteúdo confirmado por debug log). O HTML do relatório é gerado numa nova janela com estilos inline A4 (cabeçalho dourado, KPIs em grelha 4-col, tabelas de staff/propriedades/estados com minibarras, resumo IA em caixa âmbar).
- **Relatório sempre visível resolvido** — removido o componente `PdfExportContent` e o div de exportação residual (`position: fixed; left: 0; top: 0; zIndex: 99998; opacity: 1`) que, após a mudança para `window.print()`, já não era usado pelo export mas continuava renderizado por cima da página, tornando o relatório sempre visível. Removido também o `useRef` (já não há `pdfExportRef`). Comentários actualizados de "html2pdf.js" → "window.print()".

Stage Summary (Prompt 136):
- **Export PDF do relatório de produtividade funcional** via diálogo de impressão nativo do browser (A4, com resumo IA + KPIs + tabelas). Sem dependência de bibliotecas externas de captura (html2pdf.js/html2canvas).
- **Página de relatórios limpa** — o conteúdo do PDF só aparece na janela de impressão, não na página principal. Removidos ~320 linhas de código morto (`PdfExportContent` + div de exportação).
- Documentação (`docs/FRONTEND.md` + este `WORKLOG.md`) actualizada com os Prompts 132-136.

### Prompt 137 — Fix nome_hospede não aparecia nos cartões do staff
- **Root cause** — o backend (`criarTarefa` + webhook Smoobu) já gravava `detalhes_reserva.nome_hospede` corretamente, e o detalhe da tarefa (`DetalhesReservaCard`) já o mostrava. Mas a **lista de tarefas do staff** (`/staff`) não o exibia porque:
  1. `adaptarTarefa()` em `/staff/page.tsx` não repassava `detalhes_reserva` ao `TaskCard` (o campo era descartado no mapeamento).
  2. `TaskCard` (`components/staff/task-card.tsx`) não tinha renderização nenhuma do `nome_hospede`.
- **Fix 1** — `adaptarTarefa()` agora inclui `detalhes_reserva: t.detalhes_reserva ?? null` no objeto adaptado. Interface `TarefaReal` actualizada com o campo.
- **Fix 2** — `TaskCard` agora mostra uma linha destacada (ícone `User` + fundo dourado claro `bg-primary/5`) com o `nome_hospede` quando este existe, entre a morada e o botão "Ver detalhes".
- **Fix 3** — tabela de `/gestor/tarefas` ganhou uma coluna **"Hóspede"** (entre Propriedade e Funcionário) que mostra `t.detalhes_reserva?.nome_hospede ?? "—"`.

### Prompt 137b — Fix nome_hospede vazio nas tarefas via webhook Smoobu
- **Root cause do nome vazio** — o card "Detalhes da Reserva" já aparecia (com check-in/out/pax preenchidos), mas o `nome_hospede` ficava sempre `null` porque:
  1. O `enriquecerReservaSmoobu` (que busca o nome via REST API do Smoobu) **só era chamado quando `!dataCheckOutRaw`**. Se o webhook já trouxesse `departure`, o enriquecimento **não corria** e o `nome_hospede` ficava dependente apenas do payload do webhook — que normalmente **não inclui** `guestName`.
  2. O `sincronizarReservas` não extraía o nome do hóspede do payload REST API do Smoobu com cobertura exaustiva de variantes.
- **Fix 1** — `processarReservaSmoobu` agora chama `enriquecerReservaSmoobu` **sempre que `nome_hospede` estiver em falta** (mesmo que `departure` já exista). Condição: `!dataCheckOutRaw || !detalhesReserva.nome_hospede`.
- **Fix 2** — `enriquecerReservaSmoobu` agora cobre mais variantes do nome do hóspede no Smoobu REST API: `guestName`, `guest_name`, `guest.name`, `guest.firstName + guest.lastName`, `firstName + lastName`, `customerName`, `customer.name`, `bookedForName`, `name`. Adicionado log do payload para debug.
- **Fix 3** — `sincronizarReservas` (smoobuController) agora extrai o nome do hóspede do payload REST API com a mesma cobertura exaustiva, passando-o no `payloadWebhook.data.guestName`. Isto evita que o `processarReservaSmoobu` faça um fetch extra por reserva durante a sincronização em lote.
- **Fix 4** — Novo endpoint `POST /api/admin/backfill-nomes-hospedes` que percorre as tarefas existentes com `smoobu_reserva_id` mas sem `nome_hospede` e busca o nome via REST API do Smoobu. Botão **"Preencher Nomes em Falta"** adicionado na gaveta da empresa (`/admin/empresas/[id]`).
- **Debug logs** — adicionados logs em `criarTarefa`, `minhaTarefaDetalhe` e `enriquecerReservaSmoobu` para diagnosticar futuros problemas com o `nome_hospede`.
- **Testes** — os testes do webhook (incluindo `Prompt 93 — guarda detalhes_reserva`) continuam a passar. 2 testes pre-existing (`POST com smoobu_id duplicado → 409` e `com API key + fetch mockado → 200 + contadores`) já falhavam antes das alterações por problemas de setup não relacionados.

### Prompt 138 (136 V2) — Cérebro do Scheduler e Gravação da Viagem

- **Fix 1 — Matemática SLA (480 min):** o cálculo da `carga_total` (tempos tarefas + viagem + nova limpeza) estava com bugs de concatenação de strings (o aggregate do MongoDB podia devolver strings). Tudo envolvido em `Number(...)` com validação `Number.isFinite()`. Se a `carga_total` de TODOS os funcionários disponíveis exceder 480 min, o sistema NÃO força a atribuição — grava com `utilizador_id: null` e `estado: 'nao_atribuida'` (novo estado, distinto de `por_atribuir` = "ainda não tentámos").
  - `determinarUtilizadorAtribuido` agora devolve `{ utilizadorId, tempoViagem }` em vez de apenas o `_id` (para o caller poder persistir o tempo de viagem).
  - `reatribuirTarefa` também com `Number()` no cálculo de `novaCarga`.
  - Algoritmo VIP também com `Number()` no cálculo de `cargaTotalVIP`.

- **Fix 2 — Cap de GPS (Teto Máximo):** o motor de geocoding estava a devolver viagens de 5h (300 min). `calcularTempoViagem` agora impõe `tempoViagem = Math.min(tempoCalculado, 60)` — teto máximo de 60 min (1h). Se der erro (coordenadas inválidas/NaN), assume 30 min (antes devolvia 0, o que subestimava a carga e fazia atribuições impossíveis).

- **Fix 3 — Gravar Tempo de Viagem na BD:** novo campo `tempo_viagem_minutos: { type: Number, default: 0, min: 0 }` no modelo `Tarefa`. O Scheduler guarda o tempo exato da deslocação neste campo ao criar (webhook) e ao reatribuir/auto-atribuir tarefas.
  - `webhookController.criarTarefaPorReserva` — guarda `tempo_viagem_minutos` (prefere o valor do scheduler, fallback para o do load balancer).
  - `tarefaController.reatribuirTarefa` — guarda `tempo_viagem_minutos` do scheduler.
  - `tarefaController.autoAtribuirTarefas` — guarda `tempo_viagem_minutos` em cada tarefa reatribuída.
  - `jobs/caoGuarda.js` (Fail-Safe) — guarda `tempo_viagem_minutos` nas atribuições noturnas.

- **Frontend — exibição do tempo de viagem:**
  - `TarefaMock` (api.ts) ganhou `tempo_viagem_minutos?: number | null`.
  - `detalhe-tarefa-client.tsx` — mostra "+Xmin viagem" (âmbar) nos metadados do detalhe da tarefa.
  - `/staff/tarefas/[id]/page.tsx` — `adaptarTarefa` repassa `tempo_viagem_minutos`.

- **Frontend — novo estado `nao_atribuida`:**
  - Labels: "Não atribuída (SLA)" (tarefas, detalhe modal, calendário, relatórios).
  - Cores: vermelho `destructive` (mais urgente que `por_atribuir` que é âmbar).
  - Calendário: paleta vermelho escuro para eventos `nao_atribuida`.
  - Tab "Por atribuir" do `/gestor/tarefas` inclui `nao_atribuida`.
  - Enum `estadosValidos` do `atualizarEstadoTarefa` inclui `nao_atribuida`.
  - Queries `$ne: 'cancelada'` já incluem `nao_atribuida` (visível na lista do gestor).

- **Testes** — 151/151 ✓ (a mudança de retorno de `determinarUtilizadorAtribuido` de `_id` para `{ utilizadorId, tempoViagem }` não quebrou testes porque os testes do webhook mockam o load balancer).

### Prompt 137 — O Calendário Visual (Mostrar as Viagens)

- **Blocos de Viagem no Calendário (`/gestor/calendario/page.tsx`):** quando uma tarefa tem `tempo_viagem_minutos > 0`, o calendário agora cria **DOIS eventos** em vez de um:
  - **Evento A (A Viagem):** título `🚗 Viagem (Xm)`, início = `hora_tarefa - tempo_viagem`, fim = `hora_tarefa`. Cor cinzenta + borda tracejada (classe CSS `fc-evt-viagem`) para distinguir da tarefa real. ID com sufixo `-viagem` para não colidir.
  - **Evento B (A Limpeza):** a tarefa normal com a cor da propriedade/estado.
  - `tarefas.map` trocado por `tarefas.flatMap` para suportar 1 ou 2 eventos por tarefa.
  - `renderEventContent` detecta a flag `_isViagem` no `extendedProps` e renderiza o bloco de viagem com estilo próprio (cinzento + itálico + ícone 🚗).
  - Clicar no bloco de viagem abre o detalhe da tarefa associada (o `extendedProps` tem todos os campos da tarefa).
  - CSS adicionado ao `globals.css`: `.fc-evt-viagem` (borda tracejada), `.fc-evt-month--viagem` (vista mensal), `.fc-evt-block--viagem` (vista semanal/diária).

- **UI dos Detalhes da Tarefa — badge de tempo de viagem:**
  - `detalhe-tarefa-modal.tsx` (gestor): badge âmbar "🚗 Tempo de Viagem estimado: X min" entre os metadados e a lotação máxima. Interface `TarefaDetalheGestor` actualizada com `tempo_viagem_minutos`.
  - `task-card.tsx` (staff): badge âmbar "🚗 Tempo de Viagem: X min" entre o nome do hóspede e o botão "Ver detalhes".
  - `detalhe-tarefa-client.tsx` (staff, detalhe): já tinha "+Xmin viagem" nos metadados (Prompt 138).
  - `adaptarTarefa` em `/staff/page.tsx` e `/staff/tarefas/[id]/page.tsx` repassam `tempo_viagem_minutos`.
  - Interface `TarefaReal` e `TarefaCalendario` actualizadas com `tempo_viagem_minutos`.

- **Testes** — 151/151 ✓ (sem alterações de backend). Lint frontend ✓.

### Prompt 139b — Fix viagens não apareciam (cálculo on-the-fly + backfill)

- **Root cause** — as tarefas existentes foram criadas antes do Prompt 138 (que adicionou `tempo_viagem_minutos` ao schema e o guardou no scheduler). Por isso têm `tempo_viagem_minutos: 0` ou `undefined`, e os blocos de viagem não apareciam no calendário (a condição `tempoViagem > 0` era sempre falsa).
- **Fix 1 — Cálculo on-the-fly no `getDadosCalendario`** (gestorController): depois de obter as tarefas, percorre-as e para cada tarefa atribuída sem `tempo_viagem_minutos`, procura a tarefa anterior do mesmo staff no mesmo dia (no próprio array de tarefas) e calcula a viagem Haversine. Isto garante que os blocos aparecem **imediatamente** sem precisar de backfill.
- **Fix 2 — Cálculo on-the-fly no `minhasTarefas`** (authController): mesma lógica para a lista de tarefas do staff (cartões).
- **Fix 3 — Cálculo on-the-fly no `getTarefas`** (gestorController): mesma lógica para a tabela de tarefas do gestor. Populate de `propriedade_id` agora inclui `coordenadas`.
- **Fix 4 — Cálculo on-the-fly no `minhaTarefaDetalhe`** (authController): para o detalhe da tarefa do staff, faz uma query à tarefa anterior do mesmo staff no mesmo dia e calcula a viagem.
- **Fix 5 — Endpoint `POST /api/admin/backfill-tempos-viagem`**: percorre todas as tarefas atribuídas sem `tempo_viagem_minutos` e guarda o valor calculado na BD (para persistência — evita recalcular a cada pedido). Botão **"Calcular Tempos de Viagem"** adicionado na gaveta da empresa (`/admin/empresas/[id]`).
- **Testes** — 151/151 ✓. Lint ✓.

### Prompt 139c — Fix nome_hospede: Smoobu usa `guest-name` (kebab-case)

- **Root cause** — o Smoobu devolve o nome do hóspede como `guest-name` (kebab-case) em alguns endpoints, mas o código só procurava `guestName` (camelCase) e `guest_name` (snake_case). Por isso o nome ficava sempre `null`.
- **Fix** — adicionada a variante `guest-name` (acesso via bracket notation `['guest-name']`) em **3 sítios**:
  1. `extrairDadosReserva` (webhookController) — extração do payload do webhook.
  2. `enriquecerReservaSmoobu` (webhookController) — extração da resposta da REST API.
  3. `sincronizarReservas` (smoobuController) — extração do payload REST API antes de mapear para o formato webhook.
- **Testes** — 151/151 ✓.

### Prompt 140 — Caixa Negra de Webhooks na gaveta da empresa

- **Modelo `WebhookLog`** ganhou campo `empresa_id` (ObjectId ref Empresa, default null, indexado). Permite filtrar logs por empresa.
- **`webhookController.webhookSmoobu`** — resolve o `empresa_id` a partir do payload (extrai `smoobuPropId`, procura a propriedade, obtém `empresa_id`) antes de criar o log. Best-effort: se falhar, fica null.
- **`GET /api/admin/webhook-logs`** — aceita query `?empresa_id=` para filtrar logs por empresa.
- **Novo componente `WebhookLogsCard`** (`components/admin/webhook-logs-card.tsx`) — card completo que mostra os logs de webhooks filtrados por empresa. Inclui:
  - Tabela com data/hora, evento, estado (Badge), erro.
  - Filtros por estado (Todos / Sucesso / Falhas / Pendentes).
  - **Linha expansível** — click na linha expande o payload completo (JSON formatado) para auditoria.
  - Botão "Limpar Antigos" (apaga logs > 30 dias).
  - Scroll interno (`max-h-96 overflow-y-auto`) para não esticar a página.
- **Gaveta da empresa** (`/admin/empresas/[id]`) — `WebhookLogsCard` adicionado antes da Zona de Perigo, com `md:col-span-2` (ocupa toda a largura).
- **AdminSidebar** mantém só "Empresas" (não foi adicionado link global — o utilizador pediu que ficasse dentro da configuração da empresa).
- **Testes** — 151/151 ✓. Lint ✓.

Stage Summary:
- **SaaS multi-tenant consolidado:** `Empresa` com `ativa` + `apagada`, endpoints de Super Admin (toggle-status, hard-reset scoped, soft-delete + restaurar, config, sincronizar-propriedades/reservas, registrar-webhooks), Lixeira de Empresas no `/admin`.
- **Notificações In-App amadurecidas:** `Notificacao.tarefa_id`, sino com scroll/max-height, página full-page `/gestor/notificacoes` e `/staff/notificacoes`, polling 30s.
- **Timezone blindado:** helpers `parsearDataSegura` + `extrairHoraISO` (sem `new Date()`), fuso Portugal via `Intl` offset, calendário com strings locais sem `Z`, SW não interceta `/api/`. Resolveu shifts de hora/dia em produção (especialmente iOS Safari e servidores Render em UTC).
- **Soft block de conflitos:** sobreposição horária passou a warning não-bloqueante (200 com `warning` + tempo de viagem) com modal "Forçar Agendamento" / "Confirmar Morada".
- **Resumo IA (Gemini):** SDK `@google/generative-ai`, nunca crasha (placeholder hardcoded), exportável em PDF via `html2pdf`.
- **PWA resiliente:** `skipWaiting` + `clientsClaim` + runtime caching `NetworkFirst` em chunks + handler de `ChunkLoadError` com guard anti-loop.
- **Lixeira / soft delete:** empresas eliminadas vão para Reciclagem (restauráveis); índice único MongoDB legado removido no arranque.
- **Staff UX:** navegação por dias (±30 dias), tarefas agrupadas por dia, morada no cartão, `nome_hospede`, Exportar PDF (`window.print`).
- Documentação (`README.md`, `docs/BACKEND.md`, `docs/FRONTEND.md`, este `WORKLOG.md`) atualizada retroativamente para cobrir os Prompts 115-131.


---

Task ID: DOC-F0
Agent: general-purpose
Task: Limpeza de documentação Smoobu + criação de docs/ARQUITETURA.md

Work Log:
- Lido `WORKLOG.md` (756 linhas, última entrada A18 — Prompts 115-131) para contexto da era Alojamento Local.
- Baseline Smoobu: `README.md` 14 refs · `docs/BACKEND.md` 77 refs · `docs/FRONTEND.md` 16 refs (total 107).
- Confirmada estrutura backend pós-F0: `controllers/` sem `smoobuController.js`/`webhookController.js`; `routes/` sem `webhookRoutes.js`; `utils/loadBalancer.js` presente; `models/` mantém `WebhookLog.js`, `Tarefa.js`, `Propriedade.js`, `ModeloChecklist.js`, `TarefaArquivo.js` (serão migrados em F3–F8); `server.js` healthcheck já diz "API do FisioCell online e ligada à BD!".

- **README.md** (0 refs Smoobu ✅):
  - Descrição: "SaaS de gestão para Alojamento Local" → "SaaS de gestão para Clínicas de Fisioterapia".
  - Estrutura do repositório: removidos `controllers/webhookController.js` e `routes/webhookRoutes.js`; adicionados `utils/` (loadBalancer, geocoding, scheduler, etc.) e lista de routes atualizada.
  - Healthcheck: "API do Alojamento Local..." → "API do FisioCell...".
  - Endpoints: removidas 10 linhas Smoobu (POST /webhooks/smoobu, /api/gestor/smoobu/*, /api/gestor/webhooks/*, /api/admin/backfill-*, /api/admin/empresas/:id/sincronizar-*/registrar-webhooks). Limpos smoobu_id de body descrições (POST/PUT /api/gestor/propriedades). Atualizado /api/admin/empresas/:id/config (API key Smoobu → morada/telefone/email).
  - Link anchor `#32-lógica-central--atribuição-de-tarefas-webhook-smoobu` simplificado para `docs/BACKEND.md`.

- **docs/BACKEND.md** (0 refs ativas ✅; 23 refs totais = 6 F0 + 17 histórico):
  - Adicionada nota F0 no topo: "⚠️ F0 — Documentação em transição. A integração Smoobu foi removida..."
  - Domínio: "Alojamento Local" → "Fisioterapia".
  - Secção 2 (Estrutura): removidos `webhookController.js`/`webhookRoutes.js`; adicionados todos os controllers/routes/utils reais; `Propriedade.js` e `Tarefa.js` marcados como "será migrado para Sala/Consulta em F3/F4".
  - Secção 3.1 (Modelos): `Empresa` ganhou campos `morada`/`telefone`/`email` (F0). `Propriedade` — removido `smoobu_id`, atualizadas descrições de `tempo_limpeza_minutos`/`capacidade_hospedes`/`ativo`. `Tarefa` — removido `smoobu_reserva_id`, atualizada `detalhes_reserva`. `Utilizador.ativo` — removida referência ao webhook.
  - Secção 3.2 (Lógica central): substituída integralmente. Era "Atribuição de tarefas (Webhook Smoobu)" com fluxo de 9 passos; agora descreve o motor de atribuição em `utils/loadBalancer.js` (7 passos) com nota F0 explicando que a criação automática via webhook foi descontinuada.
  - Secção 3.3 (Cron Jobs): removida referência "o mesmo usado no webhook".
  - Secção 5 (Env vars): confirmado sem SMOOBU_API_KEY (já não estava na tabela principal).
  - Secção 6 (API): healthcheck atualizado. Removida secção `POST /webhooks/smoobu` (payload + exemplo JSON). Removidas secções 6.5–6.9 (Webhooks logs, Webhook robustez, Sincronização massa, Listar propriedades Smoobu, Sincronizar propriedades Smoobu) — substituídas por nota F0 "Removidos". Secção 6.11 "Impacto no webhook" → "Impacto no motor de atribuição (load balancer)".
  - Secção 6.1 (setup): "O Meu Alojamento Local" → "Clínica FisioCell Teste"; removido `smoobu_id: '99999'` do setup e da resposta JSON.
  - GET/POST /api/admin/propriedades: removido `smoobu_id` da resposta/body/erros.
  - Secção 9 (Histórico): adicionada nota F0 histórica no topo do changelog ("As entradas abaixo anteriores a F0 descrevem a era Alojamento Local..."). Changelog preservado como registo histórico (git log mantém o histórico completo).

- **docs/FRONTEND.md** (0 refs ativas ✅; 11 refs totais = 2 F0 + 9 histórico):
  - Adicionada nota F0 no topo: "⚠️ F0 — Documentação em transição. Páginas de webhooks Smoobu descontinuadas..."
  - Domínio: "Alojamento Local" → "Fisioterapia".
  - Secção 3 (Rotas): removida linha `/admin/webhooks` da tabela de rotas.
  - Secção 3.1 (Área Admin): sidebar de 9→8 itens (removido "Webhooks"). `/admin/propriedades` — removidas dropdown Smoobu + botão "Sincronizar Smoobu" + smoobu_id read-only. `/admin/tarefas` — removido botão "Sincronizar Smoobu". Removido item "Webhooks" da lista de páginas.
  - Secção `/admin/propriedades` (Client Component): coluna "Smoobu ID" removida da tabela; campo "Smoobu ID" removido do formulário; validação "Smoobu ID obrigatório" removida.
  - Secção `/admin/calendario`: "Integração com webhook" → "Integração com o motor de atribuição (load balancer)".
  - Secção 13 (Histórico): adicionada nota F0 histórica no topo do changelog (igual ao BACKEND.md).

- **docs/ARQUITETURA.md** (novo ficheiro, ~300 linhas):
  - Criado com a proposta de arquitetura v0.1 do FisioCell em pt-pt.
  - 9 secções: Visão Geral (stack Node/Express/MongoDB + Next.js 14/TS/Tailwind/shadcn + FullCalendar v6), Princípios Herdados (8 princípios em tabela), Hierarquia de Roles (4 roles + matriz de permissões recursos×roles + middleware isDiretorClinico/isClinico/isRececionista), Mapa de Migração de Domínio (Empresa→Empresa, Propriedade→Sala, Tarefa→Consulta, smoobuController/webhookController→❌removido, novos: Paciente/HorarioFisioterapeuta/Documento), Modelos Propostos v0.1 (esquemas Mongoose para Empresa/Utilizador/Paciente/Consulta/Sala/HorarioFisioterapeuta/Documento), Cron Jobs (5 jobs adaptados: briefingDiarioFisio 08:00, lembreteConsultasAmanha 19:00, lembrete2hConsulta 15min, caoGuardaConsultas 02:00, arquivistaConsultas semanal), Decisões de Design (8 decisões justificadas), Roadmap F0–F9 (tabela com 10 fases, F0✅), Questões Respondidas (5 questões: faturação Não, portal Não, multi-clínica Não, documentos Sim→F9, grupo Não).

Stage Summary:
- **README.md**: 0 refs Smoobu (objetivo 0 atingido). Descrição, estrutura, healthcheck, endpoints e env vars atualizados para Fisioterapia.
- **docs/BACKEND.md**: 0 refs Smoobu ATIVAS. 6 refs em notas F0 explicativas (aceitáveis per task) + 17 refs em changelog histórico (contextualizadas por nota F0 no topo do changelog). Secção 3.2 reescrita (webhook → load balancer), secções 6.5–6.9 removidas, modelos limpos de smoobu_id/smoobu_reserva_id/smoobu_api_key, setup "Clínica FisioCell Teste".
- **docs/FRONTEND.md**: 0 refs Smoobu ATIVAS. 2 refs em notas F0 explicativas + 9 refs em changelog histórico. Páginas/itens de webhooks removidos, referências a Sincronizar Smoobu/dropdown Smoobu removidas.
- **docs/ARQUITETURA.md**: criado (novo). Proposta v0.1 completa com 4 roles, 7 modelos Mongoose, 5 cron jobs, 8 decisões de design, roadmap F0–F9, e 5 questões respondidas pelo utilizador.
- **WORKLOG.md**: esta entrada DOC-F0 adicionada em append.
- Validação `rg -c -i "smoobu"`: README.md 0 · BACKEND.md 23 (6 F0 + 17 histórico) · FRONTEND.md 11 (2 F0 + 9 histórico). Objetivo "0 refs ativas" atingido — todas as refs restantes são notas F0 explicativas ou registos históricos de changelog.

---
Task ID: F0
Agent: Z.ai Code
Task: Reexecução da F0 — rename Autocell → FisioCell + remoção completa da integração Smoobu + criação de docs/ARQUITETURA.md. (Esta fase já tinha sido executada anteriormente mas o commit não chegou ao remote — o branch foi revertido ao estado pré-F0 pelo utilizador.)

Work Log:

### F0-A — Remoção da integração Smoobu (backend)
- Eliminados 3 ficheiros: `backend/controllers/smoobuController.js`, `backend/controllers/webhookController.js`, `backend/routes/webhookRoutes.js`.
- `backend/server.js`: removido o mount `/webhooks` + import de `webhookRoutes`; cabeçalho atualizado (Autocell→FisioCell) + mensagem do healthcheck ("API do FisioCell online e ligada à BD!").
- `backend/routes/gestorRoutes.js`: removidas 6 rotas Smoobu + respetivo import do `smoobuController`. Endpoint `/configuracoes` GET/PUT refatorado para gerir `nome/nif/morada/telefone/email` em vez de `smoobu_api_key`.
- `backend/routes/adminRoutes.js` (913→~450 linhas): removidas todas as rotas Smoobu (scoped + globais + backfills). Endpoints `/config-empresa` e `/empresas/:id/config` refatorados para gerir `nome/nif/morada/telefone/email`. Import do `smoobuController` removido.

### F0-B — Extração do load balancer
- Criado `backend/utils/loadBalancer.js` com `calcularCargaLimpezaDia` e `determinarUtilizadorAtribuido` extraídas do `webhookController` eliminado. Reutiliza `obterRangeDia` + `calcularTempoViagem` do `utils/scheduler.js`.
- `backend/controllers/tarefaController.js`: import mudou de `require('./webhookController')` para `require('../utils/loadBalancer')`.
- `backend/jobs/caoGuarda.js`: mesma alteração de import.
- `backend/controllers/gestorController.js`: `reprocessarWebhook` transformado em stub 410 Gone.

### F0-C — Limpeza dos modelos Mongoose
- `models/Empresa.js`: removido `smoobu_api_key`; adicionados `morada`, `telefone`, `email`.
- `models/Propriedade.js`: removido `smoobu_id` (era `required: true, unique: true`).
- `models/Tarefa.js`: removido `smoobu_reserva_id` (topo) + `detalhes_reserva.smoobu_reserva_id`. `detalhes_reserva` mantido como vestigial (será substituído por `nota_clinica` SOAP na F4).
- `models/TarefaArquivo.js`: mesma remoção de `smoobu_reserva_id`.

### F0-D — Limpeza dos controladores
- `gestorController.js`: `criarPropriedade` removida validação de `smoobu_id` (obrigatório + único). `atualizarPropriedade` removida lógica de `smoobu_id`. `setupClienteZero`: empresa renomeada "Clínica FisioCell Teste", utilizadores renomeados (Diretor FisioCell, Responsável Clínico, João Fisioterapeuta), propriedade procurada por `nome` em vez de `smoobu_id`.

### F0-E — Limpeza dos testes
- `tests/integration.test.js` (3985→2847 linhas): removidos 6 blocos `describe` Smoobu (POST /webhooks/smoobu, GET /api/gestor/webhooks, POST /webhooks/:id/reprocessar, POST /smoobu/sincronizar, GET /smoobu/propriedades, POST /smoobu/sincronizar-propriedades) + 2 testes de `importarPropriedades` no bloco Correções. Testes de Propriedade CRUD atualizados: removido `smoobu_id` do setup e asserções; removidos 2 testes de duplicação 409 (constraint único deixou de existir).
- `tests/server.test.js`: mensagem do healthcheck atualizada.
- **Resultado: 111/111 testes a passar ✓** (eram 151, removidos ~40 testes Smoobu).

### F0-F — Rename Autocell → FisioCell (73+ ficheiros)
- 4 passos `sed` em massa (excluindo `node_modules`, `package-lock.json`, `agent-ctx`, `WORKLOG.md` histórico):
  1. `autocell_admin_token` → `fisiocell_admin_token` (cookie de impersonação)
  2. `autocell_token` → `fisiocell_token` (cookie de sessão principal)
  3. `Autocell` → `FisioCell` (capitalizado)
  4. `autocell` → `fisiocell` (lowercase: emails, package names, URLs)
- `backend/package.json`: name → "fisiocell-backend"
- `frontend/package.json`: name → "fisiocell-frontend"
- `frontend/public/manifest.json`: name/description atualizados para Fisioterapia
- 0 residuais de "autocell" no código.

### F0-G — Documentação
- Criado `docs/ARQUITETURA.md` com a proposta v0.1: visão geral, princípios herdados, hierarquia de 4 roles (admin/diretor_clinico/fisioterapeuta/rececionista), matriz de permissões, mapa de migração, 7 modelos propostos (Empresa, Utilizador, Paciente, Consulta, Sala, HorarioFisioterapeuta, Documento), cron jobs, decisões de design, roadmap F0-F9, questões respondidas.
- Task DOC-F0 (subagent): limpeza de Smoobu em README.md (0 refs), docs/BACKEND.md (notas F0 + changelog histórico preservado), docs/FRONTEND.md (notas F0 + changelog histórico). Removidos ~10 endpoints Smoobu, ~130 linhas de secções Smoobu, atualizado domínio para Fisioterapia.

Stage Summary:
- **Código:** Smoobu completamente removido (3 ficheiros eliminados, 4 modelos limpos, 2 route files reescritos, load balancer extraído para `utils/loadBalancer.js`). 111/111 testes ✓.
- **Rename:** Autocell→FisioCell aplicado em 73+ ficheiros (cookies `fisiocell_token` + `fisiocell_admin_token`, package names, emails, manifest, docs).
- **Documentação:** `docs/ARQUITETURA.md` criado com a proposta v0.1 + modelo `Documento` (Q4). README/BACKEND/FRONTEND limpos de Smoobu.
- **Commit + push:** Esta reexecução garante que o trabalho chega ao remote (a execução anterior não teve commit).
- **Próximo passo:** F1 (adaptar Empresa + Utilizador com novos roles + perfil profissional).

---
Task ID: DOC-F1
Agent: general-purpose
Task: Atualização de documentação para F1 (migração de roles)

Work Log:
- Lido `WORKLOG.md` (864 linhas, última entrada F0) e `docs/ARQUITETURA.md` (342 linhas) para contexto.
- Confirmado estado pós-F1 no código: `backend/middleware/requireRole.js` (isAdmin/isDiretorClinico/isClinico/isRececionista, sem isGestor/requireStaff/requireManager/requireAdmin); `backend/models/Utilizador.js` (enum novo + `perfil_profissional` com cedula/especialidades/biografia/cor_calendario/ativo_clinico, default role 'rececionista'); `backend/models/Empresa.js` (logo_url + bloco config estruturado com horario_padrao/duracao_consulta_padrao/tolerancia_atraso_min/fuso_horario); `backend/utils/loadBalancer.js` (query `role: 'fisioterapeuta'`); `frontend/src/middleware.ts` (Role type + rotaPorRole com rececionista → /gestor); `frontend/src/components/auth/route-guard.tsx` (aceita `Role | Role[]`); `frontend/src/app/gestor/layout.tsx` (`role={["diretor_clinico", "rececionista"]}`); `frontend/src/lib/auth.ts` + `frontend/src/lib/api.ts` (Role type atualizado).

- **docs/BACKEND.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Secção 2 (Estrutura): adicionado `middleware/requireRole.js` à árvore de diretórios.
  - Secção 3.1 `Empresa`: adicionado `logo_url` (F1) e bloco `config` (F1) como sub-tabela própria (horario_padrao, duracao_consulta_padrao, tolerancia_atraso_min, fuso_horario); adicionados campos `ativa`/`apagada` que estavam em falta; nota F1 explicativa.
  - Secção 3.1 `Utilizador`: roles migradas de admin/manager/staff para admin/diretor_clinico/fisioterapeuta/rececionista (com descrições RGPD de cada uma); enum atualizado para `['admin','diretor_clinico','fisioterapeuta','rececionista']` default `'rececionista'`; `responsavel_id` agora referencia admin/diretor_clinico; adicionados campos `telefone`/`dias_folga`/`eliminado_em`/`pushSubscription` que estavam em falta; novo sub-bloco `perfil_profissional` (cedula, especialidades, biografia, cor_calendario, ativo_clinico); nota F1 sobre migração de middleware (isGestor→isDiretorClinico, etc.); novo parágrafo "Middlewares RBAC (F1)" documentando isAdmin/isDiretorClinico/isClinico/isRececionista; regra de segurança atualizada (admin/manager → admin/diretor_clinico).
  - Secção 3.2 (load balancer): passo 1 "Procurar Staff" → "Procurar Fisioterapeutas" com query `role: 'fisioterapeuta'`.
  - Secção 6.1 GET /api/admin/equipa: exemplo JSON atualizado (João Fisioterapeuta / joao.fisio@fisiocell.pt / role fisioterapeuta).
  - Secção 6.1 POST /api/admin/equipa: body exemplo `role: "fisioterapeuta"`; descrição do campo role atualizada (enum + default 'rececionista' no modelo, 'fisioterapeuta' no controller).
  - Secção 6.1 PUT /api/admin/equipa: body exemplo `role: "diretor_clinico"` (era "manager").
  - Secção 6.1 setup Cliente Zero: descrição dos 3 utilizadores atualizada (admin/gestor@fisiocell.pt/joao.fisio@fisiocell.pt com roles admin/diretor_clinico/fisioterapeuta); resposta JSON atualizada (nomes "Diretor FisioCell"/"Responsável Clínico"/"João Fisioterapeuta"); nota F1 sobre o email `gestor@fisiocell.pt` ser mantido por compatibilidade; credenciais de teste atualizadas.
  - Secção 6.2 POST /api/auth/login: body e resposta JSON atualizados (joao.fisio@fisiocell.pt, nome "João Fisioterapeuta", role "fisioterapeuta").
  - Secção 6.3 GET /api/admin/ausencias: resposta JSON atualizada (João Fisioterapeuta / role fisioterapeuta).
  - Secção 6.3 POST /api/admin/ausencias: constraints de role atualizadas (fisioterapeuta/diretor_clinico em vez de staff/manager).
  - Secção 6.3 "Integração com o webhook": corrigida ref legacy (webhookController → utils/loadBalancer.js, staff → fisioterapeutas).
  - Secção 9 (Histórico): nota F0 expandida para "F0 + F1 — Notas históricas" cobrindo roles antigos e middleware legacy; nova entrada F1 no topo do changelog descrevendo os 5 grupos de alterações (modelo Utilizador, modelo Empresa, middleware/requireRole.js, load balancer + controllers, setupClienteZero).

- **docs/FRONTEND.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Secção 3 (Rotas): tabela atualizada — adicionada linha `/gestor` (área partilhada diretor_clinico+rececionista via RouteGuard); `/staff` agora descrito como "Área do Fisioterapeuta" com `role fisioterapeuta` (era "role staff").
  - Secção 11 (`lib/auth.ts`): `rotaPorRole` atualizada (admin → /admin, diretor_clinico/rececionista → /gestor partilhado, fisioterapeuta → /staff); nota F1 sobre o tipo Role.
  - Secção 11 (`lib/api.ts`): nota F1 sobre o tipo Role = admin/diretor_clinico/fisioterapeuta/rececionista.
  - Secção 11 `/login`: redirect pós-login atualizado (admin → /admin, diretor_clinico/rececionista → /gestor, fisioterapeuta → /staff).
  - Secção 11 `/admin/equipa`: "Responsável select populado com admin+diretor_clinico" (era admin+manager); nota F1.
  - Secção 11 `/admin/calendario`: "filtrado a fisioterapeuta+diretor_clinico" (era staff+manager); nota F1.
  - Secção 12.1 (`middleware.ts`): exemplo "staff tenta aceder a /admin" → "fisioterapeuta tenta aceder a /admin"; nova nota F1 sobre Role type e rotaPorRole (incl. validação de rota errada que aceita diretor_clinico+rececionista em /gestor/*).
  - Secção 12.2 (`route-guard.tsx`): nova nota F1 sobre a prop `role` aceitar `Role | Role[]` para áreas partilhadas; menção explícita de `gestor/layout.tsx` com `role={["diretor_clinico", "rececionista"]}` e `staff/layout.tsx` agora com `role="fisioterapeuta"`.
  - Secção 12.4: `rotaPorRole` atualizada para o mapeamento F1.
  - Secção 13 (Histórico): nota F0 expandida para "F0 + F1 — Notas históricas" cobrindo roles antigos, área /manager removida, e área /gestor partilhada; nova entrada F1 no topo do changelog descrevendo os 6 grupos de alterações (middleware.ts, lib/auth.ts+api.ts, route-guard.tsx, gestor/layout.tsx, gestor/equipa/page.tsx, admin/page.tsx).

- **docs/ARQUITETURA.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Banner topo: "acompanha a fase F0" → "acompanha as fases F0 e F1".
  - Secção 4 (Mapa de Migração): linha do `Utilizador` marcada com "F1 ✅" (era "F1").
  - Secção 5.1 `Empresa`: título "✅ F0 concluído" → "✅ F0 + F1 concluídos"; schema atualizado para refletir a implementação real (logo_url, bloco config estruturado com horario_padrao/duracao_consulta_padrao/tolerancia_atraso_min/fuso_horario, ativa/apagada com index).
  - Secção 5.2 `Utilizador`: título "F1" → "✅ F1 concluído"; schema atualizado para refletir a implementação real (default role 'rececionista' em vez de 'fisioterapeuta'; perfil_profissional completo com biografia e ativo_clinico; pushSubscription; ordem dos campos alinhada com o modelo real).
  - Secção 8 (Roadmap): F1 marcado como "✅ Concluído" (era "Pendente").

Stage Summary:
- **docs/BACKEND.md**: 0 refs ativas a `'staff'`/`'gestor'`/`'manager'`/`isGestor` (3 notas F1 explicativas + 4 entradas de changelog histórico cobertas pela nota F1 no topo da secção 9). Modelo `Utilizador` com 4 roles + `perfil_profissional`; modelo `Empresa` com `logo_url` + bloco `config`; load balancer referencia `role: 'fisioterapeuta'`; setupClienteZero com 3 utilizadores novos; entrada F1 adicionada ao histórico.
- **docs/FRONTEND.md**: 0 refs ativas a `'staff'`/`'gestor'`/`'manager'`/`isGestor` (2 entradas de changelog histórico cobertas pela nota F1 no topo da secção 13). middleware.ts e route-guard.tsx documentados com a prop `Role | Role[]`; /gestor marcado como área partilhada diretor_clinico+rececionista; /staff marcado como área do fisioterapeuta; entrada F1 adicionada ao histórico.
- **docs/ARQUITETURA.md**: F1 marcado como ✅ Concluído no roadmap (secção 8) e no mapa de migração (secção 4); schemas de Empresa e Utilizador alinhados com a implementação real; banner topo atualizado.
- **Validação `rg -c "'staff'|'gestor'|isGestor"`**: BACKEND.md 7 (3 F1 explicativas + 4 histórico) · FRONTEND.md 2 (2 histórico). Objetivo "0 refs ativas" atingido — todas as refs restantes são notas F1 explicativas ou registos históricos de changelog cobertos pela nota F1 no topo das secções 9 (BACKEND) e 13 (FRONTEND).
- **WORKLOG.md**: esta entrada DOC-F1 adicionada em append.

---
Task ID: F1
Agent: Z.ai Code
Task: Adaptar Empresa + Utilizador para o domínio Fisioterapia — novos roles (admin/diretor_clinico/fisioterapeuta/rececionista), perfil profissional embutido, config da clínica, middleware RBAC atualizado, propagação para load balancer/controllers/routes/testes/frontend.

Work Log:

### F1-A — Modelo Utilizador
- Enum de roles migrado: `['admin', 'gestor', 'staff']` → `['admin', 'diretor_clinico', 'fisioterapeuta', 'rececionista']` (default `rececionista`, indexado).
- Adicionado bloco `perfil_profissional`: `cedula` (Ordem dos Fisioterapeutas), `especialidades` (array), `biografia`, `cor_calendario` (default `#3b82f6`), `ativo_clinico` (default true).
- Cabeçalho reescrito com a nova hierarquia e regra RGPD (admin não vê dados clínicos).

### F1-B — Modelo Empresa
- Adicionado `logo_url`.
- Adicionado bloco `config`: `horario_padrao` (array de {dia_semana, abertura, fecho}), `duracao_consulta_padrao` (default 45, min 15), `tolerancia_atraso_min` (default 10), `fuso_horario` (default 'Europe/Lisbon').

### F1-C — Middleware requireRole.js
- Removidos `isGestor`, `requireStaff`, `requireManager`, `requireAdmin` (legacy).
- Adicionados: `isAdmin` (só admin), `isDiretorClinico` (admin+diretor_clinico), `isClinico` (admin+diretor_clinico+fisioterapeuta), `isRececionista` (admin+diretor_clinico+rececionista).

### F1-D — Load balancer + controllers (substituições em massa)
- `role: 'staff'` → `role: 'fisioterapeuta'` (load balancer, gestorController, tarefaController, ausenciaController, caoGuarda).
- `role: 'gestor'` → `role: 'diretor_clinico'`.
- `['staff', 'gestor']` → `['fisioterapeuta', 'diretor_clinico']`.
- `isGestor` → `isDiretorClinico` em todas as routes.
- `gestorController.criarMembroEquipa` / `atualizarMembroEquipa`: validações de role atualizadas para os 3 novos roles (diretor_clinico, fisioterapeuta, rececionista).
- `superAdminController.criarUtilizadorEmpresa`: mesma atualização.
- `superAdminController.impersonarGestor`: query e token geram role 'diretor_clinico'.
- `staffController.faltaHoje`: notificação push envia para 'diretor_clinico' + 'admin'.
- `ausenciaController.cancelarAusencia`: condição de role atualizada.

### F1-E — setupClienteZero
- Roles dos utilizadores de teste: admin → admin, gestor → diretor_clinico, staff → fisioterapeuta.
- (Já tinha sido renomeado em F0, mas os roles internos precisavam de mudar.)

### F1-F — Testes (integration.test.js)
- Substituições em massa: `role: 'staff'` → `role: 'fisioterapeuta'`, `role: 'gestor'` → `role: 'diretor_clinico'`.
- Asserções: `toBe('gestor')` → `toBe('diretor_clinico')`, `toContain('gestor'/'staff')` → `toContain('diretor_clinico'/'fisioterapeuta')`.
- 1 teste corrigido manualmente (`toHaveProperty('gestor')` mantido — é o nome do campo JSON da API, não o role).
- **Resultado: 111/111 testes a passar ✓.**

### F1-G — Frontend
- `middleware.ts`: `Role` type atualizado para os 4 roles; `rotaPorRole` trata rececionista → /gestor; `rotaErrada` permite rececionista em /gestor.
- `route-guard.tsx`: prop `role` agora aceita `Role | Role[]` (para áreas partilhadas); lógica de redirect atualizada.
- `gestor/layout.tsx`: `<RouteGuard role={["diretor_clinico", "rececionista"]}>` (área partilhada).
- `lib/auth.ts`: `Role` type + `rotaPorRole` atualizados (rececionista → /gestor).
- `lib/api.ts`: `Role` type atualizado.
- `gestor/equipa/page.tsx`: `ROLE_LABEL` e `ROLE_VARIANT` atualizados (4 roles); options do formulário atualizadas.
- `admin/page.tsx`: labels de role atualizados (Diretor Clínico, Fisioterapeuta, Rececionista).
- `propriedades/page.tsx`: filtro de staff → fisioterapeuta.
- **Validação: tsc ✓, lint ✓, build ✓ (middleware 26.8kB).**

### F1-H — Documentação (Task DOC-F1 por subagent)
- `docs/BACKEND.md`: tabelas de Empresa (logo_url + config) e Utilizador (perfil_profissional) atualizadas; middleware RBAC documentado; load balancer role atualizada; exemplos JSON atualizados; entrada F1 no histórico.
- `docs/FRONTEND.md`: rotas, middleware, route-guard, ROLE_LABEL atualizados; entrada F1 no histórico.
- `docs/ARQUITETURA.md`: F1 marcado como ✅ Concluído no roadmap; schemas alinhados com a implementação real.

Stage Summary:
- **Roles migrados com sucesso** para o domínio Fisioterapia: admin, diretor_clinico, fisioterapeuta, rececionista. Default `rececionista` (menos privilegiado após admin).
- **Perfil profissional** embutido no Utilizador (cédula, especialidades, cor do calendário) — prepara o caminho para F3 (horários) e F4 (consultas).
- **Config da clínica** embutida na Empresa (horário padrão, duração de consulta, fuso) — prepara o motor de disponibilidade de F3.
- **Middleware RBAC** com 4 atalhos compostos: `isAdmin`, `isDiretorClinico`, `isClinico`, `isRececionista`.
- **/gestor partilhado** por diretor_clinico + rececionista (a rececionista gere marcações; o backend limita via `isRececionista` o acesso a notas clínicas).
- **111/111 testes ✓** + **lint ✓** + **tsc ✓** + **build ✓**.
- **Próximo passo:** F2 (Criar Paciente + CRUD + permissões).

---
Task ID: DOC-F2
Agent: general-purpose
Task: Atualização de documentação para F2 (Pacientes)

Work Log:
- Lido `WORKLOG.md` (980 linhas, últimas entradas DOC-F0/F0/DOC-F1/F1) e `docs/ARQUITETURA.md` (357 linhas) para contexto.
- Confirmado estado pós-F2 no código: `backend/models/Paciente.js` (empresa_id, nome, data_nascimento default null index, genero enum ['M','F','Outro','NA'] default 'NA', num_utente SNS, nif, telefone obrigatório, email/morada, contacto_emergencia {nome,telefone,relacao}, historico_medico, alergias [String], consentimento_dados {concedido,data,versao_termos}, ativo index, eliminado_em index soft delete, observacoes, origem enum ['walk_in','referenciacao','online','outro'] default 'walk_in'; índices compostos {empresa_id,nome}, {empresa_id,num_utente}, {empresa_id,ativo,eliminado_em}); `backend/controllers/pacienteController.js` (6 funções + helpers `temAcessoClinico`/`sanitizarParaNaoClinico` + auditoria); `backend/routes/pacienteRoutes.js` (middleware custom `podeVer` 4 roles para GET/POST/PUT, `isRececionista` para PATCH estado, `isDiretorClinico` para DELETE soft delete); `backend/server.js` mount `/api/gestor/pacientes`; `frontend/src/app/gestor/pacientes/page.tsx` (grid de cartões + busca + modais); `frontend/src/lib/api.ts` (PacienteDTO + PacienteListResponse); `frontend/src/components/gestor/gestor-sidebar.tsx` (item Pacientes, ícone UserRound).

- **docs/BACKEND.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Secção 2 (Estrutura): adicionado `pacienteController.js` à árvore de controllers; `Paciente.js` à árvore de models; `pacienteRoutes.js` à árvore de routes. Atualizada contagem "5 coleções" → "6 coleções" na secção 3.1.
  - Secção 3.1: nova subsecção `Paciente` (após `Tarefa`) — nota F2 sobre entidade separada do Utilizador + soft delete + sanitização; tabela completa de campos (empresa_id, nome, data_nascimento, genero, num_utente, nif, telefone, email, morada, contacto_emergencia, historico_medico, alergias, consentimento_dados, ativo, eliminado_em, observacoes, origem); sub-tabela `consentimento_dados` (concedido/data/versao_termos); lista de índices compostos; nota de permissões (temAcessoClinico/sanitizarParaNaoClinico, podeVer/isRececionista/isDiretorClinico, flag dados_clinicos).
  - Secção 6 (API): nova secção 6.12 — Pacientes (`/api/gestor/pacientes`). Bloco de permissões (podeVer/isRececionista/isDiretorClinico), bloco de sanitização (temAcessoClinico/sanitizarParaNaoClinico/dados_clinicos), nota F2 sobre filtro "fisio vê só os seus" ficar para F4. Documentados 6 endpoints: GET / (lista com query params busca/ativo/limit), GET /:id (detalhe), POST / (criar com body exemplo completo), PUT /:id (atualizar), PATCH /:id/estado (alternar ativo), DELETE /:id (soft delete). Cada um com auth, body, resposta, erros, auditoria.
  - Secção 9 (Histórico): nova entrada F2 no topo do changelog descrevendo os 4 grupos de alterações (modelo Paciente com todos os campos + índices; controller com 6 funções + helpers + auditoria; routes com middlewares; mount em server.js). 130/130 testes ✓.

- **docs/FRONTEND.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Secção 3 (Rotas): adicionada linha `/gestor/pacientes` à tabela (CRUD de Pacientes F2 — grid, busca, modais, soft delete, permissões por role).
  - Secção 11 (`lib/api.ts`): adicionado bullet `PacienteDTO`/`PacienteListResponse` (F2) — campos clínicos opcionais espelham a sanitização do backend; PacienteListResponse com flag dados_clinicos.
  - Secção 11: nova subsecção `/gestor/pacientes (Client Component) — F2` (após `/admin/calendario`). Nota sobre item de sidebar (gestor-sidebar.tsx, href /gestor/pacientes, ícone UserRound do lucide-react, entre Propriedades e Equipa). Documentação do grid de cartões, busca (?busca=), modal criar/editar (Dialog) com campos clínicos condicionados a dados_clinicos, modal de detalhe, toggle de estado (adminPatch), editar (adminPut), eliminar (adminDelete só diretor_clinico/admin), estados visuais (loading/erro/vazio), tipos PacienteDTO/PacienteListResponse.
  - Secção 13 (Histórico): nova entrada F2 no topo do changelog descrevendo os 3 grupos de alterações (página /gestor/pacientes; tipos PacienteDTO/PacienteListResponse em lib/api.ts; item Pacientes no gestor-sidebar com ícone UserRound). Lint + tsc + build ✓.

- **docs/ARQUITETURA.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Banner topo: "acompanha as fases F0 e F1" → "acompanha as fases F0, F1 e F2" (com descrição "Paciente + CRUD + sanitização de dados clínicos").
  - Secção 4 (Mapa de Migração): linha do `Paciente` marcada com "F2 ✅" (era "F2").
  - Secção 5.3 `Paciente`: título "F2" → "✅ F2 concluído"; schema reescrito para refletir a implementação real (genero enum ['M','F','Outro','NA'] default 'NA'; num_utente SNS; nif; morada; contacto_emergencia estruturado {nome,telefone,relacao}; historico_medico; alergias [String]; consentimento_dados sub-documento {concedido,data,versao_termos} em vez de 3 booleans; ativo index; observacoes; origem enum; índices compostos {empresa_id,nome}/{empresa_id,num_utente}/{empresa_id,ativo,eliminado_em}). Adicionada nota "F2 — Implementação real" listando as diferenças face à proposta v0.1 (genero rename, novos campos, consentimento_dados reestruturado, índices alterados, sanitização).
  - Secção 8 (Roadmap): F2 marcado como "✅ Concluído" (era "Pendente").

Stage Summary:
- **docs/BACKEND.md**: nova subsecção do modelo Paciente (tabela completa + sub-tabela consentimento_dados + índices + nota de permissões); nova secção 6.12 com 6 endpoints documentados (GET/GET:id/POST/PUT/PATCH estado/DELETE soft delete) + blocos de permissões e sanitização; árvore de ficheiros atualizada (pacienteController.js, Paciente.js, pacienteRoutes.js); entrada F2 no histórico. 130/130 testes ✓ referenciado.
- **docs/FRONTEND.md**: rota /gestor/pacientes na tabela; subsecção completa da página (grid, busca, modais criar/editar/detalhe, toggle estado, soft delete, permissões via dados_clinicos); tipos PacienteDTO/PacienteListResponse documentados; item de sidebar (UserRound) documentado; entrada F2 no histórico.
- **docs/ARQUITETURA.md**: F2 marcado ✅ no roadmap (secção 8) e no mapa de migração (secção 4); schema de Paciente (secção 5.3) alinhado com a implementação real + nota de divergências face à proposta v0.1; banner topo atualizado.
- **WORKLOG.md**: esta entrada DOC-F2 adicionada em append.
- **Finding (não resolvido por escopo):** a matriz de permissões da secção 3.1 de ARQUITETURA.md indica `admin` ❌ para "Pacientes (CRUD)" e a decisão de design #6 diz "admin não vê dados clínicos", mas a implementação F2 inclui `admin` no middleware `podeVer` e em `temAcessoClinico` (admin vê pacientes E dados clínicos). Esta divergência foi deixada intacta por estar fora do escopo pedido (a task pedia apenas atualizar o schema e o roadmap); fica como assunto a clarificar numa futura revisão (ou o `admin` deve ser removido do `podeVer`/`temAcessoClinico`, ou a matriz + decisão #6 devem ser atualizadas para refletir que o admin plataforma tem acesso total por conveniência operacional).


---
Task ID: F2
Agent: Z.ai Code
Task: Criar modelo Paciente + CRUD + permissões baseadas em role (rececionista/diretor vê todos, fisio vê só os seus, sanitização de dados clínicos para rececionistas).

Work Log:

### F2-A — Modelo Paciente
- Criado `backend/models/Paciente.js` com 17 campos: empresa_id, nome, data_nascimento, genero (M/F/Outro/NA), num_utente (SNS), nif, telefone (obrigatório), email, morada, contacto_emergencia {nome, telefone, relacao}, historico_medico, alergias (array), consentimento_dados {concedido, data, versao_termos}, ativo, eliminado_em (soft delete), observacoes, origem (walk_in/referenciacao/online/outro).
- Índices: {empresa_id, nome}, {empresa_id, num_utente}, {empresa_id, ativo, eliminado_em}.

### F2-B — Controller (pacienteController.js)
- 6 funções: listarPacientes, obterPaciente, criarPaciente, atualizarPaciente, eliminarPaciente (soft delete), alternarEstadoPaciente.
- Helper `temAcessoClinico` (admin/diretor_clinico/fisioterapeuta) e `sanitizarParaNaoClinico` (remove historico_medico, alergias, contacto_emergencia).
- Validações: nome + telefone obrigatórios, data_nascimento não pode ser futura, genero/origem enum.
- Consentimento RGPD com data automática.
- Campos clínicos só são guardados/editados se `temAcessoClinico` (rececionista envia mas são ignorados).
- Auditoria registada em criar/atualizar/eliminar.
- Resposta inclui flag `dados_clinicos: boolean` para o frontend saber se pode mostrar campos clínicos.

### F2-C — Routes (pacienteRoutes.js) + server.js
- Middleware custom `podeVer` (todos os 4 roles) para GET/POST/PUT.
- `isRececionista` para PATCH /:id/estado.
- `isDiretorClinico` para DELETE /:id (soft delete).
- Montado em server.js: `app.use('/api/gestor/pacientes', pacienteRoutes)`.

### F2-D — Testes (130/130 ✓)
- Adicionados 19 testes no bloco "F2 — Pacientes (CRUD + permissões)":
  - Criação por rececionista (201) e fisio (201 com campos clínicos).
  - Validações (400): campos obrigatórios, data futura.
  - Sanitização: rececionista NÃO recebe historico_medico/alergias/contacto_emergencia.
  - Fisio RECEBE dados clínicos completos.
  - Busca por nome.
  - Detalhe (404 se inexistente, soft deleted).
  - PUT (rececionista edita admin, fisio edita clínico).
  - PATCH estado.
  - DELETE: rececionista 403, fisio 403, diretor_clinico 200 (soft delete).
  - 401 sem token.
- **Resultado: 130/130 testes a passar ✓** (+19).

### F2-E — Frontend (/gestor/pacientes)
- Criada página `frontend/src/app/gestor/pacientes/page.tsx`:
  - Grid de cartões com nome, idade, telefone, email, alergias (se clínico), consentimento RGPD.
  - Busca por nome/Nº utente/telefone/email.
  - Modal criar/editar com campos administrativos + bloco clínico (só se dadosClinicos=true).
  - Modal detalhe com todos os campos.
  - Botões: Editar, Ativar/Desativar, Eliminar (soft delete com confirm).
  - Flag `dados_clinicos` controla visibilidade dos campos clínicos.
- `PacienteDTO` e `PacienteListResponse` adicionados a `lib/api.ts`.
- **Lint ✓, tsc ✓, build ✓** (rota /gestor/pacientes = 5.22 kB).

### F2-F — Sidebar
- Adicionado item "Pacientes" (ícone UserRound) ao `gestor-sidebar.tsx`, entre Propriedades e Equipa.

### F2-G — Documentação (Task DOC-F2 por subagent)
- `docs/BACKEND.md`: modelo Paciente documentado (17 campos + índices), endpoints /api/gestor/pacientes (6 endpoints), permissões por role, sanitização, entrada F2 no histórico.
- `docs/FRONTEND.md`: rota /gestor/pacientes, PacienteDTO, página documentada, entrada F2 no histórico.
- `docs/ARQUITETURA.md`: F2 marcado ✅ no roadmap, schema de Paciente alinhado com implementação real.

Stage Summary:
- **Paciente criado** com schema completo (dados demográficos, contactos, dados clínicos, consentimentos RGPD, soft delete).
- **Permissões RGPD implementadas**: rececionista vê dados administrativos mas NÃO vê historico_medico/alergias/contacto_emergencia. Fisio/diretor/admin vêem tudo.
- **Soft delete** preserva histórico (RGPD: obrigações de retenção 10-20 anos).
- **130/130 testes ✓** + **lint ✓** + **tsc ✓** + **build ✓**.
- **Nota**: o filtro "fisioterapeuta vê só os seus pacientes" será implementado em F4 (Consulta com paciente_id + fisioterapeuta_id). Por agora, todos os clínicos vêem todos os pacientes ativos da empresa.
- **Próximo passo:** F3 (Sala de Propriedade + HorarioFisioterapeuta + motor de disponibilidade).


---
Task ID: DOC-F3
Agent: general-purpose
Task: Atualização de documentação para F3 (Horários de Fisioterapeuta + motor de disponibilidade)

Work Log:
- Lido `WORKLOG.md` (1082 linhas, últimas entradas DOC-F2/F2) e `docs/ARQUITETURA.md` (375 linhas) para contexto.
- Confirmado estado pós-F3 no código: `backend/models/HorarioFisioterapeuta.js` (empresa_id, fisioterapeuta_id, tipo enum ['recorrente','excecao'] default 'recorrente', dia_semana 0-6 default null, hora_inicio/hora_fim com regex HH:mm, data Date default null, disponivel boolean default true, ativo boolean default true index, nota string; pre('validate') recorrente↔dia_semana/excecao↔data; índices {fisioterapeuta_id, dia_semana, ativo}, {empresa_id, fisioterapeuta_id, tipo}, {fisioterapeuta_id, data}); `backend/utils/disponibilidade.js` (expandido com `horaLisboa`, `compararHoras`, `obterHorarioDia` 3 sub-camadas, `verificarConflitoHorario`, `verificarDisponibilidadeCompleta` 3 camadas ausência→folga→horário); `backend/controllers/horarioController.js` (6 funções: listarHorarios, obterHorario, criarHorario, atualizarHorario, eliminarHorario hard delete, verificarDisponibilidade; valida fisio/diretor_clinico ativo da empresa; auditoria); `backend/routes/horarioRoutes.js` (middleware `podeVer` 4 roles para GET/disponibilidade; `isDiretorClinico` para POST/PUT/DELETE); `backend/server.js` mount `/api/gestor/horarios`; `frontend/src/app/gestor/equipa/horarios/page.tsx` (verificador de disponibilidade + lista agrupada por fisio + modal criar/editar + hard delete); `frontend/src/lib/api.ts` (HorarioFisioterapeutaDTO, HorarioListResponse, DisponibilidadeResponse); `frontend/src/components/gestor/gestor-sidebar.tsx` (item Horários, ícone Clock).

- **docs/ARQUITETURA.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Banner topo: "acompanha as fases F0, F1 e F2" → "acompanha as fases F0, F1, F2 e F3" (com descrição "`HorarioFisioterapeuta` + motor de disponibilidade em 3 camadas").
  - Secção 4 (Mapa de Migração): linha do `HorarioFisioterapeuta` marcada com "F3 ✅" (era "F3").
  - Secção 5.6 `HorarioFisioterapeuta`: título "F3" → "✅ F3 concluído"; schema reescrito para refletir a implementação real (campos `hora_inicio`/`hora_fim` em vez de `janelas: [{inicio, fim}]`; `nota` singular em vez de `notas`; `disponivel` default `true` em vez de `false`; novo campo `ativo` indexado; `tipo` default 'recorrente' indexado; índices compostos `{fisioterapeuta_id, dia_semana, ativo}`, `{empresa_id, fisioterapeuta_id, tipo}`, `{fisioterapeuta_id, data}`). Adicionada nota "F3 — Implementação real" listando as divergências face à proposta v0.1.
  - Secção 7 (Decisões de Design), decisão #8 ("3 camadas de disponibilidade"): reescrita para refletir o motor real (`verificarDisponibilidadeCompleta`: 1. Ausência aprovada → 2. Folga fixa semanal → 3. Horário de trabalho com `obterHorarioDia` que tem sub-camadas exceção→recorrente→sem horário, e `verificarConflitoHorario` que valida se a consulta cabe no bloco). Nota de que a 4.ª camada (conflito com consultas já marcadas) será adicionada em F4.
  - Secção 8 (Roadmap): F3 marcado como "✅ Concluído\*" (era "Pendente") com nota explicativa que a migração `Propriedade` → `Sala` foi adiada para uma fase posterior (será retomada em F4 quando `Consulta` exigir `sala_id`); o `HorarioFisioterapeuta` + motor + endpoints + página estão concluídos.

- **docs/BACKEND.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Secção 2 (Estrutura): adicionado `horarioController.js` à árvore de controllers; `HorarioFisioterapeuta.js` à árvore de models; `horarioRoutes.js` à árvore de routes. Atualizada descrição de `utils/disponibilidade.js` para incluir "motor de disponibilidade F3 (horários)". Atualizada contagem "6 coleções" → "7 coleções" na secção 3.1.
  - Secção 3.1: nova subsecção `HorarioFisioterapeuta` (após `Paciente`) — nota F3 sobre dois tipos de regra (recorrente/excecao) e coerência validada em pre('validate'); tabela completa de campos (empresa_id, fisioterapeuta_id, tipo, dia_semana, hora_inicio, hora_fim, data, disponivel, ativo, nota); bloco de validação pre('validate'); lista de índices compostos; nota de permissões (podeVer 4 roles para GET, isDiretorClinico para mutações, validação de fisio/diretor_clinico ativo da empresa, auditoria).
  - Secção 3.4 (nova) — Motor de Disponibilidade — F3: documentação das 3 camadas verificadas por `verificarDisponibilidadeCompleta` (ausência aprovada → folga fixa semanal → horário de trabalho via verificarConflitoHorario); documentação das 3 sub-camadas de `obterHorarioDia` (exceção do dia → regra recorrente → sem horário); helpers de fuso e horas (`dataLisboa`, `horaLisboa`, `compararHoras`); nota de robustez de fuso herdada do Prompt 113; nota que a 4.ª camada (conflito com consultas) será adicionada em F4.
  - Secção 6 (API): nova secção 6.13 — Horários (`/api/gestor/horarios`). Bloco de permissões (podeVer para GET/disponibilidade, isDiretorClinico para mutações), bloco de validação do fisioterapeuta, nota de auditoria. Documentados 6 endpoints: GET / (lista com query params fisioterapeuta_id/tipo/ativo, populate, exemplo JSON), GET /disponibilidade (verificador com query params fisioterapeuta_id/data/duracao_minutos, resposta com disponivel/horario/motivo/origem, nota de ordem de registo antes de /:id), GET /:id (detalhe), POST / (criar com body exemplo + validações), PUT /:id (atualizar), DELETE /:id (hard delete). Cada um com auth, body, resposta, erros, auditoria.
  - Secção 9 (Histórico): nova entrada F3 no topo do changelog descrevendo os 5 grupos de alterações (modelo HorarioFisioterapeuta + validações + índices; utils/disponibilidade.js expandido com 5 funções; horarioController.js com 6 funções; horarioRoutes.js com middlewares; mount em server.js). 151/151 testes ✓ (+21 testes de Horário).

- **docs/FRONTEND.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Secção 3 (Rotas): adicionada linha `/gestor/equipa/horarios` à tabela (Horários de Fisioterapeuta F3 — verificador de disponibilidade, lista agrupada por fisio, modais criar/editar, soft toggle via DELETE).
  - Secção 11 (`lib/api.ts`): adicionado bullet `HorarioFisioterapeutaDTO`/`HorarioListResponse`/`DisponibilidadeResponse` (F3) — espelham o modelo `HorarioFisioterapeuta` do backend + resposta do verificador; `fisioterapeuta_id` é `string | { _id, nome, email, role }` (populate); `dia_semana`/`data` como `number | null`/`string | null` conforme o tipo; `DisponibilidadeResponse` com `disponivel`/`horario`/`motivo`/`origem`.
  - Secção 11: nova subsecção `/gestor/equipa/horarios (Client Component) — F3` (após `/gestor/pacientes`). Nota sobre item de sidebar (gestor-sidebar.tsx, href /gestor/equipa/horarios, ícone Clock do lucide-react, entre Equipa e Ausências / Férias). Documentação do verificador de disponibilidade (fisio + data + hora + duração → CheckCircle2/XCircle + motivo + janela), lista agrupada por fisioterapeuta (badges recorrente/excecao, dia_semana/data, janelas, nota, botões Pencil/Trash2 para diretor_clinico/admin), filtro por fisio, modal criar/editar (tipo recorrente/excecao, dia_semana/data condicional, horas, disponivel só se excecao, nota), hard delete via adminDelete, permissões client-side, estados visuais (loading/erro/vazio), tipos F3.
  - Secção 13 (Histórico): nova entrada F3 no topo do changelog descrevendo os 3 grupos de alterações (página /gestor/equipa/horarios; tipos HorarioFisioterapeutaDTO/HorarioListResponse/DisponibilidadeResponse em lib/api.ts; item Horários no gestor-sidebar com ícone Clock). Lint + tsc + build ✓ (rota /gestor/equipa/horarios = 4.35 kB).

Stage Summary:
- **docs/BACKEND.md**: nova subsecção do modelo HorarioFisioterapeuta (tabela completa + validações pre-validate + índices + nota de permissões); nova secção 3.4 com o motor de disponibilidade (3 camadas + sub-camadas de obterHorarioDia + helpers de fuso); nova secção 6.13 com 6 endpoints documentados (GET listagem, GET /disponibilidade, GET /:id, POST, PUT, DELETE hard delete) + blocos de permissões, validação do fisioterapeuta e auditoria; árvore de ficheiros atualizada (horarioController.js, HorarioFisioterapeuta.js, horarioRoutes.js); contagem "7 coleções"; entrada F3 no histórico. 151/151 testes ✓ referenciado.
- **docs/FRONTEND.md**: rota /gestor/equipa/horarios na tabela; subsecção completa da página (verificador, lista agrupada, modais criar/editar, hard delete, permissões, estados visuais); tipos HorarioFisioterapeutaDTO/HorarioListResponse/DisponibilidadeResponse documentados; item de sidebar (Clock) documentado; entrada F3 no histórico. Lint + tsc + build ✓ (4.35 kB).
- **docs/ARQUITETURA.md**: F3 marcado ✅ Concluído\* no roadmap (secção 8) e no mapa de migração (secção 4) com nota explicativa que a migração Propriedade→Sala foi adiada; schema de HorarioFisioterapeuta (secção 5.6) alinhado com a implementação real + nota de divergências face à proposta v0.1; decisão de design #8 reescrita para refletir o motor real; banner topo atualizado.
- **WORKLOG.md**: esta entrada DOC-F3 adicionada em append.
- **Finding (não resolvido por escopo):** a matriz de permissões da secção 3.1 de ARQUITETURA.md indica `admin` ❌ para "Horários fisio", mas a implementação F3 inclui `admin` no middleware `podeVer` (e na validação `isDiretorClinico` para mutações). Esta divergência foi deixada intacta por estar fora do escopo pedido (a task pedia apenas marcar F3 como ✅ e atualizar o schema e as camadas de disponibilidade) e por ser coerente com a mesma divergência já registada em DOC-F2 para Pacientes — fica como assunto a clarificar numa futura revisão (ou o `admin` deve ser removido do `podeVer`/`isDiretorClinico`, ou a matriz + decisão #6 devem ser atualizadas para refletir que o admin plataforma tem acesso total por conveniência operacional).

---
Task ID: F3
Agent: Z.ai Code
Task: Criar HorarioFisioterapeuta + motor de disponibilidade (3 camadas: folga fixa / horário recorrente / exceção / ausência) + CRUD + frontend.

Work Log:

### F3-A — Modelo HorarioFisioterapeuta
- Criado `backend/models/HorarioFisioterapeuta.js` com: empresa_id, fisioterapeuta_id, tipo ('recorrente'|'excecao'), dia_semana (0-6), hora_inicio/fim (HH:mm), data (Date), disponivel (boolean), ativo (boolean), nota.
- Validação `pre('validate')`: recorrente exige dia_semana, excecao exige data.
- Índices: {fisioterapeuta_id, dia_semana, ativo}, {empresa_id, fisioterapeuta_id, tipo}, {fisioterapeuta_id, data}.

### F3-B — Motor de disponibilidade (utils/disponibilidade.js expandido)
- Adicionadas funções:
  - `horaLisboa(instante)` — devolve "HH:mm" no fuso de Lisboa (via Intl.DateTimeFormat).
  - `compararHoras(a, b)` — compara duas horas HH:mm.
  - `obterHorarioDia(fisioterapeutaId, data)` — consulta 3 camadas: exceções do dia → regra recorrente → sem horário.
  - `verificarConflitoHorario(fisioterapeutaId, dataHoraInicio, duracaoMinutos)` — verifica se a consulta cabe no bloco de trabalho.
  - `verificarDisponibilidadeCompleta(utilizador, dataHoraInicio, duracaoMinutos)` — ausências aprovadas + folga fixa + horários (3 camadas por ordem de prioridade).
- Mantidas as funções existentes (verificarDisponibilidadeUtilizador, mensagemIndisponivel, dataLisboa).

### F3-C — Controller + Routes
- Criado `backend/controllers/horarioController.js` com 6 funções: listarHorarios, obterHorario, criarHorario, atualizarHorario, eliminarHorario, verificarDisponibilidade. Valida fisioterapeuta (role fisioterapeuta/diretor_clinico ativo da empresa). Auditoria registada.
- Criado `backend/routes/horarioRoutes.js` montado em `/api/gestor/horarios`. Middleware `podeVer` (4 roles) para GET/listar/disponibilidade; `isDiretorClinico` para POST/PUT/DELETE.
- `server.js`: montado `app.use('/api/gestor/horarios', horarioRoutes)`.

### F3-D — Testes (151/151 ✓)
- Adicionados 21 testes no bloco "F3 — Horários (CRUD + disponibilidade)":
  - CRUD completo (criar recorrente/excecao, listar, detalhe, atualizar, eliminar).
  - Validações (400): sem fisioterapeuta_id, recorrente sem dia_semana, excecao sem data, fisioterapeuta inexistente.
  - Permissões (403): rececionista e fisioterapeuta não podem criar.
  - Motor de disponibilidade: fisio disponível no horário recorrente, indisponível antes/depois do bloco, indisponível no dia de exceção (formação), sem horário definido (domingo).
  - Fisioterapeuta vê só os seus horários.
  - 401 sem token.
- **Resultado: 151/151 testes a passar ✓** (+21).

### F3-E — Frontend (/gestor/equipa/horarios)
- Criada página `frontend/src/app/gestor/equipa/horarios/page.tsx`:
  - **Verificador de disponibilidade**: fisio + data + hora + duração → resultado (disponível/indisponível com motivo).
  - **Lista agrupada por fisioterapeuta**: badges recorrente/excecao, horários, notas, indisponível.
  - **Modal criar/editar**: tipo recorrente/excecao, dia_semana/data, horas, disponivel, nota.
  - **Eliminar** (hard delete com confirm).
- `HorarioFisioterapeutaDTO`, `HorarioListResponse`, `DisponibilidadeResponse` adicionados a `lib/api.ts`.
- Item "Horários" (ícone Clock) adicionado ao sidebar do gestor (entre Equipa e Ausências).
- **Lint ✓, tsc ✓, build ✓** (rota /gestor/equipa/horarios = 4.35 kB).

### F3-F — Documentação (Task DOC-F3 por subagent)
- `docs/BACKEND.md`: modelo HorarioFisioterapeuta documentado, motor de disponibilidade (3 camadas), 6 endpoints, entrada F3 no histórico.
- `docs/FRONTEND.md`: rota /gestor/equipa/horarios, tipos DTO, página documentada, entrada F3 no histórico.
- `docs/ARQUITETURA.md`: F3 marcado ✅ no roadmap, schema de HorarioFisioterapeuta alinhado, decisão de design #8 atualizada com o motor real.

Stage Summary:
- **HorarioFisioterapeuta criado** com 2 tipos: recorrente (regra semanal) e excecao (dia específico, disponível ou bloqueio).
- **Motor de disponibilidade** com 3 camadas por ordem de prioridade: ausência aprovada → folga fixa semanal → horário de trabalho (exceção > recorrente). Verifica também se a consulta cabe dentro do bloco de trabalho.
- **Timezone blindado**: usa `Intl.DateTimeFormat` com `Europe/Lisbon` para calcular data e hora local (robusto a DST).
- **151/151 testes ✓** + **lint ✓** + **tsc ✓** + **build ✓**.
- **Nota**: a 4.ª camada (conflito com consultas já marcadas) será implementada em F4 (Consulta). Por agora, o motor valida disponibilidade do fisioterapeuta mas não conflitos de sala/paciente.
- **Nota**: Propriedade→Sala foi adiada (o modelo Propriedade mantém-se, será renomeado em F8 de limpeza). O foco da F3 foi o motor de disponibilidade.
- **Próximo passo:** F4 (Consulta de Tarefa + CRUD de marcação + validação de conflitos sala+fisio+paciente).


---
Task ID: DOC-F4
Agent: general-purpose
Task: Atualização de documentação para F4 (Consultas + validação de conflitos + cédula profissional)

Work Log:
- Lido `WORKLOG.md` (1179 linhas, últimas entradas DOC-F3/F3) e `docs/ARQUITETURA.md` (389 linhas) para contexto.
- Confirmado estado pós-F4 no código: `backend/models/Consulta.js` (empresa_id, sala_id ref Propriedade alias Sala, fisioterapeuta_id ref Utilizador, paciente_id ref Paciente, data_hora_inicio/data_hora_fim Date, duracao_minutos default 45 min 15, tipo enum ['primeira_consulta','sessao','reavaliacao','alta','grupo'] default 'sessao', estado enum ['marcada','confirmada','em_curso','concluida','cancelada','faltou','nao_compareceu'] default 'marcada', motivo_cancelamento enum ['paciente','clinica','fisio','outro'] default null, presenca enum ['pendente','presente','ausente','atrasado'] default 'pendente', nota_clinica {subjetivo, objetivo, avaliacao, plano, tratamento_efetuado, protocolo_aplicado[] {nome, items[{texto, concluido}]}, cedula_assinante}, criada_por ref Utilizador, concluida_em, cancelada_em, cancelada_por ref Utilizador, lembrete_24h_enviado, lembrete_2h_enviado, observacoes; índices {empresa_id, fisioterapeuta_id, data_hora_inicio}, {empresa_id, sala_id, data_hora_inicio}, {empresa_id, paciente_id, data_hora_inicio -1}, {estado, data_hora_inicio}); `backend/models/Utilizador.js` (método de instância `temCedulaValida()` — true para admin/rececionista, exige `perfil_profissional.cedula` para fisio/diretor_clinico); `backend/controllers/consultaController.js` (função interna `validarConflitos` 4 dimensões + 7 funções exportadas: `listarConsultas` com filtros fisioterapeuta_id/sala_id/paciente_id/estado/inicio/fim + fisio vê só as suas, `obterConsulta`, `criarConsulta` com `forcar` soft block 409/200, `atualizarConsulta` com re-validação temporal + excluirConsultaId, `atualizarNotaClinica` endpoint separado isClinico + validação cédula + snapshot cedula_assinante, `eliminarConsulta` bloqueia concluídas RGPD hard delete, `validarConflitosEndpoint` GET para tempo real; auditoria recurso 'consulta'); `backend/routes/consultaRoutes.js` (podeVer 4 roles para GET, isRececionista para POST/PUT, isClinico para PATCH /:id/nota-clinica, isDiretorClinico para DELETE); `backend/server.js` mount `/api/gestor/consultas`; `frontend/src/app/gestor/consultas/page.tsx` (lista cartões + modal criar/editar com debounce 400ms + modal detalhe SOAP + ações rápidas Confirmar/Concluir/Eliminar); `frontend/src/lib/api.ts` (EstadoConsulta, TipoConsulta, ConsultaDTO, ConsultaListResponse, ValidarConflitosResponse); `frontend/src/components/gestor/gestor-sidebar.tsx` (item Consultas, ícone CalendarPlus, entre Calendário e Tarefas).

- **docs/BACKEND.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Secção 2 (Estrutura): adicionado `consultaController.js` à árvore de controllers; `Consulta.js` à árvore de models (com nota "substitui Tarefa; conflitos + SOAP + cédula"); `consultaRoutes.js` à árvore de routes; nota "temCedulaValida() (F4)" no Utilizador.js. Atualizada contagem "7 coleções" → "8 coleções" na secção 3.1.
  - Secção 3.1: nova subsecção `Consulta` (após `HorarioFisioterapeuta`) — nota F4 sobre 3 eixos (fisio/sala/paciente) e 4 dimensões de conflito; tabela completa de campos (empresa_id, sala_id ref Propriedade alias Sala, fisioterapeuta_id, paciente_id, data_hora_inicio, data_hora_fim, duracao_minutos, tipo, estado, motivo_cancelamento, presenca, nota_clinica, criada_por, concluida_em, cancelada_em, cancelada_por, lembrete_24h_enviado, lembrete_2h_enviado, observacoes); sub-tabela `nota_clinica` (subjetivo, objetivo, avaliacao, plano, tratamento_efetuado, protocolo_aplicado[], cedula_assinante) com nota sobre imutabilidade e snapshot de cédula; lista de 4 índices compostos; nota de permissões (podeVer/isRececionista/isClinico/isDiretorClinico) + nota de imutabilidade de concluídas (RGPD) com citação exata da mensagem 403.
  - Secção 3.1 (`Utilizador`): adicionada nota F4 sobre o método de instância `temCedulaValida()` (lógica, casos por role, obrigatoriedade para SOAP/faturação).
  - Secção 3.4: mantida nota "a 4.ª camada (conflito com consultas já marcadas) será adicionada em F4" — atualizada para referir que está implementada na nova secção 3.5.
  - Secção 3.5 (nova) — Validação de Conflitos — F4: documentação da função interna `validarConflitos` (4 verificações em simultâneo: fisio disponível via motor F3, sala sem sobreposição, fisio sem sobreposição, paciente sem sobreposição; filtro de consultas ativas `estado: { $nin: ['cancelada','faltou','nao_compareceu'] }`; parâmetro `excluirConsultaId` para modo edição); documentação do soft block (409 sem `forcar`, 200 com warning se `forcar: true`, 201/200 sem conflitos); nota de auditoria (`detalhes.conflitos_forcados: true`); nota sobre o endpoint `GET /validar` para validação em tempo real no frontend (debounce 400ms).
  - Secção 6 (API): nova secção 6.14 — Consultas (`/api/gestor/consultas`). Bloco de permissões (podeVer/isRececionista/isClinico/isDiretorClinico), bloco de imutabilidade RGPD (403 em DELETE/PUT/PATCH para concluídas), bloco de cédula obrigatória (`temCedulaValida()` + snapshot `cedula_assinante`), bloco de soft block (409/200/201), nota de auditoria. Documentados 7 endpoints: GET / (lista com query params fisioterapeuta_id/sala_id/paciente_id/estado/inicio/fim/limit + populate + exemplo JSON), GET /validar (verificador com query params fisioterapeuta_id/sala_id/paciente_id/data_hora_inicio/duracao_minutos/excluir_id + resposta {ok, conflitos[], horario}), GET /:id (detalhe com 5 populates), POST / (criar com body exemplo + validações + 201/200/409/400), PUT /:id (atualizar com re-validação temporal + rejeição de nota_clinica no body), PATCH /:id/nota-clinica (endpoint separado isClinico + regras de imutabilidade/autoridade/cédula + snapshot de cédula), DELETE /:id (hard delete + bloqueio RGPD de concluídas). Cada um com auth, body, resposta, erros, auditoria.
  - Secção 9 (Histórico): nova entrada F4 no topo do changelog descrevendo os 5 grupos de alterações (modelo Consulta + 4 índices; método temCedulaValida no Utilizador; controller consultaController com validarConflitos + 7 funções; routes consultaRoutes com 4 middlewares; mount em server.js). 176/176 testes ✓ (+25 testes de Consulta).

- **docs/FRONTEND.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Secção 3 (Rotas): adicionada linha `/gestor/consultas` à tabela (Consultas F4 — lista de cartões, modal criar/editar com validação de conflitos em tempo real debounce 400ms, modal detalhe com SOAP editável, ações rápidas Confirmar/Concluir/Eliminar).
  - Secção 11 (`lib/api.ts`): adicionado bullet `EstadoConsulta`/`TipoConsulta`/`ConsultaDTO`/`ConsultaListResponse`/`ValidarConflitosResponse` (F4) — espelham o modelo `Consulta` + resposta do verificador; `sala_id`/`fisioterapeuta_id`/`paciente_id`/`criada_por` como `string | { _id, ... }` (populate); `nota_clinica` opcional; `ValidarConflitosResponse` = `{ ok, conflitos[], horario? }`.
  - Secção 11: nova subsecção `/gestor/consultas (Client Component) — F4` (após `/gestor/equipa/horarios`). Nota sobre item de sidebar (gestor-sidebar.tsx, href /gestor/consultas, ícone CalendarPlus do lucide-react, entre Calendário e Tarefas). Documentação da lista de cartões (paciente/fisio/sala/data/estado/tipo/indicador SOAP), modal criar/editar com validação de conflitos em tempo real (debounce 400ms + `excluir_id` no modo edição), submissão com soft block (409 → modal "Forçar Agendamento?" → reenvio com `forcar: true`), modal de detalhe com SOAP editável (S/O/A/P + tratamento_efetuado) via PATCH /:id/nota-clinica (só isClinico; imutável se concluída), ações rápidas Confirmar/Concluir/Eliminar, permissões client-side, estados visuais (loading/erro/vazio), tipos F4.
  - Secção 13 (Histórico): nova entrada F4 no topo do changelog descrevendo os 3 grupos de alterações (página /gestor/consultas; tipos EstadoConsulta/TipoConsulta/ConsultaDTO/ConsultaListResponse/ValidarConflitosResponse em lib/api.ts; item Consultas no gestor-sidebar com ícone CalendarPlus). Lint + tsc + build ✓ (rota /gestor/consultas = 5.6 kB).

- **docs/ARQUITETURA.md** (alterações cirúrgicas via Edit/MultiEdit):
  - Banner topo: "acompanha as fases F0, F1, F2 e F3" → "acompanha as fases F0, F1, F2, F3 e F4" (com descrição "`Consulta` + validação de conflitos + cédula profissional + nota clínica SOAP imutável").
  - Secção 4 (Mapa de Migração): linhas do `Tarefa` → `Consulta` e `TarefaArquivo` → `ConsultaArquivo` marcadas com "F4 ✅" (era "F4").
  - Secção 5.4 `Consulta`: título "F4 (substitui Tarefa)" → "✅ F4 concluído (substitui Tarefa)"; schema reescrito para refletir a implementação real (sala_id ref 'Propriedade' alias Sala em vez de ref 'Sala'; fisioterapeuta_id obrigatório em vez de default null; data_hora dividida em data_hora_inicio + data_hora_fim; duracao_minutos default 45 em vez de 60; enum tipo com 'sessao' e 'grupo'; enum estado com 'marcada' em vez de 'agendada' + 'nao_compareceu'; motivo_cancelamento; presenca com 'atrasado' em vez de 'justificada'; nota_clinica com tratamento_efetuado + protocolo_aplicado[] + cedula_assinante; lembretes[] → lembrete_24h_enviado/lembrete_2h_enviado; adicionados criada_por/cancelada_em/cancelada_por; índices expandidos para 4 com data_hora_inicio -1 no do paciente). Adicionada nota "F4 — Implementação real" listando as divergências face à proposta v0.1 + nota sobre imutabilidade enforced no controller + cédula via temCedulaValida + validarConflitos soft block.
  - Secção 7 (Decisões de Design): decisão #3 ("Nota clínica SOAP embutida") reescrita para incluir F4 (imutável após conclusão + cédula obrigatória via temCedulaValida + endpoint dedicado PATCH /:id/nota-clinica); decisão #7 ("Soft delete em tudo") atualizada com exceção da Consulta (hard delete + bloqueio RGPD de concluídas); decisão #8 ("3 camadas de disponibilidade") atualizada com a 4.ª camada (validarConflitos do consultaController: 4a fisio disponível via camadas 1-3, 4b sala, 4c fisio, 4d paciente); novas decisões #9 (Soft block de conflitos — 409/200/forcar + auditoria + debounce frontend) e #10 (Cédula obrigatória para assinar SOAP — temCedulaValida + snapshot cedula_assinante para rastreabilidade).
  - Secção 8 (Roadmap): F4 marcado como "✅ Concluído" (era "Pendente") com escopo expandido para mencionar "nota clínica SOAP imutável + cédula profissional".

Stage Summary:
- **docs/BACKEND.md**: nota F4 sobre `temCedulaValida()` no Utilizador; nova subsecção do modelo Consulta (tabela completa + sub-tabela nota_clinica + 4 índices + nota de permissões + nota de imutabilidade RGPD); nova secção 3.5 com a validação de conflitos (4 dimensões + soft block + auditoria + endpoint /validar); nova secção 6.14 com 7 endpoints documentados (GET listagem, GET /validar, GET /:id, POST, PUT, PATCH /:id/nota-clinica, DELETE) + blocos de permissões, imutabilidade RGPD, cédula obrigatória, soft block e auditoria; árvore de ficheiros atualizada (consultaController.js, Consulta.js, consultaRoutes.js); contagem "8 coleções"; entrada F4 no histórico. 176/176 testes ✓ referenciado.
- **docs/FRONTEND.md**: rota /gestor/consultas na tabela; subsecção completa da página (lista cartões, modal criar/editar com validação de conflitos em tempo real debounce 400ms, modal detalhe SOAP via PATCH, soft block 409→forçar, ações rápidas, permissões, estados visuais); tipos EstadoConsulta/TipoConsulta/ConsultaDTO/ConsultaListResponse/ValidarConflitosResponse documentados; item de sidebar (CalendarPlus, entre Calendário e Tarefas) documentado; entrada F4 no histórico. Lint + tsc + build ✓ (5.6 kB).
- **docs/ARQUITETURA.md**: F4 marcado ✅ no roadmap (secção 8) e no mapa de migração (secção 4 — Tarefa→Consulta e TarefaArquivo→ConsultaArquivo); schema de Consulta (secção 5.4) alinhado com a implementação real + nota de divergências face à proposta v0.1; decisões de design #3/#7/#8 atualizadas + novas decisões #9 (soft block) e #10 (cédula obrigatória); banner topo atualizado.
- **WORKLOG.md**: esta entrada DOC-F4 adicionada em append.
- **Finding (não resolvido por escopo):** a matriz de permissões da secção 3.1 de ARQUITETURA.md indica `admin` ❌ para "Consultas (marcar)"/"Consultas (ver todas)"/"Nota clínica SOAP", mas a implementação F4 inclui `admin` no middleware `podeVer` (ver consultas), no `isRececionista` (criar/editar marcações via POST/PUT) e no `isClinico` (PATCH /nota-clinica). Esta divergência é coerente com as mesmas divergências já registadas em DOC-F2 (Pacientes) e DOC-F3 (Horários) — o `admin` plataforma tem acesso total por conveniência operacional. Fica como assunto a clarificar numa futura revisão global da matriz (ou remover `admin` dos middlewares, ou atualizar a matriz + decisão #6 para refletir o acesso total do admin). Não foi alterada por estar fora do escopo pedido (a task pedia apenas atualizar schema, roadmap e decisões de design).

---
Task ID: F4
Agent: Z.ai Code
Task: Criar Consulta (substitui Tarefa) + CRUD de marcação + validação de conflitos (fisio + sala + paciente em simultâneo) + cédula profissional obrigatória para notas clínicas SOAP + imutabilidade RGPD.

Work Log:

### F4-A — Reforçar validação de cédula no Utilizador
- Adicionado método de instância `temCedulaValida()` no schema Utilizador.
- Devolve `true` para admin/rececionista (não aplicável).
- Para fisioterapeuta/diretor_clinico: verifica se `perfil_profissional.cedula` está preenchido.
- **Obrigatório** para assinar notas clínicas (SOAP) — prepara o caminho para faturação.

### F4-B — Modelo Consulta
- Criado `backend/models/Consulta.js` (substitui Tarefa para o novo domínio):
  - 3 eixos: fisioterapeuta_id, sala_id (Propriedade alias Sala), paciente_id.
  - Marcação temporal: data_hora_inicio, data_hora_fim, duracao_minutos (default 45, min 15).
  - tipo (primeira_consulta/sessao/reavaliacao/alta/grupo), estado (7 valores), presenca (4 valores).
  - nota_clinica SOAP: subjetivo, objetivo, avaliacao, plano, tratamento_efetuado, protocolo_aplicado[], cedula_assinante.
  - Auditoria: criada_por, concluida_em, cancelada_em, cancelada_por.
  - Lembretes: lembrete_24h_enviado, lembrete_2h_enviado.
  - Índices: {empresa_id, fisioterapeuta_id, data_hora_inicio}, {empresa_id, sala_id, data_hora_inicio}, {empresa_id, paciente_id, data_hora_inicio}, {estado, data_hora_inicio}.

### F4-C — Controller com validação de conflitos (ponto mais sensível)
- Criado `backend/controllers/consultaController.js`:
  - `validarConflitos()` (função interna) — valida em simultâneo:
    1. Fisioterapeuta disponível (motor F3: ausência + folga + horário)
    2. Sala sem sobreposição temporal com outra consulta ATIVA
    3. Fisioterapeuta sem sobreposição temporal
    4. Paciente sem sobreposição temporal
  - Soft block: conflitos devolvem 409 (sem `forcar`) ou 200 com warning (com `forcar=true`).
  - `criarConsulta`: valida fisio/sala/paciente existem, rejeita data no passado, valida conflitos.
  - `atualizarConsulta`: re-valida conflitos se mudar data/duração/fisio/sala/paciente (excluindo a própria consulta).
  - `atualizarNotaClinica` (endpoint SEPARADO, isClinico): valida cédula do assinante, guarda snapshot da cédula para auditoria legal.
  - `eliminarConsulta`: bloqueia consultas concluídas (RGPD — nota clínica imutável).
  - `validarConflitosEndpoint` (GET /validar): para o frontend validar em tempo real sem criar.

### F4-D — Routes + server.js
- Criado `backend/routes/consultaRoutes.js` montado em `/api/gestor/consultas`:
  - GET /, GET /validar, GET /:id → podeVer (4 roles)
  - POST /, PUT /:id → isRececionista (marcações)
  - PATCH /:id/nota-clinica → isClinico (fisio/diretor/admin — SOAP)
  - DELETE /:id → isDiretorClinico
- `server.js`: montado `app.use('/api/gestor/consultas', consultaRoutes)`.

### F4-E — Testes (176/176 ✓)
- Adicionados 25 testes no bloco "F4 — Consultas (CRUD + conflitos)":
  - CRUD completo (criar, listar, detalhe, atualizar, eliminar).
  - Validações (400): campos obrigatórios, data no passado, fisio/sala/paciente inexistentes.
  - **Validação de conflitos** (409 sem forcar):
    - Conflito de SALA (mesma sala, mesmo horário, fisio diferente)
    - Conflito de FISIOTERAPEUTA (mesmo fisio, mesmo horário, sala diferente)
    - Conflito de PACIENTE (mesmo paciente, mesmo horário, fisio/sala diferentes)
  - Soft block com `forcar=true` → 200 com warning.
  - Sem sobreposição → 201 (sem conflitos).
  - Fisioterapeuta vê só as suas consultas.
  - GET /validar → 200 com conflitos sem criar.
  - PATCH /nota-clinica (fisio com cédula) → 200 + snapshot da cédula.
  - PATCH /nota-clinica por fisio SEM cédula → 403 (mensagem contém "cédula").
  - PATCH /nota-clinica por rececionista → 403 (só isClinico).
  - PATCH /nota-clinica em consulta CONCLUÍDA → 403 (imutável, RGPD).
  - DELETE consulta concluída → 403 (RGPD).
  - DELETE (rececionista) → 403 (só diretor).
  - DELETE (diretor) → 200.
  - 401 sem token.
- **Resultado: 176/176 testes a passar ✓** (+25).

### F4-F — Frontend (/gestor/consultas)
- Criada página `frontend/src/app/gestor/consultas/page.tsx`:
  - Lista de consultas (cartões com paciente, fisio, sala, data, estado, tipo, indicador SOAP).
  - **Modal criar/editar com validação de conflitos em tempo real** (debounce 400ms, mostra warnings antes de submeter).
  - Modal detalhe com nota clínica SOAP editável (S/O/A/P + tratamento_efetuado).
  - Ações rápidas: Confirmar, Concluir, Eliminar.
  - Botão "Forçar Agendamento" quando há conflitos.
- `ConsultaDTO`, `ConsultaListResponse`, `ValidarConflitosResponse`, `EstadoConsulta`, `TipoConsulta` adicionados a `lib/api.ts`.
- Item "Consultas" (ícone CalendarPlus) adicionado ao sidebar do gestor (entre Calendário e Tarefas).
- **Lint ✓, tsc ✓, build ✓** (rota /gestor/consultas = 5.6 kB).

### F4-G — Documentação (Task DOC-F4 por subagent)
- `docs/BACKEND.md`: modelo Consulta documentado, validação de conflitos (4 dimensões), soft block, endpoint PATCH /nota-clinica, imutabilidade RGPD, temCedulaValida(), 7 endpoints, entrada F4 no histórico.
- `docs/FRONTEND.md`: rota /gestor/consultas, 5 tipos DTO, página documentada (validação em tempo real, SOAP), entrada F4 no histórico.
- `docs/ARQUITETURA.md`: F4 marcado ✅ no roadmap, schema de Consulta alinhado, decisões de design #9 (soft block) e #10 (cédula obrigatória) adicionadas.

Stage Summary:
- **Consulta criada** com 3 eixos (fisio + sala + paciente) e nota clínica SOAP completa.
- **Validação de conflitos dupla** (o ponto mais sensível, conforme pedido do utilizador): valida em simultâneo se o fisioterapeuta está disponível (motor F3) E se a sala tem vaga (sem sobreposição). Adicionalmente valida fisio e paciente sem sobreposição.
- **Soft block**: conflitos não bloqueiam (409 sem forçar, 200 com warning se forçado) — o gestor pode sobrepor em casos excecionais (dupla marcação, sobreposição intencional).
- **Cédula profissional obrigatória** para assinar notas clínicas SOAP (RGPD/faturação). Snapshot da cédula guardado para auditoria legal.
- **Imutabilidade RGPD**: consultas concluídas não podem ser eliminadas nem ter a nota clínica editada.
- **176/176 testes ✓** + **lint ✓** + **tsc ✓** + **build ✓**.
- **Próximo passo:** F5 (Nota clínica SOAP avançada + ModeloProtocolo de ModeloChecklist).
