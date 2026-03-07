'use strict';

var express = require('express');
var cors = require('cors');
var bcrypt = require('bcryptjs');
var jwt = require('jsonwebtoken');
var { v4: uuidv4 } = require('uuid');
var { DatabaseSync } = require('node:sqlite');
var fs = require('fs');
var path = require('path');

// ─── Config ────────────────────────────────────────────
var PORT = process.env.PORT || 3000;
var JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
var JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
var JWT_REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
var DB_PATH = process.env.DB_PATH || './data/swapmart.db';

// ─── Database ──────────────────────────────────────────
var dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

var db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── App ───────────────────────────────────────────────
var app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ─── Auth Middleware ────────────────────────────────────
function authenticate(req, res, next) {
  var header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  try {
    var payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
}

function generateTokens(userId) {
  var accessToken = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  var refreshToken = uuidv4();
  var expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), userId, refreshToken, expiresAt);

  return { accessToken: accessToken, refreshToken: refreshToken, expiresIn: 900 };
}

// ─── Auth Routes ───────────────────────────────────────
app.post('/api/v1/auth/register', function(req, res) {
  var body = req.body || {};
  if (!body.email || !body.password || !body.displayName) {
    return res.status(400).json({ error: 'email, password, and displayName are required' });
  }
  if (body.password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  var existing = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  var id = uuidv4();
  var hash = bcrypt.hashSync(body.password, 10);

  db.prepare('INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)')
    .run(id, body.email, hash, body.displayName);

  var tokens = generateTokens(id);
  var user = db.prepare('SELECT id, email, display_name, bio, location, avatar_url, rating, trade_count, verified, created_at FROM users WHERE id = ?').get(id);

  res.status(201).json({ ...tokens, user: formatUser(user) });
});

app.post('/api/v1/auth/login', function(req, res) {
  var body = req.body || {};
  if (!body.email || !body.password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  var user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email);
  if (!user || !bcrypt.compareSync(body.password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  var tokens = generateTokens(user.id);
  res.json({ ...tokens, user: formatUser(user) });
});

app.post('/api/v1/auth/refresh', function(req, res) {
  var body = req.body || {};
  if (!body.refreshToken) return res.status(400).json({ error: 'refreshToken is required' });

  var row = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(body.refreshToken);
  if (!row || new Date(row.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  // Delete old token, issue new pair
  db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);
  var tokens = generateTokens(row.user_id);
  var user = db.prepare('SELECT id, email, display_name, bio, location, avatar_url, rating, trade_count, verified, created_at FROM users WHERE id = ?').get(row.user_id);

  res.json({ ...tokens, user: formatUser(user) });
});

// ─── User Routes ───────────────────────────────────────
app.get('/api/v1/users/me', authenticate, function(req, res) {
  var user = db.prepare('SELECT id, email, display_name, bio, location, avatar_url, rating, trade_count, verified, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(formatUser(user));
});

app.patch('/api/v1/users/me', authenticate, function(req, res) {
  var body = req.body || {};
  var fields = [];
  var values = [];

  ['display_name', 'bio', 'location', 'avatar_url'].forEach(function(f) {
    var key = f === 'display_name' ? 'displayName' : f === 'avatar_url' ? 'avatarUrl' : f;
    if (body[key] !== undefined) {
      fields.push(f + ' = ?');
      values.push(body[key]);
    }
  });

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  fields.push("updated_at = datetime('now')");
  values.push(req.userId);

  db.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE id = ?').run(...values);
  var user = db.prepare('SELECT id, email, display_name, bio, location, avatar_url, rating, trade_count, verified, created_at FROM users WHERE id = ?').get(req.userId);
  res.json(formatUser(user));
});

app.get('/api/v1/users/:id', function(req, res) {
  var user = db.prepare('SELECT id, display_name, bio, location, avatar_url, rating, trade_count, verified, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(formatUser(user));
});

// ─── Listing Routes ────────────────────────────────────
app.get('/api/v1/listings', function(req, res) {
  var page = Math.max(1, parseInt(req.query.page) || 1);
  var limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  var offset = (page - 1) * limit;

  var where = ['l.status = ?'];
  var params = ['active'];

  if (req.query.category) { where.push('l.category = ?'); params.push(req.query.category); }
  if (req.query.type) { where.push('l.type = ?'); params.push(req.query.type); }
  if (req.query.minPrice) { where.push('l.price_chf >= ?'); params.push(parseFloat(req.query.minPrice)); }
  if (req.query.maxPrice) { where.push('l.price_chf <= ?'); params.push(parseFloat(req.query.maxPrice)); }
  if (req.query.q) { where.push("(l.title LIKE ? OR l.description LIKE ?)"); params.push('%' + req.query.q + '%', '%' + req.query.q + '%'); }

  var orderBy = 'l.created_at DESC';
  if (req.query.sort === 'price_asc') orderBy = 'l.price_chf ASC';
  if (req.query.sort === 'price_desc') orderBy = 'l.price_chf DESC';

  var whereClause = where.join(' AND ');
  var total = db.prepare('SELECT COUNT(*) as count FROM listings l WHERE ' + whereClause).get(...params).count;

  var rows = db.prepare(
    'SELECT l.*, u.display_name as seller_name, u.avatar_url as seller_avatar, u.rating as seller_rating ' +
    'FROM listings l JOIN users u ON l.seller_id = u.id WHERE ' + whereClause +
    ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?'
  ).all(...params.concat([limit, offset]));

  res.json({
    data: rows.map(formatListing),
    total: total,
    page: page,
    limit: limit
  });
});

app.post('/api/v1/listings', authenticate, function(req, res) {
  var body = req.body || {};
  if (!body.title || !body.category || !body.type) {
    return res.status(400).json({ error: 'title, category, and type are required' });
  }

  var id = uuidv4();
  db.prepare(
    'INSERT INTO listings (id, seller_id, title, description, category, type, price_chf, swap_for, condition, images, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.userId, body.title, body.description || '', body.category, body.type,
    body.priceCHF || 0, body.swapFor || '', body.condition || 'good',
    JSON.stringify(body.images || []), body.location || '');

  var listing = db.prepare(
    'SELECT l.*, u.display_name as seller_name, u.avatar_url as seller_avatar, u.rating as seller_rating ' +
    'FROM listings l JOIN users u ON l.seller_id = u.id WHERE l.id = ?'
  ).get(id);

  res.status(201).json(formatListing(listing));
});

app.get('/api/v1/listings/:id', function(req, res) {
  var listing = db.prepare(
    'SELECT l.*, u.display_name as seller_name, u.avatar_url as seller_avatar, u.rating as seller_rating ' +
    'FROM listings l JOIN users u ON l.seller_id = u.id WHERE l.id = ?'
  ).get(req.params.id);

  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  // Increment view count
  db.prepare('UPDATE listings SET view_count = view_count + 1 WHERE id = ?').run(req.params.id);
  listing.view_count++;

  res.json(formatListing(listing));
});

app.patch('/api/v1/listings/:id', authenticate, function(req, res) {
  var listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  if (listing.seller_id !== req.userId) return res.status(403).json({ error: 'Not the listing owner' });

  var body = req.body || {};
  var fields = [];
  var values = [];

  var allowed = { title: 'title', description: 'description', category: 'category', type: 'type',
    priceCHF: 'price_chf', swapFor: 'swap_for', condition: 'condition', location: 'location', status: 'status' };

  Object.keys(allowed).forEach(function(k) {
    if (body[k] !== undefined) {
      fields.push(allowed[k] + ' = ?');
      values.push(body[k]);
    }
  });

  if (body.images) { fields.push('images = ?'); values.push(JSON.stringify(body.images)); }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  fields.push("updated_at = datetime('now')");
  values.push(req.params.id);

  db.prepare('UPDATE listings SET ' + fields.join(', ') + ' WHERE id = ?').run(...values);

  var updated = db.prepare(
    'SELECT l.*, u.display_name as seller_name, u.avatar_url as seller_avatar, u.rating as seller_rating ' +
    'FROM listings l JOIN users u ON l.seller_id = u.id WHERE l.id = ?'
  ).get(req.params.id);

  res.json(formatListing(updated));
});

app.delete('/api/v1/listings/:id', authenticate, function(req, res) {
  var listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  if (listing.seller_id !== req.userId) return res.status(403).json({ error: 'Not the listing owner' });

  db.prepare("UPDATE listings SET status = 'removed', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// ─── Swap Routes ───────────────────────────────────────
app.post('/api/v1/swaps', authenticate, function(req, res) {
  var body = req.body || {};
  if (!body.listingId) return res.status(400).json({ error: 'listingId is required' });

  var listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(body.listingId);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  if (listing.seller_id === req.userId) return res.status(400).json({ error: 'Cannot swap with yourself' });

  var id = uuidv4();
  db.prepare(
    'INSERT INTO swaps (id, listing_id, offered_listing_id, proposer_id, receiver_id, cash_offer_chf) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, body.listingId, body.offeredListingId || null, req.userId, listing.seller_id, body.cashOfferCHF || 0);

  // Create initial message if provided
  if (body.message) {
    db.prepare('INSERT INTO messages (id, swap_id, sender_id, body) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), id, req.userId, body.message);
  }

  var swap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(id);
  res.status(201).json(formatSwap(swap));
});

app.get('/api/v1/swaps', authenticate, function(req, res) {
  var where = '(s.proposer_id = ? OR s.receiver_id = ?)';
  var params = [req.userId, req.userId];

  if (req.query.status) { where += ' AND s.status = ?'; params.push(req.query.status); }

  var swaps = db.prepare('SELECT * FROM swaps s WHERE ' + where + ' ORDER BY s.created_at DESC').all(...params);
  res.json(swaps.map(formatSwap));
});

app.post('/api/v1/swaps/:id/accept', authenticate, function(req, res) {
  var swap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(req.params.id);
  if (!swap) return res.status(404).json({ error: 'Swap not found' });
  if (swap.receiver_id !== req.userId) return res.status(403).json({ error: 'Only the receiver can accept' });
  if (swap.status !== 'pending') return res.status(400).json({ error: 'Swap is not pending' });

  db.prepare("UPDATE swaps SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  var updated = db.prepare('SELECT * FROM swaps WHERE id = ?').get(req.params.id);
  res.json(formatSwap(updated));
});

app.post('/api/v1/swaps/:id/reject', authenticate, function(req, res) {
  var swap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(req.params.id);
  if (!swap) return res.status(404).json({ error: 'Swap not found' });
  if (swap.receiver_id !== req.userId) return res.status(403).json({ error: 'Only the receiver can reject' });
  if (swap.status !== 'pending') return res.status(400).json({ error: 'Swap is not pending' });

  db.prepare("UPDATE swaps SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ status: 'rejected' });
});

// ─── Message Routes ────────────────────────────────────
app.get('/api/v1/messages/:swapId', authenticate, function(req, res) {
  var swap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(req.params.swapId);
  if (!swap) return res.status(404).json({ error: 'Swap not found' });
  if (swap.proposer_id !== req.userId && swap.receiver_id !== req.userId) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  var messages = db.prepare('SELECT * FROM messages WHERE swap_id = ? ORDER BY created_at ASC').all(req.params.swapId);
  res.json(messages.map(formatMessage));
});

app.post('/api/v1/messages/:swapId', authenticate, function(req, res) {
  var swap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(req.params.swapId);
  if (!swap) return res.status(404).json({ error: 'Swap not found' });
  if (swap.proposer_id !== req.userId && swap.receiver_id !== req.userId) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  var body = req.body || {};
  if (!body.body || body.body.length > 2000) {
    return res.status(400).json({ error: 'Message body required (max 2000 chars)' });
  }

  var id = uuidv4();
  db.prepare('INSERT INTO messages (id, swap_id, sender_id, body) VALUES (?, ?, ?, ?)')
    .run(id, req.params.swapId, req.userId, body.body);

  var msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  res.status(201).json(formatMessage(msg));
});

// ─── Payment Routes ────────────────────────────────────
var payments = require('./payments');
app.use('/api/v1', payments.createPaymentRoutes(db, authenticate));

// ─── Health ────────────────────────────────────────────
app.get('/api/v1/health', function(req, res) {
  res.json({ status: 'ok', version: '1.0.0' });
});

// ─── Formatters ────────────────────────────────────────
function formatUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email || undefined,
    displayName: u.display_name,
    bio: u.bio,
    location: u.location,
    avatarUrl: u.avatar_url,
    rating: u.rating,
    tradeCount: u.trade_count,
    verified: !!u.verified,
    createdAt: u.created_at
  };
}

function formatListing(l) {
  if (!l) return null;
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    category: l.category,
    type: l.type,
    priceCHF: l.price_chf,
    swapFor: l.swap_for,
    condition: l.condition,
    images: JSON.parse(l.images || '[]'),
    location: l.location,
    status: l.status,
    viewCount: l.view_count,
    seller: {
      id: l.seller_id,
      displayName: l.seller_name,
      avatarUrl: l.seller_avatar,
      rating: l.seller_rating
    },
    createdAt: l.created_at,
    updatedAt: l.updated_at
  };
}

function formatSwap(s) {
  if (!s) return null;
  return {
    id: s.id,
    listingId: s.listing_id,
    offeredListingId: s.offered_listing_id,
    proposerId: s.proposer_id,
    receiverId: s.receiver_id,
    cashOfferCHF: s.cash_offer_chf,
    status: s.status,
    createdAt: s.created_at,
    updatedAt: s.updated_at
  };
}

function formatMessage(m) {
  if (!m) return null;
  return {
    id: m.id,
    swapId: m.swap_id,
    senderId: m.sender_id,
    body: m.body,
    createdAt: m.created_at
  };
}

// ─── Start ─────────────────────────────────────────────
app.listen(PORT, function() {
  console.log('SwapMart API running on port ' + PORT);
});
