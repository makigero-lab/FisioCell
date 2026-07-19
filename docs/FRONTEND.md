# Documentação Técnica — Frontend (FisioCell)

> ⚠️ **F0 — Documentação em transição (F8 concluída).** O projeto migrou de Alojamento Local para Fisioterapia. A integração Smoobu foi removida. **F8 — Limpeza:** as páginas Smoobu/Tarefa legacy (`/admin/webhooks`, `/gestor/webhooks`, `/admin/sistema`, `/gestor/calendario` antigo de Tarefas, `/gestor/tarefas`, `/gestor/configuracoes/checklists`) foram **removidas**; o item "Propriedades" do sidebar foi renomeado para "**Salas**"; o item "Configurações" foi reposto. Ver [`docs/ARQUITETURA.md`](ARQUITETURA.md) para o roadmap completo F0–F9.

Interface web do SaaS de gestão para Fisioterapia, construída com **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS** e componentes **shadcn/ui** (estilo *New York*).

> Nesta fase, o frontend usa **dados fictícios (mock data)** — sem ligação à API. O objetivo é validar design, layout e comportamento responsivo.

---

## 1. Stack tecnológica

| Camada          | Tecnologia        | Função                                                         |
|-----------------|-------------------|----------------------------------------------------------------|
| Framework       | Next.js 14.2.x    | App Router, SSR/SSG, rotas por ficheiro                        |
| Linguagem       | TypeScript 5      | Tipagem estática                                               |
| Estilos         | Tailwind CSS 3.4  | Utilitários CSS + design tokens via CSS variables             |
| Componentes UI  | shadcn/ui         | Componentes base (Button, Card, Badge, Avatar, Separator)     |
| Ícones          | lucide-react      | Conjunto de ícones SVG                                         |
| Utilitários     | clsx, tailwind-merge, class-variance-authority | Combinação de classes + variantes |

> **Nota sobre dependências:** os componentes shadcn foram criados **sem Radix UI** (exceto onde estritamente necessário), de forma a manter o número de dependências mínimo. O `Button` usa `asChild={false}` nativo.

---

## 2. Estrutura de ficheiros

```
frontend/
├── package.json              # Dependências e scripts
├── next.config.mjs           # Configuração do Next.js
├── tsconfig.json             # Configuração TypeScript (paths @/*)
├── tailwind.config.ts        # Tema Tailwind + cores shadcn
├── postcss.config.mjs        # PostCSS (Tailwind + Autoprefixer)
├── components.json           # Configuração shadcn/ui (estilo new-york)
├── .env.example              # Modelo de variáveis de ambiente
├── .gitignore
└── src/
    ├── middleware.ts          # Proteção de rotas (Edge): /admin/** e /staff/** exigem token; / e /login redirecionam autenticados
    ├── app/
    │   ├── globals.css       # Variáveis CSS do tema premium (azul marinho) — light/dark
    │   ├── layout.tsx        # Layout root (fonte Inter, lang pt-PT)
    │   ├── page.tsx          # Landing page premium (1 botão 'Entrar na Plataforma' → /login)
    │   ├── login/
    │   │   └── page.tsx      # Ecrã de Login (POST /api/auth/login, redirect por role / ?from=)
    │   ├── admin/
    │   │   ├── layout.tsx    # Layout admin + RouteGuard (role admin)
    │   │   ├── page.tsx      # Dashboard (estatísticas, tarefas, equipa)
    │   │   ├── propriedades/page.tsx   # Consome API real (GET/POST)
    │   │   ├── equipa/page.tsx         # Placeholder
    │   │   └── calendario/page.tsx     # Placeholder
    │   ├── manager/
    │   │   ├── layout.tsx    # Layout manager + RouteGuard (role manager)
    │   │   ├── page.tsx      # Dashboard do responsável (tarefas + equipa)
    │   │   ├── tarefas/page.tsx        # Placeholder
    │   │   └── equipa/page.tsx          # Placeholder
    │   └── staff/
    │       ├── layout.tsx    # Layout staff + RouteGuard (role staff)
    │       ├── page.tsx      # Área do Staff (mobile-first)
    │       └── tarefas/[id]/page.tsx  # Detalhe da Tarefa (checklist + concluir)
    ├── components/
    │   ├── ui/               # shadcn: button, card, badge, avatar, separator, checkbox, textarea, input
    │   ├── admin/
    │   │   ├── admin-sidebar.tsx    # Sidebar responsiva (desktop fixa / mobile overlay)
    │   │   └── placeholder-page.tsx # Componente de página "Em breve"
    │   ├── auth/
    │   │   └── route-guard.tsx      # Camada client-side de proteção (valida token + role)
    │   ├── manager/
    │   │   └── manager-sidebar.tsx  # Sidebar do responsável de limpezas
    │   └── staff/
    │       ├── task-card.tsx             # Cartão de tarefa (link para detalhe)
    │       └── detalhe-tarefa-client.tsx # Ecrã de detalhe (estado interativo)
    └── lib/
        ├── utils.ts          # cn() — clsx + tailwind-merge
        ├── api.ts             # Helpers de fetch (adminGet/adminPost) com Authorization Bearer
        ├── auth.ts            # Gestão do token JWT em **cookie** (middleware lê) + ler user do payload
        └── mock-data.ts      # Dados fictícios (ainda usados em /staff e dashboard)
```

---

## 3. Sistema de rotas

A aplicação tem **três áreas privadas** (cada uma com layout próprio), uma página de login e uma landing page pública — todas com proteção de rotas (ver secção 12):

> **F8 — Limpeza:** as seguintes rotas foram **removidas** no âmbito da limpeza de modelos legacy: `/gestor/calendario` (antigo calendário de Tarefas — substituído por `/gestor/calendario-consultas` em F6), `/gestor/tarefas`, `/gestor/configuracoes/checklists`, `/gestor/webhooks`, `/admin/webhooks` e `/admin/sistema`. O item de sidebar "Propriedades" foi renomeado para "**Salas**" (mantém o `href: /gestor/propriedades` por compatibilidade com o backend, onde o modelo `Propriedade` continua a ser o alias de Sala). Os itens "Calendário" (antigo), "Tarefas" e "Checklists" foram removidos do sidebar do gestor; foi reposto o item "Configurações".

| Rota            | Descrição                                          | Abordagem         |
|-----------------|----------------------------------------------------|-------------------|
| `/`             | Landing premium — 1 botão 'Entrar na Plataforma' → `/login` | — |
| `/login`        | **Login** (POST /api/auth/login; redirect por role / `?from=`) | Centrado, premium |
| `/admin`        | Painel do Super Admin (gestão cross-tenant de empresas) — **protegido** (role admin) | Desktop-first |
| `/admin/empresas/[id]` | Gaveta de empresa (configuração, webhook-logs, hard-reset, impersonação) — F8 manteve o CRUD de empresas e `webhook-logs` | Desktop-first |
| `/gestor`       | Painel operacional da clínica — **protegido** (F1: roles `diretor_clinico` + `rececionista` partilham a área via `RouteGuard role={["diretor_clinico", "rececionista"]}`; permissões diferenciadas no backend via `isDiretorClinico`/`isRececionista`) | Desktop-first |
| `/gestor/pacientes` | **CRUD de Pacientes** (F2) — grid de cartões, busca, modais criar/editar/detalhe, soft delete; permissões por role | Desktop-first |
| `/gestor/equipa/horarios` | **Horários de Fisioterapeuta** (F3) — verificador de disponibilidade, lista agrupada por fisio, modais criar/editar, soft toggle (DELETE) | Desktop-first |
| `/gestor/consultas` | **Consultas** (F4) — lista de cartões (paciente/fisio/sala/data/estado/tipo/indicador SOAP), modal criar/editar com validação de conflitos em tempo real (debounce 400ms), modal detalhe com nota clínica SOAP editável (S/O/A/P + tratamento), ações rápidas Confirmar/Concluir/Eliminar | Desktop-first |
| `/gestor/protocolos` | **Protocolos Clínicos** (F5) — lista de cartões (nome/área/secções/items/estado ativo), filtro por área clínica, modal criar/editar com secções e items dinâmicos (adicionar/remover) | Desktop-first |
| `/gestor/calendario-consultas` | **Agenda de Consultas** (F6) — FullCalendar com Consultas; cores por fisioterapeuta, filtros, legenda, modal de detalhe. **F8:** substituiu definitivamente o antigo `/gestor/calendario` (removido) | Desktop-first |
| `/gestor/propriedades` | **Salas** (alias `Propriedade`) — CRUD de salas da clínica (criar/editar/toggle ativo) + morada com geocoding + checklist padrão. **F8:** item de sidebar renomeado de "Propriedades" para "**Salas**" | Desktop-first |
| `/gestor/equipa` | CRUD completo de equipa + folgas fixas + telefone + paginação | Desktop-first |
| `/gestor/ausencias` | Centro de Aprovações de RH (F8: sem redistribuição de Tarefas) | Desktop-first |
| `/gestor/relatorios` | Relatórios/Analytics com gráficos (recharts: linha, barras, pie) + relatório IA — **F8:** reescrito sobre `Consulta` (`totalConsultas`/`porFisio`/`porSala`) | Desktop-first |
| `/gestor/notificacoes` | Vista full-page do centro de notificações (além do sino dropdown) | Desktop-first |
| `/gestor/configuracoes` | Configurações operacionais da clínica (F8: item reposto no sidebar) | Desktop-first |
| `/staff`        | Área do Fisioterapeuta (executante) — **protegida** (F1: role `fisioterapeuta`) | Mobile-first |
| `/staff/ausencias` | Pedidos de ausência do fisioterapeuta (férias/doença/outro) — criar + histórico + cancelar pendentes | Mobile-first |
| `/staff/calendario` | Calendário pessoal do fisioterapeuta (legacy — mantido) | Mobile-first |
| `/staff/notificacoes` | Vista full-page das notificações do fisioterapeuta | Mobile-first |
| `/staff/tarefas/[id]` | Detalhe da Tarefa (legacy — mantido; o backend devolve stubs em `/api/auth/me/tarefas`)      | Mobile-first |

### 3.1 Área Admin (`/admin`)

> **F8 — Limpeza:** o painel do Admin foi consolidado (Prompt 122 + F8) numa única página de gestão de empresas com gaveta por empresa. As antigas páginas `/admin/tarefas`, `/admin/calendario`, `/admin/calendario-operacional`, `/admin/aprovacoes`, `/admin/relatorios`, `/admin/propriedades`, `/admin/webhooks` e `/admin/sistema` foram **removidas** (a funcionalidade operacional está em `/gestor/*`; a gestão de webhooks/sistema ficou na gaveta da empresa `/admin/empresas/[id]`).

- **Barra lateral** (`admin-sidebar.tsx`) — **1 item: Empresas** (`href: /admin`, ícone `Building2`). Os links antigos para "Sistema" (`/admin/sistema`) e "Webhooks" (`/admin/webhooks`) foram removidos (Prompt 122 + F8); a gestão foi consolidada na gaveta da empresa.
  - Desktop (`lg+`): sidebar fixa à esquerda, sempre visível.
  - Mobile: colapsada; abre como **overlay** ao tocar no botão de menu (hambúrguer).
  - Item ativo destacado com cor primária (dourado). Toggle de tema (claro/escuro) no fundo.
- **Página principal** (`/admin`): tabela de empresas (ativas + reciclagem via tabs) com botões para criar, ativar/suspender, hard-reset scoped, apagar (soft delete), restaurar. Consome `GET /api/admin/empresas`, `PATCH .../toggle-status`, `POST .../hard-reset`, `DELETE .../empresas/:id`, `PATCH .../restaurar`.
- **Gaveta de empresa** (`/admin/empresas/[id]`): detalhe de uma empresa — gestão de utilizadores da empresa (CRUD via `/api/admin/empresas/:empresaId/utilizadores/*`), webhook-logs (`GET /api/admin/empresas/:id/webhook-logs` — modelo `WebhookLog` mantido em F8 para auditoria), botão de impersonação (`POST /api/admin/impersonar/:id` — troca o cookie por um do utilizador alvo).

### 3.2 Área Staff (`/staff`)

> **F8 — Limpeza:** a área de Staff mantém-se com a lista de "Tarefas" do dia e o detalhe `/staff/tarefas/[id]`, mas o backend (`authController.minhasTarefas`/`minhaTarefaDetalhe`/`concluirMinhaTarefa`) devolve agora **stubs** (array vazio ou `410 Gone`) — o modelo `Tarefa` foi removido. Esta área está preservada para uma futura migração para Consultas do fisioterapeuta (lista de consultas do dia + ações rápidas Confirmar/Concluir). A página `/staff/ausencias` é a única totalmente operacional sobre o modelo `Ausencia` (não dependia de `Tarefa`).

- **Mobile-first**: container com largura máxima `max-w-md` centrado.
- **Cabeçalho fixo** com:
  - Avatar (iniciais do nome)
  - Mensagem "Bem-vindo, [Nome]"
  - Data de hoje (formato pt-PT) e resumo (nº de tarefas + tempo total)
- **Lista de cartões** (`task-card.tsx`), cada um representando uma **Tarefa de Limpeza do dia** com:
  - Nome da propriedade
  - Tipo (ícone + label: Limpeza / Check-in / Check-out / Manutenção)
  - **Hora limite**
  - **Estimativa de tempo** (minutos → formato `XhYY`)
  - Endereço (opcional)
  - Estado (Atribuída / Por atribuir) com badge colorido
  - Botão "Iniciar tarefa" → abre o **Detalhe da Tarefa** (`/staff/tarefas/[id]`). Em tarefas "Por atribuir" o botão fica desativado.
