-- 0002_users: members
--
-- Deliberately minimal: no password column, ever (see CLAUDE.md). With
-- AUTH_DRIVER=dev the id is the handle a person types to sign in; an external
-- provider added later maps its own identifier onto a row here.

CREATE TABLE users (
  id            text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 50),
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
  created_at    timestamptz NOT NULL DEFAULT now()
);
