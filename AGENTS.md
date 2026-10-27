# Teams CLI — instruções do projeto

## Objetivo e estado

Construir uma CLI open source para Microsoft Teams web, equivalente ao openclaw/wacli: autenticar uma vez, sincronizar mensagens para SQLite, pesquisar offline e enviar mensagens para chats individuais, grupos e canais. O público é quem quer dar aos seus agentes acesso ao Teams; a CLI precisa ser estável para scripts e agentes, não só para uso humano.

Estado: autenticação e endpoints de leitura, sync e envio validados por spikes (ver `docs/authentication.md`); implementação não iniciada. A estrutura abaixo é proposta. Não alegar compatibilidade além do que foi validado.

## Fluxo local

Se existir `AGENTS.local.md` na raiz (fora do git), leia-o também: ele traz o fluxo pessoal do mantenedor (memória, orquestração de agentes, plano de execução).

Ao iniciar trabalho: ler este arquivo e `docs/conventions.md` (padrões de código, obrigatórios), conferir `git status`.

## Direção técnica

- TypeScript com Node.js 24+, um único pacote. `node:sqlite` (FTS5 incluído) e `fetch` nativos; evitar dependências nativas.
- Somente endpoints que o próprio cliente Teams web chama. Nunca Microsoft Graph. Concentrar formatos internos e particularidades em `src/teams/`.
- SQLite com FTS5 para histórico local, metadados, checkpoints e busca textual offline. Upsert por id de mensagem: a ordem das páginas da API não é estrita.
- Sync em dois níveis: `syncState` da lista de conversas indica o que mudou; `syncState` por conversa traz os deltas (novas, editadas, apagadas). Websocket em tempo real fica para depois.
- Envio chama a API direto, mesmo com sync ativo; sem IPC. Concorrência no SQLite via WAL e `busy_timeout`.
- `--read-only` bloqueia qualquer mutação remota ou local, para uso seguro por agentes.
- Chats, canais e pessoas endereçáveis por nome, além de id.
- Separar autenticação, acesso remoto, sincronização, armazenamento e apresentação da CLI.
- Modelar chats individuais, grupos e reuniões; equipes, canais e respostas em threads.
- Múltiplas contas isoladas, como no wacli; nunca misturar sessões ou bancos de identidades distintas.

## Autenticação

- Device code com o client público do Teams é o único fluxo (validado; ver `docs/authentication.md`). A CLI nunca recebe senha nem abre navegador; o usuário conclui o login em qualquer navegador ou dispositivo.
- Refresh token persistido no cofre do sistema e renovado silenciosamente; informar quando o login precisar ser refeito.
- Fora do escopo: Playwright, login por usuário e senha e ROPC.

MFA, passkeys e políticas da organização (Conditional Access pode bloquear device code) podem impedir o login. Não prometer login universal.

Nunca gravar senha, tokens, cookies, perfil autenticado ou mensagens privadas em código, fixtures, commits, logs ou notas. Documentar nomes de variáveis, nunca seus valores.

## Estrutura proposta

Alvo de longo prazo. Layout, nomes e padrões vigentes estão em `docs/conventions.md`, que prevalece em caso de divergência.

Criar arquivos conforme as funcionalidades forem implementadas; não gerar módulos vazios só para reproduzir a árvore.

```text
src/
  main.ts                     # Executável
  models.ts                   # Tipos compartilhados do domínio
  cli/
    program.ts                # Comandos e opções globais
    output.ts                 # Tabelas, JSON, eventos NDJSON
    commands/
      auth.ts                 # Login, status, logout
      accounts.ts             # Contas isoladas
      sync.ts                 # Sync pontual e contínuo
      history.ts              # Histórico antigo e cobertura
      chats.ts
      teams.ts
      channels.ts
      messages.ts
      send.ts
      files.ts
      people.ts
      presence.ts
      store.ts
      doctor.ts
  auth/
    devicecode.ts             # Login e renovação
    secrets.ts                # Cofre por plataforma
    accounts.ts
  teams/
    client.ts                 # HTTP autenticado
    chats.ts
    channels.ts
    messages.ts
    files.ts
    people.ts
    presence.ts
    mapping.ts                # Respostas externas -> modelos locais
  sync/
    runner.ts                 # Sync inicial e contínuo
    history.ts                # Paginação de mensagens antigas
    checkpoints.ts            # Progresso por conversa
  store/
    database.ts
    migrations/001_initial.sql
    messages.ts
    conversations.ts
    people.ts
    search.ts                 # FTS5
  runtime/
    paths.ts
tests/
  auth/
  sync/
  store/
  cli/
  fixtures/                   # Sintéticas ou anonimizadas
docs/
  authentication.md
  commands.md
  storage.md
```