- **Rodapé** fixo com identidade "FisioCell · Área do Staff".

#### Página `/staff/ausencias` — Pedidos de Ausência

- **Botão "Novo Pedido de Ausência"** no topo → abre modal com formulário:
  - Tipo (select: Férias / Doença / Outro)
  - Data de Início + Data de Fim (input date, com `min` dinâmico)
  - Notas (opcional)
  - Submissão → `POST /api/staff/ausencias` (estado fica sempre `pendente`). Mensagem de sucesso: "Pedido enviado para aprovação."
- **Histórico de pedidos** (cards): cada cartão mostra o tipo, as datas formatadas (pt-PT), notas (se houver), data do pedido, e uma **Badge de estado**:
  - Pendente → amarelo (`secondary`)
  - Aprovada → verde (`default`)
  - Rejeitada → vermelho (`destructive`)
- **Cancelar pedidos pendentes**: botão de lixeira (ícone `Trash2`) só aparece em pedidos pendentes. `DELETE /api/staff/ausencias/:id` (backend valida que só pendentes podem ser cancelados → 403 se já aprovada/rejeitada).
- Consome `GET /api/staff/ausencias` (via proxy `/api/staff/[...path]` com cookie httpOnly).

### 3.3 Ecrã de Detalhe da Tarefa (`/staff/tarefas/[id]`)

Ecrã mobile-first apresentado quando o Staff clica num cartão de tarefa atribuída.

- **Cabeçalho fixo** com:
  - Link "Voltar" para `/staff`
  - Ícone do tipo de tarefa + **nome da propriedade no topo** + label do tipo
  - Metadados rápidos: hora limite, estimativa e endereço
- **Checklist interativa** (gerada a partir de um array `string[]`):
  - Cada item tem uma **checkbox** controlada por React State (`itensMarcados[]`).
  - Badge com contador `{concluídos}/{total}` e barra de progresso visual.
  - Itens marcados ficam riscados e com fundo esverdeado.
- **Campo de texto (textarea)** opcional "Observações ou Problemas" com contador de caracteres (máx. 500).
- **Botão grande "Concluir Tarefa"** fixo no fundo do ecrã.

#### Regra de Negócio Visual (implementada com React State)
> O botão **"Concluir Tarefa" está `disabled`** até que **todas as checkboxes** da checklist estejam marcadas (`todasMarcadas = itensConcluidos === total && total > 0`).
>
> Enquanto não estão todas marcadas, o botão mostra o progresso `Concluir Tarefa (X/Y)` e uma legenda explicativa por baixo. Quando todas estão marcadas, o botão fica ativo (cor primária + ícone de confirmação) e, ao clicar, mostra "Tarefa concluída!" e volta para a lista de tarefas.

#### Arquitetura
- `app/staff/tarefas/[id]/page.tsx` — **Server Component**: valida o `id` contra o mock data (`getTarefaPorId`), resolve a checklist (a da tarefa ou a por defeito) e passa ao Client Component. Se o id não existir → `notFound()`.
- `components/staff/detalhe-tarefa-client.tsx` — **Client Component** (`"use client"`): gere o estado (`itensMarcados`, `observacoes`, `concluida`) e aplica a regra de negócio visual.

---

## 4. Tema visual

### Rebranding Premium Dourado (v1.7.0)
Inspirado em sites corporativos de Property Management de luxo (ex.: All2Gether). Estética dourada/sobre-areia, "afiada" e sofisticada.

- **Cor primária:** Dourado/Areia elegante (`hsl(43 74% 49%)`) — luxo, sofisticado. (Anterior: azul marinho `blue-950` — abandonado.)
- **Paleta exata (light):**
  - `--background`: `0 0% 100%` (branco puro)
  - `--foreground`: `222 47% 11%` (azul/cinza muito escuro — texto)
  - `--primary`: `43 74% 49%` (dourado/areia)
  - `--primary-foreground`: `0 0% 100%` (branco sobre dourado)
  - `--card` / `--popover`: `0 0% 100%` (branco puro)
  - `--muted` / `--secondary` / `--accent`: `210 40% 96%` (cinza super suave)
  - `--border` / `--input`: `214.3 31.8% 91.4%` (hairline)
  - `--ring`: `43 74% 49%` (igual ao primary)
- **Dark mode luxuoso:** fundo `222 47% 11%` (azul/cinza escuro), primary ligeiramente mais brilhante (`43 74% 55%`) com texto escuro sobre dourado — contraste de luxo.
- **Border-radius global:** `0.25rem` — bordas "afiadas" e corporativas (ainda mais sharp que a versão anterior `0.3rem`).
- **Sombras:** **flat** e sofisticado. `Card` usa `border-border/60` + `shadow-sm`; `Button` default usa apenas `shadow-sm` (sem `hover:shadow-md` — elevação removida para visual mais flat).
- **Estilo shadcn:** *New York*, com CSS variables (suporte light/dark).
- **Tipografia:** Inter (via `next/font/google`); pesos `font-light` (corpo) e `font-semibold` (títulos) para hierarquia premium.
- **Landing page (`/`):** fundo limpo (sem gradiente), padrão de pontos subtil em radial-gradient, marca minimalista (quadrado dourado com "A"), botão grande e elegante (`h-12 px-10 tracking-wide`).
- **Responsividade:** mobile-first em toda a aplicação; breakpoints Tailwind (`sm`, `lg`, `xl`).
- **Acessibilidade:** alvos táteis ≥ 44px, `aria-label` nos botões de menu, semântica HTML (`header`, `main`, `footer`, `nav`).

---

## 5. Dados fictícios (Mock Data)

Definidos em `src/lib/mock-data.ts`. A estrutura **espelha os modelos do backend** para facilitar a integração futura:

| Tipo TS              | Modelo backend correspondente     |
|----------------------|-----------------------------------|
| `PropriedadeMock`    | `backend/models/Propriedade.js`   |
| `MembroEquipaMock`   | `backend/models/Utilizador.js`    |
| `TarefaMock`         | `backend/models/Tarefa.js`        |

Inclui: `staffAtual` (utilizador staff simulado), `tarefasHoje` (4 tarefas, cada uma com `checklist: string[]`), `equipa` (4 membros), `propriedades` (4 alojamentos), `resumoDashboard` (estatísticas agregadas), `checklistPorDefeito` (fallback) e o helper `getTarefaPorId(id)` (usado no ecrã de detalhe).

> Quando a ligação à API for ativada, basta substituir as importações de `mock-data.ts` por chamadas `fetch` aos endpoints do backend (mesmos campos).

---

## 6. Variáveis de ambiente

Definidas em `.env.example` (copiar para `.env.local`). Nesta fase (mock) não são obrigatórias.

| Variável             | Descrição                                              |
|----------------------|--------------------------------------------------------|
| `NEXT_PUBLIC_API_URL`| URL base da API backend (Render). Usada na fase de integração. |

---

## 7. Scripts disponíveis

| Script         | Comando        | Descrição                                  |
|----------------|----------------|--------------------------------------------|
| `npm run dev`  | `next dev`     | Servidor de desenvolvimento (porta 3000)   |
| `npm run build`| `next build`   | Build de produção                          |
| `npm start`    | `next start`   | Servidor de produção                       |
| `npm run lint` | `next lint`    | ESLint                                     |

---

## 8. Instalação e execução local

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

Abrir http://localhost:3000 → landing page com links para `/admin` e `/staff`.

---

## 9. Deploy na Vercel

### ⚠️ Definições obrigatórias no Vercel

Para evitar o erro `No Output Directory named "public" found`, é **obrigatório** configurar:

| Definição (Project Settings) | Valor                          | Notas                                                            |
|------------------------------|--------------------------------|------------------------------------------------------------------|
| **Root Directory**           | `frontend`                     | O `package.json` do Next.js está em `frontend/`, não na raiz do repo. |
| **Framework Preset**         | **Next.js**                    | Se não for detetado automaticamente, selecionar manualmente.     |
| Build Command                | `next build` *(auto)*          | Deixar o auto quando Framework = Next.js.                        |
| Output Directory             | `.next` *(auto)*               | **Não** definir como `public` — `public` é só para assets estáticos. |
| Install Command              | `npm install` *(auto)*         |                                                                  |
| Environment Variables        | `NEXT_PUBLIC_API_URL`          | URL do backend no Render (ex.: `https://fisiocell-backend.onrender.com`). |

> **Causa do erro `public`:** quando o Vercel não reconhece o projeto como Next.js, assume o preset "Other" (site estático) e procura a pasta `public/` como output. A correção é garantir que o **Framework Preset = Next.js** e que o **Root Directory = `frontend`**.

### `frontend/vercel.json` (rede de segurança)

Para garantir que o Vercel trata o projeto como Next.js — mesmo que a auto-deteção falhe —, o repositório inclui `frontend/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs"
}
```

Isto força o framework para `nextjs`, pelo que o output directory passa a `.next` e o build command a `next build` automaticamente. **Este ficheiro só é lido se o Root Directory estiver definido como `frontend`.**

### Passos para (re)configurar um projeto já criado no Vercel
1. Vercel → Project → **Settings** → **General**.
2. **Root Directory** → `frontend` → Save.
3. **Settings → Build & Development Settings** → confirmar que o **Framework Preset = Next.js** (se estiver "Other", o build falha com o erro `public`). Se necessário, override e selecionar Next.js.
4. **Settings → Environment Variables** → adicionar `NEXT_PUBLIC_API_URL`.
5. **Deployments** → Redeploy.

---

## 10. Regras e convenções

- **Branch de desenvolvimento:** `dev`.
- **Documentação:** sempre que o frontend é alterado, este ficheiro e o `README.md` são atualizados.
- **Linguagem:** interface e comentários em **pt-pt**.
- **Integração com a API:** `/admin/propriedades` consome a API real com **JWT** (v1.3.0); `/login` faz autenticação; as restantes secções (`/staff`, dashboard) ainda usam `mock-data.ts`.

---

## 11. Autenticação e Integração com a API backend

### `src/lib/auth.ts` — Gestão do token JWT (cookie seguro)
- `guardarToken(token)` / `lerToken()` / `removerToken()` — token guardado **EXCLUSIVAMENTE num cookie** (`fisiocell_token`, `SameSite=Strict; Secure; path=/; expires=7d`). v1.13.0: localStorage **removido** (era vulnerável a XSS).
- **Flags de segurança do cookie (v1.13.0):**
  - `SameSite=Strict` — o cookie NÃO é enviado em pedidos cross-site (mitiga CSRF).
  - `Secure` — o cookie só é enviado over HTTPS (em `http://localhost` o cookie não será definido — testar em HTTPS ou ajustar temporariamente em dev).
- `lerUtilizadorDoToken()` — descodifica o payload JWT (base64url) **sem verificar assinatura** (isso é responsabilidade do backend); devolve `{ id, role, empresa_id }` ou `null` se inválido/expirado.
- `estaAutenticado()` — true se houver token válido.
- `rotaPorRole(role)` — devolve `/admin` para admin, `/gestor` para diretor_clinico e rececionista (área partilhada F1), `/staff` para fisioterapeuta (usado no redirect pós-login).

> **F1 — Roles migrados:** o tipo `Role` em `lib/auth.ts` (e em `lib/api.ts`) passou de `"admin" | "manager" | "staff"` para `"admin" | "diretor_clinico" | "fisioterapeuta" | "rececionista"`. A função `rotaPorRole` mapeia `rececionista` → `/gestor` (partilha o painel do diretor clínico com permissões limitadas via `isRececionista` no backend).

