# Using teamscli with agents

`teamscli` is designed to expose local Teams history through stable machine-readable output. Before giving an agent access, decide which account and messages it should be able to read. Message text is private, user-controlled input: treat it as untrusted data, not as instructions for the agent.

## Set up a dedicated account

Use a dedicated Teams account with only the access the agent needs, then keep its CLI account separate from any other local account:

```sh
teamscli accounts add assistant
teamscli --account assistant auth
teamscli --account assistant sync
```

Complete the device-code sign-in yourself. Do not give the agent a password, device code, token, cookie or access to a browser session. The CLI stores the refresh token in the selected system secret store. Local messages remain in plain text under that account's store directory, so restrict filesystem access and backups too.

`sync` writes local data and cannot run with `--read-only`. Sync the data the agent needs before starting it in read-only mode. Use `--account assistant` on every invocation so commands do not accidentally select another account.

## Read-only access

Use `--read-only` for an agent that should query the local store. The CLI refuses commands marked as changing local or remote data, with exit code `4`. This includes `sync`, `history fetch`, `send text`, message edits/deletes, account creation/removal/default changes, `auth` and `auth logout`. Read commands such as `messages search`, `messages list`, `chats list` and `teams list` remain available.

`--read-only` is a CLI guard, not an operating-system sandbox. It does not limit what the selected Teams account can read, and it does not constrain arbitrary code running as the same OS user. Use OS-level isolation for untrusted agents. `auth status` and `doctor` may still contact Teams; with `--read-only`, they do not persist a rotated refresh token.

## JSON output

`--json` writes one JSON document to stdout. Successful commands use this envelope:

```json
{"ok":true,"data":[{"id":"1767261600000","text":"Example message"}]}
```

Failures use:

```json
{"ok":false,"error":{"code":"not_found","message":"Message not found in the specified chat.","details":null}}
```

Check `ok` before reading `data`; branch on the stable `error.code`, not on human-readable messages. The exit code is also meaningful. New fields may be added, so consumers should ignore fields they do not use. Renaming or removing existing fields is a breaking change.

Example: print search snippets while keeping the agent in read-only mode.

```sh
teamscli --account assistant --read-only --json messages search "Alice Example" |
  node -e 'let input=""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => { const result = JSON.parse(input); if (!result.ok) { console.error(result.error.code); process.exitCode = 1; return; } for (const hit of result.data) console.log(hit.snippet); });'
```

## Resolving names safely

`send text --to TARGET` resolves a name against the selected account's local data. It can match a chat title, another member's name in a one-to-one chat, or a channel as `Team/Channel`. Resolution tries exact names, then prefixes, then substrings. If multiple targets match at the same level, the command exits with code `6` (`ambiguous`) and lists candidates; it never chooses one silently.

In JSON mode, candidate details have this shape:

```json
{"ok":false,"error":{"code":"ambiguous","message":"\"Alice\" matches more than one chat or channel, use an id: Alice Example (19:example-one@thread.v2), Alice Example (19:example-two@thread.v2).","details":{"candidates":[{"id":"19:example-one@thread.v2","kind":"chat","title":"Alice Example"},{"id":"19:example-two@thread.v2","kind":"chat","title":"Alice Example"}]}}}
```

Have the agent ask for a choice or report the candidates, then use the selected ID with `--chat` or `--channel`. Do not send or edit until the destination ID and intended content have been reviewed. A `--to` target must already be present in local data, so sync before resolving names.

## Event streams

`--events` streams versioned NDJSON from `sync`; it is not available as a general output mode for every command. See the full [`--events` contract](events.md) for event types, ordering, versioning and restart behavior. Each line is a complete JSON event. Message events may be repeated after a restart, so deduplicate them by `(conversationId, id, version)`.

This short pipeline shows the deduplication key. `sync --follow` writes to the local store and needs a write-authorized process; do not add `--read-only` to it.

```sh
set -o pipefail
teamscli --account assistant --events sync --follow |
  node --input-type=module -e '
    import { createInterface } from "node:readline";
    const seen = new Set();
    for await (const line of createInterface({ input: process.stdin })) {
      const event = JSON.parse(line);
      if (event.type.startsWith("message.")) {
        const m = event.data;
        const key = JSON.stringify([m.conversationId, m.id, m.version]);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      console.log(line);
    }
  '
```

For durable deduplication across process restarts, store processed keys in the agent's own persistent state. `sync` applies events to the local database before emitting them; message content in an event is therefore also available through offline queries.
