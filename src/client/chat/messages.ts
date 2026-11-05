import {
  participantKey,
  type ChatMessage,
  type ChatParticipant,
  type ChatPresenceEntry,
} from '@shared/domain/chat';

/** How many messages a room keeps on screen; older ones scroll away for good. */
const MAX_KEPT = 500;

/**
 * Folds newly received messages into the ones already held: ordered by `seq`,
 * each once — the same message may arrive both live and in a history
 * response, or as the answer to our own send.
 *
 * Returns `held` itself when nothing new arrived, and keeps every held
 * message object as it was: a message never changes, so a UI can tell what
 * is new by identity alone and leave everything else untouched.
 *
 * `after` marks a history response fetched with `?after=`: when it does not
 * pick up right after that number, more was missed than the room's backlog
 * covers, and the messages before the hole are dropped rather than shown as
 * if nothing had happened in between.
 */
export function mergeMessages(
  held: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
  options: { after?: number } = {},
): readonly ChatMessage[] {
  const first = incoming[0];
  if (first === undefined) return held;
  const missedSome = options.after !== undefined && first.seq > options.after + 1;
  const kept = missedSome ? held.filter((message) => message.seq >= first.seq) : held;

  // The common case — the next messages, in order: append.
  const last = kept.at(-1);
  if ((last === undefined || first.seq > last.seq) && isAscending(incoming)) {
    return trim([...kept, ...incoming]);
  }

  const bySeq = new Map(kept.map((message) => [message.seq, message]));
  let added = false;
  for (const message of incoming) {
    if (bySeq.has(message.seq)) continue;
    bySeq.set(message.seq, message);
    added = true;
  }
  if (!added && kept === held) return held;
  return trim([...bySeq.values()].sort((a, b) => a.seq - b.seq));
}

function isAscending(messages: readonly ChatMessage[]): boolean {
  return messages.every((message, index) => index === 0 || message.seq > messages[index - 1]!.seq);
}

function trim(messages: ChatMessage[]): ChatMessage[] {
  return messages.length > MAX_KEPT ? messages.slice(-MAX_KEPT) : messages;
}

/**
 * Who is in the room, one entry per person, from its open connections (a
 * person with two tabs has two). People already listed keep their place and
 * newcomers go last, so nobody jumps around; `current` itself comes back
 * when the people did not change — a second tab arriving is not news.
 */
export function peopleIn(
  connections: ReadonlyMap<string, ChatParticipant>,
  current: readonly ChatParticipant[],
): readonly ChatParticipant[] {
  const present = new Map<string, ChatParticipant>();
  for (const participant of connections.values()) {
    const key = participantKey(participant);
    if (!present.has(key)) present.set(key, participant);
  }
  const next = current.filter((person) => present.delete(participantKey(person)));
  next.push(...present.values()); // what is left is new
  return next.length === current.length && next.every((person, i) => person === current[i])
    ? current
    : next;
}

/** A presence snapshot as the connection map `peopleIn` reads. */
export function connectionsOf(entries: readonly ChatPresenceEntry[]): Map<string, ChatParticipant> {
  return new Map(entries.map((entry) => [entry.connectionId, entry.participant]));
}