### `src/lib/api.ts` — Helpers de fetch
- `API_URL` — lê `process.env.NEXT_PUBLIC_API_URL`.
- `adminHeaders()` — inclui `Authorization: Bearer <token>` **se houver token** no cookie. v1.12.0: **sem fallback** — se não houver token, não envia header `x-empresa-id` (o backend devolve 401). A proteção de rotas (middleware.ts + RouteGuard) garante que o utilizador só chega a páginas privadas com token válido.
- `adminGet(path)` / `adminPost(path, body)` / `adminPut(path, body)` / `adminPatch(path, body?)` / `adminDelete(path)` — wrappers de `fetch` para GET/POST/PUT/PATCH/DELETE com tratamento de erros. Em `401`, removem o token (força novo login).
- `LoginResponse` — tipo da resposta de `POST /api/auth/login`.
- `UtilizadorDTO` / `Role` — tipos que espelham o modelo `Utilizador` do backend (F1: `Role = "admin" | "diretor_clinico" | "fisioterapeuta" | "rececionista"`). **F6:** `UtilizadorDTO` expandido com `perfil_profissional?` (`cedula`, `especialidades`, `biografia`, `cor_calendario`, `ativo_clinico`) — necessário para a legenda de cores do calendário de consultas.
- `AusenciaDTO` / `TipoAusencia` — tipos que espelham o modelo `Ausencia` do backend.
- `PacienteDTO` / `PacienteListResponse` (F2) — tipos que espelham o modelo `Paciente` do backend. `PacienteDTO` inclui os campos clínicos (`contacto_emergencia`, `historico_medico`, `alergias`) como opcionais — só estão presentes quando o backend devolve `dados_clinicos: true` (isClinico). `PacienteListResponse` = `{ pacientes: PacienteDTO[]; total: number; dados_clinicos: boolean }`.
- `HorarioFisioterapeutaDTO` / `HorarioListResponse` / `DisponibilidadeResponse` (F3) — tipos que espelham o modelo `HorarioFisioterapeuta` do backend e a resposta do verificador de disponibilidade. `HorarioFisioterapeutaDTO.fisioterapeuta_id` é `string | { _id, nome, email, role }` (populate do backend); `dia_semana` é `number | null` (null se exceção); `data` é `string | null` (ISO, null se recorrente). `HorarioListResponse` = `{ horarios: HorarioFisioterapeutaDTO[]; total: number }`. `DisponibilidadeResponse` = `{ disponivel: boolean; horario: { hora_inicio, hora_fim } | null; motivo: string | null; origem: 'excecao' | 'recorrente' | null }`.
- `EstadoConsulta` / `TipoConsulta` / `ConsultaDTO` / `ConsultaListResponse` / `ValidarConflitosResponse` (F4) — tipos que espelham o modelo `Consulta` do backend e a resposta do verificador de conflitos. `EstadoConsulta` = `"marcada" | "confirmada" | "em_curso" | "concluida" | "cancelada" | "faltou" | "nao_compareceu"`. `TipoConsulta` = `"primeira_consulta" | "sessao" | "reavaliacao" | "alta" | "grupo"`. `ConsultaDTO.sala_id` é `string | { _id, nome }` (populate); `fisioterapeuta_id` é `string | { _id, nome, email, perfil_profissional?: { cor_calendario?, cedula? } }`; `paciente_id` é `string | { _id, nome, telefone }`; `criada_por` é `string | { _id, nome }`. `nota_clinica` é opcional (sub-documento SOAP `{ subjetivo, objetivo, avaliacao, plano, tratamento_efetuado, cedula_assinante }`). `ConsultaListResponse` = `{ consultas: ConsultaDTO[]; total: number }`. `ValidarConflitosResponse` = `{ ok: boolean; conflitos: string[]; horario?: { hora_inicio, hora_fim } | null }` — resposta do `GET /api/gestor/consultas/validar` usada pelo modal criar/editar para mostrar warnings em tempo real.
- `AreaProtocolo` / `ModeloProtocoloDTO` / `ProtocoloListResponse` (F5) — tipos que espelham o modelo `ModeloProtocolo` do backend. `AreaProtocolo` = `"musculoesqueletica" | "neurologica" | "cardioresp" | "desporto" | "pediatria" | "outro"`. `ModeloProtocoloDTO` = `{ _id, empresa_id, nome, descricao, area: AreaProtocolo, seccoes: { nome: string; items: string[] }[], ativo: boolean, createdAt?, updatedAt? }` — `seccoes` é um array de `{ nome, items: string[] }` (items como strings simples no template; o snapshot na `Consulta.nota_clinica.protocolo_aplicado` converte para `{ texto, concluido }`). `ProtocoloListResponse` = `{ protocolos: ModeloProtocoloDTO[]; total: number }` — resposta do `GET /api/gestor/protocolos` (com filtros opcionais `?area=` e `?ativo=`).

### `/login` (Client Component)
Ecrã minimalista premium centrado:
- Formulário com **Email** + **Password** + botão **Entrar** (design premium: azul marinho, padrão de pontos de fundo, marca "A").
- Ao submeter: `POST /api/auth/login` (sem auth header — endpoint público).
- Em caso de sucesso: `guardarToken(token)` + `router.push(rotaPorRole(role))` → **admin → `/admin`**, **diretor_clinico/rececionista → `/gestor`** (área partilhada), **fisioterapeuta → `/staff`** (F1).
- Estados: loading (spinner), erro (cartão vermelho com a mensagem do backend).

### `/admin/propriedades` (Client Component)
Primeiro ecrã a consumir a API real (mock-data abandonado nesta secção):

- `useEffect` chama `adminGet('/api/admin/propriedades')` ao montar.
- Apresenta as propriedades numa **tabela HTML** (Tailwind) com colunas **Nome**, **Tempo de Limpeza**, **Estado**.
- Estados visuais: loading (spinner), erro (cartão vermelho com “Tentar novamente”), vazio (call-to-action).
- Botão **“Nova Propriedade”** no topo → abre formulário **inline** (Card) com campos **Nome**, **Tempo de Limpeza**.
- Ao submeter: `adminPost('/api/admin/propriedades', { ... })`, limpa o formulário e volta a chamar `carregar()` para atualizar a tabela automaticamente.
- Validações no cliente: Nome obrigatório; Tempo de Limpeza numérico `>= 0`.

### `/admin/equipa` (Client Component) — CRUD completo (v1.9.0 + v1.10.0)
- `useEffect` chama `adminGet('/api/admin/equipa')` ao montar.
- **Tabela** com colunas: **Nome**, **Email**, **Role** (Badge), **Responsável** (nome do superior hierárquico ou "—"), **Estado** (Badge Ativo/Inativo), **Ações**.
- **Adicionar**: botão "Adicionar Funcionário" → formulário inline (Nome, Email, Password, Role select **sem Admin**, **Responsável select** populado com admin+diretor_clinico) → `adminPost` (F1: roles migrados).
- **Editar**: botão ✏️ por linha → abre **modal Dialog** com Nome, Email, Role (**sem Admin**), **Responsável select** + **Nova Password (opcional)** → `adminPut`. Password vazia = mantém atual. O utilizador a editar é excluído do select de Responsável (não pode ser responsável de si próprio).
- **Ativar/Desativar**: botão ⏻ por linha → `adminPatch('/equipa/:id/estado')` com otimismo (atualiza UI imediatamente, reverte se falhar).
- **Eliminar**: botão 🗑️ por linha → abre **modal de confirmação** (Dialog) → `adminDelete`. Aviso: "ação permanente".
- **Admin = só de leitura**: linhas com `role === "admin"` **não mostram botões de ação** (Editar/Ativar/Eliminar escondidos). Mostra "—" no lugar das ações. Isto reflete as regras 403 do backend (não é possível modificar/eliminar admins via `/api/admin/equipa`).
- Após cada operação (criar/editar/eliminar), a tabela atualiza-se automaticamente (`carregar()`).
- Componente `Dialog` (shadcn, sem Radix) em `components/ui/dialog.tsx` — backdrop, fecho com Esc/clique fora, scroll bloqueado.

### `/admin/calendario` (Client Component) — Folgas e Férias (v1.11.0)
- `useEffect` carrega em paralelo: `adminGet('/api/admin/ausencias?futuras=true')` + `adminGet('/api/admin/equipa')` (para popular o select de funcionários, filtrado a fisioterapeuta+diretor_clinico — F1).
- **Formulário "Marcar Ausência"** no topo: select Funcionário, Data de Início, Data de Fim, select Tipo (Folga/Férias), Notas (opcional), botão "Agendar" → `adminPost`.
- **Tabela** de ausências agendadas: Funcionário, Tipo (Badge com ícone Plane/Sun), Período (datas formatadas pt-PT), Notas, Ações.
- **Eliminar**: botão 🗑️ por linha → `adminDelete` com otimismo (remove da UI imediatamente, reverte se falhar).
- Validações no cliente: funcionário + datas obrigatórios; `data_fim >= data_inicio`.
- Tipo `AusenciaDTO` + `TipoAusencia` em `lib/api.ts`.
- **Integração com o motor de atribuição**: as ausências registadas aqui excluem automaticamente o staff da atribuição de tarefas (o load balancer consulta `Ausencia` no passo 2).

### `/gestor/pacientes` (Client Component) — F2
Página de gestão de pacientes da clínica. Consome `GET/POST/PUT/PATCH/DELETE /api/gestor/pacientes` via `adminGet`/`adminPost`/`adminPut`/`adminPatch`/`adminDelete`.

> **Item de sidebar (F2):** o `components/gestor/gestor-sidebar.tsx` inclui o item **Pacientes** (`href: "/gestor/pacientes"`, ícone `UserRound` do `lucide-react`), posicionado entre **Salas** (antigo "Propriedades", renomeado em F8) e **Equipa**.

- **Listagem em grid de cartões:** cada cartão mostra `nome`, idade (calculada de `data_nascimento`), `telefone`, `email`, badge de estado (Ativo/Inativo), e ícones de ação. `useEffect` chama `adminGet('/api/gestor/pacientes')` ao montar; a resposta traz a flag `dados_clinicos` que controla a visibilidade dos campos clínicos.
- **Busca:** campo de texto no topo que filtra via query param `?busca=` (debounce) — corresponde à pesquisa server-side por `nome`/`num_utente`/`telefone`/`email`.
- **Modal criar/editar** (`Dialog`): formulário com Nome (obrigatório), Telefone (obrigatório), Data de Nascimento, Género, Nº Utente (SNS), NIF, Email, Morada, Contacto de Emergência (`nome`/`telefone`/`relação`), Histórico Médico, Alergias (array), Consentimento de Dados (`concedido`/`versao_termos`), Observações, Origem. Os campos clínicos só aparecem/editáveis quando `dados_clinicos === true` (isClinico); a rececionista só vê e edita campos administrativos.
- **Modal de detalhe** (`Dialog`): mostra todos os campos do paciente (incl. clínicos se `dados_clinicos`). Ícones `Phone`/`Mail`/`Calendar` para contacto e data de nascimento; `ShieldCheck` para o bloco de consentimento RGPD; `AlertTriangle` para alergias.
- **Ativar/Desativar** (botão `Power`): `adminPatch('/:id/estado')` com otimismo. Disponível para todos os roles que acedem à página (o backend permite `isRececionista` no PATCH).
- **Editar** (botão `Pencil`): abre o modal de criar/editar pré-preenchido → `adminPut('/:id')`.
- **Eliminar** (botão `Trash2`, só para `diretor_clinico`/`admin`): abre modal de confirmação → `adminDelete('/:id')` (soft delete). O botão só é renderizado quando o role do utilizador permite eliminar.
- Estados visuais: loading (`Loader2` spinner), erro (`AlertCircle` cartão vermelho + botão `RefreshCw` para tentar de novo), vazio (call-to-action).
- Tipo `PacienteDTO` + `PacienteListResponse` em `lib/api.ts` (F2).

### `/gestor/equipa/horarios` (Client Component) — F3
Página de gestão dos limites de agenda dos fisioterapeutas. Consome `GET/POST/PUT/DELETE /api/gestor/horarios` e `GET /api/gestor/horarios/disponibilidade` via `adminGet`/`adminPost`/`adminPut`/`adminDelete`.

> **Item de sidebar (F3):** o `components/gestor/gestor-sidebar.tsx` inclui o item **Horários** (`href: "/gestor/equipa/horarios"`, ícone `Clock` do `lucide-react`), posicionado entre **Equipa** e **Ausências / Férias**.

- **Verificador de disponibilidade** (cartão no topo): formulário com Fisioterapeuta (select), Data (input date), Hora (input time, default `10:00`), Duração (input number, default `45` min) e botão "Verificar". Ao submeter, monta um ISO string (data + hora) e chama `adminGet('/api/gestor/horarios/disponibilidade?fisioterapeuta_id=...&data=...&duracao_minutos=...')`. O resultado é apresentado num cartão com ícone `CheckCircle2` (verde, "Disponível") ou `XCircle` (vermelho, "Indisponível") + o `motivo` devolvido pelo backend e a janela de trabalho (`hora_inicio`–`hora_fim`, origem `excecao`/`recorrente`).
- **Lista agrupada por fisioterapeuta:** `useEffect` chama `adminGet('/api/gestor/horarios')` ao montar; o resultado é agrupado em JS por `fisioterapeuta_id` (ou pelo `_id` do populate). Para cada fisioterapeuta, mostra-se um cartão com:
  - Nome do fisioterapeuta (e badge de role).
  - Lista de regras desse fisio, cada uma com:
    - **Badge `tipo`** (`recorrente` em azul, `excecao` em âmbar).
    - Para `recorrente`: nome do dia da semana (`nomeDia(dia_semana)` — Domingo…Sábado).
    - Para `excecao`: data formatada (pt-PT) + badge verde (`disponivel: true` — "Extra") ou vermelha (`disponivel: false` — "Bloqueio").
    - Janela de trabalho `hora_inicio`–`hora_fim`.
    - `nota` (se preenchida) com ícone `CalendarOff`/`Calendar`.
    - Botões de ação (só para `diretor_clinico`/`admin`): `Pencil` (editar) e `Trash2` (eliminar).
  - Badges com `ativo: false` são destacadas (estilo "desativado").
- **Filtro** por fisioterapeuta (select no topo da lista) — quando aplicado, mostra só as regras desse fisio.
- **Modal criar/editar** (`Dialog`): formulário com Fisioterapeuta (select populado da lista de fisios), Tipo (`recorrente`/`excecao` — radio/toggle), Dia da Semana (select 0–6, só visível se `recorrente`), Data (input date, só visível se `excecao`), Hora de Início + Hora de Fim (input time), Disponível (checkbox, só visível se `excecao` — para distinguir horário extra de bloqueio), Nota (textarea). Ao submeter: `adminPost('/api/gestor/horarios', body)` (criar) ou `adminPut('/api/gestor/horarios/:id', body)` (editar). Após sucesso, a lista recarrega.
- **Eliminar** (botão `Trash2`, só para `diretor_clinico`/`admin`): `adminDelete('/api/gestor/horarios/:id')` (hard delete — o backend não usa soft delete para horários).
- **Permissões:** o backend limita as mutações a `isDiretorClinico` (admin + diretor_clinico); o fisioterapeuta e a rececionista conseguem ver a lista e usar o verificador, mas os botões de criar/editar/eliminar são escondidos no cliente quando o role do utilizador não os permite.
- Estados visuais: loading (`Loader2` spinner), erro (`AlertCircle` cartão vermelho + botão `RefreshCw`), vazio (call-to-action com botão "Criar primeiro horário").
- Tipos `HorarioFisioterapeutaDTO` + `HorarioListResponse` + `DisponibilidadeResponse` em `lib/api.ts` (F3).

