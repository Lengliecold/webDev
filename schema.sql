-- 福州鳌峰学校 · 校园论坛 D1 数据库结构
-- 在 Cloudflare 控制台 → D1 → 你的数据库 → Console 里执行本文件全部语句

DROP TABLE IF EXISTS likes;
DROP TABLE IF EXISTS replies;
DROP TABLE IF EXISTS threads;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS categories;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  pass          TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    INTEGER NOT NULL DEFAULT 0,
  last_post_at  INTEGER NOT NULL DEFAULT 0,
  last_reply_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE categories (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE threads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  views        INTEGER NOT NULL DEFAULT 0,
  reply_count  INTEGER NOT NULL DEFAULT 0,
  pinned       INTEGER NOT NULL DEFAULT 0,
  locked       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_threads_cat ON threads(category_id);
CREATE INDEX idx_threads_time ON threads(updated_at DESC);

CREATE TABLE replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  content    TEXT NOT NULL,
  floor      INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_replies_thread ON replies(thread_id, floor);

CREATE TABLE likes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  UNIQUE(thread_id, user_id)
);

INSERT INTO categories (id, slug, name, description, sort) VALUES
  (1, 'notices',    '公告通知', '学校通知、活动安排、重要事项发布（仅管理员可发）', 1),
  (2, 'study',      '学习交流', '作业答疑、学习方法、复习资料与考试经验', 2),
  (3, 'life',       '校园生活', '食堂、宿舍、日常随拍与生活琐事', 3),
  (4, 'clubs',      '活动社团', '社团招新、比赛报名、运动会与文艺活动', 4),
  (5, 'lost',       '失物招领', '捡到东西、丢了东西，都在这里说一声', 5),
  (6, 'feedback',   '意见建议', '对学校与论坛的建议，认真提，认真改', 6);
