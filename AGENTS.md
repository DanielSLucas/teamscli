# Teams CLI — instruções do projeto

## Objetivo e estado

Construir uma CLI pessoal para Microsoft Teams web, inspirada no openclaw/wacli: autenticar uma vez, sincronizar mensagens para SQLite, pesquisar offline e enviar mensagens para chats individuais, grupos e canais.

Estado inicial: planejamento. Só existem arquivos de documentação; a estrutura abaixo é proposta, não funcionalidade implementada. Não alegar compatibilidade de endpoints ou autenticação antes de validar.

## Ambiente e memória

- Código: `/home/daniellucas/Dev/teams-cli` (`~/Dev/teams-cli` no WSL).
- Área do vault: `pessoal.teams-cli`.
- Entrada: `~/notes/pessoal/teams-cli/notes.md`.
- Registro do brain: `~/notes/.brain/config.json`, por nome `teams-cli` e caminho absoluto.
- No Windows, executar ferramentas configuradas com `wsl -- zsh -lic '<comando>'`.
- Ao iniciar trabalho, ler este arquivo, executar `memory context --brief` na raiz do projeto e conferir `git status`.
- Antes de pedir contexto ao usuário, consultar `memory search` ou as notas relevantes.
- Para editar o vault, seguir `~/notes/AGENTS.md`. Nunca executar Git dentro do vault; o obsidian-git faz seu versionamento.

## Direção técnica

- TypeScript com Node.js, inicialmente um único pacote.
- Integração pelos endpoints usados pelo Teams web; concentrar formatos internos e particularidades em `src/teams/`.
- SQLite com FTS5 para histórico local, metadados, checkpoints e busca textual offline.
- Separar autenticação, acesso remoto, sincronização, armazenamento e apresentação da CLI.
- Modelar chats individuais, grupos e reuniões; equipes, canais e respostas em threads.
- Contas isoladas; nunca misturar sessões ou bancos de identidades distintas.

## Autenticação

Preferência do usuário: não abrir janela de navegador.

1. Validar device code com os recursos e endpoints necessários do Teams web. Tokens OAuth não equivalem automaticamente a cookies ou a uma sessão do navegador.
2. Se não atender, avaliar Playwright headless, com credenciais por prompt de senha oculta ou variáveis de ambiente.
3. Persistir e renovar sessão silenciosamente quando possível; informar quando uma interação for necessária.
4. Navegador visível deve ser alternativa explícita, não abertura automática inesperada.

MFA, passkeys e políticas da organização podem exigir interação. Não prometer login automático universal. Não adotar ROPC como fluxo padrão.

Nunca gravar senha, tokens, cookies, perfil autenticado ou mensagens privadas em código, fixtures, commits, logs ou vault. Documentar nomes de variáveis, nunca seus valores.

## Estrutura proposta

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
    browser.ts                # Login por navegador, quando necessário
    session.ts                # Persistência e renovação
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
    lock.ts                   # Coordenação de escrita
    ipc.ts                    # Comunicação com sync ativo, quando necessária
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

Estado local proposto: `~/.teamscli/accounts/<conta>/`, contendo configuração, autenticação protegida, `messages.db` e mídia baixada. Localização exata e mecanismo de proteção devem ser validados na implementação.

## Contrato da CLI

Executável proposto: `teamscli`.

```bash
teamscli auth --device-code
teamscli auth --headless
teamscli auth --headless --credentials-env
teamscli auth status
teamscli accounts list
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

## Memória durante o trabalho — obrigatório

Não deixar o registro só para o fim. Git guarda código; memory log guarda andamento; memory put guarda conhecimento durável.

### memory log: execução e progresso

Após cada marco significativo (implementação, validação, descoberta de bloqueio ou conclusão), executar na raiz do projeto:

```bash
memory log --area pessoal.teams-cli 'Resumo do que foi feito, resultado da verificação, commit e próximo passo ou bloqueio'
```

Registrar fatos concretos, referências de commit e limitações, sem copiar mensagens privadas ou credenciais. Evitar um log por comando trivial.

### memory put: conhecimento durável

Usar para decisões com racional, contratos descobertos, comportamento de autenticação, restrições dos endpoints, causas-raiz e handoffs reutilizáveis. Não transformar todo evento operacional em nota permanente.

Preferir corpo em arquivo temporário e stdin para preservar aspas e texto multilinha:

```bash
memory put --area pessoal.teams-cli --title 'Decisão: título específico' --type decisao < /tmp/teams-cli-decisao.md
```

- Separar confirmado, proposto e pendente de validação; registrar evidências e consequências.
- Vincular notas relacionadas com wikilinks quando aplicável.
- `memory put` grava em `agents/memories/`; não duplicar manualmente essas notas.
- Se houver aviso de cache semântico incompleto, executar `memory embeddings sync` conforme a skill memory.
- Ao concluir uma etapa, deixar Git e memória consistentes para a próxima sessão.

## Referências iniciais

- https://github.com/openclaw/wacli
- https://github.com/michaelschnyder/teams-cli
- https://github.com/nakasyou/teams-api
- https://github.com/nospor/teams-tui-go