### `/gestor/consultas` (Client Component) — F4
Página de gestão de marcações/consultas da clínica. Consome `GET/POST/PUT/PATCH/DELETE /api/gestor/consultas` e `GET /api/gestor/consultas/validar` via `adminGet`/`adminPost`/`adminPut`/`adminPatch`/`adminDelete`.

> **Item de sidebar (F4):** o `components/gestor/gestor-sidebar.tsx` inclui o item **Consultas** (`href: "/gestor/consultas"`, ícone `CalendarPlus` do `lucide-react`). **F8:** os items adjacentes "Calendário" (antigo) e "Tarefas" foram removidos do sidebar — **Consultas** fica agora entre **Agenda Consultas** (F6) e **Salas**.

- **Lista de consultas (cartões):** cada cartão mostra o nome do paciente, o fisioterapeuta, a sala, a data/hora (`data_hora_inicio` formatada em pt-PT), a duração, badges de `estado` (`marcada`/`confirmada`/`em_curso`/`concluida`/`cancelada`/`faltou`/`nao_compareceu`) e de `tipo` (`primeira_consulta`/`sessao`/`reavaliacao`/`alta`/`grupo`), e um **indicador SOAP** (preenchido quando `nota_clinica.subjetivo`/`objetivo`/`avaliacao`/`plano` têm conteúdo). `useEffect` chama `adminGet('/api/gestor/consultas')` ao montar; o fisioterapeuta vê só as suas consultas (filtro aplicado no backend).
- **Modal criar/editar** (`Dialog`): formulário com Fisioterapeuta (select populado pela equipa), Sala (select populado por `Propriedade` ativas), Paciente (select populado por `Paciente` ativos), Data/Hora de Início (input datetime), Duração (input number, default `45`, min `15`), Tipo (select), Observações. **Validação de conflitos em tempo real:** quando o utilizador muda algum campo relevante (fisio/sala/paciente/data/duração), um `useEffect` com **debounce de 400ms** chama `adminGet('/api/gestor/consultas/validar?fisioterapeuta_id=...&sala_id=...&paciente_id=...&data_hora_inicio=...&duracao_minutos=...&excluir_id=...')` e mostra os warnings (`ValidarConflitosResponse.conflitos`) num bloco âmbar abaixo do formulário (ícone `AlertTriangle`). No modo edição, `excluir_id` exclui a própria consulta da verificação.
- **Submissão:** `POST /api/gestor/consultas` (criar) ou `PUT /api/gestor/consultas/:id` (editar). Se o backend devolver `409` (conflitos sem `forcar`), mostra um modal de confirmação "Forçar Agendamento?" — ao confirmar, reenvia com `forcar: true` (o backend devolve `200` com `warning` + `conflitos`). Se devolver `201` (sem conflitos) ou `200` (forçado), fecha o modal e atualiza a lista.
- **Modal de detalhe** (`Dialog`): mostra todos os campos da consulta (paciente, fisio, sala, data/hora, duração, tipo, estado, presença, observações, criada_por, concluida_em/cancelada_em) + bloco de **nota clínica SOAP editável** (Subjetivo, Objetivo, Avaliação, Plano, Tratamento Efetuado) — só visível/editável para `isClinico` (admin/diretor_clinico/fisioterapeuta). A rececionista vê os campos administrativos mas não vê nem edita a SOAP. A SOAP é submetida via `PATCH /api/gestor/consultas/:id/nota-clinica` (endpoint separado do PUT). Se a consulta estiver concluída, a SOAP é apresentada em modo só-leitura (imutável — RGPD).
- **Ações rápidas** (botões no cartão ou no modal de detalhe):
  - **Confirmar** (`Check`/`CheckCircle2`) — `PUT /:id` com `{ estado: 'confirmada' }` (disponível para `isRececionista`).
  - **Concluir** (`CheckCheck`) — `PUT /:id` com `{ estado: 'concluida' }` (só para clínicos; a partir daqui a SOAP fica imutável).
  - **Eliminar** (`Trash2`, só para `diretor_clinico`/`admin`) — abre modal de confirmação → `adminDelete('/:id')` (hard delete). O backend bloqueia consultas concluídas (403 RGPD) — o botão é escondido nesses casos.
- **Permissões (client-side):** os botões de criar/editar marcações são escondidos para o fisioterapeuta (o backend devolve 403 via `isRececionista`). A SOAP só aparece para `isClinico`. O botão Eliminar só é renderizado para `diretor_clinico`/`admin`.
- Estados visuais: loading (`Loader2` spinner), erro (`AlertCircle` cartão vermelho + botão `RefreshCw`), vazio (call-to-action com botão "Criar primeira consulta").
- Tipos `EstadoConsulta` + `TipoConsulta` + `ConsultaDTO` + `ConsultaListResponse` + `ValidarConflitosResponse` em `lib/api.ts` (F4).

### `/gestor/protocolos` (Client Component) — F5
Página de gestão dos templates de protocolo clínico da clínica. Consome `GET/POST/PUT/DELETE /api/gestor/protocolos` via `adminGet`/`adminPost`/`adminPut`/`adminDelete`.

> **Item de sidebar (F5):** o `components/gestor/gestor-sidebar.tsx` inclui o item **Protocolos** (`href: "/gestor/protocolos"`, ícone `Stethoscope` do `lucide-react`).

- **Lista de protocolos (cartões):** cada cartão mostra o `nome`, a `area` (área clínica — badge), a `descricao`, a lista de **secções** (cada uma com o `nome` e os `items`), e um indicador de estado (Ativo/Inativo). `useEffect` chama `adminGet('/api/gestor/protocolos')` ao montar; o resultado é ordenado por `area` + `nome` (já vem ordenado do backend).
- **Filtro por área clínica:** select no topo que filtra a lista localmente (ou via query param `?area=`) — `musculoesqueletica`/`neurologica`/`cardioresp`/`desporto`/`pediatria`/`outro` + "Todas".
- **Modal criar/editar** (`Dialog`): formulário com Nome (obrigatório), Descrição, Área clínica (select), Ativo (checkbox), e blocos dinâmicos de **secções** — cada secção tem Nome (obrigatório) + lista de Items (inputs de texto). Botões **"Adicionar Secção"** e **"Adicionar Item"** (por secção) + botões de remover (lixeira) em cada secção/item. A estrutura é validada antes de submeter (cada secção tem de ter nome + ≥1 item não vazio). Ao submeter: `adminPost('/api/gestor/protocolos', body)` (criar) ou `adminPut('/api/gestor/protocolos/:id', body)` (editar). Após sucesso, a lista recarrega.
- **Ativar/Desativar** (botão `Power`, só para `diretor_clinico`/`admin`): `adminPut('/:id', { ativo: !ativo })` com otimismo. Permite retirar o protocolo da seleção ao marcar consulta sem apagar (preserva snapshots já guardados).
- **Eliminar** (botão `Trash2`, só para `diretor_clinico`/`admin`): abre modal de confirmação → `adminDelete('/api/gestor/protocolos/:id')` (hard delete — o backend não tem soft delete para protocolos).
- **Permissões (client-side):** os botões de criar/editar/eliminar são escondidos para `fisioterapeuta` e `rececionista` (o backend devolve 403 via `isDiretorClinico` nas mutações). Ambos conseguem ver a lista e o detalhe (para aplicar/selecionar na marcação de consulta), mas só a direção clínica gere protocolos.
- Estados visuais: loading (`Loader2` spinner), erro (`AlertCircle` cartão vermelho + botão `RefreshCw`), vazio (call-to-action com botão "Criar primeiro protocolo").
- Tipos `ModeloProtocoloDTO` + `ProtocoloListResponse` + `AreaProtocolo` em `lib/api.ts` (F5).

> **Integração com a Consulta (F5):** o `protocolo_id` selecionado no formulário de marcação de consulta (`/gestor/consultas`) é enviado no `POST /api/gestor/consultas` — o backend gera um snapshot imutável em `nota_clinica.protocolo_aplicado`. Durante a sessão, o fisioterapeuta marca os items como `concluido` via `PATCH /:id/nota-clinica` com `protocolo_aplicado` no body. Alterações futuras no template (em `/gestor/protocolos`) não afetam consultas antigas (RGPD/legal).

### `/gestor/calendario-consultas` (Client Component) — F6
Página de calendário **FullCalendar v6** que mostra **Consultas** (em vez de Tarefas do antigo `/gestor/calendario`). Consome `GET /api/gestor/consultas?inicio=...&fim=...` (com filtros opcionais `fisioterapeuta_id`/`sala_id`/`estado`) e `GET /api/gestor/equipa` (para o filtro e a legenda de fisioterapeutas) via `adminGet`.

> **Item de sidebar (F6):** o `components/gestor/gestor-sidebar.tsx` inclui o item **Agenda Consultas** (`href: "/gestor/calendario-consultas"`, ícone `CalendarPlus` do `lucide-react`), posicionado entre **Dashboard** e **Consultas**. **F8:** o antigo item **Calendário** (que apontava para `/gestor/calendario`) foi removido do sidebar — **Agenda Consultas** é agora o único calendário do gestor.

> **F8 — Substituição concluída:** o calendário antigo `/gestor/calendario` (que mostrava Tarefas) foi **removido** em F8. O `/gestor/calendario-consultas` é agora a única agenda do gestor (sobre `Consulta`).

- **FullCalendar v6** com plugins `dayGrid` (mês), `timeGrid` (semana/dia) e `interaction`; locale `pt`; vista inicial `timeGridWeek`. `headerToolbar` com `prev,next today` / `title` / `dayGridMonth,timeGridWeek,timeGridDay` (botões traduzidos: Hoje/Mês/Semana/Dia). `slotMinTime: "08:00:00"`, `slotMaxTime: "20:00:00"`, `nowIndicator` ativo, `allDaySlot: false`.
- **Blocos com duração real:** cada Consulta gera um evento com `start = data_hora_inicio` e `end = data_hora_fim` (o backend calcula `fim = inicio + duracao_minutos`), pelo que os blocos ocupam o intervalo correto na grelha horária.
- **Cores por fisioterapeuta:** a cor de cada evento vem de `perfil_profissional.cor_calendario` do fisioterapeuta (populate do backend); se não estiver definida, há **fallback por estado** (marcada=azul, confirmada=verde, em_curso=âmbar, concluida=índigo, cancelada=vermelho, faltou=vermelho escuro, nao_compareceu=vermelho muito escuro).
- **Filtros:** select de Fisioterapeuta (populado pela equipa, filtrado a `fisioterapeuta`+`diretor_clinico`) e select de Estado (Todos + 7 estados). Os filtros são enviados como query params no `GET /api/gestor/consultas`. O período (`inicio`/`fim`) é determinado pelo callback `datesSet` do FullCalendar (vista atual) — ao navegar entre semanas/dias/meses, a lista recarrega automaticamente.
- **Legenda de cores por fisioterapeuta:** faixa por baixo dos filtros que mostra um círculo colorido (`cor_calendario` ou fallback azul) + o nome de cada fisioterapeuta (até 8), permitindo identificar visualmente a quem pertence cada bloco.
- **Render customizado de eventos** (`eventContent`): em vez do conteúdo padrão do FullCalendar, cada bloco mostra a **hora de início** + **nome do paciente** (linha bold); na vista semanal (`timeGridWeek`) mostra ainda o **nome do fisioterapeuta** por baixo. O `title` do evento é `"paciente — fisio"`.
- **Modal de detalhe** (`Dialog`) ao clicar num evento: mostra o nome do paciente no título + grelha com Início, Fim, Duração, Tipo (badge), Fisioterapeuta, Sala, Estado (badge), Presença (badge). Se a consulta tiver `nota_clinica`, mostra um bloco **Nota Clínica SOAP resumida** (Subjetivo, Avaliação e Tratamento Efetuado — subconjunto só-leitura) e as Observações.
- Estados visuais: loading (`Loader2` spinner + botão "Atualizar" com ícone `RefreshCw` giratório), erro (cartão vermelho `AlertCircle`), contador de consultas no período no cabeçalho.
- Tipos reutilizados de `lib/api.ts`: `ConsultaDTO`, `ConsultaListResponse`, `UtilizadorDTO`, `EstadoConsulta`, `TipoConsulta` (definidos em F4; `UtilizadorDTO.perfil_profissional` expandido em F6).

---

## 12. Proteção de Rotas (v1.5.0)

A proteção de rotas usa **duas camadas complementares**:

### 12.1 `src/middleware.ts` (camada servidor / Edge)
Executado antes de renderizar qualquer página. Lê o cookie `fisiocell_token` (definido por `lib/auth.ts` após login):

- **Rotas privadas** (`/admin/*`, `/gestor/*`, `/staff/*`):
  - Sem token (ou token inválido/expirado) → redireciona para `/login?from=<rota>` (preserva a rota pretendida).
  - Token válido mas role errado (ex.: fisioterapeuta tenta aceder a `/admin`) → redireciona para o painel do role.
  - Token válido + role certo → deixa passar.
