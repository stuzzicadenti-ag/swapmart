import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://swapmart_app:swapmart_pass@localhost:5432/stz_swapmart';
const pool = new pg.Pool({ connectionString: DATABASE_URL });

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        username VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255),
        bio TEXT,
        location VARCHAR(255),
        kyc_status VARCHAR(20) NOT NULL DEFAULT 'none',
        reputation_score INTEGER NOT NULL DEFAULT 0,
        plan VARCHAR(20) NOT NULL DEFAULT 'free',
        avatar_path TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Categories
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        icon VARCHAR(50),
        parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
      );
    `);

    // Listings
    await client.query(`
      CREATE TABLE IF NOT EXISTS listings (
        id SERIAL PRIMARY KEY,
        seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(12, 2),
        currency VARCHAR(10) NOT NULL DEFAULT 'CHF',
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        condition VARCHAR(20) NOT NULL,
        location VARCHAR(255),
        type VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Listing images
    await client.query(`
      CREATE TABLE IF NOT EXISTS listing_images (
        id SERIAL PRIMARY KEY,
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Offers
    await client.query(`
      CREATE TABLE IF NOT EXISTS offers (
        id SERIAL PRIMARY KEY,
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL,
        cash_amount DECIMAL(12, 2),
        swap_listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
        message TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        read_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Transactions
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
        amount DECIMAL(12, 2) NOT NULL,
        commission DECIMAL(12, 2) NOT NULL,
        commission_rate DECIMAL(5, 4) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Reviews
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reviewee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Indices
    await client.query('CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_listings_type ON listings(type);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at DESC);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON listing_images(listing_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_offers_listing ON offers(listing_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_offers_buyer ON offers(buyer_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_messages_offer ON messages(offer_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_transactions_offer ON transactions(offer_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_reviews_transaction ON reviews(transaction_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id);');

    // --- Admin system columns ---
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(255)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'Switzerland'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP`);

    // Flags table
    await client.query(`
      CREATE TABLE IF NOT EXISTS flags (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        listing_id INTEGER REFERENCES listings(id),
        user_id INTEGER,
        details TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        reviewed_by INTEGER,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Admin log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_log (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(50),
        target_id INTEGER,
        details TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Admin system indices
    await client.query('CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_flags_listing ON flags(listing_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_flags_created ON flags(created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_log(created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_banned ON users(banned)');

    // --- KYC Document Verification columns ---
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_type VARCHAR(50)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_path TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_verified BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMP`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMP`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_rejected_reason TEXT`);

    // --- Auction/Bidding system columns ---
    await client.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS listing_mode VARCHAR(20) DEFAULT 'fixed'`);
    await client.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS starting_price NUMERIC(12,2)`);
    await client.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS buy_now_price NUMERIC(12,2)`);
    await client.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS auction_end TIMESTAMP`);
    await client.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS min_bid_increment NUMERIC(12,2) DEFAULT 1.00`);

    // Bids table
    await client.query(`
      CREATE TABLE IF NOT EXISTS bids (
        id SERIAL PRIMARY KEY,
        listing_id INTEGER NOT NULL REFERENCES listings(id),
        bidder_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(12,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Bids indices
    await client.query('CREATE INDEX IF NOT EXISTS idx_bids_listing ON bids(listing_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_bids_bidder ON bids(bidder_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_bids_amount ON bids(listing_id, amount DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_listings_mode ON listings(listing_mode)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_listings_auction_end ON listings(auction_end)');

    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

migrate();
