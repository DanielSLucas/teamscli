# Teams web payloads

What the Teams web endpoints return and how each field maps to `src/models.ts`. Written from a shape-only capture on 2026-10-27 (one corporate account): 197 conversations, 456 messages from 12 conversations plus one channel thread, 4 thread rosters and the `csa` teams payload. No values were recorded, only key paths, types and patterns; the enumerations below are Teams vocabulary.

Synthetic examples of every payload live in `tests/fixtures/teams/`. Endpoints and auth are in `docs/authentication.md`.

## Conventions seen in every payload

- Ids are strings. Message ids are 13-digit strings; for a message that was never changed, `id` and `version` both equal `composetime` in epoch milliseconds.
- `composetime` and `originalarrivaltime` are ISO 8601 UTC with 7 fractional digits (`2026-01-15T12:00:00.1234567Z`). `new Date(s).toISOString()` normalizes them to the model format.
- `properties.edittime`, `properties.deletetime` are JSON numbers in epoch milliseconds, not ISO strings.
- Many `properties.*` values are JSON encoded as strings (`files`, `links`, `mentions`, `cards`, `parentSpaces`, `meetingInfo`). Parse them only when needed.
- Booleans inside `properties` and `threadProperties` are strings with inconsistent case (`"True"`, `"true"`, `"False"`).
- Person ids (MRI) seen: `8:orgid:<uuid>` (work account), `8:live:<x>` and `8:teamsvisitor:<x>` (external and anonymous), `28:<uuid>` (bots and apps). A `19:…` id in `from` means the thread itself (system events).

## Conversation list

`GET {chatService}/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=100`

```text
{ conversations: [...], _metadata: { totalCount, forwardLink: "", backwardLink, syncState } }
```

- Follow `backwardLink` until a page has no items; the last page still carries `syncState`. 197 conversations came in 3 pages (97, 80, 20). The links Teams returns use the user's MRI in the path (`/v1/users/8:orgid:<uuid>/conversations`) instead of `ME`: use them verbatim.

### Item fields

| Field | Presence | Notes |
|---|---|---|
| `id` | always | `19:<x>@unq.gbl.spaces` (one-on-one), `19:<x>@thread.v2` (group), `19:meeting_<x>@thread.v2`, `19:<x>@thread.tacv2` (channels and teams), `48:<stream>` |
| `type` | always | `Conversation` |
| `version` | always | number, epoch ms |
| `threadProperties.threadType` | always | see enumerations |
| `threadProperties.productThreadType` | always | see enumerations |
| `threadProperties.topic` | group chats with a name (7 of 24), meetings, standard channels | absent in one-on-one chats, General and private channels |
| `threadProperties.spaceId` | standard channels (`topic`) | the team id |
| `threadProperties.threadSubType` | private channels | `PrivateChannel` |
| `threadProperties.parentSpaces` | private channels | JSON string: `{ linkedSpaceInfoItems: [{ spaceThreadId, linkState, role }] }`; `spaceThreadId` is the team id |
| `threadProperties.spaceThreadTopic` | `space` threads | the team name, not the channel name |
| `threadProperties.uniquerosterthread` | one-on-one chats | `"True"` or `"true"` |
| `memberProperties.role` | always | the signed-in user's role: `Admin`, `User` |
| `lastMessage` | always | `{}` when the conversation is empty; otherwise a message with the fields of the next section (no `properties` for most) |
| `properties.lastimreceivedtime` | most | ISO, 1 to 3 fractional digits |
| `properties.isemptyconversation` | always | `"True"`/`"False"` |
| `properties.consumptionhorizon` | most (85 of 97 in a 2026-10-27 check) | `<epoch ms>;<epoch ms>;<message id>`; the first field is the arrival time of the last message the user read. Opening the chat in Teams moves it forward. |

No member list comes with the conversation list.

### Mapping to `Conversation`

| Model field | Source |
|---|---|
| `id` | `id` |
| `kind` | table below |
| `title` | `threadProperties.topic`, else `null`. General and private channels have no `topic` here: their name comes from `csa` (`channels[].displayName`). |
| `teamId` | channels only, see table below |
| `lastMessageAt` | `lastMessage.originalarrivaltime` normalized; `null` when `lastMessage` is `{}` |
| `readUpTo` | first field of `properties.consumptionhorizon` as ISO; `null` when absent or not a number |

| `threadType` | `productThreadType` | Other signals | `kind` | `teamId` |
|---|---|---|---|---|
| `chat` | `OneToOneChat` | id ends with `@unq.gbl.spaces` (29/29) | `chat` | null |
| `chat` | `Chat` | id ends with `@thread.v2` | `group` | null |
| `meeting` | `Meeting` | id starts with `19:meeting_` | `meeting` | null |
| `topic` | `TeamsStandardChannel` | | `channel` | `threadProperties.spaceId` |
| `space` | `TeamsTeam` | id equals the team id | `channel` (the General channel) | the conversation's own `id` |
| `space` | `TeamsPrivateChannel` | `threadSubType: PrivateChannel` | `channel` | `parentSpaces` → `spaceThreadId` |
| `streamofnotes`, `streamofnotifications`, `streamofthreads`, `streamofcalllogs`, `streamofmentions` | `StreamOf…` | id `48:notes`, `48:notifications`, `48:threads`, `48:calllogs`, `48:mentions` | `system` | null |

