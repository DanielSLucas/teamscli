import { CliError } from '../../errors.ts';
import { readIdentity, writeIdentityIfMissing } from '../../auth/identity.ts';
import { openDatabase } from '../../store/database.ts';
import { accountDir, databasePath } from '../../runtime/paths.ts';
import { acquireSyncLock } from '../../sync/lock.ts';
import { emitEvent, type SyncEvent } from '../../sync/events.ts';
import { runSync, runSyncFollow } from '../../sync/runner.ts';
import { createTeamsClient } from '../../teams/client.ts';
import type { Command } from '../command.ts';
import { teamsSession } from '../session.ts';

const command: Command = {
  name: 'sync',
  summary: 'Sync changed conversations and recent messages to the local store',
  usage: '[--days N] [--follow] [--interval S]',
  options: { days: { type: 'string' }, follow: { type: 'boolean' }, interval: { type: 'string' } },
  optionHelp: {
    days: { valueName: 'N', description: 'Backfill this many days of recent history.' },
    follow: { description: 'Keep syncing until interrupted.' },
    interval: { valueName: 'SECONDS', description: 'Wait this many seconds between syncs.' },
  },
  mutates: true,
  async run(ctx, { values }) {
    const days = Number(values.days ?? '90');
    if (!Number.isSafeInteger(days) || days < 1) throw new CliError('usage', '--days must be a positive integer.');
    const follow = values.follow === true;
    if (values.interval !== undefined && !follow) throw new CliError('usage', '--interval requires --follow.');
    const intervalSeconds = Number(values.interval ?? '30');
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1) {
      throw new CliError('usage', '--interval must be a positive integer number of seconds.');
    }

    const controller = new AbortController();
    const onSignal = () => {
      controller.abort();
      ctx.log('stopping after the current page; press Ctrl+C again to quit now');
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    let db: ReturnType<typeof openDatabase> | null = null;
    let releaseLock: (() => void) | null = null;
    try {
      const directory = accountDir(ctx.home, ctx.account);
      releaseLock = acquireSyncLock(directory);
      db = openDatabase(databasePath(ctx.home, ctx.account));
      const session = teamsSession(ctx);
      if (readIdentity(ctx.home, ctx.account) === null) {
        const { userId, tenantId, region, displayName } = await session.account();
        writeIdentityIfMissing(ctx.home, ctx.account, { userId, tenantId, region, displayName });
      }
      const options = {
        db,
        client: createTeamsClient({ fetch: ctx.fetch, session }),
        endpoints: await session.endpoints(),
        days,
        now: ctx.now,
        log: ctx.log,
        selfId: readIdentity(ctx.home, ctx.account)?.userId ?? null,
        emit: (event: SyncEvent) => emitEvent(ctx.emit, event),
        signal: controller.signal,
      };
      return follow
        ? await runSyncFollow({ ...options, intervalSeconds, sleep: sleepUntilAbort })
        : await runSync(options);
    } finally {
      try {
        db?.close();
      } finally {
        try {
          releaseLock?.();
        } finally {
          process.off('SIGINT', onSignal);
          process.off('SIGTERM', onSignal);
        }
      }
    }
  },
};

export default command;

function sleepUntilAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
  });
}
