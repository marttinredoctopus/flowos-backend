import express, { Router, Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { authenticate } from '../middleware/auth';
import { pool } from '../config/database';
import { PLANS, getPlan } from '../config/plans';
import { env } from '../config/env';

const router = Router();

function getStripe() {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
}

async function countResource(orgId: string, table: string): Promise<number> {
  const r = await pool.query(`SELECT COUNT(*) FROM ${table} WHERE org_id=$1`, [orgId]);
  return parseInt(r.rows[0].count, 10);
}

// GET /api/billing/plans — public
router.get('/plans', (_req, res) => {
  const plans = Object.values(PLANS).map(({ stripe_price_id_monthly, stripe_price_id_annual, ...plan }) => plan);
  res.json(plans);
});

// GET /api/billing/current
router.get('/current', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgRes = await pool.query(
      `SELECT id, name, plan, billing_cycle, stripe_customer_id,
              subscription_starts_at, subscription_ends_at
       FROM organizations WHERE id=$1`,
      [req.user!.orgId]
    );
    const org = orgRes.rows[0];
    const planDetails = getPlan(org?.plan || 'starter');

    const [members, projects, clients] = await Promise.all([
      countResource(req.user!.orgId, 'users'),
      countResource(req.user!.orgId, 'projects'),
      countResource(req.user!.orgId, 'clients'),
    ]);

    res.json({
      plan: org?.plan || 'starter',
      plan_details: planDetails,
      billing_cycle: org?.billing_cycle || 'monthly',
      current_period_end: org?.subscription_ends_at,
      has_stripe_customer: !!org?.stripe_customer_id,
      usage: { team_members: members, projects, clients },
    });
  } catch (err) { next(err); }
});

// POST /api/billing/create-checkout
router.post('/create-checkout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { plan_id, billing_cycle = 'monthly' } = req.body;
    if (!PLANS[plan_id as keyof typeof PLANS] || plan_id === 'starter') {
      res.status(400).json({ error: 'Invalid plan' }); return;
    }

    const plan = PLANS[plan_id as keyof typeof PLANS];
    const priceId = billing_cycle === 'annual'
      ? plan.stripe_price_id_annual
      : plan.stripe_price_id_monthly;

    if (!priceId) {
      res.status(400).json({ error: 'Stripe price not configured. Set STRIPE_*_PRICE_ID env vars.' }); return;
    }

    const stripe = getStripe();
    const orgRes = await pool.query(
      'SELECT name, stripe_customer_id FROM organizations WHERE id=$1',
      [req.user!.orgId]
    );
    const org = orgRes.rows[0];

    let customerId = org?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: (req as any).user!.email || '',
        name: org?.name,
        metadata: { org_id: req.user!.orgId },
      });
      customerId = customer.id;
      await pool.query('UPDATE organizations SET stripe_customer_id=$1 WHERE id=$2', [customerId, req.user!.orgId]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${env.FRONTEND_URL}/settings/billing?success=true&plan=${plan_id}`,
      cancel_url: `${env.FRONTEND_URL}/settings/billing?cancelled=true`,
      metadata: { org_id: req.user!.orgId, plan_id, billing_cycle },
      subscription_data: { metadata: { org_id: req.user!.orgId, plan_id } },
      allow_promotion_codes: true,
    });

    res.json({ checkout_url: session.url });
  } catch (err: any) {
    next(err);
  }
});

// POST /api/billing/create-portal
router.post('/create-portal', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgRes = await pool.query('SELECT stripe_customer_id FROM organizations WHERE id=$1', [req.user!.orgId]);
    const customerId = orgRes.rows[0]?.stripe_customer_id;
    if (!customerId) {
      res.status(400).json({ error: 'No active subscription' }); return;
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.FRONTEND_URL}/settings/billing`,
    });
    res.json({ portal_url: session.url });
  } catch (err) { next(err); }
});

// POST /api/billing/webhook — Stripe events (raw body)
router.post('/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'];
    if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
      res.status(400).send('Missing signature or webhook secret'); return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      console.error('[Stripe] Webhook signature error:', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`); return;
    }

    console.log(`[Stripe] Event: ${event.type}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any;
          const { org_id, plan_id, billing_cycle } = session.metadata || {};
          if (org_id && plan_id) {
            await pool.query(
              `UPDATE organizations SET plan=$1, billing_cycle=$2,
               stripe_subscription_id=$3, subscription_starts_at=NOW()
               WHERE id=$4`,
              [plan_id, billing_cycle || 'monthly', session.subscription, org_id]
            );
            console.log(`[Stripe] Org ${org_id} upgraded to ${plan_id}`);
          }
          break;
        }
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          if (!invoice.subscription) break;
          const stripe = getStripe();
          const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const orgId = (sub as any).metadata?.org_id;
          if (orgId) {
            const periodEnd = (sub as any).current_period_end;
            await pool.query(
              'UPDATE organizations SET subscription_ends_at=$1 WHERE id=$2',
              [periodEnd ? new Date(periodEnd * 1000) : null, orgId]
            );
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object as any;
          const orgId = sub.metadata?.org_id;
          if (orgId) {
            await pool.query(
              `UPDATE organizations SET plan='starter', billing_cycle='monthly',
               stripe_subscription_id=NULL, subscription_ends_at=NULL WHERE id=$1`,
              [orgId]
            );
            console.log(`[Stripe] Org ${orgId} downgraded to starter`);
          }
          break;
        }
        case 'invoice.payment_failed': {
          console.warn('[Stripe] Payment failed for subscription:', (event.data.object as any).subscription);
          break;
        }
      }
    } catch (err) {
      console.error('[Stripe] Webhook handler error:', err);
    }

    res.json({ received: true });
  }
);

export default router;
