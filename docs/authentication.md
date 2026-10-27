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
| Resposta citada em chat | mesmo POST no chat, com o `content` abaixo | 201; o Teams exibe a citação, com o aviso "Esta mensagem citada não foi verificada pelo Teams" (em todas as combinações testadas, ver "Citação: o aviso") |

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

### Citação: o aviso "não verificada" (testado em 2026-10-27, 17:40–17:55 BRT / 20:40–20:55 UTC)

`properties.qtdMsgs` enviado pelo cliente é uma **string JSON**, com `messageId` em string e `time` em número (ms):

```json
"qtdMsgs": "[{\"messageId\":\"<messageId>\",\"sender\":\"<mri>\",\"time\":<ms>}]"
```

O `content` é o mesmo blockquote já documentado (o cliente escreve `itemscope` sem valor; `itemscope=""` da CLI é o mesmo HTML). O servidor guarda a string como veio: não aparecem `hasValidMsgReferences` nem `validationResult`.

**Resultado: nenhuma combinação testada remove o aviso.** Só a citação enviada pelo próprio Teams web aparece verificada. Num chat `48:notes`, com uma mensagem-fonte de teste, cada variante abaixo citou a fonte e foi conferida na UI assim que apareceu (só c5 e c6 sem recarregar depois; as demais, a nativa e a sem `qtdMsgs` também foram vistas depois de recarregar):

| Variante (`qtdMsgs` string e blockquote do cliente, salvo indicação) | POST | Aviso |
|---|---|---|
| controle: `skypetoken`, `{chatService}`, envelope da CLI | 201 | sim |
| a) `Authorization: Bearer` `ic3` (`refreshAccessToken`), `{chatService}`, envelope da CLI | 201 | sim |
| b) Bearer `ic3`, host do cliente (`teams.cloud.microsoft/api/chatsvc/<região>`), envelope da CLI + headers do cliente | 201 | sim |
| c1) envelope completo do cliente, `skypetoken`, `{chatService}` | 201 | sim |
| c2) envelope completo, `skypetoken`, host do cliente + headers do cliente | 201 | sim |
| c3) envelope completo, Bearer `ic3`, host do cliente + headers do cliente | 201 | sim |
| c4) envelope completo, Bearer `ic3`, `{chatService}` | 201 | sim |
| c5) como c3 + `origin`, `referer`, `user-agent` do navegador | 201 | sim |
| c6) como c5, precedido do POST `Control/Typing` | 201 | sim |
| envelope e corpo atuais da CLI (blockquote, **sem** `qtdMsgs`), `skypetoken` | 201 | sim |
| nativa: `Responder com citação` na UI do Teams web | 201 | **não**, e continua sem aviso após recarregar |

- O corpo do POST nativo é idêntico ao de c3 (só `itemscope` sem `=""`) e ele não faz nenhuma chamada de validação: além de leituras de rotina (sync, `consumptionhorizon`), só o POST `Control/Typing` e o POST da mensagem.
- Conferido por `GET …/messages/<messageId>` (com `skypetoken`, e com Bearer no host do cliente, com `view=msnp24Equivalent|supportsMessageProperties`): a nativa e a variante c3 têm o mesmo conjunto de campos e `properties` (`cards`, `files`, `formatVariant`, `languageStamp`, `links`, `mentions`, `qtdMsgs`), com `qtdMsgs` igual. Nada no que o servidor devolve distingue as duas.
- Ficam como únicas diferenças que não reproduzi: o token (o do cliente web é emitido ao app broker do Teams web, outro `appid` que o da CLI, com `scp` `Teams.AccessAsUser.All` e MFA no `amr`) e cookies/estado local do navegador. As hipóteses em aberto são (1) o servidor marcar a mensagem conforme o app do token, sem expor isso na leitura; (2) o cliente guardar localmente, por mensagem, que ele mesmo enviou a citação. Para separar: abrir o mesmo chat com a citação nativa em outro cliente (celular ou app desktop). Se o aviso aparecer lá, é estado local; se não, é marca do servidor.
- Para a CLI: a citação funciona (o bloco aparece, com remetente, hora e prévia) mas o Teams exibe o aviso. Não há ganho em trocar para Bearer, host do cliente ou envelope completo; `qtdMsgs` também não muda o aviso. Manter o envio atual e documentar a limitação.

Outras observações úteis:

- O Bearer `ic3` pedido pela CLI (`refreshAccessToken` com `https://ic3.teams.office.com/.default`) é aceito no POST e no GET de mensagens, tanto no `{chatService}` quanto no host do cliente. `skypetoken` também é aceito no host do cliente (c2).
- O cliente envia, antes de cada mensagem, um POST de digitação no mesmo endpoint: `{"content":"","contenttype":"Application/Message","messagetype":"Control/Typing"}` → 201 `{"OriginalArrivalTime": <ms>}`. Não é necessário para enviar.
- Headers do POST do cliente: `x-ms-request-priority` (`10` na digitação, `0` na mensagem), `behavioroverride: redirectAs404`, `x-ms-test-user: False`, `x-ms-migration: True`, `clientinfo`, `content-type: application/json`.
- Uma sequência de 15 `DELETE` seguidos gerou 429 em 6; com 1,5 s entre eles e retry com espera, passaram.

### Menções (validado em 2026-10-27, 17:26–17:40 BRT / 20:26–20:40 UTC)

Capturado no chat 1:1 com uma pessoa de teste autorizada (escolhida no seletor `@`); as mensagens de teste foram apagadas. O Teams não oferece o próprio usuário no seletor `@` (nem no chat de notas nem no canal), então é preciso outra pessoa.

POST do cliente (envelope completo da tabela "O que o cliente web faz diferente da CLI", mudando só `content` e `properties.mentions`):

```json
"content": "<p>teamscli D5 test <readonly class=\"skipProofing\" itemtype=\"http://schema.skype.com/Mention\" spellcheck=\"false\"><span itemtype=\"http://schema.skype.com/Mention\" itemscope itemid=\"0\"><nome></span></readonly></p>",
"properties": {
  "mentions": "[{\"@type\":\"http://schema.skype.com/Mention\",\"itemid\":\"0\",\"mri\":\"<mri>\",\"mentionType\":\"person\",\"displayName\":\"<nome>\"}]",
  …
}
```

- `properties.mentions` é uma **string JSON** (como `qtdMsgs`), um objeto por menção: `@type` fixo, `itemid` em string, `mri`, `mentionType: "person"`, `displayName`. O `itemid` do objeto é o do `<span>` (`"0"` na primeira menção; mais de uma menção, com `itemid` crescente, não foi testado).
- No `content`, o span traz só o nome, sem `@`; o texto do usuário fica fora do `<readonly>`. `messagetype` é `RichText/Html`.
- Resposta: 201 `{"OriginalArrivalTime": <ms>}`; a mensagem foi vista na UI com o nome em destaque (`span data-mention-type="person"`, botão "<nome> mencionado").
- O envio com o corpo mínimo da CLI funciona: `{content, messagetype: "RichText/Html", contenttype: "text", clientmessageid, properties: {mentions}}` com `skypetoken` e o mesmo `content` acima → 201, e a UI renderiza de forma idêntica à mensagem nativa (mesmo `span`, mesma cor, mesmo botão). `imdisplayname` e o resto do envelope não são necessários.
- Não verificado: se o destinatário recebe a notificação de menção (a mensagem foi apagada logo depois), e menções a canal, equipe ou grupo.

## Persistência da sessão

Refresh token cifrado com DPAPI (`CurrentUser`) via `powershell.exe`. O segredo trafega só por stdin e stdout, nunca por argumento. O blob fica em `~/.teamscli/accounts/<conta>/refresh_token.dpapi`, com modo 600. O WSL não tem keyring.

Validado: um processo novo leu o blob, renovou o token e gravou o refresh token rotacionado. Cada operação DPAPI leva cerca de 0,5 s.

## Pendente

- Tempo de vida real da sessão: a resposta não traz `refresh_token_expires_in`. Reexecutar com o token gravado após dias sem uso.
- Citação verificada: sem solução. Testadas 10 combinações de auth, host, envelope, headers e `qtdMsgs` (ver "Citação: o aviso"); nenhuma remove o aviso e o servidor guarda o mesmo conteúdo que para a citação nativa. Falta separar "marca do servidor por app" de "estado local do cliente": ver a citação nativa em outro cliente (celular ou desktop). Se for marca por app, só o app do Teams web verifica e a CLI documenta a limitação.
- Menção: formato de envio confirmado e reproduzido pela CLI. Falta confirmar a notificação ao destinatário, mais de uma menção na mesma mensagem (`itemid` crescente?) e menção a canal, equipe ou grupo; depois, implementar `--mention` em `send text`.
- Post de canal com assunto: o campo "Adicionar um assunto" não foi preenchido; ver onde vai (`properties.subject`/`title`).
- Tempo real: o Teams web recebe eventos por websocket. Ainda não foi investigado; consultar o `syncState` periodicamente funciona como alternativa.
- Comportamento sob limite de requisições, num sync inicial com volume real.

## Limitações conhecidas

- O navegador embutido do Orca não suporta WebAuthn: o login com passkey falha com `AADSTS10040141`. Conclua o device code num navegador comum, inclusive o do celular.
- Device code com o client do Teams pode ser bloqueado por Conditional Access ou gerar alerta de segurança, conforme a política do tenant.