Estado local proposto: `~/.teamscli/accounts/<conta>/`, contendo configuração, `messages.db` e mídia baixada. Refresh token fora do diretório quando houver cofre: Keychain (macOS), DPAPI (Windows e WSL via `powershell.exe`, validado), libsecret (Linux); arquivo 0600 só com opt-in explícito.

## Riscos de uso (documentar no README)

Ferramenta não oficial, sem vínculo com a Microsoft, sobre endpoints não documentados que podem mudar. O banco local guarda mensagens em texto puro; device code com o client do Teams pode ser bloqueado ou gerar alerta no tenant. Esses riscos são de quem usa a ferramenta; o projeto os documenta, não os mitiga.

## Contrato da CLI

Executável proposto: `teamscli`.

```bash
teamscli auth
teamscli auth status
teamscli accounts list
teamscli --read-only --json messages search 'fechamento mensal'
teamscli send text --to 'Nome do chat ou pessoa' --message 'Olá'
teamscli --account work sync --follow
teamscli chats list --type group
teamscli teams list
teamscli channels list --team TEAM_ID
teamscli history fetch --chat CHAT_ID --before 2026-10-01
teamscli history coverage --chat CHAT_ID
teamscli messages search 'fechamento mensal'
teamscli --json messages list --chat CHAT_ID --limit 50
teamscli messages thread MESSAGE_ID --channel CHANNEL_ID
teamscli send text --chat CHAT_ID --message 'Olá'
teamscli send text --channel CHANNEL_ID --reply-to MESSAGE_ID --message 'Resposta'
teamscli send file --chat CHAT_ID --file ./relatorio.pdf
teamscli --events sync --follow
teamscli store stats
teamscli doctor
```

- Consultas de mensagens usam o SQLite e funcionam offline; sync e ações remotas exigem conexão.
- stdout contém o resultado; progresso e diagnósticos vão para stderr.
- `--json` para resultados estruturados; `--events` para eventos NDJSON em operações contínuas.
- Sync deve permitir retomada, evitar duplicatas e refletir edições, exclusões e respostas conforme os endpoints permitirem.
- Descobrir IDs antes de mutações. Testes de envio exigem destino de teste autorizado; não enviar mensagens de teste para terceiros por iniciativa própria.
- Presença, exclusão, gestão de chats/canais e demais recursos dependem de descoberta: a lista de comandos não é promessa de paridade já validada.

## Implementação e verificação

- Procurar solução existente antes de escrever. Sem abstração especulativa, camadas futuras ou validações sem cenário real.
- Primeiro marco: comprovar autenticação persistente e leitura de chat e canal; depois SQLite, sync, busca e envio.
- Verificar mudanças com checks apropriados. Priorizar testes de retomada, paginação, duplicação, atualização de mensagens, isolamento de contas e contratos da CLI quando essas funcionalidades existirem.
- Não inventar sucesso nem ampliar testes sem necessidade. Documentar limitações verificadas e pendências reais.

## Commits incrementais — obrigatório durante o trabalho

- Fazer commits pequenos e coerentes ao concluir cada etapa verificável; não acumular uma sessão inteira num commit gigante.
- A instrução de ir commitando autoriza commits locais das alterações do projeto. Push, publicação e ações externas precisam estar no escopo autorizado pelo usuário.
- Usar Conventional Commits com escopo: `docs(project): ...`, `feat(auth): ...`, `feat(sync): ...`, `fix(store): ...`.
- Antes de cada commit, conferir diff e staged, executar checks pertinentes e incluir apenas arquivos relacionados. Preservar alterações alheias.
- Nunca versionar segredos, sessões, bancos reais, mídia privada ou dependências geradas.
- No handoff, informar commits, validação feita e o que falta.

## Referências iniciais

- https://github.com/openclaw/wacli
- https://github.com/michaelschnyder/teams-cli
- https://github.com/nakasyou/teams-api
- https://github.com/nospor/teams-tui-go
