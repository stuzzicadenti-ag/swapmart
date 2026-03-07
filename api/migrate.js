#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var { DatabaseSync } = require('node:sqlite');

var DB_PATH = process.env.DB_PATH || './data/swapmart.db';

// Ensure data directory exists
var dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

var db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

var sql = fs.readFileSync(path.join(__dirname, 'migrations', '001_initial_sqlite.sql'), 'utf8');
db.exec(sql);

console.log('Migrations complete. Database:', DB_PATH);
db.close();
