export const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price_monthly: 0,
    price_annual: 0,
    stripe_price_id_monthly: null as string | null,
    stripe_price_id_annual: null as string | null,
    limits: {
      team_members: 5,
      projects: 3,
      clients: 5,
      storage_gb: 5,
      ai_requests_per_month: 0,
    },
    features: [
      'Up to 5 team members',
      'Up to 3 projects',
      'Up to 5 clients',
      'Task & Kanban boards',
      'Basic reporting',
      'Email support',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price_monthly: 49,
    price_annual: 39,
    stripe_price_id_monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || null,
    stripe_price_id_annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || null,
    limits: {
      team_members: 25,
      projects: -1,
      clients: -1,
      storage_gb: 100,
      ai_requests_per_month: 100,
    },
    features: [
      'Everything in Starter',
      'Up to 25 team members',
      'Unlimited projects & clients',
      'Content Calendar',
      'Ad Campaign Tracker',
      'Time Tracking & Invoices',
      'Client Portal',
      'AI Intelligence (100/mo)',
      'Priority support',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price_monthly: 149,
    price_annual: 119,
    stripe_price_id_monthly: process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID || null,
    stripe_price_id_annual: process.env.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID || null,
    limits: {
      team_members: -1,
      projects: -1,
      clients: -1,
      storage_gb: -1,
      ai_requests_per_month: 1000,
    },
    features: [
      'Everything in Pro',
      'Unlimited team members',
      'White-label branding',
      'Public API + Webhooks',
      'Facebook & Google Ads API',
      'AI Intelligence (1000/mo)',
      'Dedicated support',
      'Custom integrations',
    ],
  },
} as const;

export type PlanId = keyof typeof PLANS;

export function getPlan(planId: string) {
  return PLANS[planId as PlanId] || PLANS.starter;
}
