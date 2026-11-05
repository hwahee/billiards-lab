-- 0003_chat: chat rooms + messages
--
-- A room is standalone: the feature that uses it picks its id (e.g. 'home',
-- 'inquiry.42') and its policy when opening it (ChatService.openRoom).
-- Messages are numbered per room (seq, from chat_rooms.last_seq) so clients
-- can order them and spot what they missed. Who is in a room right now is not
-- stored here — that lives with the live connections (src/server/presence).

CREATE TABLE chat_rooms (
  id                  text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  -- NULL keeps messages for as long as the room exists.
  retention_ms        bigint CHECK (retention_ms > 0),
  backlog_max_count   integer NOT NULL CHECK (backlog_max_count > 0),
  -- NULL = the backlog has no age limit, only a count.
  backlog_max_age_ms  bigint CHECK (backlog_max_age_ms > 0),
  last_seq            bigint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  room_id      text NOT NULL REFERENCES chat_rooms (id) ON DELETE CASCADE,
  seq          bigint NOT NULL,
  author_kind  text NOT NULL CHECK (author_kind IN ('member', 'guest')),
  -- users.id for a member, the tab's guest handle for a guest. Deliberately
  -- no foreign key: a message keeps its author's name as it was when sent.
  author_id    text NOT NULL,
  -- The member's display name at send time; NULL for a guest.
  author_name  text,
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, seq)
);

-- The retention sweep deletes by age across every room.
CREATE INDEX chat_messages_created_at_idx ON chat_messages (created_at);
