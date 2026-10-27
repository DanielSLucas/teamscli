# Autenticação

## Device code — validado em 2026-10-26 (22:10 BRT / 01:10 UTC)

Spike só de leitura, numa conta corporativa. Tokens ficaram apenas em memória.

| Passo | Requisição | Resultado |
|---|---|---|
| Login | device code, client `1fec8e78-bce4-4aaf-ab1b-5451cc387264`, authority `organizations`, scope `https://api.spaces.skype.com/.default offline_access openid profile` | access + refresh token |
| Skype token | `POST https://teams.microsoft.com/api/authsvc/v1.0/authz` com Bearer (spaces) | 200: `tokens.skypeToken`, `region`, `regionGtms.chatService`, `regionGtms.chatServiceAggregator` |
| Chats | `GET {chatService}/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=N`, header `Authentication: skypetoken=…` | 200 |
| Mensagens | `GET {chatService}/v1/users/ME/conversations/{id}/messages?view=msnp24Equivalent&pageSize=N` | 200; `_metadata.backwardLink` e `_metadata.syncState` |
| Chats (alternativa) | mesmo endpoint com `Authorization: Bearer` de `https://ic3.teams.office.com/.default` | 200 |
| Equipes e canais | `GET https://teams.microsoft.com/api/csa/{region}/api/v1/teams/users/me?isPrefetch=false&enableMembershipSummary=true`, Bearer de `https://chatsvcagg.teams.microsoft.com/.default` | 200: `teams[].channels`, `chats` |
| Renovação | refresh token para chatsvcagg, ic3 e Graph | ok, sem interação |

`threadType` observados em conversations: `chat`, `meeting`, `space`, `topic`, `streamofcalllogs`, `streamofnotifications`, `streamofmentions`, `streamofnotes`.

## Canais, threads e envio — validado em 2026-10-26 (22:25 BRT / 01:25 UTC)

| Passo | Requisição | Resultado |
|---|---|---|
| Mensagens de canal | `GET {chatService}/v1/users/ME/conversations/{19:…@thread.tacv2}/messages?view=msnp24Equivalent&pageSize=N` | 200; o feed traz raízes e respostas |
| Thread | `GET {chatService}/v1/users/ME/conversations/{canal};messageid={raiz}/messages` | 200 com a raiz e as respostas |
| Envio | `POST {chatService}/v1/users/ME/conversations/48:notes/messages`, body `{content, messagetype: "Text", contenttype: "text", clientmessageid}` | 201 `OriginalArrivalTime`; mensagem localizada no histórico pelo `clientmessageid` |

- Raiz x resposta: `conversationLink` termina em `;messageid=<id>`. Na raiz, o id é o próprio; na resposta, o da raiz.
- `48:notes` é o chat consigo mesmo (`threadType` `streamofnotes`), usado como destino de teste.

## Respostas — validado em 2026-10-27 (08:33 BRT / 11:33 UTC)

| Passo | Requisição | Resultado |
|---|---|---|
| Resposta em thread de canal | `POST {chatService}/v1/users/ME/conversations/{canal};messageid={raiz}/messages`, body `{content: "<p>…</p>", messagetype: "RichText/Html", contenttype: "text", imdisplayname, clientmessageid}` | 201; aparece na thread |
| Resposta citada em chat | mesmo POST no chat, com o `content` abaixo | 201; o Teams exibe a citação, com o aviso "Esta mensagem citada não foi verificada pelo Teams" |

```html
<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="{msgId}">
  <strong itemprop="mri" itemid="8:orgid:{oid}">{nome}</strong>
  <span itemprop="time" itemid="{msgId}"></span>
  <p itemprop="preview">{texto citado}</p>
</blockquote><p>{resposta}</p>
```

Nas mensagens citadas pelo cliente, `properties.qtdMsgs` é um objeto (`[{messageId, sender, time, validationResult: "Valid", …}]`) e vem acompanhado de `hasValidMsgReferences: true`. Enviar `qtdMsgs` como string JSON grava a propriedade, mas não a valida. *(Não reproduzido na captura de 2026-10-27: o cliente enviou string JSON e o servidor a guardou assim; ver a seção "Citação, menções, post em canal e edição de resposta".)*

## Paginação, sync incremental, edição e exclusão — validado em 2026-10-27 (09:04 BRT / 12:04 UTC)

