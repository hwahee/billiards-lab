-- 0004_drop_users: members live on the member server
--
-- Services sign members in through the member server (OIDC) and know them by
-- the `sub` and `name` it vouches for at sign-in (CLAUDE.md). A service keeps
-- no user records of its own; chat messages already carry their author's name.

DROP TABLE IF EXISTS users;
