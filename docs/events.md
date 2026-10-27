# Events (`--events`)

`teamscli --events sync` and `teamscli --events sync --follow` write one JSON object per line (NDJSON) to stdout. This is a public contract for scripts and agents. Progress text and diagnostics still go to stderr. Types live in `src/sync/events.ts`.

## Envelope

```json
{"v":1,"type":"message.new","at":"2026-10-27T12:00:00.000Z","data":{…}}
```

| Field | Meaning |
|---|---|
| `v` | Format version. Currently `1`. |
| `type` | One of the types below. |
| `at` | When the event was written (ISO 8601 UTC), not when the message was sent. |
| `data` | Payload for that type. |

## Types

| Type | `data` | Emitted when |
|---|---|---|
| `message.new` | `Message` | A message is stored for the first time. Not emitted for a message first seen already deleted. |
| `message.edited` | `Message` | A stored message arrives with a higher `version` and a changed `editedAt` or `content`. |
| `message.deleted` | `Message` | A stored message arrives with a higher `version` and `deletedAt` set. `content` and `text` are empty. |
| `conversation.updated` | `Conversation` | A conversation is stored for the first time or one of its fields changes (title, `lastMessageAt`, …). |
| `sync.progress` | `SyncProgress` | See below. |
| `sync.error` | `SyncError` | See below. |

Message events carry the full stored message, so a consumer can act without querying the database. Fetch conversation details (members, team) with `teamscli --json chats list` or keep the latest `conversation.updated` per id.

A version bump without an edit or delete (reactions also bump `version`) emits nothing in v1.

### `Message`

Same fields as `teamscli --json messages list`:

```json
{
  "id": "1767261600000",
  "conversationId": "19:conversation-1@thread.v2",
  "parentId": null,
  "senderId": "8:orgid:00000000-0000-0000-0000-000000000001",
  "senderName": "Alice Example",
  "type": "RichText/Html",
  "content": "<p>Hello there</p>",
  "text": "Hello there",
  "createdAt": "2026-01-01T10:00:00.000Z",
  "editedAt": null,
  "deletedAt": null,
  "version": 1767261600000,
  "clientMessageId": null
}
```

`id` is unique only within its conversation. `parentId` is the root message id for a channel thread reply, otherwise `null`.

### `Conversation`

```json
{"id":"19:conversation-1@thread.v2","kind":"group","title":"Example group","teamId":null,"lastMessageAt":"2026-01-01T10:00:00.000Z"}
```

`kind`: `chat` (one-on-one), `group`, `meeting`, `channel`, `system`.

### `SyncProgress`

```json
{"phase":"messages","conversationId":"19:conversation-1@thread.v2","conversationsDone":4,"conversationsTotal":12,"messages":230}
```

| Field | Meaning |
|---|---|
| `phase` | `conversations`: the conversation list was read. `messages`: one conversation was applied. `done`: a pass finished. |
| `conversationId` | The conversation just applied in `messages`; `null` otherwise. |
| `conversationsDone`, `conversationsTotal` | Conversations handled and to handle in this pass; total is `null` while unknown. |
| `messages` | Messages written in this pass so far. |

A one-off `sync` is a single pass. `sync --follow` runs one pass per poll and emits `done` after each, so `done` doubles as a heartbeat.

### `SyncError`

```json
{"code":"rate_limited","message":"Teams asked to slow down; retrying.","conversationId":null,"fatal":false}
```

| Field | Meaning |
|---|---|
| `code` | An error code from `src/errors.ts` (`remote`, `rate_limited`, `auth_required`, …). |
| `message` | One sentence for people. Never contains tokens or message content. |
| `conversationId` | The conversation that failed, or `null`. |
| `fatal` | `false`: the sync skipped or will retry and goes on. `true`: the sync stops after this event and the process exits with the code's exit status (and the usual message on stderr). |

## When events are emitted

- Events describe changes applied to the local database, after they are written. Anything you can read in an event is already queryable offline.
- The first `sync` of an account emits `message.new` for every message in the backfill window. Filter on `createdAt` if you only want recent ones.
- `sync --follow` emits only what changed since the previous pass.
- `history fetch` does not emit events.

## Guarantees

- **Order:** events of one conversation are emitted in the order they were applied; within one page they are sorted by `createdAt`, then `id`. For one message, versions are emitted in increasing order. There is no order across conversations.
- **At least once:** after a restart or a resumed sync, an event may be emitted again. Deduplicate on `(conversationId, id, version)` for message events.
- A delete is final: no `message.edited` follows a `message.deleted` for the same message.

## Compatibility

- Consumers must ignore unknown event types and unknown fields.
- Adding an event type or a field is not a breaking change and keeps `v`.
- Renaming or removing a field, changing its type or meaning, or changing the envelope bumps `v`.
