'use strict';

/**
 * SwapMart Payment Module
 *
 * Implements Money Guard escrow flow:
 * 1. Buyer pays → funds held in escrow
 * 2. Seller ships → tracking added
 * 3. Buyer confirms receipt → funds released to seller (minus commission)
 *
 * Commission: 3% capped at CHF 50. Pure swaps (0 cash) = 0% fee.
 */

var express = require('express');
var { v4: uuidv4 } = require('uuid');

var COMMISSION_RATE = 0.03;
var COMMISSION_CAP_CHF = 50;
var ESCROW_TIMEOUT_DAYS = 14;

// ─── Commission Calculator ─────────────────────────────
function calculateCommission(amountCHF) {
  if (!amountCHF || amountCHF <= 0) return 0;
  var commission = amountCHF * COMMISSION_RATE;
  return Math.min(commission, COMMISSION_CAP_CHF);
}

function createPaymentRoutes(db, authenticate) {
  var router = express.Router();

  // ─── Create Payment (buyer initiates escrow) ──────────
  router.post('/payments', authenticate, function(req, res) {
    var body = req.body || {};
    if (!body.swapId) return res.status(400).json({ error: 'swapId is required' });

    var swap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(body.swapId);
    if (!swap) return res.status(404).json({ error: 'Swap not found' });
    if (swap.status !== 'accepted') return res.status(400).json({ error: 'Swap must be accepted first' });
    if (swap.proposer_id !== req.userId) return res.status(403).json({ error: 'Only the proposer can pay' });

    // Check no duplicate payment
    var existing = db.prepare("SELECT id FROM transactions WHERE swap_id = ? AND payment_status != 'failed'").get(body.swapId);
    if (existing) return res.status(409).json({ error: 'Payment already exists for this swap' });

    var amount = swap.cash_offer_chf || 0;
    if (amount <= 0) return res.status(400).json({ error: 'No cash amount to pay (pure swap)' });

    var commission = calculateCommission(amount);
    var method = body.method || 'stripe';
    if (!['stripe', 'twint'].includes(method)) {
      return res.status(400).json({ error: 'Payment method must be stripe or twint' });
    }

    var id = uuidv4();
    db.prepare(
      'INSERT INTO transactions (id, swap_id, buyer_id, seller_id, amount_chf, commission_chf, payment_method, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, body.swapId, req.userId, swap.receiver_id, amount, commission, method, 'pending');

    // In production: create Stripe PaymentIntent or TWINT payment request here
    // For MVP: simulate immediate processing
    var paymentIntent = {
      provider: method,
      clientSecret: method === 'stripe' ? 'pi_simulated_' + id : null,
      twintUrl: method === 'twint' ? 'twint://payment?ref=' + id : null
    };

    res.status(201).json({
      id: id,
      swapId: body.swapId,
      amountCHF: amount,
      commissionCHF: commission,
      sellerReceivesCHF: +(amount - commission).toFixed(2),
      method: method,
      status: 'pending',
      escrowTimeoutDays: ESCROW_TIMEOUT_DAYS,
      paymentIntent: paymentIntent
    });
  });

  // ─── Confirm Payment (webhook or client callback) ─────
  router.post('/payments/:id/confirm', authenticate, function(req, res) {
    var tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.buyer_id !== req.userId) return res.status(403).json({ error: 'Not the buyer' });
    if (tx.payment_status !== 'pending') return res.status(400).json({ error: 'Payment not pending' });

    // In production: verify with Stripe/TWINT that payment succeeded
    db.prepare("UPDATE transactions SET payment_status = 'processing' WHERE id = ?").run(req.params.id);

    // Swap stays 'accepted' — moves to 'completed' only on /release (buyer confirms receipt)

    res.json({
      id: tx.id,
      status: 'processing',
      message: 'Funds held in escrow. Waiting for seller to ship.'
    });
  });

  // ─── Release Escrow (buyer confirms receipt) ──────────
  router.post('/payments/:id/release', authenticate, function(req, res) {
    var tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.buyer_id !== req.userId) return res.status(403).json({ error: 'Not the buyer' });
    if (tx.payment_status !== 'processing') return res.status(400).json({ error: 'Funds not in escrow' });

    // In production: trigger Stripe Transfer to seller's connected account
    db.prepare("UPDATE transactions SET payment_status = 'completed' WHERE id = ?").run(req.params.id);

    // Now mark swap as completed and update trade counts
    db.prepare("UPDATE swaps SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(tx.swap_id);
    db.prepare('UPDATE users SET trade_count = trade_count + 1 WHERE id = ?').run(tx.seller_id);
    db.prepare('UPDATE users SET trade_count = trade_count + 1 WHERE id = ?').run(tx.buyer_id);

    var sellerAmount = +(tx.amount_chf - tx.commission_chf).toFixed(2);

    res.json({
      id: tx.id,
      status: 'completed',
      sellerReceivedCHF: sellerAmount,
      commissionCHF: tx.commission_chf,
      message: 'Funds released to seller. Transaction complete.'
    });
  });

  // ─── Refund (dispute or timeout) ──────────────────────
  router.post('/payments/:id/refund', authenticate, function(req, res) {
    var tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.buyer_id !== req.userId) return res.status(403).json({ error: 'Not the buyer' });
    if (tx.payment_status !== 'processing') return res.status(400).json({ error: 'Cannot refund at this stage' });

    // In production: trigger Stripe Refund
    db.prepare("UPDATE transactions SET payment_status = 'refunded' WHERE id = ?").run(req.params.id);
    db.prepare("UPDATE swaps SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(tx.swap_id);

    res.json({
      id: tx.id,
      status: 'refunded',
      refundedCHF: tx.amount_chf,
      message: 'Full refund issued. Swap cancelled.'
    });
  });

  // ─── Get Payment Status ───────────────────────────────
  router.get('/payments/:id', authenticate, function(req, res) {
    var tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.buyer_id !== req.userId && tx.seller_id !== req.userId) {
      return res.status(403).json({ error: 'Not a participant' });
    }

    res.json({
      id: tx.id,
      swapId: tx.swap_id,
      buyerId: tx.buyer_id,
      sellerId: tx.seller_id,
      amountCHF: tx.amount_chf,
      commissionCHF: tx.commission_chf,
      sellerReceivesCHF: +(tx.amount_chf - tx.commission_chf).toFixed(2),
      method: tx.payment_method,
      status: tx.payment_status,
      createdAt: tx.created_at
    });
  });

  // ─── Check Expired Escrows (cron endpoint) ────────────
  router.post('/payments/check-timeouts', authenticate, function(req, res) {
    var expired = db.prepare(
      "SELECT * FROM transactions WHERE payment_status = 'processing' AND created_at < datetime('now', '-' || ? || ' days')"
    ).all(ESCROW_TIMEOUT_DAYS);

    for (var i = 0; i < expired.length; i++) {
      db.prepare("UPDATE transactions SET payment_status = 'refunded' WHERE id = ?").run(expired[i].id);
      db.prepare("UPDATE swaps SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(expired[i].swap_id);
    }

    res.json({
      processed: expired.length,
      escrowTimeoutDays: ESCROW_TIMEOUT_DAYS,
      message: expired.length > 0 ? expired.length + ' expired escrow(s) auto-refunded.' : 'No expired escrows found.'
    });
  });

  return router;
}

module.exports = { createPaymentRoutes: createPaymentRoutes, calculateCommission: calculateCommission };
