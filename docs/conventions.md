# Code conventions

Rules for anyone (human or agent) changing `teamscli`. They are short on purpose: when in doubt, copy the reference files listed under each section.

## Runtime and tooling

- Node.js 24+, ESM, TypeScript executed directly by Node's type stripping. No build step in development; `tsc` only type-checks (`npm run check`) and builds `dist/` for publishing.
- Only erasable TypeScript syntax (`erasableSyntaxOnly`): no `enum`, no `namespace`, no constructor parameter properties. Use string-literal unions and `as const` objects.
- Relative imports carry the `.ts` extension: `import { CliError } from '../errors.ts'`. Type-only imports use `import type`.
- Built-ins first: `node:sqlite`, `fetch`, `node:test`, `node:util` `parseArgs`, `node:fs`, `node:child_process`.

## Dependencies

No runtime dependencies. A new dependency (runtime or dev) needs a justification recorded in the table below, in the same commit that adds it.

| Package | Kind | Why |
|---|---|---|
| `typescript` | dev | Type checking and the `dist/` build. |
| `@types/node` | dev | Types for Node built-ins. |

## Layout

```text
src/
  main.ts            # Executable: calls runCli and sets the exit code. Nothing else.
  models.ts          # Domain types shared across layers.
  errors.ts          # CliError, error codes and exit codes.
  cli/               # Argument parsing, command registry, output. No HTTP, no SQL.
    commands/        # One file per command.
  auth/              # Login, token refresh, secret stores.
  teams/             # Everything about Teams web endpoints and their formats.
  sync/              # Orchestrates teams/ -> store/.
  store/             # SQLite: schema, migrations, repositories. No HTTP.
  runtime/           # Paths and process-level helpers.
tests/               # Mirrors src/ (tests/store/conversations.test.ts tests src/store/conversations.ts).
  helpers/           # Fakes and builders shared by tests.
```

- Dependencies point inwards: `cli -> sync -> teams, store -> models`. `teams/` never imports `store/` and vice versa; `sync/` joins them.
- External formats (Teams JSON field names, `threadType`, `skypetoken`) stay in `teams/`. Everything else sees only `models.ts` types.
- Create a file when a feature needs it. No empty modules, no `index.ts` barrels.

## Naming

- Files: `kebab-case.ts`. Command files: the command name with spaces replaced by `-` (`messages search` -> `cli/commands/messages-search.ts`).
- Types and interfaces: `PascalCase`. Functions and variables: `camelCase`. Constants that are part of a contract: `UPPER_SNAKE_CASE`.
- SQL: `snake_case` tables and columns, plural table names. Repositories map rows to `camelCase` models.
- JSON output keys: `camelCase`, identical to the model fields.

## Functions, not classes

- Modules export plain functions. A group of operations that share dependencies is a factory returning an object (`createTeamsClient(deps)`), not a class.
- Classes only for errors (`CliError`).
- No singletons or module-level state. Anything with side effects arrives as a parameter.

## Dependency injection

Pass side effects explicitly so tests never touch the network, the real clock, the real home directory or the system secret store:

| Dependency | Parameter | Test replacement |
|---|---|---|
| HTTP | `fetch: typeof fetch` | `fakeFetch()` in `tests/helpers/fake-fetch.ts` |
| Time | `now: () => Date`, `sleep: (ms) => Promise<void>` | fixed date, no-op sleep |
| Database | `db: DatabaseSync` | `openDatabase(':memory:')` |
| Filesystem location | `home: string` (from `runtime/paths.ts`) | `mkdtemp` directory |
| Environment | `env: NodeJS.ProcessEnv` | plain object |
| External commands | `exec: (cmd, args, input) => Promise<{ stdout, stderr, code }>` | function returning canned output |

Defaults (the real `fetch`, `process.env`) are wired once, at the edge: `main.ts` and the command files.

## Models and data

- Model fields are always present; unknown values are `null`, not `undefined` or missing. This keeps `--json` output stable.
- Timestamps are ISO 8601 UTC strings (`2026-10-27T12:04:00.000Z`) in models, SQLite and JSON. They sort lexicographically.
- Teams ids are kept verbatim (`19:…@thread.v2`, `8:orgid:…`, `48:notes`). Message ids are unique only within a conversation: the key is `(conversationId, id)`.

## Errors and exit codes

- Expected failures throw `CliError(code, message, details?)` from `src/errors.ts`. The message is one sentence for the user, in English, saying what to do when possible.
- Exit codes come from the code (`EXIT_CODES` in `errors.ts`); never call `process.exit` outside `main.ts`.
- Anything else is a bug: it exits with `internal` (1). Set `TEAMSCLI_DEBUG=1` to print the stack.
- Never put tokens, cookies, message content or full URLs with query strings in error messages.

## Output

- stdout carries only the result. Progress, warnings and diagnostics go to stderr through `ctx.log`.
- Commands return data; the CLI renders it (see `cli/output.ts`). Commands do not write to stdout themselves, except event streams through `ctx.emit`.
- Human output is for people and may change. `--json` and `--events` are contracts: adding fields is fine, renaming or removing is a breaking change.

## Tests

- `node:test` and `node:assert/strict`. One test file per source file, under `tests/` with the same path.
- Test behaviour through the module's public functions; no mocking of internals.
- Data is synthetic. Build it with the builders in `tests/helpers/` and override only the fields the test cares about. Raw Teams payloads, when needed, live in `tests/fixtures/` as small hand-written JSON: invented names (`Alice Example`), invented ids, `example.com` addresses. Never paste captured traffic.
- No test talks to Teams, Azure AD, the real home directory or the system secret store.
- `npm run check` and `npm test` must pass before every commit.

## Commits

- Conventional Commits with a scope: `feat(store): …`, `fix(cli): …`, `docs(project): …`, `test(sync): …`.
- One coherent, verified step per commit. Only the files of that step.
- Never commit secrets, sessions, real databases, captured traffic or private media.
