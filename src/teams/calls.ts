import type { CallLog, CallParty } from '../models.ts';
import type { Endpoints, TeamsClient } from './client.ts';

/** The `call-log` property each `48:calllogs` message carries, as a JSON string. */
interface RawCallLog {
  callId: string;
  startTime: string;
  connectTime: string | null;
  endTime: string;
  callDirection: 'incoming' | 'outgoing';
  callType: string;
  callState: string;
  originator: string;
  target: string;
  originatorParticipant: RawParticipant | null;
  targetParticipant: RawParticipant | null;
  participantList: RawParticipant[] | null;
  forwardingInfo: { forwardingDestinationType?: string } | null;
  threadId: string | null;
}

interface RawParticipant {
  id: string;
  displayName: string | null;
}

interface RawMessage {
  id: string;
  properties?: Record<string, unknown>;
}

/** The whole call history, in Teams' page order. Entries without a `call-log` (call recordings) are skipped. */
export async function listCallLogs(client: TeamsClient, endpoints: Endpoints): Promise<CallLog[]> {
  const url = `${endpoints.chatService}/v1/users/ME/conversations/${encodeURIComponent('48:calllogs')}/messages?view=msnp24Equivalent&pageSize=200`;
  const calls: CallLog[] = [];
  for await (const page of client.pages<RawMessage>('chatService', url, 'messages')) {
    for (const message of page.items) {
      const log = message.properties?.['call-log'];
      if (typeof log === 'string') calls.push(mapCallLog(message.id, JSON.parse(log) as RawCallLog));
    }
  }
  return calls;
}

export function mapCallLog(id: string, raw: RawCallLog): CallLog {
  const connectAt = raw.connectTime ? iso(raw.connectTime) : null;
  const endAt = iso(raw.endTime);
  return {
    id,
    callId: raw.callId,
    startAt: iso(raw.startTime),
    connectAt,
    endAt,
    durationSeconds: connectAt === null ? null : Math.max(0, Math.floor((Date.parse(endAt) - Date.parse(connectAt)) / 1000)),
    direction: raw.callDirection,
    state: raw.callState,
    isGroup: raw.callType === 'multiParty',
    isVoicemail: raw.forwardingInfo?.forwardingDestinationType === 'voicemail',
    originator: party(raw.originator, raw.originatorParticipant),
    target: party(raw.target, raw.targetParticipant),
    participants: (raw.participantList ?? []).map((participant) => party(participant.id, participant)),
    chatId: raw.threadId || null,
  };
}

function party(id: string, participant: RawParticipant | null): CallParty {
  return { id, name: participant?.displayName || null };
}

/** Teams sends 7 fractional digits (`…:53.4364261Z`); models keep millisecond ISO. */
function iso(value: string): string {
  return new Date(value).toISOString();
}
