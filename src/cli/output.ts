import { CliError, EXIT_CODES, type ErrorCode } from '../errors.ts';

/**
 * `--json` contract: stdout gets exactly one JSON document.
 *   success: {"ok":true,"data":<result>}
 *   failure: {"ok":false,"error":{"code":"not_found","message":"…","details":null}}
 */
export function jsonSuccess(data: unknown): string {
  return JSON.stringify({ ok: true, data: data ?? null });
}

export function jsonFailure(code: ErrorCode, message: string, details: unknown): string {
  return JSON.stringify({ ok: false, error: { code, message, details } });
}

/**
 * `--events` contract: one JSON object per line on stdout.
 *   {"v":1,"type":"sync.progress","at":"2026-10-27T12:00:00.000Z","data":{…}}
 * `v` changes only on breaking changes to the envelope or to an event's data.
 */
export function eventLine(type: string, data: unknown, at: Date): string {
  return JSON.stringify({ v: 1, type, at: at.toISOString(), data });
}

/** Default human rendering when a command has no `render`. */
export function renderHuman(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    if (result.every(isRecord)) return table(result);
    return result.map(String).join('\n');
  }
  if (isRecord(result)) {
    const width = Math.max(0, ...Object.keys(result).map((key) => key.length));
    return Object.entries(result)
      .map(([key, value]) => `${key.padEnd(width)}  ${cell(value)}`)
      .join('\n');
  }
  return String(result);
}

/** Aligned text table. `columns` defaults to the keys of the first row. */
export function table(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const keys = columns ?? Object.keys(rows[0] ?? {});
  const lines = [keys, ...rows.map((row) => keys.map((key) => cell(row[key])))];
  const widths = keys.map((_, i) => Math.max(...lines.map((line) => (line[i] ?? '').length)));
  return lines
    .map((line) => line.map((value, i) => value.padEnd(widths[i] ?? 0)).join('  ').trimEnd())
    .join('\n');
}

/** Maps any thrown value to what the CLI prints and the exit code. */
export function describeError(error: unknown): { code: ErrorCode; message: string; details: unknown; exitCode: number } {
  if (error instanceof CliError) {
    return { code: error.code, message: error.message, details: error.details, exitCode: EXIT_CODES[error.code] };
  }
  return { code: 'internal', message: 'Unexpected error; rerun with TEAMSCLI_DEBUG=1 for details.', details: null, exitCode: EXIT_CODES.internal };
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replace(/\s+/g, ' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