`productThreadType` alone decides the kind; `threadType` agrees with it in every sample. In a team, the team id and its General channel id are the same thread (`csa` confirms: `isGeneral` channel `id` = team `id`).

## Messages

`GET {chatService}/v1/users/ME/conversations/{id}/messages?view=msnp24Equivalent&pageSize=N&startTime=1`
Channel thread: same URL with `{channelId};messageid={rootId}` as the id.

```text
{ messages: [...], tenantId, _metadata: { backwardLink?, syncState, lastCompleteSegmentStartTime, lastCompleteSegmentEndTime } }
```

- `backwardLink` is absent on the last page. `syncState` is always present. Right after reaching the present, a `syncState` call returned no `messages` items and a new `syncState`.
- A channel's feed holds roots and replies together; the thread URL returns one root and its replies.

### Message fields

| Field | Presence | Notes |
|---|---|---|
| `id` | always | 13-digit string |
| `type` | always | `Message` |
| `messagetype` | always | see enumerations |
| `contenttype` | all but `ThreadActivity/*` | `Text`/`text` (case varies), `application/user+xml` (`Event/Call`), `RichText/Media_CallRecording`, `RichText/Html` (transcript) |
| `content` | always | HTML for `RichText/Html`; XML for `Event/Call`, `ThreadActivity/*` and `RichText/Media_*`; plain text for some `Text`; `""` when deleted |
| `conversationid` | always | the conversation id (the channel id, also in a thread fetch) |
| `conversationLink` | always | `…/v1/users/ME/conversations/{conversationId}`; in channels it ends with `;messageid={rootId}` |
| `rootMessageId` | channel messages | always equals the `;messageid=` suffix (110/110) |
| `from` | always | `https://{chatService}/v1/users/ME/contacts/{mri}` |
| `imdisplayname` | all but `ThreadActivity/*` | sender name; `""` for `Event/Call`, recordings and some meetings |
| `fromDisplayNameInToken`, `fromGivenNameInToken`, `fromFamilyNameInToken` | most messages from people | |
| `composetime`, `originalarrivaltime` | always | equal in all 456 samples, including edited ones |
| `version` | always | 13-digit string, epoch ms of the last change; ≥ `edittime` and `deletetime` |
| `sequenceId` | always | number; not the message order (pages are not sorted) |
| `clientmessageid` | all but `ThreadActivity/*` | digits string |
| `properties.edittime` | edited messages | number, epoch ms |
| `properties.deletetime` | soft-deleted messages | number, epoch ms; `content` is `""` |
| `properties.hardDeleteTime`, `properties.hardDeleteReason` | 3 messages | not investigated |
| `properties.emotions` | messages with reactions | `[{ key, users: [{ mri, time, value }] }]`; changes `version` |
| `properties.mentions` | JSON string | `[{ "@type": "http://schema.skype.com/Mention", itemid, mri, mentionType, displayName }]`; same string in the web client's send (2026-10-27), `itemid` equal to the `<span itemid>` in `content` (see `docs/authentication.md`) |
| `properties.qtdMsgs` | quoted replies | JSON string `[{messageId, sender, time}]` in the web client's send (2026-10-27) and stored as sent; an array was seen in earlier received messages |
| `properties.fromAppMetadata` | bot and app messages | `{ id, name }` |
| `s2spartnername` | service messages | `SMBA` (bots), `recorder`, `concore_gvc` (calls), `skypespacesMT` |

### Mapping to `Message`

| Model field | Source |
|---|---|
| `id` | `id` |
| `conversationId` | `conversationid` |
| `parentId` | the `;messageid=<root>` suffix of `conversationLink` (or `rootMessageId`) when it differs from `id`; else `null` (roots and all chat messages) |
| `senderId` | last path segment of `from`, URL-decoded; `null` when it is a `19:` thread id (`ThreadActivity/*` events: the actor is `<initiator>` inside `content`) |
| `senderName` | `imdisplayname`, `null` when absent or `""` |
| `type` | `messagetype` |
| `content` | `content` |
| `text` | derived from `content`: strip tags and decode entities for `RichText/Html` and `Text`; `""` for XML types (`Event/*`, `ThreadActivity/*`, `RichText/Media_*`) so search does not index markup |
| `createdAt` | `composetime` normalized |
| `editedAt` | `properties.edittime` → `new Date(ms).toISOString()`, else `null` |
| `deletedAt` | `properties.deletetime` → ISO, else `null` |
| `version` | `Number(version)` (fits in a safe integer) |
| `clientMessageId` | `clientmessageid`, else `null` |

## People seen

No endpoint read here returns e-mail addresses for people; `Person.email` stays `null` unless another source appears.

