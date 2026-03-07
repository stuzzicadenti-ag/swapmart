#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var Database = require('better-sqlite3');

var DB_PATH = process.env.DB_PATH || './data/swapmart.db';
var MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Ensure data directory exists
var dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

var db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// SQLite doesn't have gen_random_uuid, so we adapt the SQL
var sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf8');

// Replace PostgreSQL-specific syntax for SQLite
sql = sql
  .replace(/gen_random_uuid\(\)::text/g, "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))")
  .replace(/TIMESTAMPTZ/g, 'TEXT')
  .replace(/NOW\(\)/g, "datetime('now')")
  .replace(/REAL DEFAULT 0/g, 'REAL DEFAULT 0.0');

// Execute migrations
var statements = sql.split(';').filter(function(s) { return s.trim().length > 0; });
for (var i = 0; i < statements.length; i++) {
  try {
    db.exec(statements[i]);
  } catch (err) {
    // Ignore "already exists" errors
    if (!err.message.includes('already exists')) {
      console.error('Migration error:', err.message);
      console.error('Statement:', statements[i].trim().substring(0, 80));
    }
  }
}

console.log('Migrations complete. Database:', DB_PATH);
db.close();
