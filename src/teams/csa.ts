import type { Conversation, ConversationMember, Person, Team } from '../models.ts';
import type { Endpoints, TeamsClient } from './client.ts';

interface CsaResponse {
  teams?: CsaTeam[] | null;
  chats?: CsaChat[] | null;
  metadata?: { hasMoreChats?: boolean; isPartialData?: boolean };
}

interface CsaTeam {
  id: string;
  displayName: string;
  description: string;
  channels?: CsaChannel[] | null;
}

interface CsaChannel {
  id: string;
  displayName: string;
  parentTeamId: string;
  isMember: boolean;
  isDeleted: boolean;
}

interface CsaChat {
  id: string;
  members?: CsaChatMember[] | null;
}

interface CsaChatMember {
  mri: string;
  role: string;
  friendlyName?: string;
}

type FetchTeamsAndChatsResult = {
  teams: Team[];
  channels: Conversation[];
  chatMembers: { conversationId: string; members: ConversationMember[] }[];
  people: Person[];
  partial: boolean;
};

/** Reads teams, channels, chat rosters and named chat members from CSA. */
export async function fetchTeamsAndChats(client: TeamsClient, endpoints: Endpoints): Promise<FetchTeamsAndChatsResult> {
  const url = `${endpoints.csa}/api/v1/teams/users/me?isPrefetch=false&enableMembershipSummary=true`;
  const response = await client.json<CsaResponse>('csa', url);
  const sourceTeams = response.teams ?? [];
  const sourceChats = response.chats ?? [];

  const teams = sourceTeams.map(({ id, displayName, description }) => ({
    id,
    name: displayName,
    description: description === '' ? null : description,
  }));
  // Only live channels where this account is a member can be synced.
  const channels = sourceTeams.flatMap((team) =>
    (team.channels ?? [])
      .filter((channel) => !channel.isDeleted && channel.isMember)
      .map(({ id, displayName, parentTeamId }) => ({ id, kind: 'channel' as const, title: displayName, teamId: parentTeamId, lastMessageAt: null })),
  );
  const chatMembers = sourceChats.map(({ id, members }) => ({
    conversationId: id,
    members: (members ?? []).map(({ mri, role }) => ({ conversationId: id, personId: mri, role })),
  }));
  const peopleById = new Map<string, Person>();
  for (const { members } of sourceChats) {
    for (const { mri, friendlyName } of members ?? []) {
      // An MRI without friendlyName is not enough to create a Person.
      if (friendlyName) peopleById.set(mri, { id: mri, displayName: friendlyName, email: null });
    }
  }

  return {
    teams,
    channels,
    chatMembers,
    people: [...peopleById.values()],
    // CSA has no paging contract here; preserve its incompleteness signals for callers.
    partial: Boolean(response.metadata?.hasMoreChats || response.metadata?.isPartialData),
  };
}
