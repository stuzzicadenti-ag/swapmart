export function calculateCommission(amount, plan = 'free') {
  const tiers = {
    free: [
      { max: 50, rate: 0.05 },
      { max: 1000, rate: 0.08 },
      { max: 10000, rate: 0.06 },
      { max: Infinity, rate: 0.04 },
    ],
    seller_pro: [
      { max: 50, rate: 0.03 },
      { max: 1000, rate: 0.06 },
      { max: 10000, rate: 0.04 },
      { max: Infinity, rate: 0.03 },
    ],
    business: [
      { max: 50, rate: 0.02 },
      { max: 1000, rate: 0.04 },
      { max: 10000, rate: 0.03 },
      { max: Infinity, rate: 0.02 },
    ],
  };
  const planTiers = tiers[plan] || tiers.free;
  const tier = planTiers.find(t => amount < t.max) || planTiers[planTiers.length - 1];
  return { amount: Math.round(amount * tier.rate * 100) / 100, rate: tier.rate };
}