- **Rotas públicas para autenticados** (`/`, `/login`):
  - Com token válido → redireciona para o painel do role (`/admin`, `/gestor` ou `/staff`).
  - Sem token → deixa passar (mostra landing/login).
- `matcher`: `/`, `/login`, `/admin/:path*`, `/gestor/:path*`, `/staff/:path*` (ignora `_next`, `api`, estáticos).
- **Não verifica a assinatura** do JWT (seria arriscado no Edge); valida apenas formato + `exp`. A verificação real é feita pelo backend em cada pedido à API.

> **F1 — `Role` e `rotaPorRole` migrados:** o tipo `Role` no `middleware.ts` passou a `"admin" | "diretor_clinico" | "fisioterapeuta" | "rececionista"`. A função `rotaPorRole` mapeia `admin` → `/admin`, `diretor_clinico` e `rececionista` → `/gestor` (área partilhada), `fisioterapeuta` → `/staff`. A validação de rota errada permite `diretor_clinico`+`rececionista` em `/gestor/*`, só `fisioterapeuta` em `/staff/*`, só `admin` em `/admin/*`.

### 12.2 `components/auth/route-guard.tsx` (camada client-side)
Client Component aplicado nos layouts de `/admin`, `/gestor` e `/staff` (envolve o conteúdo). Segunda camada de defesa:

- Re-valida o token no client (`lerUtilizadorDoToken` — descodifica e verifica `exp`).
- Confirma que o `role` do utilizador corresponde ao role da área.
- Mostra um **spinner** enquanto valida (evita flash de conteúdo protegido).
- Se falhar → `router.replace('/login')`.

> **F1 — Aceita `Role | Role[]`:** a prop `role` do `RouteGuard` passou a aceitar um array de roles para suportar áreas partilhadas. O `gestor/layout.tsx` usa `role={["diretor_clinico", "rececionista"]}` (ambos acedem ao `/gestor/*` com permissões diferentes via `isDiretorClinico`/`isRececionista` no backend). O `admin/layout.tsx` continua a usar `role="admin"` e o `staff/layout.tsx` continua a usar `role="fisioterapeuta"` (era `"staff"`).

### 12.3 `lib/auth.ts` — token em cookie (necessário para middleware)
O token passou a ser guardado num **cookie** (`fisiocell_token`, SameSite=Lax, 7 dias) em vez de localStorage, porque o `middleware.ts` (Edge) só consegue ler cookies, não localStorage. Mantém-se localStorage como backup. Funções: `guardarToken`, `lerToken`, `removerToken`, `lerUtilizadorDoToken`, `estaAutenticado`, `rotaPorRole`.

### 12.4 Fluxo de redirecionamento pós-login
- Login com sucesso → `guardarToken(token)` (define cookie) → redirect para `?from=` (se vier de rota protegida) ou `rotaPorRole(role)`.
- `rotaPorRole` (F1): admin → `/admin`, diretor_clinico/rececionista → `/gestor` (área partilhada), fisioterapeuta → `/staff`.
- Se um utilizador autenticado aceder a `/login` ou `/` → middleware redireciona para o painel.

### 12.5 Área `/manager` (Responsável de Limpezas) — v1.6.0 (removida)
Área privada original (role `manager`) com sidebar própria. **Removida em v1.37.0** — o painel operacional passou a ser `/gestor/*` (role `gestor`) e o painel `/manager/*` foi eliminado por redundância. O conteúdo (Dashboard, Tarefas, Equipa, Pedidos de Férias, Calendário Operacional) está agora integralmente em `/gestor/*`.

---

## 13. Histórico de alterações (frontend)

> ⚠️ **F0 + F1 — Notas históricas:**
> - **F0:** As entradas abaixo anteriores a F0 descrevem a era Alojamento Local. Referências a Smoobu/webhooks/sincronização correspondem a funcionalidade **removida em F0**.
> - **F1:** As entradas entre F0 e F1 referem-se aos roles antigos `admin`/`manager`/`staff`/`gestor` e à área `/manager` (removida em v1.37.0). Em **F1** os roles foram migrados para `admin`/`diretor_clinico`/`fisioterapeuta`/`rececionista`; a área `/gestor/*` passou a ser partilhada entre `diretor_clinico` e `rececionista` (via `RouteGuard role={["diretor_clinico", "rececionista"]}`).
> - O histórico completo (incluindo commits Smoobu) está preservado no `git log`.

