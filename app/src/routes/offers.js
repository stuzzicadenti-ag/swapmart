import { calculateCommission } from '../utils/commission.js';

export default async function offersRoutes(fastify) {
  const { db } = fastify;

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // GET /offers - User's offers (received + sent)
  fastify.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      // Received offers (on user's listings)
      const receivedResult = await db.query(
        `SELECT o.*, l.title as listing_title, l.price as listing_price, u.username as buyer_name,
         (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as listing_image
         FROM offers o
         JOIN listings l ON o.listing_id = l.id
         JOIN users u ON o.buyer_id = u.id
         WHERE l.seller_id = $1
         ORDER BY o.created_at DESC
         LIMIT 100`,
        [request.user.id]
      );

      // Sent offers
      const sentResult = await db.query(
        `SELECT o.*, l.title as listing_title, l.price as listing_price, u.username as seller_name,
         (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as listing_image
         FROM offers o
         JOIN listings l ON o.listing_id = l.id
         JOIN users u ON l.seller_id = u.id
         WHERE o.buyer_id = $1
         ORDER BY o.created_at DESC
         LIMIT 100`,
        [request.user.id]
      );

      return reply.view('offers/list.ejs', {
        user: request.user,
        received: receivedResult.rows,
        sent: sentResult.rows,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('offers/list.ejs', {
        user: request.user,
        received: [],
        sent: [],
      });
    }
  });

  // POST /offers/:id/accept
  fastify.post('/:id/accept', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    try {
      // Verify the offer is on user's listing
      const offerResult = await db.query(
        `SELECT o.*, l.seller_id FROM offers o
         JOIN listings l ON o.listing_id = l.id
         WHERE o.id = $1 AND l.seller_id = $2 AND o.status = 'pending'`,
        [parseInt(id), request.user.id]
      );

      if (offerResult.rows.length === 0) {
        return reply.redirect('/offers');
      }

      await db.query("UPDATE offers SET status = 'accepted' WHERE id = $1", [parseInt(id)]);

      return reply.redirect('/offers');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/offers');
    }
  });

  // POST /offers/:id/reject
  fastify.post('/:id/reject', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    try {
      const offerResult = await db.query(
        `SELECT o.*, l.seller_id FROM offers o
         JOIN listings l ON o.listing_id = l.id
         WHERE o.id = $1 AND l.seller_id = $2 AND o.status = 'pending'`,
        [parseInt(id), request.user.id]
      );

      if (offerResult.rows.length === 0) {
        return reply.redirect('/offers');
      }

      await db.query("UPDATE offers SET status = 'rejected' WHERE id = $1", [parseInt(id)]);

      return reply.redirect('/offers');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/offers');
    }
  });

  // POST /offers/:id/complete - Mark completed, calculate commission
  fastify.post('/:id/complete', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    try {
      const offerResult = await db.query(
        `SELECT o.*, l.seller_id, l.price as listing_price, u.plan as seller_plan
         FROM offers o
         JOIN listings l ON o.listing_id = l.id
         JOIN users u ON l.seller_id = u.id
         WHERE o.id = $1 AND l.seller_id = $2 AND o.status = 'accepted'`,
        [parseInt(id), request.user.id]
      );

      if (offerResult.rows.length === 0) {
        return reply.redirect('/offers');
      }

      const offer = offerResult.rows[0];
      const amount = parseFloat(offer.cash_amount || offer.listing_price || 0);

      // Update offer status
      await db.query("UPDATE offers SET status = 'completed' WHERE id = $1", [parseInt(id)]);

      // Update listing status
      const newStatus = offer.type === 'swap' ? 'swapped' : 'sold';
      await db.query('UPDATE listings SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, offer.listing_id]);

      // Create transaction with commission (only if there's a cash amount)
      if (amount > 0) {
        const { amount: commissionAmount, rate } = calculateCommission(amount, offer.seller_plan);
        await db.query(
          `INSERT INTO transactions (offer_id, amount, commission, commission_rate, status)
           VALUES ($1, $2, $3, $4, 'completed')`,
          [parseInt(id), amount, commissionAmount, rate]
        );
      }

      return reply.redirect('/offers');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/offers');
    }
  });
}
