/** Subscription constants — enforced only on the backend. */
module.exports = {
  PLANS: {
    FREE: 'free',
    PRO: 'pro'
  },
  /** FREE: max TOTAL cases (active + archived + any other status). */
  FREE_CASE_LIMIT: 15,
  /** PRO monthly price in Tomans (ZarinPal currency=IRT). */
  PRO_MONTHLY_PRICE_TOMAN: 299000,
  PRO_CURRENCY: 'IRT',
  ERROR_CODE_QUOTA: 'CASE_QUOTA_EXCEEDED'
};
