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
