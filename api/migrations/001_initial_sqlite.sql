CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  bio           TEXT DEFAULT '',
  location      TEXT DEFAULT '',
  avatar_url    TEXT DEFAULT '',
  rating        REAL DEFAULT 0.0,
  trade_count   INTEGER DEFAULT 0,
  verified      INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS listings (
  id          TEXT PRIMARY KEY,
  seller_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  category    TEXT NOT NULL,
  type        TEXT NOT NULL,
  price_chf   REAL DEFAULT 0,
  swap_for    TEXT DEFAULT '',
  condition   TEXT DEFAULT 'good',
  images      TEXT DEFAULT '[]',
  location    TEXT DEFAULT '',
  status      TEXT DEFAULT 'active',
  view_count  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at DESC);

CREATE TABLE IF NOT EXISTS swaps (
  id                  TEXT PRIMARY KEY,
  listing_id          TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  offered_listing_id  TEXT REFERENCES listings(id) ON DELETE SET NULL,
  proposer_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cash_offer_chf      REAL DEFAULT 0,
  status              TEXT DEFAULT 'pending',
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_swaps_listing ON swaps(listing_id);
CREATE INDEX IF NOT EXISTS idx_swaps_proposer ON swaps(proposer_id);
CREATE INDEX IF NOT EXISTS idx_swaps_receiver ON swaps(receiver_id);
CREATE INDEX IF NOT EXISTS idx_swaps_status ON swaps(status);

CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT PRIMARY KEY,
  swap_id         TEXT NOT NULL REFERENCES swaps(id) ON DELETE CASCADE,
  buyer_id        TEXT NOT NULL REFERENCES users(id),
  seller_id       TEXT NOT NULL REFERENCES users(id),
  amount_chf      REAL NOT NULL,
  commission_chf  REAL NOT NULL,
  payment_method  TEXT,
  payment_status  TEXT DEFAULT 'pending',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_swap ON transactions(swap_id);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  swap_id    TEXT NOT NULL REFERENCES swaps(id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_swap ON messages(swap_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
