import pg from 'pg';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://swapmart_app:swapmart_pass@localhost:5432/stz_swapmart';
const pool = new pg.Pool({ connectionString: DATABASE_URL });

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Seed categories
    const categoriesData = [
      { name: 'Trading Cards', slug: 'trading-cards', icon: 'cards' },
      { name: 'Electronics', slug: 'electronics', icon: 'cpu' },
      { name: 'Cars & Vehicles', slug: 'cars-vehicles', icon: 'car' },
      { name: 'Apartments & Housing', slug: 'apartments-housing', icon: 'home' },
      { name: 'Fashion', slug: 'fashion', icon: 'shirt' },
      { name: 'Furniture', slug: 'furniture', icon: 'sofa' },
      { name: 'Sports', slug: 'sports', icon: 'trophy' },
      { name: 'Collectibles', slug: 'collectibles', icon: 'gem' },
    ];

    const categoryIds = {};
    for (const cat of categoriesData) {
      const result = await client.query(
        'INSERT INTO categories (name, slug, icon) VALUES ($1, $2, $3) ON CONFLICT (slug) DO UPDATE SET name = $1 RETURNING id',
        [cat.name, cat.slug, cat.icon]
      );
      categoryIds[cat.slug] = result.rows[0].id;
    }

    // Seed demo users
    const passwordHash = await bcrypt.hash('demo1234', 10);
    const usersData = [
      { email: 'alice@example.com', username: 'alice_trader', name: 'Alice M.', location: 'Zurich, CH' },
      { email: 'bob@example.com', username: 'bob_swapper', name: 'Bob K.', location: 'Bern, CH' },
      { email: 'carol@example.com', username: 'carol_sells', name: 'Carol W.', location: 'Basel, CH' },
    ];

    const userIds = {};
    for (const u of usersData) {
      const result = await client.query(
        `INSERT INTO users (email, password_hash, username, name, location)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET name = $4
         RETURNING id`,
        [u.email, passwordHash, u.username, u.name, u.location]
      );
      userIds[u.username] = result.rows[0].id;
    }

    // Seed 12 sample listings
    const listingsData = [
      {
        seller: 'alice_trader', title: 'Charizard Holo 1st Edition', description: 'Near mint condition, original Base Set. Comes with protective sleeve and top loader.',
        price: 4500.00, category: 'trading-cards', condition: 'like_new', location: 'Zurich, CH', type: 'sell',
      },
      {
        seller: 'bob_swapper', title: 'iPhone 15 Pro Max 256GB', description: 'Space Black, purchased 6 months ago. Battery health 98%. Includes original box and charger.',
        price: 950.00, category: 'electronics', condition: 'like_new', location: 'Bern, CH', type: 'both',
      },
      {
        seller: 'carol_sells', title: 'VW Golf GTI 2020', description: '45,000 km, full service history, winter tires included. Manual transmission, tornado red.',
        price: 28500.00, category: 'cars-vehicles', condition: 'good', location: 'Basel, CH', type: 'sell',
      },
      {
        seller: 'alice_trader', title: '3.5 Room Apartment Sublet', description: 'Bright apartment in Zurich Seefeld. Available April-September. Furnished, balcony with lake view.',
        price: 2800.00, category: 'apartments-housing', condition: 'good', location: 'Zurich, CH', type: 'sell',
      },
      {
        seller: 'bob_swapper', title: 'Vintage Leather Jacket', description: 'Genuine Italian leather, size M. Beautiful patina, no tears or damage. Looking to swap for similar quality outerwear.',
        price: null, category: 'fashion', condition: 'good', location: 'Bern, CH', type: 'swap',
      },
      {
        seller: 'carol_sells', title: 'Herman Miller Aeron Chair', description: 'Size B, fully loaded with PostureFit. Purchased new 2 years ago. Perfect for home office.',
        price: 850.00, category: 'furniture', condition: 'like_new', location: 'Basel, CH', type: 'sell',
      },
      {
        seller: 'alice_trader', title: 'Canyon Aeroad CF SLX', description: 'Full Shimano Ultegra Di2 groupset. Size M. Carbon frame, excellent climbing bike.',
        price: 3200.00, category: 'sports', condition: 'good', location: 'Zurich, CH', type: 'both',
      },
      {
        seller: 'bob_swapper', title: 'Rolex Submariner Date', description: '2019, ref 116610LN. Box and papers. Running perfectly, recently serviced.',
        price: 12500.00, category: 'collectibles', condition: 'like_new', location: 'Bern, CH', type: 'sell',
      },
      {
        seller: 'carol_sells', title: 'Pokemon Booster Box - Scarlet & Violet', description: 'Factory sealed, 36 packs. Perfect for collectors or opening.',
        price: 180.00, category: 'trading-cards', condition: 'new', location: 'Basel, CH', type: 'sell',
      },
      {
        seller: 'alice_trader', title: 'MacBook Pro M3 14"', description: '18GB RAM, 512GB SSD. AppleCare+ until 2027. Space Gray, barely used.',
        price: 1800.00, category: 'electronics', condition: 'like_new', location: 'Zurich, CH', type: 'both',
      },
      {
        seller: 'bob_swapper', title: 'Nike Air Jordan 1 Retro High OG', description: 'Size 43 EU. Deadstock, Chicago colorway. Will swap for other rare sneakers.',
        price: 350.00, category: 'fashion', condition: 'new', location: 'Bern, CH', type: 'swap',
      },
      {
        seller: 'carol_sells', title: 'Vintage Swiss Railway Clock', description: 'Original SBB station clock by Mondaine. Wall-mounted, 25cm diameter. Iconic Swiss design.',
        price: 420.00, category: 'collectibles', condition: 'good', location: 'Basel, CH', type: 'sell',
      },
    ];

    for (const l of listingsData) {
      await client.query(
        `INSERT INTO listings (seller_id, title, description, price, category_id, condition, location, type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userIds[l.seller], l.title, l.description, l.price,
          categoryIds[l.category], l.condition, l.location, l.type,
        ]
      );
    }

    await client.query('COMMIT');
    console.log('Seed completed: 8 categories, 3 users, 12 listings.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

seed();
