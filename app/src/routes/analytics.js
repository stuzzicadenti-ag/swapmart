export default async function analyticsRoutes(fastify) {
  const { db } = fastify;

  // Auto-create tables if not exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS listing_views (
      id SERIAL PRIMARY KEY,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      viewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ip_address VARCHAR(45),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_listing_views_listing ON listing_views(listing_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_listing_views_listing_date ON listing_views(listing_id, created_at)');

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // GET /analytics/listings/:id - Listing analytics (owner only)
  fastify.get('/listings/:id', { preHandler: requireAuth }, async (request, reply) => {
    const listingId = parseInt(request.params.id);
    if (isNaN(listingId)) return reply.redirect('/listings');

    try {
      // Verify ownership
      const listing = await db.query(
        `SELECT l.*, c.name as category_name,
         (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as image
         FROM listings l
         JOIN categories c ON l.category_id = c.id
         WHERE l.id = $1 AND l.seller_id = $2`,
        [listingId, request.user.id]
      );

      if (listing.rows.length === 0) {
        return reply.redirect('/listings');
      }

      // Parallel queries: total views, favorite count, offer count, daily views (last 30 days)
      const [totalViews, favCount, offerCount, dailyViews, uniqueViewers] = await Promise.all([
        db.query('SELECT COUNT(*) FROM listing_views WHERE listing_id = $1', [listingId]),
        db.query('SELECT COUNT(*) FROM user_favorites WHERE listing_id = $1', [listingId]),
        db.query('SELECT COUNT(*) FROM offers WHERE listing_id = $1', [listingId]),
        db.query(
          `SELECT DATE(created_at) as day, COUNT(*) as views
           FROM listing_views
           WHERE listing_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
           GROUP BY DATE(created_at)
           ORDER BY day ASC`,
          [listingId]
        ),
        db.query(
          `SELECT COUNT(DISTINCT COALESCE(viewer_id::text, ip_address)) FROM listing_views WHERE listing_id = $1`,
          [listingId]
        ),
      ]);

      // Build 30-day array with zeros for missing days
      const dailyData = [];
      const dailyMap = new Map();
      for (const row of dailyViews.rows) {
        dailyMap.set(new Date(row.day).toISOString().split('T')[0], parseInt(row.views));
      }
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        dailyData.push({
          date: key,
          label: d.toLocaleDateString('en-CH', { month: 'short', day: 'numeric' }),
          views: dailyMap.get(key) || 0,
        });
      }

      return reply.view('analytics/listing.ejs', {
        user: request.user,
        listing: listing.rows[0],
        stats: {
          totalViews: parseInt(totalViews.rows[0].count),
          uniqueViewers: parseInt(uniqueViewers.rows[0].count),
          favoriteCount: parseInt(favCount.rows[0].count),
          offerCount: parseInt(offerCount.rows[0].count),
        },
        dailyData,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/listings');
    }
  });
}