| Source | id | Name |
|---|---|---|
| message `from` | MRI | `imdisplayname` |
| `properties.mentions` | `mri` | `displayName` (can also be a `19:` thread or `28:` app) |
| `csa` `chats[].members[]` | `mri` | `friendlyName` (rare, 34 of 176 chats) |
| `threads/{id}` `members[]` | `id` | none |

## Members

- **Chats and meetings:** `csa` `chats[].members[]`: `{ mri, objectId, role, isMuted, isIdentityMasked, shareHistoryTime?, tenantId?, friendlyName? }`. `role`: `Admin`, `User`, `Guest`. Empty for 9 of 185 chats.
- **Any thread, including channels:** `GET {chatService}/v1/threads/{id}?view=msnp24Equivalent` (what the web client calls). Body: `{ id, type: "Thread", members: [...], properties, rosterVersion, version, tenantId, rosterSummary? }`. Each member: `{ id (MRI), role: Admin|User, type: "ThreadMember", capabilities, meetingRole, hidden, … }`; no names.

Mapping to `ConversationMember`: `personId` = `mri`/`id`, `role` = `role`.

## Teams and channels (`csa`)

`GET https://teams.microsoft.com/api/csa/{region}/api/v1/teams/users/me?isPrefetch=false&enableMembershipSummary=true` (Bearer `chatsvcagg`).

```text
{ teams: [...], chats: [...], privateFeeds: [...], users: [], metadata: { syncToken, forwardSyncToken, hasMoreChats, isPartialData } }
```

Field names here are camelCase (`composeTime`, `messageType`), unlike the chat service.

| Path | Notes |
|---|---|
| `teams[].id` | `19:<x>@thread.tacv2`; same id as the team's General channel |
| `teams[].displayName`, `teams[].description` | always present |
| `teams[].channels[].id` | `19:<x>@thread.tacv2` |
| `teams[].channels[].displayName` | always present; the only source of the General and private channel names |
| `teams[].channels[].parentTeamId` | always equals the team's `id` |
| `teams[].channels[].isGeneral` | `true` on the channel whose `id` = team `id` |
| `teams[].channels[].threadType` | `topic` (standard) or `space` (General and private) |
| `teams[].channels[].threadSubType` | `""` or `PrivateChannel` |
| `teams[].channels[].channelType` | `0` (standard and General), `1` (private) |
| `teams[].channels[].isMember`, `isDeleted`, `isArchived` | 4 of 11 channels were not in the conversation list (not a member, or deleted) |
| `chats[]` | one per chat and meeting: `id`, `threadType`/`chatType` (`chat`, `meeting`), `isOneOnOne`, `title` (null for 46 of 185), `members[]`, `lastMessage` |
| `privateFeeds[]` | the `48:*` streams, with `threadType` |

Mapping: `Team` = `{ id, name: displayName, description }` (`""` → `null`); channel `Conversation` = `{ id, kind: 'channel', title: displayName, teamId: parentTeamId, lastMessageAt: null }` unless the conversation list already has it.

## Enumerations observed

- `threadType`: `chat`, `meeting`, `topic`, `space`, `streamofnotes`, `streamofnotifications`, `streamofthreads`, `streamofcalllogs`, `streamofmentions`.
- `productThreadType`: `OneToOneChat`, `Chat`, `Meeting`, `TeamsStandardChannel`, `TeamsTeam`, `TeamsPrivateChannel`, `StreamOfNotes`, `StreamOfNotifications`, `StreamOfThreads`, `StreamOfCallLogs`, `StreamOfMentions`.
- `messagetype`: `RichText/Html`, `Text`, `RichText/Media_Card`, `RichText/Media_CallRecording`, `RichText/Media_CallTranscript`, `Event/Call`, `ThreadActivity/AddMember`, `ThreadActivity/TopicUpdate`, `ThreadActivity/MeetingPolicyUpdated`, `ThreadActivity/AddCustomApp`.
- HTML `itemtype`s inside `content`: `http://schema.skype.com/` + `Reply`, `Mention`, `HyperLink`, `Emoji`, `CustomEmoji`, `AMSImage`, `CodeBlockEditor`.
- Roles: `Admin`, `User`, `Guest`.

## Uncertain or not observed

- **404 on messages:** one of two empty standard channels returned 404 for its messages; the other returned 200. Cause unknown. Sync should record it and continue, not abort.
- **Unknown `threadType`/`productThreadType`:** only the values above were seen. Mapping anything else to `system` keeps the schema's `CHECK` valid.
- **`skypeeditedid`** appears on 8 messages and on `lastMessage` of `48:notes`, but not on the edited notes; its meaning is unknown. `properties.edittime` is the edit signal.
- **Hard delete** (`hardDeleteTime`, `hardDeleteReason`) was seen 3 times and not investigated.
- **Shared channels** (`isShared`), `Event/*` other than `Event/Call`, and `ThreadActivity/*` types beyond the four above were not observed.
- **Roster size:** `threads/{id}` returned up to a few dozen members; paging for large channels was not checked.
- **Delta pages:** only an empty `syncState` delta was observed in this capture; its non-empty shape (new, edited, deleted items) was validated earlier and is in `docs/authentication.md`.
