# teamscli

`teamscli` is an unofficial command-line client for Microsoft Teams web, in the spirit of [wacli](https://github.com/openclaw/wacli). It lets people and agents sync messages to a local SQLite database, search that history offline, and send text messages to chats or reply in channel threads. It uses endpoints called by Teams web; it does not use Microsoft Graph.

Sign-in uses a device code. You complete the sign-in in a browser; the CLI does not ask for your password or open a browser for you.

## Requirements and installation

Node.js 24 or newer is required. The npm package is being prepared for its first release. After it is published, install it globally:

```sh
npm install --global teamscli
```

Or run it without a global install:

```sh
npx teamscli@latest --help
```

## Quick start

```sh
teamscli auth
teamscli sync --days 30
teamscli chats list --type group
teamscli --read-only --json messages search "Alice Example"
```

`auth` prints a device code and sign-in URL to stderr. Complete sign-in in a browser, then the CLI saves the refresh token in the selected system secret store. `sync` stores recent conversations and messages locally. The search example uses fictional data.

Sending changes remote data. Replace the fictional ID below with a chat ID from your local `chats list` output, and send only to an authorized test chat:

```sh
teamscli send text --chat '19:example-chat@thread.v2' --message 'Hello from teamscli'
```

## Local data and accounts

Each account has its own directory and SQLite database at `~/.teamscli/accounts/<account>/messages.db` by default. Message content is stored in plain text in that database. Use a separate account name for isolated local data and sessions:

```sh
teamscli accounts add work
teamscli --account work auth
teamscli --account work sync
```

`--account` selects the account for a command. `accounts use <name>` changes the default account. See the [command reference](docs/commands.md) for storage paths and all options.

## Structured output

- [`--json`](docs/agents.md#json-output) returns one JSON envelope for scripts and agents.
- [`--events`](docs/events.md) streams versioned NDJSON events from `sync`.
- [`--read-only`](docs/agents.md#read-only-access) refuses commands that change local or remote data.

See [using teamscli with agents](docs/agents.md) for safe access patterns.

## Validation status

| Area | Current status |
|---|---|
| Device-code sign-in and refresh-token renewal | Validated against the Teams service. DPAPI persistence and renewal in a later process were validated in the tested environment. See [authentication details](docs/authentication.md). |
| Conversation, message, team and channel reads | Live endpoint reads and pagination have been validated. Channel threads have been read successfully. |
| Sync, local history and offline search | Implemented. Service sync/delta behavior has been exercised; automated coverage uses synthetic fixtures and fake dependencies for pagination, resumption, duplicate handling, edits, deletions and search. |
| Chat text send; channel-thread replies; message edit and soft-delete | Validated against authorized test destinations. |
| New channel posts | Not supported yet; endpoint discovery is pending. |
| Mentions | Not implemented or validated yet. |
| Verified quoted references | Not validated. The current chat `--quote` option sends a quote that Teams treats as unverified. |
| Media and presence | Not implemented or validated yet. |
| CLI output contracts (`--json`, `--events`, `--read-only`) | Implemented and covered by local tests with synthetic data and fake dependencies; those tests do not validate future Teams service changes. |

This status describes tested behavior, not a promise of compatibility with every tenant or future Teams release.

## Risks and limitations

- This is an unofficial tool and is not affiliated with Microsoft.
- It uses undocumented Teams web endpoints. Microsoft can change or remove them at any time.
- The local SQLite database stores message content in plain text. Protect the account directory and its backups accordingly.
- Device-code sign-in with the Teams client may be blocked by Conditional Access or may raise a security alert in your tenant. MFA and other organization policies can also prevent sign-in.
- Microsoft Teams personal accounts (`teams.live.com`) are outside the project scope.
- You are responsible for deciding whether to use this tool and for protecting data it stores or displays. The project documents these risks but does not mitigate them.

## License

[MIT](LICENSE)
