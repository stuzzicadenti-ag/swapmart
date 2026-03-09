export default async function reviewsRoutes(fastify) {
  const { db } = fastify;

  // Auto-create table if not exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS seller_reviews (
      id SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(transaction_id, reviewer_id)
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_seller_reviews_seller ON seller_reviews(seller_id)');

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // POST /reviews/seller/:id - Rate a seller after a transaction
  fastify.post('/seller/:id', { preHandler: requireAuth }, async (request, reply) => {
    const sellerId = parseInt(request.params.id);
    const { transaction_id, rating, comment } = request.body;
    const ratingNum = parseInt(rating);

    if (isNaN(sellerId) || isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return reply.redirect(`/seller/${sellerId}/reviews?error=invalid`);
    }

    if (comment && comment.length > 2000) {
      return reply.redirect(`/seller/${sellerId}/reviews?error=too_long`);
    }

    const txId = parseInt(transaction_id);
    if (isNaN(txId)) return reply.redirect(`/seller/${sellerId}/reviews?error=invalid`);

    try {
      // Verify the transaction exists and the reviewer is the buyer
      const txResult = await db.query(
        `SELECT t.id, o.buyer_id, l.seller_id
         FROM transactions t
         JOIN offers o ON t.offer_id = o.id
         JOIN listings l ON o.listing_id = l.id
         WHERE t.id = $1 AND o.buyer_id = $2 AND l.seller_id = $3 AND t.status = 'completed'`,
        [txId, request.user.id, sellerId]
      );

      if (txResult.rows.length === 0) {
        return reply.redirect(`/seller/${sellerId}/reviews?error=not_allowed`);
      }

      // Check if already reviewed
      const existing = await db.query(
        'SELECT id FROM seller_reviews WHERE transaction_id = $1 AND reviewer_id = $2',
        [txId, request.user.id]
      );

      if (existing.rows.length > 0) {
        return reply.redirect(`/seller/${sellerId}/reviews?error=already_reviewed`);
      }

      await db.query(
        `INSERT INTO seller_reviews (transaction_id, reviewer_id, seller_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [txId, request.user.id, sellerId, ratingNum, comment || null]
      );

      // Update seller's reputation score (average rating * 20, roughly maps 1-5 to 20-100)
      const avgResult = await db.query(
        'SELECT AVG(rating)::numeric(3,2) as avg_rating, COUNT(*) as count FROM seller_reviews WHERE seller_id = $1',
        [sellerId]
      );
      const avgRating = parseFloat(avgResult.rows[0].avg_rating) || 0;
      const repScore = Math.round(avgRating * 20);
      await db.query('UPDATE users SET reputation_score = $1 WHERE id = $2', [repScore, sellerId]);

      return reply.redirect(`/seller/${sellerId}/reviews?success=submitted`);
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect(`/seller/${sellerId}/reviews?error=failed`);
    }
  });

  // GET /seller/:id/reviews - Show seller reviews
  fastify.get('/seller/:id/reviews', async (request, reply) => {
    const sellerId = parseInt(request.params.id);
    if (isNaN(sellerId)) return reply.redirect('/');

    try {
      const [sellerResult, reviewsResult, statsResult] = await Promise.all([
        db.query(
          'SELECT id, username, name, avatar_path, reputation_score, created_at FROM users WHERE id = $1',
          [sellerId]
        ),
        db.query(
          `SELECT sr.*, u.username as reviewer_name, u.avatar_path as reviewer_avatar
           FROM seller_reviews sr
           JOIN users u ON sr.reviewer_id = u.id
           WHERE sr.seller_id = $1
           ORDER BY sr.created_at DESC
           LIMIT 50`,
          [sellerId]
        ),
        db.query(
          `SELECT AVG(rating)::numeric(3,2) as avg_rating, COUNT(*) as review_count
           FROM seller_reviews WHERE seller_id = $1`,
          [sellerId]
        ),
      ]);

      if (sellerResult.rows.length === 0) {
        return reply.redirect('/');
      }

      const stats = statsResult.rows[0];
      const avgRating = parseFloat(stats.avg_rating) || 0;
      const reviewCount = parseInt(stats.review_count);

      // Trust score badge
      let trustBadge = null;
      if (reviewCount >= 50 && avgRating >= 4.5) {
        trustBadge = 'gold';
      } else if (reviewCount >= 20 && avgRating >= 4.0) {
        trustBadge = 'silver';
      } else if (reviewCount >= 5) {
        trustBadge = 'bronze';
      }

      // Check if current user can leave a review (has completed transactions with this seller)
      let reviewableTransactions = [];
      if (request.user && request.user.id !== sellerId) {
        const txResult = await db.query(
          `SELECT t.id as transaction_id, l.title as listing_title, t.created_at as completed_at
           FROM transactions t
           JOIN offers o ON t.offer_id = o.id
           JOIN listings l ON o.listing_id = l.id
           WHERE o.buyer_id = $1 AND l.seller_id = $2 AND t.status = 'completed'
           AND t.id NOT IN (SELECT transaction_id FROM seller_reviews WHERE reviewer_id = $1)
           ORDER BY t.created_at DESC`,
          [request.user.id, sellerId]
        );
        reviewableTransactions = txResult.rows;
      }

      const error = request.query.error === 'invalid' ? 'Invalid rating. Please provide a rating between 1 and 5.'
        : request.query.error === 'too_long' ? 'Comment is too long (max 2000 characters).'
        : request.query.error === 'not_allowed' ? 'You can only review sellers you have completed transactions with.'
        : request.query.error === 'already_reviewed' ? 'You have already reviewed this transaction.'
        : request.query.error === 'failed' ? 'Failed to submit review. Please try again.'
        : null;
      const success = request.query.success === 'submitted' ? 'Your review has been submitted. Thank you!' : null;

      return reply.view('reviews/seller.ejs', {
        user: request.user,
        seller: sellerResult.rows[0],
        reviews: reviewsResult.rows,
        avgRating,
        reviewCount,
        trustBadge,
        reviewableTransactions,
        error,
        success,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/');
    }
  });
}
