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

## Pendente

- Ler mensagens de canal (só a listagem de canais foi validada).
- Persistência protegida do refresh token e tempo de vida real da sessão.
- Envio de mensagens.

## Limitações conhecidas

- O navegador embutido do Orca não suporta WebAuthn: o login com passkey falha com `AADSTS10040141`. Conclua o device code num navegador comum, inclusive o do celular.
- Device code com o client do Teams pode ser bloqueado por Conditional Access ou gerar alerta de segurança, conforme a política do tenant.
