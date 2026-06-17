-- Run this in your Neon SQL editor before deploying the messaging feature.

CREATE TABLE IF NOT EXISTS threads (
  id          BIGINT PRIMARY KEY,
  title       TEXT,
  item_id     BIGINT,
  created_by  BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS thread_participants (
  thread_id   BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id          BIGINT PRIMARY KEY,
  thread_id   BIGINT NOT NULL,
  sender_id   BIGINT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id  BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_thread_participants_user ON thread_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread         ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_user      ON message_reads(user_id);