| Data    | Versão | Alteração                                                                       |
|---------|--------|---------------------------------------------------------------------------------|
| **F8**  | —      | **Limpeza de páginas e sidebar legacy (Tarefa/ModeloChecklist extintos):** (1) **Páginas removidas** — `/gestor/calendario` (antigo calendário de Tarefas, substituído por `/gestor/calendario-consultas` em F6), `/gestor/tarefas`, `/gestor/configuracoes/checklists`, `/gestor/webhooks`, `/admin/webhooks`, `/admin/sistema`. As antigas páginas `/admin/tarefas`, `/admin/calendario`, `/admin/calendario-operacional`, `/admin/aprovacoes`, `/admin/relatorios`, `/admin/propriedades` já tinham sido removidas em Prompt 122 (consolidação no `/admin/empresas/[id]`). (2) **Sidebar do gestor** (`components/gestor/gestor-sidebar.tsx`) — removidos os items **Calendário** (antigo, `href: /gestor/calendario`), **Tarefas** (`href: /gestor/tarefas`) e **Webhooks** (`href: /gestor/webhooks`); **renomeado** o item **Propriedades** → **Salas** (mantém `href: /gestor/propriedades` — o modelo `Propriedade` é o alias de Sala no backend); **reposto** o item **Configurações** (`href: /gestor/configuracoes`). Items finais do sidebar do gestor (12): Dashboard, Agenda Consultas, Consultas, Salas, Pacientes, Equipa, Horários, Protocolos, Ausências / Férias, Relatórios, Notificações, Configurações. (3) **Sidebar do admin** (`components/admin/admin-sidebar.tsx`) — mantém **1 item: Empresas** (já consolidado em Prompt 122). (4) **Rotas mantidas** no `/staff` — `/staff`, `/staff/ausencias`, `/staff/calendario`, `/staff/notificacoes`, `/staff/tarefas/[id]` (legacy — o backend devolve stubs via `authController.minhasTarefas`/`minhaTarefaDetalhe`/`concluirMinhaTarefa`: array vazio ou 410 Gone; preservadas para futura migração para Consultas do fisioterapeuta). (5) **`/admin/calendario`** (Client Component de Folgas e Férias) e o detalhe de tarefa (`/staff/tarefas/[id]`) — páginas marcadas como legacy (sem chamadas a `Tarefa` no backend). Lint + tsc + build ✓. |
| **F6**  | —      | **Calendário FullCalendar com Consultas:** (1) Nova página `app/gestor/calendario-consultas/page.tsx` — Client Component com **FullCalendar v6** (vistas mês/semana/dia, locale `pt`, `slotMinTime` 08:00, `slotMaxTime` 20:00, `nowIndicator`, `allDaySlot: false`) que mostra **Consultas** em vez de Tarefas; blocos com duração real (`data_hora_inicio` → `data_hora_fim`); **cores por fisioterapeuta** (`perfil_profissional.cor_calendario`, fallback por estado); **filtros** por fisioterapeuta e estado; **legenda de cores** por fisioterapeuta; **render customizado** de eventos (hora + paciente + fisio na vista semanal); **modal de detalhe** ao clicar (paciente, fisio, sala, data/hora, duração, tipo, estado, presença, nota clínica SOAP resumida S/A/Tratamento, observações). Substitui `/gestor/calendario` (Tarefas) que se mantém até F8. (2) `lib/api.ts` — `UtilizadorDTO` expandido com `perfil_profissional` (`cedula`, `especialidades`, `biografia`, `cor_calendario`, `ativo_clinico`) — necessário para a legenda de cores. (3) `components/gestor/gestor-sidebar.tsx` — novo item **Agenda Consultas** (`href: "/gestor/calendario-consultas"`, ícone `CalendarPlus`), posicionado entre **Calendário** e **Consultas**. Lint + tsc + build ✓ (rota `/gestor/calendario-consultas` = 5.36 kB). |
| **F5**  | —      | **Protocolos Clínicos + snapshot na Consulta:** (1) Nova página `app/gestor/protocolos/page.tsx` — Client Component com lista de cartões (nome/área/secções/items/estado ativo), **filtro por área clínica** (`musculoesqueletica`/`neurologica`/`cardioresp`/`desporto`/`pediatria`/`outro`), e modal criar/editar (`Dialog`) com **secções e items dinâmicos** (botões "Adicionar Secção"/"Adicionar Item" + remover por secção/item). Toggle Ativo/Inativo (`adminPut`) e hard delete (`adminDelete`, só diretor_clinico/admin). (2) `lib/api.ts` — novos tipos `AreaProtocolo`, `ModeloProtocoloDTO`, `ProtocoloListResponse` (espelham o modelo `ModeloProtocolo` do backend; `seccoes` é `{ nome, items: string[] }[]` no template). (3) `components/gestor/gestor-sidebar.tsx` — novo item **Protocolos** (`href: "/gestor/protocolos"`, ícone `Stethoscope` do `lucide-react`). (4) Integração com a Consulta — o `protocolo_id` selecionado no modal de marcação é enviado no `POST /api/gestor/consultas` (o backend gera snapshot imutável); o fisioterapeuta marca items `concluido` via `PATCH /:id/nota-clinica` com `protocolo_aplicado`. Lint + tsc + build ✓ (rota `/gestor/protocolos` = 3.46 kB). |
| **F4**  | —      | **Consultas + validação de conflitos + cédula:** (1) Nova página `app/gestor/consultas/page.tsx` — Client Component com lista de cartões (paciente/fisio/sala/data/estado/tipo/indicador SOAP), modal criar/editar (`Dialog`) com **validação de conflitos em tempo real** (debounce 400ms, mostra warnings do `GET /validar`), modal de detalhe com nota clínica SOAP editável (S/O/A/P + tratamento_efetuado) submetida via `PATCH /:id/nota-clinica` (endpoint separado, só `isClinico`), e ações rápidas Confirmar/Concluir/Eliminar. Soft block: 409 do backend abre modal "Forçar Agendamento?" que reenvia com `forcar: true`. (2) `lib/api.ts` — novos tipos `EstadoConsulta`, `TipoConsulta`, `ConsultaDTO`, `ConsultaListResponse`, `ValidarConflitosResponse` (espelham o modelo `Consulta` + resposta do verificador de conflitos do backend). (3) `components/gestor/gestor-sidebar.tsx` — novo item **Consultas** (`href: "/gestor/consultas"`, ícone `CalendarPlus` do `lucide-react`), posicionado entre **Calendário** e **Tarefas**. Lint + tsc + build ✓ (rota `/gestor/consultas` = 5.6 kB). |
| **F3**  | —      | **Horários de Fisioterapeuta:** (1) Nova página `app/gestor/equipa/horarios/page.tsx` — Client Component com verificador de disponibilidade (fisio + data + hora + duração → resultado `DisponibilidadeResponse`), lista agrupada por fisioterapeuta com badges `recorrente`/`excecao`, janelas de trabalho, notas, modal criar/editar (`Dialog`) com tipo recorrente/excecao (dia_semana/data, horas, disponivel, nota), e hard delete (`adminDelete`, só diretor_clinico/admin). (2) `lib/api.ts` — novos tipos `HorarioFisioterapeutaDTO`, `HorarioListResponse`, `DisponibilidadeResponse` (espelham o modelo `HorarioFisioterapeuta` + resposta do verificador do backend). (3) `components/gestor/gestor-sidebar.tsx` — novo item **Horários** (`href: "/gestor/equipa/horarios"`, ícone `Clock` do `lucide-react`), posicionado entre Equipa e Ausências / Férias. Lint + tsc + build ✓ (rota `/gestor/equipa/horarios` = 4.35 kB). |
| **F2**  | —      | **Pacientes:** (1) Nova página `app/gestor/pacientes/page.tsx` — Client Component com grid de cartões, busca server-side (`?busca=`), modal criar/editar (`Dialog`), modal de detalhe, toggle de estado (`adminPatch`), soft delete (`adminDelete`, só diretor_clinico/admin). Campos clínicos visíveis/editáveis apenas quando `dados_clinicos === true` (isClinico). (2) `lib/api.ts` — novos tipos `PacienteDTO` e `PacienteListResponse` (campos clínicos opcionais, espelham a sanitização do backend). (3) `components/gestor/gestor-sidebar.tsx` — novo item **Pacientes** (`href: "/gestor/pacientes"`, ícone `UserRound` do `lucide-react`), posicionado entre Propriedades e Equipa. Lint + tsc + build ✓. |
| **F1**  | —      | **Migração de roles (Fisioterapia):** (1) `middleware.ts` — tipo `Role` atualizado para `"admin" \| "diretor_clinico" \| "fisioterapeuta" \| "rececionista"`; `rotaPorRole` mapeia `rececionista` → `/gestor` (partilhado); validação de rota errada aceita `diretor_clinico`+`rececionista` em `/gestor/*`. (2) `lib/auth.ts` + `lib/api.ts` — tipo `Role` atualizado. (3) `components/auth/route-guard.tsx` — prop `role` passou a aceitar `Role \| Role[]` para suportar áreas partilhadas. (4) `app/gestor/layout.tsx` — `RouteGuard role={["diretor_clinico", "rececionista"]}`. (5) `app/gestor/equipa/page.tsx` — `ROLE_LABEL` e `ROLE_VARIANT` atualizados (Diretor Clínico/Fisioterapeuta/Rececionista); formulário de criar/editar usa `role: "fisioterapeuta"` por defeito. (6) `app/admin/page.tsx` — labels de role no modal de utilizadores (`diretor_clinico` → "Diretor Clínico", `fisioterapeuta` → "Fisioterapeuta", `rececionista` → "Rececionista"); botão "Criar Novo Gestor" passa a criar com `role: "diretor_clinico"`. Lint + tsc + build ✓. |
| Inicial | 1.0.0  | Scaffold Next.js 14 + TS + Tailwind + shadcn; rotas `/admin` (sidebar + dashboard + placeholders) e `/staff` (mobile-first com cartões de tarefas); mock data. Build validado. |
| v1.1.0  | 1.1.0  | Ecrã de Detalhe da Tarefa (`/staff/tarefas/[id]`): checklist interativa gerada de array, textarea de observações, botão "Concluir Tarefa" desativado até todas as checkboxes marcadas (React State). Componentes UI Checkbox e Textarea. TaskCard agora abre o detalhe via Link. |
| v1.1.1  | 1.1.1  | Fix deploy Vercel: adicionado `vercel.json` (`"framework": "nextjs"`) para forçar a deteção do framework e evitar o erro `No Output Directory named "public"`. Documentação de deploy atualizada com definições obrigatórias (Root Directory = `frontend`, Framework Preset = Next.js). |
| v1.2.0  | 1.2.0  | Integração com a API real na secção Propriedades: `lib/api.ts` (helpers `adminGet`/`adminPost` + `EMPRESA_ID` placeholder via header `x-empresa-id`); `/admin/propriedades` convertido em Client Component com `useEffect` (GET), tabela HTML (Nome, Smoobu ID, Tempo, Estado) e formulário inline de criação (POST + refresh automático). Componente UI `Input`. Mock-data abandonado nesta secção. |
| v1.2.1  | 1.2.1  | `EMPRESA_ID` preenchido com o ID real do “Cliente Zero” (`6a400c9009e37b27fe0bc362`) devolvido por `GET /api/admin/setup`. Placeholder `COLA_AQUI_O_ID` removido. |
| v1.3.0  | 1.3.0  | **Rebranding Premium:** primary mudada de emerald-600 → Azul Marinho Premium (`blue-950`); `--radius` reduzido de `0.5rem` → `0.3rem` (visual "sharp"); `Card` e `Button` com `shadow-sm` + borders hairline (`border-border/60`); landing page reescrita (gradiente verde removido, fundo limpo com padrão de pontos, tipografia `font-light`/`font-semibold`, cartões com elevação no hover `hover:-translate-y-0.5`). |
| v1.4.0  | 1.4.0  | **Autenticação JWT:** `lib/auth.ts` (guardar/ler/remover token + descodificar payload + `rotaPorRole`); `lib/api.ts` atualizado para enviar `Authorization: Bearer <token>` (com fallback legacy `x-empresa-id` e limpeza de token em `401`); nova rota `/login` (ecrã minimalista premium, `POST /api/auth/login`, redirect admin→`/admin` / staff→`/staff`). |
| v1.5.0  | 1.5.0  | **Proteção de rotas + landing simplificada:** `middleware.ts` (Edge) protege `/admin/**` e `/staff/**` (sem token → `/login?from=`), redireciona autenticados de `/` e `/login`, e valida role por área; `lib/auth.ts` passou a guardar token em **cookie** (middleware lê) em vez de localStorage; `components/auth/route-guard.tsx` (2ª camada client-side) aplicado nos layouts admin/staff; landing page simplificada (removidos cartões Admin/Staff, 1 botão 'Entrar na Plataforma' → `/login`); `/login` lê `?from=` e redireciona autenticados via `useEffect`. |
| v1.6.0  | 1.6.0  | **Novo role `manager` (Responsável de Limpezas):** tipo `Role = admin \| manager \| staff` em `lib/auth.ts`, `lib/api.ts`, `middleware.ts`, `route-guard.tsx`; `rotaPorRole` atualizada (manager → `/manager`); nova área `/manager` (layout + `manager-sidebar.tsx` + dashboard com tarefas + equipa + placeholders `/manager/tarefas` e `/manager/equipa`); `middleware.ts` protege `/manager/**`; `mock-data` atualizado com role manager + membro manager na equipa; dashboard admin inclui managers na equipa operacional. |
| v1.7.0  | 1.7.0  | **Rebranding Premium Dourado:** primary mudada de azul marinho (`blue-950`) → Dourado/Areia (`hsl(43 74% 49%)`); `--radius` reduzido de `0.3rem` → `0.25rem` (ainda mais "afiado"); `--muted`/`--secondary`/`--accent` = `210 40% 96%` (cinza super suave); `--border`/`--input` = `214.3 31.8% 91.4%`; dark mode luxuoso (fundo escuro + dourado brilhante `43 74% 55%`); `Button` default: removido `hover:shadow-md` (visual flat); landing page: botão maior e elegante (`h-12 px-10 tracking-wide`). Inspirado em All2Gether. |
| v1.8.0  | 1.8.0  | **Gestão de Equipa (`/admin/equipa`):** convertido em Client Component — `useEffect` chama `GET /api/admin/equipa` (JWT); tabela HTML (Nome, Email, Role com Badge, Estado); botão "Adicionar Funcionário" abre formulário inline (Nome, Email, Password, Role select); `POST /api/admin/equipa` cria utilizador (bcrypt no backend), limpa formulário e atualiza tabela. Tipo `UtilizadorDTO` + `Role` em `lib/api.ts`. |
| v1.9.0  | 1.9.0  | **CRUD completo de Utilizadores (`/admin/equipa`):** coluna "Ações" com 3 botões por linha — Editar (✏️ abre modal Dialog com Nome/Email/Role/Nova Password opcional → `PUT`), Ativar/Desativar (⏻ → `PATCH /:id/estado` com otimismo), Eliminar (🗑️ abre modal de confirmação → `DELETE`). Helpers `adminPut`/`adminPatch`/`adminDelete` em `lib/api.ts`. Componente `Dialog` (shadcn, sem Radix) em `components/ui/dialog.tsx`. |
| v1.10.0 | 1.10.0 | **Segurança hierárquica + Responsável:** `UtilizadorDTO` com `responsavel_id` + `responsavel` (populado); dropdown de Role nos formulários de criar/editar **sem opção Admin** (só Staff/Responsável); novo select **Responsável** populado com utilizadores admin+manager (exclui o próprio utilizador na edição); nova coluna **Responsável** na tabela; linhas de admin são **só de leitura** (botões Editar/Ativar/Eliminar escondidos, mostram "—"). Reflete regras 403 do backend. |
| v1.11.0 | 1.11.0 | **Calendário de Folgas e Férias (`/admin/calendario`):** convertido em Client Component — formulário "Marcar Ausência" (Funcionário select, Data Início/Fim, Tipo Folga/Férias, Notas) → `POST /api/admin/ausencias`; tabela de ausências (Funcionário, Tipo com Badge+ícone, Período formatado pt-PT, Notas, Eliminar); botão 🗑️ com otimismo. Tipo `AusenciaDTO` + `TipoAusencia` em `lib/api.ts`. Ausências integram com o webhook (excluem staff da atribuição automática). |
| v1.12.0 | 1.12.0 | **Remoção do fallback legacy `x-empresa-id`:** `lib/api.ts` — removida constante `EMPRESA_ID` e fallback `x-empresa-id` do `adminHeaders`. Agora envia **apenas** `Authorization: Bearer <token>` se houver token; sem token, não envia header (backend devolve 401). Comentário em `propriedades/page.tsx` atualizado. Alinha com o backend v1.10.0 (middleware auth estrito). |
| v1.13.0 | 1.13.0 | **Cookie seguro (anti-XSS):** `lib/auth.ts` — cookie com `SameSite=Strict` (anti-CSRF) + `Secure` (apenas HTTPS); `localStorage` **completamente removido** (era vulnerável a XSS — script injetado conseguiria ler o token). Token vive agora **exclusivamente** no cookie. `guardarToken`/`removerToken` operam apenas o cookie. `deleteCookie` atualizado com mesmas flags para garantir sobreposição. |
| Prompt 95 | — | **Ecrã de Férias/Ausências + Staff Preferencial + Detalhes da Reserva (Fase 1.5):** (1) `/gestor/ausencias` deixou de ser redirect e passou a **tabela definitiva** com TODAS as ausências da empresa (sem filtros de estado): colunas Funcionário, Tipo (ícone), Período, Estado (Badge), Notas, Ações (Eliminar com modal de confirmação → `DELETE /api/gestor/ausencias/:id` com otimismo). O menu lateral já apontava para `/gestor/ausencias` (mantido). (2) `/gestor/propriedades` modal de Editar: novo **select de Funcionário Preferencial** (carrega staff ativo via `GET /api/gestor/equipa`, filtra `role==='staff'`); grava via `PUT /api/gestor/propriedades/:id` com `funcionario_preferencial_id` (string vazia → null). `PropriedadeDTO` + `TarefaMock` atualizados em `lib/api.ts` com `funcionario_preferencial_id` e `detalhes_reserva`. (3) Novo componente partilhado `components/detalhes-reserva-card.tsx` — Card de destaque com Check-in, Check-out, Hóspedes (pax) e Nome do Hóspede; só renderiza se `detalhes_reserva` existir. Usado em: `components/staff/detalhe-tarefa-client.tsx` (topo do detalhe da tarefa no mobile do staff) e novo `components/gestor/detalhe-tarefa-modal.tsx` (modal aberto via botão Eye na tabela de tarefas do gestor, mostra propriedade/tipo/estado/data/staff/observações/avarias + o card de detalhes_reserva). Build + lint + tsc ✓. |
| Ajuste | — | **Ocultar staff indisponíveis do dropdown de atribuição:** o modal "Atribuir Tarefa" (`/gestor/tarefas`) e o modal de reatribuição do Calendário (`/gestor/calendario`) deixaram de mostrar os staff indisponíveis (férias/doença/ausência nesse dia) como `<option disabled>` e passam a **omitir** da lista via `.filter(u => !indisponiveis.some(i => i.utilizador_id === u._id))`. A lista só contém quem pode realmente receber a tarefa. O aviso amarelo abaixo do select foi atualizado de "não podem receber tarefas" para "foram omitidos da lista". Antes (v1.59.0/Prompt 81) os indisponíveis apareciam a cinzento/desativados; agora não aparecem. Build + lint + tsc ✓. |
| Prompt 99 | — | **Ecrã de Relatório no Calendário — Vista Tabela + Exportar Excel:** `/gestor/calendario` ganhou um **Toggle de vistas** no cabeçalho (Vista Calendário / Vista Tabela) e um botão **Exportar Excel**. (1) **Toggle:** `vista: "calendario" \| "tabela"` — quando "tabela" está ativo, o FullCalendar é escondido e mostra-se uma Data Table com as tarefas do período/filtros selecionados (excluindo ausências/folgas que só fazem sentido no calendário), ordenadas por data crescente. Colunas: Data (DD/MM/YYYY), Propriedade, Reserva (`In: [checkin] Out: [checkout] - [pax] pax` via `detalhes_reserva`), Funcionário (nome ou "Por Atribuir" a amarelo), Horário (`HH:mm - HH:mm`), Estado (Badge colorido: por_atribuir=destructive, atribuida=default, em_curso=warning, concluida=success, cancelada=outline). Clicar numa linha abre o modal de detalhe existente. (2) **Exportar Excel:** botão que instala a lib `xlsx` (^0.18.5); ao clicar, constrói um Workbook com `XLSX.utils.json_to_sheet` (colunas Data/Propriedade/Reserva/Funcionário/Horário/Estado, larguras definidas via `!cols`) e faz `XLSX.writeFile(wb, "Relatorio_Limpezas.xlsx")`. `xlsx` importado dinamicamente (`await import("xlsx")`) para não entrar no bundle inicial. Todos os campos vão como texto (datas DD/MM/YYYY) — o Excel interpreta como texto. Interface `TarefaCalendario` alargada com `detalhes_reserva`. Build + lint + tsc ✓. |
| Prompt 100 | — | **Garantir os Dados do Excel (robustez):** (1) Novo helper `formatarReservaExcel` (variante do `formatarReserva`) que devolve **string vazia** quando a tarefa não tem `detalhes_reserva` (ex: manutenção) — a célula do Excel fica em branco em vez de "—". Os sub-campos em falta (checkin/checkout/pax) também ficam vazios; se nenhum estiver preenchido, devolve vazio (não "In:  Out:  - "). A `exportarExcel` passou a usar `formatarReservaExcel` e a deixar em branco Propriedade/Horário em falta. (2) `ESTADO_LABEL_TAB` atualizado: `em_curso` passa a "Em Curso" (C maiúsculo, capitalização de título) para corresponder ao pedido do prompt; restantes estados já estavam traduzidos (Por Atribuir, Atribuída, Concluída, Cancelada). Backend: confirmado via 2 novos testes que o `GET /api/gestor/calendario/dados` já devolve `detalhes_reserva` (usa `.lean()` sem `.select()`). Build + lint + tsc ✓; backend 125/125 ✓. |
| Prompt 101 | — | **Controlo de Utilizadores no Painel de Admin (Fullstack):** `/admin` ganhou um botão **"Gerir Utilizadores"** (ícone Users) por cada empresa na tabela. Ao clicar, abre um **modal** que lista todos os utilizadores (gestores + staff) dessa empresa via `GET /api/admin/empresas/:empresaId/utilizadores` (proxy route). Tabela com colunas Nome, Email, Role (Badge Gestor/Staff), Estado (Badge Ativo/Inativo) e um botão **Ativar/Desativar** (ícone Power) que faz `PATCH .../utilizadores/:id/estado` com otimismo. Botão **"Criar Novo Gestor"** no fundo do modal abre um mini-formulário (Nome, Email, Password) que faz `POST .../utilizadores` com `role: 'gestor'` — para empresas que ficaram com 0 gestores. Novos proxy routes: `api/admin/empresas/[empresaId]/utilizadores/route.ts` (GET+POST) e `api/admin/empresas/[empresaId]/utilizadores/[utilizadorId]/estado/route.ts` (PATCH). Tipo `UtilizadorEmpresaDTO`. Build + lint + tsc ✓. |
| Prompt 113 | — | **Mega Prompt de Correção (Alpha):** (1) **Loop 401 + Layouts** — `lib/auth.ts` `lerUtilizador()` deixou de fazer `window.location.href=/login` como side-effect em 401 (era pura, devolve `null`); adicionado cache **in-flight** (callers paralelos partilham a mesma Promise → 1 fetch em vez de N). `components/auth/route-guard.tsx` — redirect único com flag `redirecionado`; trata role errado (→ painel certo). `gestor/layout.tsx` continua com `AdminSidebar mode="gestor"` (nunca mostra menu de admin). (2) **Banner de impersonação** — novo client component `components/gestor/impersonation-banner.tsx` (lê `sessionStorage` em `useEffect`, evita problemas de hidratação); botão **VERMELHO "Voltar a Admin"** que chama `POST /api/auth/exit-impersonation` (restaura cookie de admin guardado), limpa `sessionStorage` e vai para `/admin`. `api/admin/impersonar/[id]/route.ts` guarda o token de admin num cookie separado `fisiocell_admin_token` antes de o substituir; novo `api/auth/exit-impersonation/route.ts` troca de volta; `login` e `logout` limpam o cookie de backup. (3) **Cockpit Admin limpo** — `/admin/sistema` reescrito: removidas as tabs e todas as opções de Smoobu/Sincronizações/Webhooks/Configuração (nome empresa + API key); fica só Forçar Cron Jobs globais + Push de teste + Hard Reset, com um aviso a apontar para `/gestor/configuracoes`. (4) **Calendário + timezone** — botão **"Nova Tarefa"** no cabeçalho de `/gestor/calendario` abre um modal de criação (Propriedade, Data, Tempo, Tipo, Staff opcional). Helpers novos em `lib/utils.ts`: `paraIsoMeiaNoiteLocal("YYYY-MM-DD")` (envia meia-noite LOCAL como ISO) e `temHoraReal(iso)` (hora local ≥ 8). Tarefas sem hora real (criadas só com data) são renderizadas como **all-day** no FullCalendar (visíveis na faixa all-day das vistas semanal/diária em vez de invisíveis abaixo do slotMinTime 08:00); na Vista Tabela, o horário mostra "—". `tarefas/page.tsx` e o novo modal do calendário enviam `paraIsoMeiaNoiteLocal(form.data)`. (5) **Bloqueio de tarefa concluída** — `components/staff/detalhe-tarefa-client.tsx`: se `tarefa.estado === "concluida"`, desativa checkboxes (`disabled`), textarea, e esconde botões Concluir/Atraso/Avaria (mostra banner "Concluída"); pré-marca todos os itens. Modal do calendário: botão "Reatribuir" e dropdown de staff `disabled` quando concluída. (6) `/gestor/propriedades` ganhou botão **"Checklist Padrão"** (ícone ListChecks) que aplica o checklist padrão a todas as propriedades via `POST /api/gestor/propriedades/default-checklist` (com `confirm`). Build + lint + tsc ✓; backend 136/136 ✓. |
| Prompt 114 | — | **Notificações In-App, Bugs Alpha e Lógica de Distâncias (frontend):** (1) **Push Notifications** — `components/staff/push-notification-setup.tsx` (re-exportado em `components/gestor/`) já faz `pushManager.subscribe` + `POST /api/auth/me/push-subscribe` (via catch-all proxy). Confirmado funcional. (2) **Centro de Notificações (O Sino)** — novo `components/notification-bell.tsx`: ícone Bell com badge vermelho (count de não-lidas), dropdown com lista, polling a 30s, marca todas como lidas ao abrir (`PATCH /marcar-lidas`). Renderizado no header do `GestorSidebar` (desktop + mobile) e no header do `/staff` (ao lado do logout). Usa `/api/auth/me/notificacoes/*` (via catch-all proxy). (3) **Isolamento Menu Admin** — `/gestor/layout.tsx` deixou de importar `AdminSidebar` (partilhado). Novo `components/gestor/gestor-sidebar.tsx` dedicado (não importa nada de admin); o layout usa-o. Itens: Dashboard, Propriedades, Tarefas, Equipa, Ausências, Calendário, Relatórios, Webhooks, Configurações + Sino + Tema + Logout. (4) **Staff ativo** — `/gestor/tarefas/page.tsx` e `/gestor/calendario/page.tsx` filtram `u.role === "staff" && u.ativo === true` (antes só role). (5) **Capacidade destacada** — `TarefaMock` (lib/api.ts) + `TarefaDetalheGestor` ganham `capacidade_hospedes`. `components/gestor/detalhe-tarefa-modal.tsx` e `components/staff/detalhe-tarefa-client.tsx` mostram badge âmbar "Lotação máxima: N hóspede(s)" (ícone Users). `/staff/tarefas/[id]/page.tsx` passa `capacidade_hospedes` do populate. (6) **Toasts de warning** — `/gestor/propriedades/page.tsx` (geocoding falhou ao criar/editar), `/gestor/tarefas/page.tsx` (distância >15km ao criar/atribuir) e `/gestor/calendario/page.tsx` (distância ao criar/reatribuir) capturam `res.warning` e mostram Card âmbar (`border-amber-500/50 bg-amber-50`). Lint + tsc + build ✓; backend 143/143 ✓. |
| Prompt 115 | — | **Separação ABSOLUTA de menus/layouts + fix loop 401 (frontend):** (1) `components/gestor/gestor-sidebar.tsx` reescrito como componente **dedicado** — `gestorNavItems` com APENAS 8 items operacionais (Dashboard, Calendário, Tarefas, Propriedades, Equipa, Ausências, Relatórios, Configurações); brand label "Gestor"; **nenhum** link para Sistema/Empresas/Admin. (2) `components/admin-sidebar.tsx` reescrito **sem `mode` prop** e sem `gestorNavItems` partilhado — `adminNavItems` com APENAS 3 items (Empresas, Sistema/Webhooks, Webhooks); componente dedicado, não importa nada do gestor. (3) `admin/layout.tsx` usa `<AdminSidebar />` (sem `mode`); `gestor/layout.tsx` usa `<GestorSidebar />` — ambos importam EXCLUSIVAMENTE o seu sidebar. (4) `components/auth/route-guard.tsx` reescrito: em 401 faz `limparCacheAuth()` + `fazerLogout()` (POST `/api/auth/logout`) + `window.location.href = "/login"` (redirect HARD) em vez de `router.replace` (soft); sem retry em 401; role errado → redirect HARD para o painel certo. Elimina o re-mount/re-fetch em cascata do loop 401. Lint ✓ · tsc ✓ · build ✓ (middleware 26.8kB). |
| Prompt 116 | — | **Fundação SaaS (frontend):** (1) `/admin` ganhou gestões de empresa — tabela de empresas com botões para criar, ativar/suspender (`PATCH .../toggle-status`) e hard-reset scoped (`POST .../hard-reset`). (2) Isolamento visual admin vs gestor consolidado (a separação ABSOLUTA do Prompt 115 garante que o gestor não vê nada de admin). (3) Modal "Nova Tarefa" (`/gestor/tarefas` + `/gestor/calendario`) alargado com campos de `hora`, `check_in`, `check_out` e `hospedes` (nome + nº) que populam `detalhes_reserva`. (4) `Propriedade.observacoes` editável no formulário de propriedade. |
| Prompt 117 | — | **Remodelar UI/UX — isolar Super Admin do Gestor:** (1) Nova **gaveta da empresa** em `/admin/empresas/[id]` — página de gestão dedicada por empresa com botões **Apagar** (`DELETE .../empresas/:id`), **Suspender/Ativar** (`PATCH .../toggle-status`) e **Gerir Config** (abre secção com nome, NIF, API key Smoobu via `GET/PUT .../config`). (2) **Geocoding warning inline** — ao criar/editar propriedade, se o Nominatim falhar, mostra aviso âmbar inline no formulário (em vez de toast solto) a aconselhar simplificar a morada. (3) **Nova Tarefa com hora/hóspedes** — modal de criação alargado (hora, check-in/out, nome + nº de hóspedes → `detalhes_reserva`). Lint + tsc + build ✓. |
| Prompt 118 | — | **UX Staff, Notificações e Exportação PDF:** (1) **Staff dashboard agrupado por dia** — `/staff` reorganizado: tarefas agrupadas por data (hoje, amanhã, ...) em vez de lista única. (2) Labels passaram a **"Nº Hóspedes"** e **"Nome Hóspede"**; **Data da Limpeza** destacada no topo de cada cartão. (3) `components/notification-bell.tsx` com `max-h-[80vh]` e scroll interno (lista longa não estoura o viewport). (4) Push notifications passaram a mostrar **feedback de sucesso/erro** ao subscrever (toast). (5) **Exportar PDF** — novo botão "Exportar PDF" no `/staff` e no relatório do gestor que usa `window.print()` (estilos `@media print` dedicados) para gerar PDF via o diálogo de impressão do browser. |
| Prompt Extra | — | **Vacina Anti-Safari (parsing de datas iOS/Safari):** novos helpers em `lib/utils.ts`: **`parsearDataSegura(valor)`** (aceita `YYYY-MM-DD`, `DD/MM/YYYY`, ISO com/sem timezone; devolve `Date` válido ou `null` — robusto ao parser do Safari que devolve `Invalid Date` em formatos não-ISO) e **`extrairHoraISO(iso)`** (extrai `HH:mm` de uma string ISO sem depender de `new Date()` — evita o shift de fuso do Safari). Substituídas todas as construções `new Date("YYYY-MM-DD")` e formatações baseadas em `Date` nos componentes de staff/gestor pelos helpers seguros. Resolveu datas a aparecer como `Invalid Date` / `NaN/NaN/NaN` no iOS Safari. |
| Prompt 119 | — | **Resiliência PWA (Service Worker):** `next-pwa` configurado com `skipWaiting: true` + `clientsClaim: true` (nova versão do SW assume o controlo imediatamente). **Runtime caching** com estratégia `NetworkFirst` para os chunks JS (`/_next/static/chunks/`) — fallback para cache se a rede falhar (mitiga `ChunkLoadError`). **Handler global de `ChunkLoadError`** no cliente que faz reload limpo (uma só vez) + limpeza de caches antigos do SW ao ativar. Resolveu ecrã branco em produção após deploy com chunks obsoletos em cache. |
| Prompt 120 | — | **Remover loop de reload + fix hidratação de datas:** (1) **Remoção do Script agressivo** — o handler de `ChunkLoadError` do Prompt 119 estava a entrar em loop de reload (recarregava indefinidamente se o chunk continuasse a falhar). Substituído por um guard com `sessionStorage` (só tenta reload 1x por sessão) e remoção do `window.location.reload` em cascata. (2) **`mounted` guard na staff page** — `/staff/page.tsx` passou a verificar se o componente ainda está montado (`isMountedRef`) antes de fazer `setState` após fetch assíncrono (evita warnings de hidratação e updates em componentes desmontados). Fix de datas trocadas na hidratação inicial (server vs client). |
| Prompt 121 | — | **Reposição de fábrica do layout + next.config minimalista:** (1) **Reposição de fábrica do layout** — revertidos overrides CSS agressivos que causavam inconsistências visuais (reset do `globals.css` ao estado base do Tailwind/shadcn); removidos estilos experimentais acumulados. (2) `next.config.mjs` **minimalista** — removidas configurações experimentais de PWA/webpack que conflituavam com o `next-pwa`; mantido apenas o estritamente necessário (`next-pwa` wrapper + `reactStrictMode`). Estabilizou o build em produção. |
| Prompt 122 | — | **Limpeza Admin + Soft Delete (Lixeira de Empresas) — frontend:** (1) `/admin` ganhou **Tabs "Ativas" / "Reciclagem"** — a tab Reciclagem lista empresas eliminadas (`apagada: true`) com botão "Restaurar" (`PATCH .../restaurar`). A tab Ativas lista as empresas ativas (`apagada: false`) com botão "Apagar" (`DELETE .../empresas/:id` soft delete). (2) `AdminSidebar` simplificado para mostrar **só Empresas** (Webhooks passou para dentro da gaveta da empresa `/admin/empresas/[id]`). (3) A gaveta da empresa integra agora as ações de Smoobu (sincronizar-propriedades, sincronizar-reservas, registrar-webhooks) via os novos endpoints de Super Admin. |
| Prompt 123 | — | **Soft block de conflitos (frontend):** `/gestor/tarefas/page.tsx` (criar + atribuir) e `/gestor/calendario/page.tsx` (criar + reatribuir) passaram a capturar `res.warning` de sobreposição horária (que agora vem como `200` em vez de `409`) e mostrar Card âmbar com o **tempo de viagem** estimado. O warning é **não-bloqueante** — o gestor pode prosseguir. `Propriedade.observacoes` exposto no detalhe de tarefa (`detalhe-tarefa-modal.tsx` + `detalhe-tarefa-client.tsx`). |
| Prompt 124 | — | **Interface móvel, navegação dias, relatório IA, CSS sino:** (1) **Staff navegação por dias** — `/staff` ganhou setas ‹ › para navegar entre dias (hoje ←/→ amanhã, ontem, etc.) em vez de mostrar só o dia atual. (2) **IA resumo exportável como PDF** — botão "Exportar PDF" no `/gestor/relatorios` que consome `POST /api/gestor/relatorios/ai-summary` e gera PDF via `html2pdf.js`. (3) **CSS sino mobile** — `NotificationBell` redesenhado para mobile (dropdown full-width, posicionamento fixo, z-index corrigido para não ficar por baixo de modais). (4) **Task-card morada** — cartões de tarefa do staff passaram a mostrar a morada da propriedade (antes só o nome). |
| Prompt 125 | — | **Gemini SDK, fuso manutenção local, soft block, observacoes Propriedade (frontend):** o resumo IA (`/gestor/relatorios`) passou a usar o endpoint consolidado com Gemini SDK. `Propriedade.observacoes` passível de edição no formulário de `/gestor/propriedades`. Soft block de conflitos (warning não-bloqueante) mantido nas páginas de tarefas e calendário. |
| Prompt 126 | — | **UX logística, PDF fix, frontend responsivo, notificações:** (1) **Double-check logístico** — ao criar tarefa sobreposta, modal de confirmação com botões **"Forçar Agendamento"** (ignora o warning de conflito) e **"Confirmar Morada"** (re-confirma a morada antes de agendar — previne tarefas com morada errada). (2) PDF do relatório IA com **delay** para garantir renderização completa do `html2pdf` antes do download. (3) **Logs Smoobu** — `/gestor/webhooks` melhorado (tabela de logs com filtros por status, payload expandível). (4) Nova página **`/gestor/notificacoes`** — vista full-page do centro de notificações (além do sino dropdown). (5) Frontend responsivo: ajustes de breakpoints em tabelas e modais para tablet/mobile. |
| Prompt 127 | — | **Fix timezone (time shift), AlertDialog cancelar, loading relatório:** (1) **Fix timezone (time shift)** — `extrairHoraISO` (em `lib/utils.ts`) reescrito para **não usar `new Date()`** (que aplicava fuso e deslocava a hora mostrada). Agora faz parse direto da string ISO (`"YYYY-MM-DDTHH:mm"`) — a hora exibida é a armazenada, sem shift. Resolveu tarefas a aparecerem 1h adiantadas/atrasadas. (2) **AlertDialog "Cancelar"** — modais de confirmação (eliminar, suspender) passaram a usar `AlertDialog` (shadcn) com botão explícito "Cancelar" que fecha sem ação (antes um clique fora podia confirmar). (3) **Loading do relatório IA** — spinner visível durante a geração do resumo (impede duplo-click). |
| Prompt 128 | — | **Blindagem backend (frontend sem alterações diretas):** o fix de fuso Portugal e a blindagem do Gemini foram no backend. O frontend beneficiou-se indiretamente (resumo IA nunca devolve 500 — fallback gracioso). Sem alterações de código frontend. |
| Prompt 129 | — | **Fix calendário timezone + SW não interceta /api/ (frontend):** (1) **Calendário timezone** — eventos do FullCalendar passam a ser construídos com **strings locais sem sufixo `Z`** (`"YYYY-MM-DDTHH:mm:ss"`) em vez de ISO UTC (`...Z`) — o calendar interpreta como hora local e não aplica conversão de fuso. Resolveu eventos a aparecerem no dia/hora errada em fusos não-UTC. (2) **SW `publicExcludes /api/`** — o Service Worker (runtime caching) configurado para **não interceta** pedidos a `/api/` (passa sempre à rede). Antes, o `NetworkFirst` podia servir respostas cached obsoletas da API (ex.: notificações, tarefas). Garantia de dados sempre frescos do backend. |
| Prompt 130 | — | **Fix definitivo ausências (frontend sem alterações diretas):** o fix do `staffController.criarAusencia` (filtro de estado) e a remoção do índice único MongoDB foram no backend. O frontend deixou de receber `409` ao criar ausências sobrepostas — o pedido passa a `201`. Sem alterações de código frontend. |
| Prompt 131 | — | **Staff notificacoes + nome_hospede + dias anteriores (frontend):** (1) Nova página **`/staff/notificacoes`** — vista full-page do centro de notificações do staff (além do sino dropdown no header); consome `/api/auth/me/notificacoes/*`. (2) **`nome_hospede`** exibido nos cartões de tarefa do `/staff` e no detalhe (`detalhe-tarefa-client.tsx`), populado a partir de `detalhes_reserva.nome_hospede`. (3) **Dias anteriores (30 dias)** — `/staff` passou a permitir navegar não só para a frente mas também **até 30 dias para trás** (histórico de tarefas concluídas) via as setas ‹ ›, além dos dias futuros. |
| Prompt 132 | — | **Cancelamento de ausências (frontend):** o botão "Cancelar" nas ausências passou a fazer `PATCH /api/staff/ausencias/:id/cancelar` (soft cancel — mantém o histórico, marca `estado: 'cancelada'`) em vez de `DELETE` (que apagava o registo). Aplica-se tanto ao `/staff/ausencias` como ao `/gestor/ausencias`. |
| Prompt 133 | — | **Arquitetura de checklists dinâmicas (frontend sem alterações diretas):** o modelo `ModeloChecklist` foi criado no backend (template com secções/items). O frontend beneficiou-se via injeção on-the-fly no `minhaTarefaDetalhe` — o staff vê a checklist da propriedade mesmo em tarefas antigas sem snapshot. |
| Prompt 134 | — | **Ecrãs de configuração e interface do staff (frontend):** (1) Nova página **`/gestor/configuracoes/checklists`** — CRUD completo de modelos de checklist (criar/editar/eliminar modelos com secções e items dinâmicos). (2) Select de `modelo_checklist_id` no formulário de `/gestor/propriedades` (associa um modelo a cada propriedade). (3) `detalhe-tarefa-client.tsx` renderiza a `checklist_dinamica` por secções (em vez da checklist flat legacy), com bloqueio do botão "Concluir" até 100% dos items marcados. |
| Prompt 135 | — | **Injeção das checklists via seed (frontend sem alterações diretas):** o script `seedChecklists.js` cria 2 modelos base (Limpeza Standard + Detalhada V2) e associa-os às propriedades. O frontend mostra o botão "Correr Seed de Checklists" na gaveta da empresa (`/admin/empresas/[id]`) que faz `POST /api/admin/empresas/:id/seed-checklists`. |
| Prompt 136 | — | **Fix PDF sempre visível + abandono do html2pdf.js (frontend):** (1) O `exportarPDF` do `/gestor/relatorios` passou a usar **`window.open()` + `document.write()` + `printWindow.print()`** (diálogo de impressão nativo do browser) em vez do `html2pdf.js` (que produzia PDFs em branco). O HTML do relatório é gerado numa nova janela com estilos inline A4 (cabeçalho, KPIs, tabelas de staff/propriedades/estados, resumo IA). (2) **Removido o `PdfExportContent`** e o div de exportação residual (`position: fixed; opacity: 1; zIndex: 99998`) que estava a tornar o relatório **sempre visível** por cima da página. Removido também o `useRef` (já não há `pdfExportRef`). |
| Prompt 137 | — | **Fix nome_hospede não aparecia nos cartões do staff:** o backend já gravava `detalhes_reserva.nome_hospede` (via `criarTarefa` manual e via webhook Smoobu) e o detalhe da tarefa já o mostrava (`DetalhesReservaCard`). Mas a **lista de tarefas do staff** não o exibia. (1) `adaptarTarefa()` em `/staff/page.tsx` passou a repassar `detalhes_reserva` ao `TaskCard`. (2) `TaskCard` (`components/staff/task-card.tsx`) passou a mostrar uma linha destacada (ícone `User` + fundo dourado claro) com o `nome_hospede`. (3) Tabela de `/gestor/tarefas` ganhou coluna **"Hóspede"** entre Propriedade e Funcionário. |
| Prompt 137b | — | **Fix nome_hospede sempre vazio nas tarefas via webhook Smoobu:** o card "Detalhes da Reserva" aparecia (com check-in/out/pax) mas o nome ficava `null` porque o `enriquecerReservaSmoobu` (busca via REST API) **só corria quando `!departure`**. Se o webhook trouxesse `departure`, o enriquecimento não corria e o nome ficava vazio (o webhook oficial não envia `guestName`). (1) `processarReservaSmoobu` passou a chamar `enriquecerReservaSmoobu` **sempre que `nome_hospede` estiver em falta** (mesmo com `departure`). (2) `enriquecerReservaSmoobu` e `sincronizarReservas` agora cobrem mais variantes do nome (`guest.name`, `guest.firstName + lastName`, `customerName`, `customer.name`, `bookedForName`, `name`). (3) Novo endpoint `POST /api/admin/backfill-nomes-hospedes` + botão **"Preencher Nomes em Falta"** na gaveta da empresa (`/admin/empresas/[id]`) para preencher nomes em tarefas antigas. |
| Prompt 138 (136 V2) | — | **Cérebro do Scheduler e Gravação da Viagem (frontend):** (1) Novo estado **`nao_atribuida`** (SLA excedido — todos os staff > 480 min). Labels "Não atribuída (SLA)" + cor vermelha `destructive` em `/gestor/tarefas`, `detalhe-tarefa-modal`, `/gestor/calendario` (paleta vermelho escuro) e `/gestor/relatorios`. Tab "Por atribuir" do `/gestor/tarefas` inclui `nao_atribuida`. (2) **Tempo de viagem** — `TarefaMock` (api.ts) ganhou `tempo_viagem_minutos`. `detalhe-tarefa-client.tsx` mostra "+Xmin viagem" (âmbar) nos metadados. `/staff/tarefas/[id]/page.tsx` repassa o campo. |
| Prompt 139 (137) | — | **O Calendário Visual (Mostrar as Viagens):** (1) **Blocos de Viagem no Calendário** — `/gestor/calendario/page.tsx` agora cria **DOIS eventos** quando `tempo_viagem_minutos > 0`: Evento A (🚗 Viagem, cinzento + borda tracejada, antes da tarefa) + Evento B (Limpeza normal). `tarefas.map` → `tarefas.flatMap`. `renderEventContent` detecta `_isViagem` e renderiza com estilo próprio. CSS `.fc-evt-viagem` / `.fc-evt-month--viagem` / `.fc-evt-block--viagem` em `globals.css`. Clicar no bloco de viagem abre o detalhe da tarefa. (2) **Badge nos detalhes** — `detalhe-tarefa-modal.tsx` (gestor) mostra "🚗 Tempo de Viagem estimado: X min" (âmbar). `task-card.tsx` (staff) mostra "🚗 Tempo de Viagem: X min" (âmbar). Interfaces `TarefaCalendario`, `TarefaReal`, `TarefaDetalheGestor` actualizadas com `tempo_viagem_minutos`. |
| Prompt 139b | — | **Fix viagens não apareciam (cálculo on-the-fly + backfill):** as tarefas existentes foram criadas antes do Prompt 138 e não tinham `tempo_viagem_minutos` preenchido. (1) `getDadosCalendario`, `minhasTarefas`, `getTarefas` e `minhaTarefaDetalhe` agora calculam `tempo_viagem_minutos` **on-the-fly** (Haversine entre a tarefa anterior do mesmo staff no mesmo dia) quando o campo está vazio. (2) Novo endpoint `POST /api/admin/backfill-tempos-viagem` + botão **"Calcular Tempos de Viagem"** na gaveta da empresa para persistir os valores na BD. |
| Prompt 139c | — | **Fix nome_hospede: Smoobu usa `guest-name` (kebab-case):** o Smoobu devolve o nome do hóspede como `guest-name` (kebab-case) em alguns endpoints, mas o código só procurava `guestName` e `guest_name`. Adicionada a variante `['guest-name']` em `extrairDadosReserva`, `enriquecerReservaSmoobu` e `sincronizarReservas`. |
| Prompt 140 | — | **Caixa Negra de Webhooks na gaveta da empresa:** novo componente `WebhookLogsCard` (`components/admin/webhook-logs-card.tsx`) que mostra os logs de webhooks do Smoobu filtrados por empresa. Inclui tabela com data/hora, evento, estado (Badge) e erro; filtros por estado; **linha expansível** (click para ver payload completo em JSON); botão "Limpar Antigos". Adicionado à gaveta da empresa (`/admin/empresas/[id]`) antes da Zona de Perigo. Backend: `WebhookLog` ganhou `empresa_id`, `webhookSmoobu` resolve a empresa a partir do payload, `GET /api/admin/webhook-logs` aceita `?empresa_id=`. |
