# NoCut — RevenueCat Integration Plan

**Version:** 1.0
**Date:** March 2026
**Status:** Draft (Aligned with PRD v1.2 & Architecture v2.0)
**Classification:** Confidential

---

## Table of Contents

- [1. Integration Overview](#1-integration-overview)
- [2. RevenueCat Web Billing vs. Stripe Billing](#2-revenuecat-web-billing-vs-stripe-billing)
- [3. RevenueCat Dashboard Configuration](#3-revenuecat-dashboard-configuration)
- [4. Web SDK Integration (Lovable App)](#4-web-sdk-integration-lovable-app)
- [5. Supabase Backend Integration](#5-supabase-backend-integration)
- [6. Credit System Integration](#6-credit-system-integration)
- [7. Stripe Direct Integration (Top-Up Credits)](#7-stripe-direct-integration-top-up-credits)
- [8. Webhook Processing](#8-webhook-processing)
- [9. Entitlement Enforcement](#9-entitlement-enforcement)
- [10. Testing Strategy](#10-testing-strategy)
- [11. Phase 3: Mobile SDK Integration](#11-phase-3-mobile-sdk-integration)
- [12. Monitoring & Analytics](#12-monitoring--analytics)
- [13. Implementation Checklist](#13-implementation-checklist)

---

## 1. Integration Overview

### 1.1 What RevenueCat Does for NoCut

RevenueCat is the subscription management layer for NoCut. It handles recurring subscription billing, entitlement management, and paywall presentation — providing a single source of truth for what features each user can access.

NoCut's payment architecture has two distinct flows:

- **Subscriptions (RevenueCat + Stripe):** Recurring Pro/Business plans managed by RevenueCat's Web Billing, which uses Stripe as the underlying payment processor. RevenueCat handles the purchase UI, subscription management portal, and recurring billing logic.
- **Top-Up Credits (Stripe Direct):** One-time credit pack purchases handled directly via Stripe Checkout, bypassing RevenueCat. This is because RevenueCat is optimized for subscriptions, not one-time consumable purchases.

### 1.2 System Boundaries

| Concern | Owner | Notes |
|---------|-------|-------|
| Subscription lifecycle (purchase, renewal, cancellation, expiration) | RevenueCat | Via Web Billing SDK + webhooks |
| Entitlement management (what features user can access) | RevenueCat | `ai_fill`, `hd_export`, `transcript_edit`, etc. |
| Payment processing (subscriptions) | Stripe (via RevenueCat) | RevenueCat manages Stripe Billing under the hood |
| Payment processing (top-up credits) | Stripe (direct) | Stripe Checkout sessions created by Supabase Edge Functions |
| Credit balance tracking | Supabase PostgreSQL | `credit_ledger` + `credit_transactions` tables |
| Credit allocation on subscription events | Supabase Edge Functions | Triggered by RevenueCat webhooks |
| User authentication & identity | Supabase Auth | `app_user_id` in RevenueCat = Supabase user UUID |

### 1.3 Prerequisites

Before starting integration:

- Stripe account created and verified
- RevenueCat account created (Pro plan for webhook access)
- Stripe account connected to RevenueCat (via RevenueCat dashboard → Account Settings → Connect Stripe)
- Supabase project provisioned with Edge Functions enabled
- Lovable app project initialized

---

## 2. RevenueCat Web Billing vs. Stripe Billing

RevenueCat offers two approaches for web payments. NoCut uses **Web Billing** (not Stripe Billing integration).

| Feature | Web Billing (chosen) | Stripe Billing Integration |
|---------|---------------------|---------------------------|
| Purchase UI | RevenueCat-managed checkout (customizable) | You build your own UI with Stripe Checkout |
| Subscription management portal | RevenueCat-provided | You build or use Stripe Customer Portal |
| Recurring billing logic | RevenueCat handles | Stripe Billing handles |
| Web SDK support | Full support via `@revenuecat/purchases-js` | Not supported in Web SDK |
| Web Paywalls | Supported (component-based) | Not supported |
| Stripe fees | Payment processing fee only (no Stripe Billing fees) | Stripe Billing fees apply |
| Future mobile sync | Seamless via same entitlement model | Requires additional mapping |

**Why Web Billing:** It provides a unified SDK experience across web and (future) mobile, handles the purchase UI and subscription management portal, and avoids Stripe Billing fees. The RevenueCat Web SDK (`@revenuecat/purchases-js`) gives us the same API patterns we'll use for mobile in Phase 3.

---

## 3. RevenueCat Dashboard Configuration

### 3.1 Project Setup

1. Create a new project in RevenueCat dashboard named "NoCut"
2. Connect the Stripe account (Account Settings → Connect Stripe Account)
3. Add a **Web Billing** platform under Apps & Providers:
   - Stripe Account: Select the connected account
   - Default Currency: USD
   - App Name: "NoCut"
   - Support Email: support@nocut.app

### 3.2 Products

Create the following products in the RevenueCat dashboard. RevenueCat will auto-create the corresponding Stripe products.

| RevenueCat Product ID | Type | Price | Billing Period |
|----------------------|------|-------|---------------|
| `nocut_pro_monthly` | Subscription | $14.99 | Monthly |
| `nocut_pro_annual` | Subscription | $119.88 | Annual |
| `nocut_business_monthly` | Subscription | $39.99 | Monthly |
| `nocut_business_annual` | Subscription | $359.88 | Annual |

### 3.3 Entitlements

Configure the following entitlements in RevenueCat:

| Entitlement ID | Products That Grant It | Description |
|---------------|----------------------|-------------|
| `pro` | `nocut_pro_monthly`, `nocut_pro_annual` | Pro tier access |
| `business` | `nocut_business_monthly`, `nocut_business_annual` | Business tier access (includes all Pro features) |

Feature-level entitlement mapping is handled in NoCut's backend based on the tier:

| Feature | Free | `pro` Entitlement | `business` Entitlement |
|---------|------|-------------------|----------------------|
| `ai_fill` max gap duration | 1s | 5s | 5s |
| `export_video` | 3/month, watermarked | Unlimited, no watermark | Unlimited, no watermark |
| `hd_export` | 720p | 1080p | 4K |
| `transcript_edit` | No | Yes | Yes |
| `multi_speaker` | No | No | Yes |
| `batch_processing` | No | No | Yes |
| `priority_queue` | No | No | Yes |

### 3.4 Offerings

| Offering ID | Description | Packages |
|------------|-------------|----------|
| `default` | Standard offering shown to all users | Pro Monthly, Pro Annual (highlighted), Business Monthly, Business Annual |
| `upgrade_prompt` | Shown when user hits free tier limits | Same packages, different messaging |
| `winback` | Shown to churned users | Pro Annual with discount (if configured) |

### 3.5 Webhook Configuration

1. Navigate to Project → Integrations → Webhooks
2. Add webhook endpoint: `https://<supabase-project-ref>.supabase.co/functions/v1/webhooks-revenuecat`
3. Set authorization header: `Bearer <REVENUECAT_WEBHOOK_SECRET>`
4. Enable for: Production purchases
5. Event filter: `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `PRODUCT_CHANGE`, `UNCANCELLATION`

---

## 4. Web SDK Integration (Lovable App)

### 4.1 Installation

In the Lovable app, install the RevenueCat Web SDK:

```bash
npm install @revenuecat/purchases-js
```

### 4.2 Initialization

Configure the SDK on app startup, after Supabase Auth session is established:

```typescript
import { Purchases } from '@revenuecat/purchases-js';

// Initialize after Supabase auth
const initRevenueCat = async (supabaseUserId: string) => {
  const purchases = Purchases.configure(
    'rcb_web_xxxxxxxxxxxxx', // RevenueCat Web Billing API key
    supabaseUserId           // Use Supabase user UUID as app_user_id
  );
  return purchases;
};
```

**Critical:** The `app_user_id` must be the Supabase Auth user UUID. This is how RevenueCat links subscription state to the authenticated NoCut user. Using the same ID ensures cross-platform sync when mobile apps are added in Phase 3.

### 4.3 Displaying Offerings

```typescript
const showPaywall = async () => {
  const offerings = await Purchases.getSharedInstance().getOfferings();
  const currentOffering = offerings.current;

  if (currentOffering) {
    // Render paywall UI with packages from currentOffering.availablePackages
    // Each package contains: identifier, product (price, title, description)
  }
};
```

### 4.4 Making a Purchase

```typescript
const purchasePackage = async (rcPackage: Package) => {
  try {
    const { customerInfo } = await Purchases.getSharedInstance()
      .purchase({ rcPackage });

    // Check entitlements after purchase
    if (customerInfo.entitlements.active['pro']) {
      // User now has Pro access
      // Credit allocation happens via webhook → Supabase Edge Function
      // Refresh credit balance from Supabase
    }
  } catch (error) {
    if (error.userCancelled) {
      // User cancelled — no action needed
    } else {
      // Handle error
    }
  }
};
```

### 4.5 Checking Entitlements (Client-Side)

```typescript
const checkEntitlements = async () => {
  const customerInfo = await Purchases.getSharedInstance()
    .getCustomerInfo();

  const isPro = customerInfo.entitlements.active['pro'] !== undefined;
  const isBusiness = customerInfo.entitlements.active['business'] !== undefined;

  return { isPro, isBusiness };
};
```

### 4.6 Subscription Management

RevenueCat Web Billing provides a hosted subscription management portal:

```typescript
const openManagement = async () => {
  const customerInfo = await Purchases.getSharedInstance()
    .getCustomerInfo();

  if (customerInfo.managementURL) {
    window.open(customerInfo.managementURL, '_blank');
  }
};
```

---

## 5. Supabase Backend Integration

### 5.1 User Identity Linking

On user sign-up, the Supabase Auth trigger creates the RevenueCat subscriber:

```sql
-- Supabase DB trigger on auth.users insert
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, supabase_uid, tier, created_at)
  VALUES (NEW.id, NEW.email, NEW.id, 'free', now());

  -- Allocate free tier monthly credits
  INSERT INTO public.credit_ledger (user_id, type, credits_granted, credits_remaining, expires_at)
  VALUES (NEW.id, 'monthly_allowance', 5, 5, now() + interval '2 months');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

The RevenueCat subscriber is automatically created when the Web SDK is configured with the Supabase user UUID — no separate API call needed.

### 5.2 Entitlement Verification (Server-Side)

For server-side entitlement checks (in Edge Functions), query RevenueCat's REST API:

```typescript
// Supabase Edge Function helper
const checkEntitlement = async (userId: string, entitlementId: string): Promise<boolean> => {
  // Check cached value first
  const cached = await getCachedEntitlement(userId);
  if (cached && cached.expires_at > Date.now()) {
    return cached.entitlements.includes(entitlementId);
  }

  // Fetch from RevenueCat
  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${userId}`,
    {
      headers: {
        'Authorization': `Bearer ${REVENUECAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await response.json();
  const activeEntitlements = Object.keys(data.subscriber.entitlements || {})
    .filter(key => data.subscriber.entitlements[key].expires_date === null
      || new Date(data.subscriber.entitlements[key].expires_date) > new Date());

  // Cache for 60 seconds
  await cacheEntitlement(userId, activeEntitlements, Date.now() + 60000);

  return activeEntitlements.includes(entitlementId);
};
```

### 5.3 Tier Resolution

Map RevenueCat entitlements to NoCut tier for feature-gating logic:

```typescript
const resolveUserTier = (activeEntitlements: string[]): 'free' | 'pro' | 'business' => {
  if (activeEntitlements.includes('business')) return 'business';
  if (activeEntitlements.includes('pro')) return 'pro';
  return 'free';
};

const getTierLimits = (tier: string) => ({
  free:     { maxFillDuration: 1, maxResolution: '720p', maxInputMinutes: 5, exportsPerMonth: 3, watermark: true },
  pro:      { maxFillDuration: 5, maxResolution: '1080p', maxInputMinutes: 30, exportsPerMonth: Infinity, watermark: false },
  business: { maxFillDuration: 5, maxResolution: '4k', maxInputMinutes: 120, exportsPerMonth: Infinity, watermark: false },
}[tier]);
```

---

## 6. Credit System Integration

### 6.1 How Credits Connect to RevenueCat

RevenueCat manages **what features** a user can access (entitlements). The credit system manages **how much** AI generation a user can do (consumption). They work together:

```
User submits EDL for AI fill
  → Supabase Edge Function checks RevenueCat entitlement (can they use AI fill? what's max gap duration?)
  → Supabase Edge Function checks credit balance (do they have enough credits?)
  → Both pass: deduct credits, enqueue AI fill job
  → Either fails: return appropriate error with upgrade/top-up prompt
```

### 6.2 Credit Allocation on Subscription Events

| RevenueCat Event | Credit Action |
|-----------------|--------------|
| `INITIAL_PURCHASE` | Allocate monthly credits based on tier (Pro: 60, Business: 200). Set `expires_at = now() + 2 months`. |
| `RENEWAL` | Allocate new batch of monthly credits for the new billing period. |
| `PRODUCT_CHANGE` (upgrade) | Allocate the difference in credits for the remainder of the current period (prorated). Update tier. |
| `PRODUCT_CHANGE` (downgrade) | Update tier. New credit allocation takes effect at next renewal. Existing credits remain valid until expiry. |
| `CANCELLATION` | No credit action. Existing credits remain valid until their individual expiry dates. |
| `EXPIRATION` | No immediate credit action. Monthly credits will expire naturally per their `expires_at`. Stop allocating new monthly credits. Update tier to free. Allocate 5 free-tier credits. |
| `UNCANCELLATION` | No credit action needed. User's existing credits are still valid. |
| `BILLING_ISSUE` | No immediate credit action. 3-day grace period. If billing succeeds (RENEWAL event), continue normally. If not (EXPIRATION), handle as expiration. |

### 6.3 Credit Balance Display

The Lovable app displays the user's credit balance by querying Supabase:

```typescript
// Query credit balance from Supabase
const getCreditBalance = async () => {
  const { data } = await supabase
    .from('credit_ledger')
    .select('type, credits_remaining, expires_at')
    .gt('credits_remaining', 0)
    .gt('expires_at', new Date().toISOString())
    .order('type', { ascending: true })  // monthly first
    .order('granted_at', { ascending: true });  // oldest first

  const monthly = data?.filter(r => r.type === 'monthly_allowance')
    .reduce((sum, r) => sum + r.credits_remaining, 0) || 0;
  const topUp = data?.filter(r => r.type === 'top_up')
    .reduce((sum, r) => sum + r.credits_remaining, 0) || 0;

  return { monthly, topUp, total: monthly + topUp };
};
```

---

## 7. Stripe Direct Integration (Top-Up Credits)

### 7.1 Why Stripe Direct (Not RevenueCat)

RevenueCat Web Billing is designed for recurring subscriptions. One-time credit pack purchases are better handled by Stripe Checkout directly because:

- No subscription lifecycle to manage
- Simpler webhook flow (single `checkout.session.completed` event)
- No RevenueCat overhead for non-subscription purchases
- Stripe Checkout provides a polished, PCI-compliant payment UI

### 7.2 Stripe Product Setup

Create the following products in the Stripe Dashboard (these are NOT configured in RevenueCat):

| Stripe Product ID | Name | Price | Type |
|-------------------|------|-------|------|
| `nocut_credits_10` | 10 Credits | $4.99 | One-time |
| `nocut_credits_30` | 30 Credits | $11.99 | One-time |
| `nocut_credits_75` | 75 Credits | $24.99 | One-time |
| `nocut_credits_200` | 200 Credits | $54.99 | One-time |

### 7.3 Checkout Flow

```typescript
// Supabase Edge Function: /credits/topup
const createTopUpSession = async (req: Request) => {
  const { userId, productId } = await req.json();

  // Validate product
  const creditMap: Record<string, number> = {
    'nocut_credits_10': 10,
    'nocut_credits_30': 30,
    'nocut_credits_75': 75,
    'nocut_credits_200': 200,
  };

  if (!creditMap[productId]) throw new Error('Invalid product');

  // Create Stripe Checkout session
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{ price: STRIPE_PRICE_IDS[productId], quantity: 1 }],
    metadata: { user_id: userId, credit_amount: creditMap[productId].toString() },
    success_url: `${APP_URL}/credits?success=true`,
    cancel_url: `${APP_URL}/credits?cancelled=true`,
  });

  return new Response(JSON.stringify({ url: session.url }));
};
```

### 7.4 Stripe Webhook Setup

1. In Stripe Dashboard → Webhooks → Add endpoint
2. URL: `https://<supabase-project-ref>.supabase.co/functions/v1/webhooks-stripe`
3. Events: `checkout.session.completed`, `charge.refunded`
4. Copy the webhook signing secret for verification

---

## 8. Webhook Processing

### 8.1 RevenueCat Webhook Handler

```typescript
// Supabase Edge Function: /webhooks/revenuecat
import { serve } from 'https://deno.land/std/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

serve(async (req) => {
  // Verify authorization header
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${Deno.env.get('REVENUECAT_WEBHOOK_SECRET')}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { event } = await req.json();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const userId = event.app_user_id;
  const eventType = event.type;

  switch (eventType) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
      await handlePurchaseOrRenewal(supabase, userId, event);
      break;
    case 'PRODUCT_CHANGE':
      await handleProductChange(supabase, userId, event);
      break;
    case 'CANCELLATION':
      await handleCancellation(supabase, userId, event);
      break;
    case 'EXPIRATION':
      await handleExpiration(supabase, userId, event);
      break;
    case 'BILLING_ISSUE':
      await handleBillingIssue(supabase, userId, event);
      break;
    case 'UNCANCELLATION':
      // No credit action needed
      break;
  }

  return new Response('OK', { status: 200 });
});
```

### 8.2 Key Webhook Handlers

**Purchase / Renewal → Allocate Monthly Credits:**

```typescript
const handlePurchaseOrRenewal = async (supabase, userId, event) => {
  const productId = event.product_id;
  const tier = resolveProductTier(productId);
  const creditAmount = { free: 5, pro: 60, business: 200 }[tier];

  // Update user tier
  await supabase.from('users').update({ tier }).eq('supabase_uid', userId);

  // Allocate monthly credits
  await supabase.from('credit_ledger').insert({
    user_id: userId,
    type: 'monthly_allowance',
    credits_granted: creditAmount,
    credits_remaining: creditAmount,
    expires_at: new Date(Date.now() + 2 * 30 * 24 * 60 * 60 * 1000).toISOString(),
    revenuecat_event_id: event.id,
  });
};
```

**Expiration → Downgrade to Free:**

```typescript
const handleExpiration = async (supabase, userId, event) => {
  // Downgrade tier
  await supabase.from('users').update({ tier: 'free' }).eq('supabase_uid', userId);

  // Allocate free tier credits
  await supabase.from('credit_ledger').insert({
    user_id: userId,
    type: 'monthly_allowance',
    credits_granted: 5,
    credits_remaining: 5,
    expires_at: new Date(Date.now() + 2 * 30 * 24 * 60 * 60 * 1000).toISOString(),
    revenuecat_event_id: event.id,
  });
};
```

### 8.3 Stripe Webhook Handler (Top-Ups)

```typescript
// Supabase Edge Function: /webhooks/stripe
serve(async (req) => {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  // Verify Stripe signature
  const event = stripe.webhooks.constructEvent(
    body, sig, Deno.env.get('STRIPE_WEBHOOK_SECRET')
  );

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata.user_id;
    const creditAmount = parseInt(session.metadata.credit_amount);

    // Allocate top-up credits (valid for 1 year)
    await supabase.from('credit_ledger').insert({
      user_id: userId,
      type: 'top_up',
      credits_granted: creditAmount,
      credits_remaining: creditAmount,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      stripe_payment_id: session.payment_intent,
    });
  }

  if (event.type === 'charge.refunded') {
    // Handle refund — deduct credits if available, flag for review if consumed
    await handleCreditRefund(supabase, event.data.object);
  }

  return new Response('OK', { status: 200 });
});
```

---

## 9. Entitlement Enforcement

### 9.1 Enforcement Points

| Endpoint | What's Checked | Failure Response |
|----------|---------------|-----------------|
| `POST /upload/initiate` | Tier limits (max duration, max resolution, max file size) | 403 + tier limit details + upgrade prompt |
| `POST /project/{id}/edl` | Entitlement (`ai_fill`) + max fill duration per gap + credit balance | 403 (entitlement) or 402 (credits) + appropriate prompt |
| `GET /export/{id}` | Export limit (3/month for free), watermark flag, resolution limit | 403 + upgrade prompt |
| `POST /project/{id}/transcript` | Entitlement (`transcript_edit`) | 403 + upgrade prompt |

### 9.2 Enforcement Middleware Pattern

```typescript
// Reusable middleware for Edge Functions
const enforceEntitlement = async (userId: string, required: string) => {
  const entitled = await checkEntitlement(userId, required);
  if (!entitled) {
    // Fetch offerings for the paywall
    const offerings = await fetchOfferings(userId);
    throw new EntitlementError(required, offerings);
  }
};

const enforceCredits = async (userId: string, requiredCredits: number) => {
  const balance = await getCreditBalance(userId);
  if (balance.total < requiredCredits) {
    throw new InsufficientCreditsError(balance.total, requiredCredits);
  }
};
```

---

## 10. Testing Strategy

### 10.1 Sandbox Testing

RevenueCat automatically uses Stripe's test mode for sandbox purchases. Use Stripe test cards:

| Card Number | Scenario |
|-------------|----------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 0341` | Payment fails (attach succeeds, charge fails) |
| `4000 0000 0000 9995` | Insufficient funds |

### 10.2 Test Scenarios

| # | Scenario | Expected Outcome |
|---|----------|-----------------|
| 1 | New user signs up | Free tier, 5 monthly credits allocated |
| 2 | Free user purchases Pro Monthly | Tier updates to Pro, 60 credits allocated, entitlements active |
| 3 | Pro user exports with AI fill (3s gap) | 3 credits deducted (monthly first), AI fill generated |
| 4 | Free user exhausts 5 credits, attempts AI fill | 402 error with top-up prompt |
| 5 | User purchases 30-credit top-up | 30 credits added to ledger (top_up type, 1-year expiry) |
| 6 | Pro user with monthly + top-up credits uses AI fill | Monthly credits consumed first, then top-up |
| 7 | Pro user cancels subscription | CANCELLATION event. Credits valid until expiry. Features active until period end. |
| 8 | Subscription expires | EXPIRATION event. Tier downgraded to free. 5 free credits allocated. |
| 9 | Pro user upgrades to Business | PRODUCT_CHANGE event. Tier updated. Prorated credits allocated. |
| 10 | Billing issue → grace period → recovery | BILLING_ISSUE → 3-day grace → RENEWAL (success) or EXPIRATION (failure) |
| 11 | Monthly credits roll over | January credits still available in February, expire start of March |
| 12 | Top-up credits survive subscription change | Top-up credits unaffected by tier changes, valid for 1 year |
| 13 | AI fill fails → credit refund | Credits automatically refunded to original ledger entries |
| 14 | Stripe refund on top-up | Credits deducted. If already consumed, flagged for manual review. |

### 10.3 RevenueCat Dashboard Testing

Use RevenueCat's "Send test webhook" feature to test webhook handling without making real purchases. Verify:

- Webhook reaches Supabase Edge Function
- Authorization header validation works
- Credit allocation is correct
- User tier updates in Supabase DB

---

## 11. Phase 3: Mobile SDK Integration

When iOS and Android apps are developed in Phase 3, the RevenueCat integration extends naturally:

### 11.1 Identity Sync

The mobile SDKs configure with the same Supabase user UUID as `app_user_id`, ensuring subscription state syncs across platforms automatically.

```swift
// iOS
Purchases.configure(withAPIKey: "appl_xxxxx", appUserID: supabaseUserId)

// Android
Purchases.configure(PurchasesConfiguration.Builder(this, "goog_xxxxx")
    .appUserID(supabaseUserId).build())
```

### 11.2 Cross-Platform Subscription Sync

A user who subscribes on web (Stripe via RevenueCat) will see the same entitlements when they open the iOS/Android app, and vice versa. RevenueCat handles this automatically via the shared `app_user_id`.

### 11.3 Credit Balance on Mobile

Credits are stored in Supabase PostgreSQL, which mobile apps access via Supabase JS/Swift/Kotlin clients. No additional credit sync infrastructure needed.

### 11.4 Mobile Top-Ups

On mobile, top-up credit packs would be configured as non-renewing in-app purchases in App Store / Play Store, managed by RevenueCat. This replaces the Stripe Direct flow used on web.

---

## 12. Monitoring & Analytics

### 12.1 RevenueCat Dashboard Metrics

RevenueCat provides built-in analytics:

- MRR, ARPU, LTV, churn rate
- Trial conversion rate
- Subscription renewal rate
- Revenue by product, offering, country
- Cohort analysis

### 12.2 Custom Metrics (Supabase + Datadog)

| Metric | Source | Alert |
|--------|--------|-------|
| Webhook processing latency | Supabase Edge Function logs | p99 > 5s |
| Webhook failure rate | Supabase Edge Function logs | > 1% failure rate |
| Credit allocation accuracy | Compare RevenueCat events vs. credit_ledger entries | Any mismatch |
| Entitlement check latency | RevenueCat API response time | p99 > 500ms |
| Top-up purchase conversion | Stripe + Supabase | Funnel drop-off > 50% |
| Credit exhaustion rate | Supabase credit_ledger | > 30% of active users hitting zero |
| Revenue per credit | MRR / total credits consumed | Trending below cost-per-credit threshold |

### 12.3 Alerting

- **RevenueCat webhook failures:** Alert if > 3 consecutive retries for any webhook
- **Stripe webhook failures:** Alert if `checkout.session.completed` not processed within 5 minutes
- **Credit balance anomalies:** Alert if any user's credit balance goes negative (should be impossible with atomic transactions — indicates a bug)
- **Entitlement drift:** Weekly audit comparing RevenueCat subscriber state vs. Supabase `users.tier` column

---

## 13. Implementation Checklist

### Phase 1 (MVP)

- [ ] Create RevenueCat project and connect Stripe account
- [ ] Configure Web Billing platform in RevenueCat dashboard
- [ ] Create subscription products in RevenueCat (Pro Monthly, Pro Annual, Business Monthly, Business Annual)
- [ ] Configure entitlements (`pro`, `business`)
- [ ] Configure default offering with all packages
- [ ] Set up RevenueCat webhook → Supabase Edge Function
- [ ] Implement RevenueCat webhook handler (all event types)
- [ ] Install `@revenuecat/purchases-js` in Lovable app
- [ ] Initialize SDK with Supabase user UUID
- [ ] Build paywall UI using RevenueCat offerings
- [ ] Implement purchase flow (subscription)
- [ ] Create Stripe products for top-up credit packs
- [ ] Implement Stripe Checkout flow for top-ups (Edge Function)
- [ ] Set up Stripe webhook → Supabase Edge Function
- [ ] Implement Stripe webhook handler (top-up credits)
- [ ] Build credit balance display in Lovable app
- [ ] Implement entitlement + credit enforcement middleware
- [ ] Build "low credits" prompt UI
- [ ] Build "upgrade" prompt UI
- [ ] Test all 14 scenarios from Section 10.2
- [ ] Set up monitoring and alerting

### Phase 3 (Mobile)

- [ ] Configure iOS app in RevenueCat dashboard
- [ ] Configure Android app in RevenueCat dashboard
- [ ] Create corresponding App Store / Play Store products
- [ ] Integrate RevenueCat iOS SDK
- [ ] Integrate RevenueCat Android SDK
- [ ] Verify cross-platform subscription sync
- [ ] Configure mobile top-up IAPs (non-renewing)
- [ ] Test cross-platform credit balance sync
