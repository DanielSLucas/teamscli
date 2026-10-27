/** Exit code for each expected failure. Part of the CLI contract: agents branch on these. */
export const EXIT_CODES = {
  internal: 1,
  usage: 2,
  auth_required: 3,
  read_only: 4,
  not_found: 5,
  ambiguous: 6,
  remote: 7,
  rate_limited: 8,
} as const;

export type ErrorCode = keyof typeof EXIT_CODES;

/** An expected failure. `message` is shown to the user; `details` goes to `--json` output (e.g. ambiguous candidates). */
export class CliError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details: unknown = null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
  }
}