- **Lista de conversas:** `GET {chatService}/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=100`. `_metadata` traz `totalCount`, `forwardLink`, `backwardLink` e `syncState`. Seguindo o `backwardLink` até vir uma página vazia, foram 3 páginas e 197 conversas, sem repetição.
- **Histórico:** `.../messages?view=msnp24Equivalent&pageSize=N&startTime=1`, seguindo `_metadata.backwardLink`. `pageSize=200` é aceito. Num chat de 86 mensagens, `pageSize=20` deu 5 páginas, sem duplicatas, e o fim aparece como página vazia ou falta do link.
- **Ordem:** as páginas não vêm em ordem estrita por `id`, `sequenceId`, `composetime` nem `version`. Mensagens alteradas depois (o `version` muda; o campo é atualizado em toda alteração, não só em edição) podem aparecer fora da posição. O banco local deve fazer upsert por `id` e ordenar localmente.
- **`syncState`:** é a URL do sync incremental. Partindo de uma página parcial, primeiro entrega o resto do histórico; depois de alcançar o presente, devolve só o que mudou: mensagem nova, editada ou apagada.
- **Edição:** `PUT {chatService}/v1/users/ME/conversations/{conv}/messages/{id}` com o mesmo body do envio → 200. A mensagem mantém o `id`, ganha `properties.edittime` e um `version` novo, e aparece no `syncState`.
- **Exclusão:** `DELETE .../messages/{id}?behavior=softDelete` → 200. A mensagem continua com o mesmo `id`, com `content` vazio e `properties.deletetime`, tanto no `syncState` quanto na listagem completa.

## Citação, menções, post em canal e edição de resposta — validado em 2026-10-27 (17:05 BRT / 20:05 UTC)

Captura do tráfego do Teams web (`teams.cloud.microsoft`) numa conta corporativa, enviando só para o chat de notas e para o canal `Notificações`; tudo apagado ao fim. Valores reais omitidos: `<conversationId>`, `<channelId>`, `<messageId>`, `<mri>`.

### O que o cliente web faz diferente da CLI

| | Teams web | CLI hoje |
|---|---|---|
| Host | `https://teams.cloud.microsoft/api/chatsvc/<região>/v1/users/ME/...` (mesmos caminhos do `chatService`) | `{chatService}/v1/users/ME/...` |
| Auth | `Authorization: Bearer` (audience `ic3.teams.office.com`) | `Authentication: skypetoken=…` |
| Outros headers | `behavioroverride: redirectAs404`, `x-ms-migration: True`, `x-ms-request-priority`, `clientinfo` | só auth e `content-type` |
| `;` no id de thread | enviado como `%3B` (`<channelId>%3Bmessageid%3D<rootId>`) | `;` literal |

O corpo do POST do cliente é sempre o mesmo envelope (texto simples, resposta, citação e post de canal):

```json
{
  "id": "-1", "type": "Message",
  "conversationid": "<conversationId>", "conversationLink": "blah/<conversationId>",
  "from": "<mri>", "fromUserId": "<mri>",
  "composetime": "<ISO>", "originalarrivaltime": "<ISO>",
  "content": "<p>texto</p>", "messagetype": "RichText/Html", "contenttype": "Text",
  "imdisplayname": "<nome>", "clientmessageid": "<dígitos>",
  "callId": "", "state": 0, "version": "0", "amsreferences": [],
  "properties": { "importance": "", "subject": "", "title": "", "cards": "[]", "links": "[]",
                  "mentions": "[]", "onbehalfof": null, "files": "[]", "policyViolation": null,
                  "formatVariant": "TEAMS" },
  "crossPostChannels": []
}
```

Resposta do POST: `201` com `{"OriginalArrivalTime": <ms>}`; o id da mensagem nova é esse valor e vem também no header `Location` (`…/messages/<messageId>`).

### Resultados por ação

| Ação | Requisição | Diferenças no corpo | Resultado |
|---|---|---|---|
| Citação em chat | `POST …/conversations/<conversationId>/messages` | `content` com o blockquote da seção Respostas; `properties.qtdMsgs` (abaixo) | 201 |
| Post novo em canal | `POST …/conversations/<channelId>/messages`, **sem** `;messageid` | `"postType": "Standard"`; `properties.subject` fica `""` sem assunto | 201; `threadtype: topic`; o id novo é a raiz |
| Resposta em post de canal | `POST …/conversations/<channelId>;messageid=<rootId>/messages` | `conversationid` = `<channelId>`, `conversationLink` = `blah/<channelId>;messageid=<rootId>`, `"replyChainId": "<rootId>"`, sem `postType` | 201 |
| Editar resposta de canal | `PUT …/conversations/<channelId>/messages/<messageId>`, **sem** `;messageid` | o envelope inteiro com o `id` real, `version` em ISO, `clientmessageid` novo, `replyChainId`, `properties.edittime` (ms) | 200, corpo vazio |
| Excluir resposta de canal | `DELETE …/conversations/<channelId>/messages/<messageId>?behavior=softDelete` | sem corpo | 200 |
| Excluir post (raiz) | mesmo `DELETE`, com o id da raiz | sem corpo | 200 |

