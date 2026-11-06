/**
 * The home page's chat box — one way to draw a room. Everything about the room
 * itself (joining, the backlog, live messages, who is here, sending,
 * reconnecting) comes from the chat core (src/client/chat); another feature
 * can draw the same kind of room entirely differently.
 *
 * The box is split so that each part holds only the state it draws: the
 * frame never re-renders from chat traffic, typing redraws only the composer,
 * a person arriving redraws only the participant list, and a new message
 * adds one row to the log. Rows already drawn are left alone by the React
 * Compiler in production builds: a message object never changes, and the
 * chat core hands out the same one every time (no hand-written memo — see
 * CLAUDE.md).
 */
import type { ChatMessage, ChatParticipant } from '@shared/domain/chat';
import { participantKey, sendChatMessageValidator } from '@shared/domain/chat';
import { HOME_CHAT_ROOM } from '@shared/domain/home-chat';
import type { MessageKey, MessageParams } from '@shared/i18n';
import { formatUtcInTimeZone } from '@shared/time';
import { useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type UIEvent } from 'react';

import { ApiRequestError } from '../api/http';
import { useChatRoomActions, useChatRoomState } from '../chat/hooks';
import { useI18n } from '../i18n/locale-context';
import { TESTID } from '../testing/testids';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { TextField } from '../ui/text-field';

const ROOM_ID = HOME_CHAT_ROOM.id;

/** Names beyond this are summed up as "+N" — a big room would otherwise bury the box. */
const PARTICIPANTS_SHOWN = 20;

/** How close to the bottom of the log still counts as reading the newest message. */
const FOLLOW_SLACK_PX = 40;

const STATUS_TONES = {
  connecting: 'neutral',
  live: 'success',
  reconnecting: 'warning',
  unavailable: 'danger',
} as const;

type Translate = (key: MessageKey, params?: MessageParams) => string;

function nameOf(participant: ChatParticipant, t: Translate): string {
  return participant.kind === 'member'
    ? participant.displayName
    : t('chat.guestName', { id: participant.guestId });
}

export function HomeChat() {
  const { t } = useI18n();
  return (
    <section
      className="card chat-panel"
      aria-labelledby="home-chat-heading"
      data-testid={TESTID.home.chat.panel}
    >
      <header className="chat-panel__header">
        <h2 id="home-chat-heading">{t('chat.title')}</h2>
        <ChatStatus />
      </header>
      <p className="muted chat-panel__description">{t('chat.description')}</p>
      <ChatParticipants />
      <ChatLog />
      <ChatComposer />
    </section>
  );
}

function ChatStatus() {
  const { t } = useI18n();
  const status = useChatRoomState(ROOM_ID, (room) => room.status);
  return (
    <span role="status">
      <Badge tone={STATUS_TONES[status]} testId={TESTID.home.chat.status}>
        {t(`chat.status.${status}`)}
      </Badge>
    </span>
  );
}

function ChatParticipants() {
  const { t } = useI18n();
  const participants = useChatRoomState(ROOM_ID, (room) => room.participants);
  const hidden = participants.length - PARTICIPANTS_SHOWN;
  return (
    <div className="chat-participants" data-testid={TESTID.home.chat.participants}>
      <span className="muted">{t('chat.participants', { count: participants.length })}</span>
      <ul>
        {participants.slice(0, PARTICIPANTS_SHOWN).map((participant) => (
          <li key={participantKey(participant)}>{nameOf(participant, t)}</li>
        ))}
        {hidden > 0 && <li>{t('chat.moreParticipants', { count: hidden })}</li>}
      </ul>
    </div>
  );
}

function ChatLog() {
  const { t } = useI18n();
  const messages = useChatRoomState(ROOM_ID, (room) => room.messages);
  const status = useChatRoomState(ROOM_ID, (room) => room.status);
  const { isMine } = useChatRoomActions(ROOM_ID);

  // Keep the newest message in view while the reader is at the bottom.
  // Scrolling up to read stops that until they scroll back down or send one.
  const logRef = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const last = messages.at(-1);
  const lastSeq = last?.seq;
  const lastIsMine = last !== undefined && isMine(last);
  useEffect(() => {
    const log = logRef.current;
    if (log && (following.current || lastIsMine)) log.scrollTop = log.scrollHeight;
  }, [lastSeq, lastIsMine]);
  const onScroll = (event: UIEvent<HTMLOListElement>) => {
    const log = event.currentTarget;
    following.current = log.scrollHeight - log.scrollTop - log.clientHeight <= FOLLOW_SLACK_PX;
  };

  if (messages.length === 0 && status === 'live') {
    return (
      <p className="chat-empty muted" data-testid={TESTID.home.chat.empty}>
        {t('chat.empty')}
      </p>
    );
  }
  return (
    <ol
      ref={logRef}
      className="chat-log"
      role="log"
      aria-label={t('chat.log')}
      aria-busy={status === 'connecting' || undefined}
      onScroll={onScroll}
      data-testid={TESTID.home.chat.log}
    >
      {messages.map((message) => (
        <ChatMessageRow key={message.seq} message={message} mine={isMine(message)} />
      ))}
    </ol>
  );
}

function ChatMessageRow({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const { t, locale } = useI18n();
  return (
    <li
      className={mine ? 'chat-message chat-message--mine' : 'chat-message'}
      data-testid={TESTID.home.chat.message(message.seq)}
    >
      <div className="chat-message__meta">
        <span className="chat-message__author">
          {nameOf(message.author, t)}
          {mine && ` (${t('chat.you')})`}
        </span>
        {/* Boundary time-zone conversion: UTC → viewer's zone. */}
        <time className="muted" dateTime={message.createdAt}>
          {formatUtcInTimeZone(message.createdAt, { locale })}
        </time>
      </div>
      <p className="chat-message__text">{message.text}</p>
    </li>
  );
}

function ChatComposer() {
  const { t } = useI18n();
  const unavailable = useChatRoomState(ROOM_ID, (room) => room.status === 'unavailable');
  const { send } = useChatRoomActions(ROOM_ID);
  const sendMessage = useMutation({ mutationFn: send });

  // The only local state: the uncommitted message.
  const [text, setText] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = sendChatMessageValidator.safeParse({ text });
    if (!parsed.ok) return; // nothing worth sending yet
    sendMessage.mutate(parsed.value.text, {
      // Whatever was typed while it was on its way stays.
      onSuccess: () => setText((current) => (current === text ? '' : current)),
    });
  };

  const sendError = sendMessage.isError
    ? sendMessage.error instanceof ApiRequestError
      ? sendMessage.error.message
      : t('chat.sendFailed')
    : undefined;

  return (
    <form
      className="chat-compose"
      onSubmit={submit}
      aria-label={t('chat.send')}
      data-testid={TESTID.home.chat.form}
    >
      <TextField
        label={t('chat.inputLabel')}
        hideLabel
        placeholder={t('chat.inputPlaceholder')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        error={sendError}
        maxLength={1000}
        autoComplete="off"
        testId={TESTID.home.chat.input}
      />
      <Button
        type="submit"
        loading={sendMessage.isPending}
        disabled={unavailable || sendMessage.isPending}
        testId={TESTID.home.chat.send}
      >
        <Send aria-hidden size="1em" />
        {t('chat.send')}
      </Button>
    </form>
  );
}
