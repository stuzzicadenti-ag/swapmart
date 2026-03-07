export default async function messagesRoutes(fastify) {
  const { db } = fastify;

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // GET /messages/:offerId - Chat for an offer
  fastify.get('/:offerId', { preHandler: requireAuth }, async (request, reply) => {
    const { offerId } = request.params;

    try {
      // Verify user is buyer or seller
      const offerResult = await db.query(
        `SELECT o.*, l.title as listing_title, l.seller_id, u.username as buyer_name, s.username as seller_name
         FROM offers o
         JOIN listings l ON o.listing_id = l.id
         JOIN users u ON o.buyer_id = u.id
         JOIN users s ON l.seller_id = s.id
         WHERE o.id = $1`,
        [parseInt(offerId)]
      );

      if (offerResult.rows.length === 0) {
        return reply.redirect('/offers');
      }

      const offer = offerResult.rows[0];

      // Only buyer or seller can see messages
      if (request.user.id !== offer.buyer_id && request.user.id !== offer.seller_id) {
        return reply.redirect('/offers');
      }

      // Get messages
      const messagesResult = await db.query(
        `SELECT m.*, u.username as sender_name
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.offer_id = $1
         ORDER BY m.created_at ASC`,
        [parseInt(offerId)]
      );

      // Mark unread messages as read
      await db.query(
        'UPDATE messages SET read_at = NOW() WHERE offer_id = $1 AND sender_id != $2 AND read_at IS NULL',
        [parseInt(offerId), request.user.id]
      );

      return reply.view('messages/chat.ejs', {
        user: request.user,
        offer,
        messages: messagesResult.rows,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/offers');
    }
  });

  // POST /messages/:offerId - Send message
  fastify.post('/:offerId', { preHandler: requireAuth }, async (request, reply) => {
    const { offerId } = request.params;
    const { content } = request.body;

    if (!content || !content.trim()) {
      return reply.redirect(`/messages/${offerId}`);
    }

    if (content.length > 5000) {
      return reply.redirect(`/messages/${offerId}`);
    }

    try {
      // Verify user is buyer or seller
      const offerResult = await db.query(
        `SELECT o.*, l.seller_id
         FROM offers o
         JOIN listings l ON o.listing_id = l.id
         WHERE o.id = $1`,
        [parseInt(offerId)]
      );

      if (offerResult.rows.length === 0) {
        return reply.redirect('/offers');
      }

      const offer = offerResult.rows[0];
      if (request.user.id !== offer.buyer_id && request.user.id !== offer.seller_id) {
        return reply.redirect('/offers');
      }

      await db.query(
        'INSERT INTO messages (offer_id, sender_id, content) VALUES ($1, $2, $3)',
        [parseInt(offerId), request.user.id, content.trim()]
      );

      return reply.redirect(`/messages/${offerId}`);
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect(`/messages/${offerId}`);
    }
  });
}
