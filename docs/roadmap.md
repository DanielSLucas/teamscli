# Plano de implementação

## Contexto

`teamscli` é uma CLI open source (MIT, npm `teamscli`, repo `github.com/DanielSLucas/teamscli`) equivalente ao wacli para Microsoft Teams: dá a pessoas e agentes acesso ao Teams pelo terminal, com espelho local em SQLite e busca offline. Autenticação e os endpoints principais já foram validados por spikes (`docs/authentication.md`).

## Restrições

- Só endpoints que o cliente Teams web chama, inclusive serviços de que ele depende (SharePoint/OneDrive, AMS, presença). Nunca Microsoft Graph. Endpoint novo entra por captura do tráfego do Teams web.
- Device code é o único login. Refresh token em cofre do sistema.
- Node.js 24+, TypeScript sem build em desenvolvimento (`tsc` só para publicar), `node:sqlite`, `fetch` e `node:test` nativos. Dependência nova só com justificativa.
- stdout para resultado, stderr para progresso; `--json` e `--events` estáveis, porque agentes dependem deles.
- Testes com fixtures sintéticas. Nenhum dado real, token ou mensagem no repo.
- Código, mensagens da CLI e documentação pública em inglês desde a fase 0; `AGENTS.md`, roadmap e notas internas em português.

## Fora do escopo

Microsoft Graph; Playwright, senha e ROPC; Teams pessoal (teams.live.com) na v1; áudio e vídeo de chamadas e reuniões; TUI ou interface gráfica.

## Fases

Cada fase termina com uma CLI utilizável e commits verificados. As fases 0–4 formam a v0.1, primeira versão publicável.

### Fase 0 — Fundação

- `package.json` (Node ≥24, ESM, `bin: teamscli`), `tsconfig` com `erasableSyntaxOnly`, `npm test` com `node:test`, `npm run check` com `tsc --noEmit`.
- `LICENSE` MIT.
- Separar o fluxo pessoal (vault, `memory`) do `AGENTS.md` para um `AGENTS.local.md` fora do git; o `AGENTS.md` aponta para ele se existir.
- Esqueleto da CLI: opções globais `--account`, `--json`, `--events`, `--read-only`, `--store`; códigos de saída definidos.

**Pronto:** `node src/main.ts --help` funciona; `npm test` e `npm run check` passam.

### Fase 1 — Autenticação e contas

- `auth` (device code: código e URL no stderr, espera o login), `auth status`, `auth logout`.
- Cofre por plataforma, via comando do sistema e sem dependência nativa: DPAPI (Windows e WSL), Keychain (`security`), libsecret (`secret-tool`); arquivo 0600 só com opt-in explícito.
- Sessão: refresh com rotação, troca por skypetoken, região descoberta no `authz`, cache em memória por processo. Login expirado gera erro e código de saída próprios.
- `accounts list|add|remove|use`; diretório isolado por conta.
- `doctor`: cofre, login, região e alcance dos endpoints.

**Pronto:** login real numa conta, token renovado em novo processo, duas contas sem cruzar dados. Testes do cofre e da sessão com backend falso.

### Fase 2 — Store e sync pontual

- Schema: contas, conversas (chat, grupo, reunião, canal), membros e pessoas vistos nas mensagens, mensagens (upsert por `id`, `version`, `edittime`, `deletetime`, `parentId` de thread), FTS5 com `remove_diacritics`, checkpoints (`syncState` da lista e por conversa).
- `sync`: pagina a lista de conversas, faz o backfill inicial dos últimos 90 dias de todas as conversas (ajustável; o mais antigo vem por `history fetch`) e salva checkpoints. Trata 429 respeitando `Retry-After`.
- Leitura offline: `chats list`, `teams list`, `channels list`, `messages list|show|search|thread`.
- `--read-only` bloqueia escrita local e remota.

**Pronto:** sync real popula o banco; sync repetido não duplica; edição e exclusão refletidas. Testes com fixtures sintéticas para paginação, dedupe, upsert de edição e exclusão e retomada.

### Fase 3 — Sync contínuo e histórico

- `sync --follow`: polling em dois níveis (lista de conversas, depois deltas só das que mudaram), intervalo com backoff; lock de um seguidor por conta.
- `--events`: NDJSON (`message.new`, `message.edited`, `message.deleted`, `conversation.updated`, `sync.progress`, `sync.error`).
- `history fetch --chat X --before DATA` e `history coverage`.

**Pronto:** matar e reiniciar o `--follow` não perde nem duplica; mensagem nova aparece em segundos no banco e em `--events`.

### Fase 4 — Envio e endereçamento por nome

- Resolução de nomes: chat por título ou membros; canal como `Equipe/Canal`; pessoa por nome. Ambiguidade vira erro listando os candidatos, nunca escolha silenciosa.
- `send text --to ALVO` (chat, post novo em canal), `--reply-to` (thread de canal), `--quote` (citação em chat). Conteúdo HTML seguro a partir de texto ou markdown simples.
- `messages edit|delete` das próprias mensagens.
- Mensagem enviada gravada no banco na hora.
- Descobertas: citação verificada (`qtdMsgs`), menções (`@pessoa`), post novo em canal.

**Pronto:** envio validado só em destinos de teste autorizados; `--read-only` bloqueia todos os comandos de envio.

### Fase 5 — Publicação v0.1

- README e docs públicos em inglês: instalação, quickstart, riscos de uso, comandos, integração com agentes.
- CI (GitHub Actions: check e test), `tsc` para `dist/`, `npm publish` de `teamscli`.
- Revisão de segurança do repo: nada pessoal, nenhum dado real.

**Pronto:** `npx teamscli auth` funciona numa máquina limpa. Publicar exige autorização explícita no momento.

### Fase 6 — Mídia e arquivos

- Descoberta: imagens inline (AMS) e arquivos (SharePoint/OneDrive), como o Teams web faz.
- `media download`, `send file`.

### Fase 7 — Pessoas e presença

- Descoberta: busca de pessoas e presença usadas pelo Teams web.
- `people search|show`, `presence get|set`.

### Fase 8 — Gestão de chats (paridade com o wacli)

- Cada item depende de descoberta: marcar como lido, fixar, silenciar, ocultar, reações, criar chat ou grupo, registro de chamadas (`48:calllogs`), webhooks.

### Fase 9 — Tempo real

- Substituir o polling pelo websocket do Teams web, se a descoberta mostrar ganho real.

## Pendências transversais

- Validade real da sessão sem uso.
- Comportamento sob limite de requisições num sync inicial grande.
