CREATE TABLE IF NOT EXISTS guilds (
  guild_id            TEXT PRIMARY KEY,
  announce_channel_id TEXT,
  admin_role_ids      TEXT NOT NULL DEFAULT '[]',
  daily_period        TEXT,
  weekly_period       TEXT
);

CREATE TABLE IF NOT EXISTS groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  scope      TEXT    NOT NULL,
  boss       TEXT    NOT NULL,
  runs       INTEGER NOT NULL,
  keys       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  closed     INTEGER NOT NULL DEFAULT 0,
  locked     INTEGER NOT NULL DEFAULT 0,
  channel_id TEXT,
  message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_groups_guild ON groups (guild_id, scope);

CREATE TABLE IF NOT EXISTS regs (
  guild_id   TEXT    NOT NULL,
  scope      TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  boss       TEXT    NOT NULL,
  need       INTEGER NOT NULL DEFAULT 0,
  keys       INTEGER NOT NULL DEFAULT 0,
  support    INTEGER NOT NULL DEFAULT 0,
  group_id   INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, scope, user_id, boss)
);

CREATE INDEX IF NOT EXISTS idx_regs_pool  ON regs (guild_id, scope, boss, group_id);
CREATE INDEX IF NOT EXISTS idx_regs_group ON regs (group_id);
CREATE INDEX IF NOT EXISTS idx_regs_user  ON regs (guild_id, user_id);
