-- SwapMart Database Schema
-- PostgreSQL (or SQLite for local dev)

-- ─── Users ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  bio           TEXT DEFAULT '',
  location      TEXT DEFAULT '',
  avatar_url    TEXT DEFAULT '',
  rating        REAL DEFAULT 0,
  trade_count   INTEGER DEFAULT 0,
  verified      BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ─── Listings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  category    TEXT NOT NULL CHECK (category IN (
    'cards', 'electronics', 'cars', 'apartments',
    'fashion', 'furniture', 'sports', 'collectibles'
  )),
  type        TEXT NOT NULL CHECK (type IN ('sell', 'swap', 'both')),
  price_chf   REAL DEFAULT 0,
  swap_for    TEXT DEFAULT '',
  condition   TEXT CHECK (condition IN ('new', 'like_new', 'good', 'fair', 'parts')),
  images      TEXT DEFAULT '[]',  -- JSON array of URLs
  location    TEXT DEFAULT '',
  status      TEXT DEFAULT 'active' CHECK (status IN (
    'active', 'sold', 'swapped', 'expired', 'removed'
  )),
  view_count  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_listings_seller ON listings(seller_id);
CREATE INDEX idx_listings_category ON listings(category);
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_created ON listings(created_at DESC);
CREATE INDEX idx_listings_search ON listings(title, description);

-- ─── Swaps ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS swaps (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  listing_id          TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  offered_listing_id  TEXT REFERENCES listings(id) ON DELETE SET NULL,
  proposer_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cash_offer_chf      REAL DEFAULT 0,
  status              TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'accepted', 'rejected', 'completed', 'cancelled'
  )),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_swaps_listing ON swaps(listing_id);
CREATE INDEX idx_swaps_proposer ON swaps(proposer_id);
CREATE INDEX idx_swaps_receiver ON swaps(receiver_id);
CREATE INDEX idx_swaps_status ON swaps(status);

-- ─── Transactions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  swap_id         TEXT NOT NULL REFERENCES swaps(id) ON DELETE CASCADE,
  buyer_id        TEXT NOT NULL REFERENCES users(id),
  seller_id       TEXT NOT NULL REFERENCES users(id),
  amount_chf      REAL NOT NULL,
  commission_chf  REAL NOT NULL,
  payment_method  TEXT CHECK (payment_method IN ('stripe', 'twint', 'escrow')),
  payment_status  TEXT DEFAULT 'pending' CHECK (payment_status IN (
    'pending', 'processing', 'completed', 'refunded', 'failed'
  )),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_swap ON transactions(swap_id);

-- ─── Messages ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  swap_id    TEXT NOT NULL REFERENCES swaps(id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_swap ON messages(swap_id);
CREATE INDEX idx_messages_created ON messages(created_at);

-- ─── Refresh Tokens ────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
