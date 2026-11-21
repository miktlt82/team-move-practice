CREATE TABLE IF NOT EXISTS employee_details (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  department TEXT NOT NULL DEFAULT 'Общая команда',
  bio TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS extended_points (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount <> 0),
  kind TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS extended_points_user ON extended_points(user_id);
CREATE VIEW IF NOT EXISTS wallet_entries AS
SELECT p.id,p.user_id,p.amount,p.created_at,COALESCE(t.title,r.title) AS title
FROM point_entries p LEFT JOIN submissions s ON s.id=p.submission_id LEFT JOIN tasks t ON t.id=s.task_id
LEFT JOIN redemptions d ON d.id=p.redemption_id LEFT JOIN rewards r ON r.id=d.reward_id
UNION ALL SELECT -id,user_id,amount,created_at,title FROM extended_points;

CREATE TABLE IF NOT EXISTS reward_media (
  reward_id INTEGER PRIMARY KEY REFERENCES rewards(id),
  image TEXT NOT NULL CHECK(image IN ('coffee','book','notebook'))
);
CREATE TABLE IF NOT EXISTS store_categories (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
INSERT OR IGNORE INTO store_categories(code,label) VALUES ('perks','Бонусы'),('learning','Обучение'),('merch','Мерч');
CREATE TABLE IF NOT EXISTS store_reward_categories (
  reward_id INTEGER PRIMARY KEY REFERENCES rewards(id),
  code TEXT NOT NULL REFERENCES store_categories(code)
);
CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  contact TEXT NOT NULL,
  social_url TEXT NOT NULL,
  admin_theme TEXT NOT NULL CHECK(admin_theme IN ('warm','slate')),
  logo BLOB
);
CREATE TABLE IF NOT EXISTS cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id),
  reward_id INTEGER NOT NULL REFERENCES rewards(id),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  PRIMARY KEY(user_id,reward_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total INTEGER NOT NULL CHECK(total > 0),
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'placed' CHECK(status IN ('placed','fulfilled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  reward_id INTEGER NOT NULL REFERENCES rewards(id),
  title TEXT NOT NULL,
  unit_points INTEGER NOT NULL CHECK(unit_points > 0),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  PRIMARY KEY(order_id,reward_id)
);
CREATE TABLE IF NOT EXISTS wheel_spins (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  stake INTEGER NOT NULL CHECK(stake IN (1,5,10,20,30)),
  multiplier INTEGER NOT NULL CHECK(multiplier IN (0,1,2,5)),
  spun_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wheel_user_time ON wheel_spins(user_id,spun_at DESC);

CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('individual','team')),
  target INTEGER NOT NULL CHECK(target > 0),
  points INTEGER NOT NULL CHECK(points > 0),
  badge TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK(ends_at > starts_at),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS challenge_tasks (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id),
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY(challenge_id,task_id)
);
CREATE TABLE IF NOT EXISTS challenge_members (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  department TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  claimed_at INTEGER,
  PRIMARY KEY(challenge_id,user_id)
);

CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('survey','quiz')),
  points INTEGER NOT NULL CHECK(points > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id),
  title TEXT NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0 CHECK(correct IN (0,1))
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  option_id INTEGER NOT NULL REFERENCES poll_options(id),
  points INTEGER NOT NULL CHECK(points >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(poll_id,user_id)
);
CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY,
  reward_id INTEGER NOT NULL REFERENCES rewards(id),
  title TEXT NOT NULL,
  minimum INTEGER NOT NULL CHECK(minimum > 0),
  ends_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS auction_bids (
  id INTEGER PRIMARY KEY,
  auction_id INTEGER NOT NULL REFERENCES auctions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS auction_bids_lot ON auction_bids(auction_id,id DESC);

CREATE TABLE IF NOT EXISTS cashback_campaigns (
  id INTEGER PRIMARY KEY,
  reward_id INTEGER NOT NULL REFERENCES rewards(id),
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  percent INTEGER NOT NULL CHECK(percent BETWEEN 1 AND 100),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS cashback_offers (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  campaign_id INTEGER NOT NULL REFERENCES cashback_campaigns(id),
  PRIMARY KEY(order_id,campaign_id)
);
CREATE TABLE IF NOT EXISTS cashback_claims (
  campaign_id INTEGER NOT NULL REFERENCES cashback_campaigns(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL CHECK(points > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id,campaign_id)
);
CREATE TABLE IF NOT EXISTS cashback_reports (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  campaign_id INTEGER NOT NULL REFERENCES cashback_campaigns(id),
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  feedback TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(order_id,campaign_id)
);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  user_id INTEGER NOT NULL REFERENCES users(id),
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('focus','short','long')),
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 120),
  local_day TEXT NOT NULL,
  PRIMARY KEY(user_id,run_id)
);
CREATE INDEX IF NOT EXISTS pomodoro_day ON pomodoro_sessions(user_id,local_day);
CREATE TABLE IF NOT EXISTS telegram_links (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  chat_id TEXT UNIQUE,
  code_hash TEXT UNIQUE,
  expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  sent_at INTEGER,
  tries INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS demo_extensions (id INTEGER PRIMARY KEY);
