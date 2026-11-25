import { existsSync } from 'node:fs';
import { CliError } from '../../errors.ts';
import type { CallLog, CallParty } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { getConversation } from '../../store/conversations.ts';
import { openDatabase } from '../../store/database.ts';
import { getPersonName } from '../../store/people.ts';
import { listCallLogs } from '../../teams/calls.ts';
import { createTeamsClient } from '../../teams/client.ts';
import type { Command } from '../command.ts';
import { formatTime, table } from '../output.ts';
import { teamsSession } from '../session.ts';

const withLabel = Symbol('withLabel'); // Keep the display-only label out of --json.
type CallListItem = CallLog & { [withLabel]?: string };

const DIRECTIONS = ['incoming', 'outgoing'];

const command: Command<CallListItem[]> = {
  name: 'calls list',
  summary: 'List your Teams call history, newest first',
  usage: '[--limit 50] [--direction incoming|outgoing] [--state accepted|missed|declined] [--voicemail]',
  options: { limit: { type: 'string' }, direction: { type: 'string' }, state: { type: 'string' }, voicemail: { type: 'boolean' } },
  optionHelp: {
    limit: { valueName: 'N', description: 'Maximum number of calls to show.' },
    direction: { valueName: 'DIR', description: 'Only incoming or outgoing calls.' },
    state: { valueName: 'STATE', description: 'Only calls in this Teams state, e.g. missed.' },
    voicemail: { description: 'Only calls that went to voicemail.' },
  },
  mutates: false,
  async run(ctx, { values }) {
    const limit = values.limit === undefined ? 50 : Number(values.limit);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new CliError('usage', '--limit must be a positive integer.');
    const { direction, state } = values;
    if (direction !== undefined && !DIRECTIONS.includes(direction as string)) throw new CliError('usage', '--direction must be incoming or outgoing.');

    const session = teamsSession(ctx);
    const client = createTeamsClient({ fetch: ctx.fetch, session });
    // shortcut: fetches the whole history (one page of 200 held about six months); add paging with --limit if it grows slow.
    const calls = (await listCallLogs(client, await session.endpoints()))
      .filter((call) => (direction === undefined || call.direction === direction)
        && (state === undefined || call.state === state)
        && (values.voicemail !== true || call.isVoicemail))
      .sort((a, b) => b.startAt.localeCompare(a.startAt))
      .slice(0, limit);
    return withLocalNames(ctx.home, ctx.account, calls);
  },
  render: (calls) => calls.length === 0 ? 'No calls.' : table(calls.map((call) => ({
    date: formatTime(call.startAt).slice(0, 10),
    time: formatTime(call.startAt).slice(11, 16),
    direction: call.direction === 'incoming' ? 'in' : 'out',
    state: call.isVoicemail ? 'voicemail' : call.state,
    duration: call.durationSeconds === null ? null : duration(call.durationSeconds),
    with: call[withLabel],
    chat: call.chatId,
  }))),
};

/** Teams names the caller only; fill other names and group chat titles from the synced store when there is one. */
function withLocalNames(home: string, account: string, calls: CallLog[]): CallListItem[] {
  const path = databasePath(home, account);
  const db = existsSync(path) ? openDatabase(path, { readOnly: true }) : null;
  try {
    const named = (party: CallParty): CallParty => ({ id: party.id, name: party.name ?? (db ? getPersonName(db, party.id) : null) });
    const chatTitle = (id: string) => (db ? getConversation(db, id)?.title : null) ?? null;
    return calls
      .map((call) => ({ ...call, originator: named(call.originator), target: named(call.target), participants: call.participants.map(named) }))
      .map((call) => ({ ...call, [withLabel]: label(call, chatTitle) }));
  } finally {
    db?.close();
  }
}

/** Who the call was with: the other person, or the group chat (and who called, when it was not you). */
function label(call: CallLog, chatTitle: (id: string) => string | null): string {
  const self = call.direction === 'incoming' ? call.target.id : call.originator.id;
  const display = (party: CallParty) => party.name ?? party.id;
  if (!call.isGroup) return display(call.direction === 'incoming' ? call.originator : call.target);
  const others = call.participants.filter((party) => party.id !== self).map(display);
  const group = (call.chatId ? chatTitle(call.chatId) : null) ?? (others.slice(0, 3).join(', ') + (others.length > 3 ? ` +${others.length - 3}` : '') || 'group call');
  return call.direction === 'incoming' ? `${group} (from ${display(call.originator)})` : group;
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m${s}s` : `${m}m${s}s`;
}

export default command;
