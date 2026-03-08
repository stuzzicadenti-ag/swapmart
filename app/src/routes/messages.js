export default async function messagesRoutes(fastify) {
  const { db } = fastify;

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // GET /messages - Conversations inbox
  fastify.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await db.query(
        `SELECT
           o.id as offer_id,
           o.status as offer_status,
           l.title as listing_title,
           l.seller_id,
           o.buyer_id,
           CASE
             WHEN l.seller_id = $1 THEN bu.username
             ELSE su.username
           END as other_username,
           lm.content as last_message,
           lm.sender_id as last_sender_id,
           lm.created_at as last_message_at,
           COALESCE(uc.unread_count, 0) as unread_count
         FROM offers o
         JOIN listings l ON o.listing_id = l.id
         JOIN users bu ON o.buyer_id = bu.id
         JOIN users su ON l.seller_id = su.id
         LEFT JOIN LATERAL (
           SELECT content, sender_id, created_at
           FROM messages
           WHERE offer_id = o.id
           ORDER BY created_at DESC
           LIMIT 1
         ) lm ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) as unread_count
           FROM messages
           WHERE offer_id = o.id AND sender_id != $1 AND read_at IS NULL
         ) uc ON true
         WHERE (l.seller_id = $1 OR o.buyer_id = $1)
         ORDER BY lm.created_at DESC NULLS LAST, o.created_at DESC
         LIMIT 100`,
        [request.user.id]
      );

      return reply.view('messages/inbox.ejs', {
        user: request.user,
        conversations: result.rows,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('messages/inbox.ejs', {
        user: request.user,
        conversations: [],
      });
    }
  });

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

      // Check if chat is unlocked (offer must be accepted or completed)
      const chatUnlocked = offer.status === 'accepted' || offer.status === 'completed';

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
      if (chatUnlocked) {
        await db.query(
          'UPDATE messages SET read_at = NOW() WHERE offer_id = $1 AND sender_id != $2 AND read_at IS NULL',
          [parseInt(offerId), request.user.id]
        );
      }

      // Fetch other party's contact info if transaction is completed
      let contactInfo = null;
      if (offer.status === 'completed') {
        const otherUserId = request.user.id === offer.buyer_id ? offer.seller_id : offer.buyer_id;
        const contactResult = await db.query(
          'SELECT name, email, phone, address_line1, address_line2, city, postal_code, country FROM users WHERE id = $1',
          [otherUserId]
        );
        if (contactResult.rows.length > 0) {
          contactInfo = contactResult.rows[0];
        }
      }

      return reply.view('messages/chat.ejs', {
        user: request.user,
        offer,
        messages: messagesResult.rows,
        chatUnlocked,
        contactInfo,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/offers');
    }
  });

  // POST /messages/:offerId - Send message
  fastify.post('/:offerId', { preHandler: requireAuth }, async (request, reply) => {
    if (fastify.checkActionRateLimit && !fastify.checkActionRateLimit(request, reply, 'message')) return;
    const { offerId } = request.params;
    const { content } = request.body;

    if (!content || !content.trim()) {
      return reply.redirect(`/messages/${offerId}`);
    }

    if (content.length > 5000) {
      return reply.redirect(`/messages/${offerId}`);
    }

    try {
      // KYC check for messaging
      const kycResult = await db.query('SELECT kyc_verified FROM users WHERE id = $1', [request.user.id]);
      if (!kycResult.rows[0]?.kyc_verified) {
        return reply.redirect(`/messages/${offerId}?kyc=required`);
      }

      // Verify user is buyer or seller AND offer is accepted/completed
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

      // Block messages if offer is not accepted or completed
      if (offer.status !== 'accepted' && offer.status !== 'completed') {
        return reply.redirect(`/messages/${offerId}`);
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