- Editar e excluir em canal usam o id do **canal**, sem `;messageid=`, tanto para raiz quanto para resposta. A CLI já faz isso (`conversationId` guardado); o atalho de `src/teams/send.ts` está confirmado.
- O cliente não pede confirmação ao excluir.
- O mesmo `DELETE` com `Authentication: skypetoken` (cliente da CLI) também funcionou: 4 mensagens de teste apagadas no chat de notas.

### Citação: o que ainda não é verificado

`properties.qtdMsgs` enviado pelo cliente é uma **string JSON**, com `messageId` em string e `time` em número (ms):

```json
"qtdMsgs": "[{\"messageId\":\"<messageId>\",\"sender\":\"<mri>\",\"time\":<ms>}]"
```

O `content` é o mesmo blockquote já documentado (`itemscope` sem valor). O servidor guarda a string como veio: não aparecem `hasValidMsgReferences` nem `validationResult`.

No cliente, a citação enviada por ele aparece **sem** o aviso "Esta mensagem citada não foi verificada pelo Teams", inclusive depois de recarregar a página. Dois envios de controle pelo caminho da CLI, citando a mesma mensagem, continuaram com o aviso:

| Controle (via `skypetoken`) | Aviso |
|---|---|
| `qtdMsgs` idêntico ao do cliente (`messageId` em string) | sim |
| o mesmo, mais `mentions`, `cards`, `links`, `files`, `formatVariant: "TEAMS"`, `imdisplayname`, `contenttype: "Text"` | sim |

Logo, `qtdMsgs` e `properties` não bastam. Resta como hipótese o canal de autenticação (Bearer `ic3` do cliente contra `skypetoken`) ou algum campo do envelope; não testado.

### Menções

O Teams não oferece o próprio usuário no seletor `@`, nem no chat de notas (só a sugestão "Compartilhe as informações de contato de alguém") nem no canal (a lista traz só outros membros; a busca por nome e sobrenome volta vazia). O canal consulta `POST /api/userprofilesvc/<região>/api/v1.0/teams/<teamId>/users/profilesearch?top=15&includeDLs=false&includeBots=false&enableGuest=true`.

Mencionar outra pessoa notificaria um terceiro, fora do destino autorizado, então o corpo de uma menção **não foi capturado**. Foi lido só o rascunho do editor (nada enviado), que é representação interna e não o formato de envio:

```html
<readonly itemtype="http://schema.skype.com/Mention"><mention mri="<mri>" type="person" aria-label="<nome>">…</mention></readonly>
```

Para `content` e `properties.mentions` valem os formatos de `docs/teams-payloads.md`, vistos em mensagens recebidas; não confirmados no envio.

## Persistência da sessão

Refresh token cifrado com DPAPI (`CurrentUser`) via `powershell.exe`. O segredo trafega só por stdin e stdout, nunca por argumento. O blob fica em `~/.teamscli/accounts/<conta>/refresh_token.dpapi`, com modo 600. O WSL não tem keyring.

Validado: um processo novo leu o blob, renovou o token e gravou o refresh token rotacionado. Cada operação DPAPI leva cerca de 0,5 s.

## Pendente

- Tempo de vida real da sessão: a resposta não traz `refresh_token_expires_in`. Reexecutar com o token gravado após dias sem uso.
- Citação verificada: o `qtdMsgs` do cliente já foi capturado, mas reproduzi-lo com `skypetoken` não remove o aviso. Testar o POST com `Authorization: Bearer` (`ic3`) e, se for o caso, o envelope completo do cliente.
- Menção: capturar `content` e `properties.mentions` no envio. Exige um destino em que mencionar um terceiro de teste seja autorizado (o Teams não deixa mencionar a si mesmo).
- Post de canal com assunto: o campo "Adicionar um assunto" não foi preenchido; ver onde vai (`properties.subject`/`title`).
- Tempo real: o Teams web recebe eventos por websocket. Ainda não foi investigado; consultar o `syncState` periodicamente funciona como alternativa.
- Comportamento sob limite de requisições, num sync inicial com volume real.

## Limitações conhecidas

- O navegador embutido do Orca não suporta WebAuthn: o login com passkey falha com `AADSTS10040141`. Conclua o device code num navegador comum, inclusive o do celular.
- Device code com o client do Teams pode ser bloqueado por Conditional Access ou gerar alerta de segurança, conforme a política do tenant.
