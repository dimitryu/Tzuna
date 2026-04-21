/**
 * Firebase Cloud Function — Lemon Squeezy Webhook Handler
 * 
 * העלה לפרויקט Firebase שלך:
 *   firebase deploy --only functions
 * 
 * ב-Lemon Squeezy הגדר Webhook URL:
 *   https://us-central1-YOUR_PROJECT.cloudfunctions.net/lemonsqueezyWebhook
 * 
 * אירועים שצריך להפעיל:
 *   - order_created        ← רכישה חד-פעמית
 *   - subscription_created ← מנוי חדש
 *   - subscription_updated ← עדכון מנוי
 *   - subscription_cancelled
 *   - subscription_expired
 *   - subscription_payment_success ← חידוש חיוב
 *   - subscription_payment_failed
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

// ─── CONFIG ───────────────────────────────────────────────
const LEMON_SQUEEZY_SIGNING_SECRET = functions.config().lemonsqueezy?.secret || '';
const LIFETIME_PRODUCT_ID = functions.config().lemonsqueezy?.lifetime_product_id || '';
const MONTHLY_PRODUCT_ID  = functions.config().lemonsqueezy?.monthly_product_id  || '';
// ──────────────────────────────────────────────────────────

/**
 * אמת חתימת Webhook מ-Lemon Squeezy
 */
function verifySignature(rawBody, signature) {
  if (!LEMON_SQUEEZY_SIGNING_SECRET) {
    console.warn('No signing secret configured — skipping verification');
    return true; // development mode
  }
  const hmac = crypto.createHmac('sha256', LEMON_SQUEEZY_SIGNING_SECRET);
  const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
  const checksum = Buffer.from(signature, 'utf8');
  try {
    return crypto.timingSafeEqual(digest, checksum);
  } catch {
    return false;
  }
}

/**
 * Main Webhook Handler
 */
exports.lemonsqueezyWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const signature = req.headers['x-signature'];
  const rawBody   = req.rawBody; // Firebase Functions מספקים rawBody

  if (!verifySignature(rawBody, signature || '')) {
    console.error('Invalid webhook signature');
    return res.status(401).send('Invalid signature');
  }

  const event    = req.headers['x-event-name'];
  const payload  = req.body;
  const meta     = payload.meta || {};
  const data     = payload.data || {};
  const attrs    = data.attributes || {};

  // ── חלץ Firebase UID מה-custom_data ──
  // ב-Checkout URL שלך: ?checkout[custom][uid]=FIREBASE_UID
  const uid = meta.custom_data?.uid || attrs.custom_data?.uid;
  if (!uid) {
    console.warn(`Event ${event} — no Firebase UID in custom_data`);
    return res.status(200).send('OK (no uid)'); // לא error — Lemon Squeezy יחזור ללא retry
  }

  const subRef = db.collection('tenants').doc(uid).collection('subscription').doc('current');

  console.log(`Processing ${event} for uid=${uid}`);

  try {
    switch (event) {

      // ── רכישה חד-פעמית (Lifetime) ──
      case 'order_created': {
        const productId = attrs.first_order_item?.product_id?.toString();
        if (productId !== LIFETIME_PRODUCT_ID.toString()) break;
        await subRef.set({
          plan:      'lifetime',
          status:    'active',
          paidAt:    admin.firestore.FieldValue.serverTimestamp(),
          orderId:   data.id?.toString() || '',
          productId: productId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await logTransaction(uid, 'lifetime_purchase', attrs.total || 0);
        break;
      }

      // ── מנוי חדש ──
      case 'subscription_created': {
        const nextBilling = attrs.renews_at ? new Date(attrs.renews_at) : null;
        await subRef.set({
          plan:              'monthly',
          status:            'active',
          paidAt:            admin.firestore.FieldValue.serverTimestamp(),
          subscriptionId:    data.id?.toString() || '',
          nextBillingDate:   nextBilling,
          updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await logTransaction(uid, 'subscription_created', attrs.total || 0);
        break;
      }

      // ── חידוש חיוב מוצלח ──
      case 'subscription_payment_success': {
        const nextBilling = attrs.renews_at ? new Date(attrs.renews_at) : null;
        await subRef.set({
          status:          'active',
          nextBillingDate: nextBilling,
          updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        break;
      }

      // ── עדכון מנוי ──
      case 'subscription_updated': {
        const lsStatus    = attrs.status; // 'active' | 'paused' | 'cancelled' | 'expired'
        const ourStatus   = mapLSStatus(lsStatus);
        const nextBilling = attrs.renews_at ? new Date(attrs.renews_at) : null;
        await subRef.set({
          status:          ourStatus,
          nextBillingDate: nextBilling,
          updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        break;
      }

      // ── ביטול ──
      case 'subscription_cancelled': {
        // cancelled = עדיין פעיל עד סוף התקופה
        const endsAt = attrs.ends_at ? new Date(attrs.ends_at) : null;
        await subRef.set({
          status:    'cancelled',
          endsAt:    endsAt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        break;
      }

      // ── פג תוקף ──
      case 'subscription_expired': {
        await subRef.set({
          status:    'expired',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        break;
      }

      // ── חיוב נכשל ──
      case 'subscription_payment_failed': {
        await subRef.set({
          status:    'past_due',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        break;
      }

      default:
        console.log(`Unhandled event: ${event}`);
    }

    return res.status(200).send('OK');

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).send('Internal error');
  }
});

function mapLSStatus(lsStatus) {
  const map = {
    active:    'active',
    paused:    'paused',
    cancelled: 'cancelled',
    expired:   'expired',
    past_due:  'past_due',
    unpaid:    'past_due',
  };
  return map[lsStatus] || lsStatus;
}

async function logTransaction(uid, type, amount) {
  try {
    await db.collection('tenants').doc(uid)
      .collection('transactions').add({
        type,
        amount: typeof amount === 'number' ? amount / 100 : 0, // agoras → shekels
        currency: 'ILS',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (e) {
    console.warn('logTransaction error:', e);
  }
}

// ─── Admin Dashboard Helper ─────────────────────────────────
/**
 * מחזיר רשימת כל המנויים הפעילים (לדשבורד)
 * קרא רק מתוך Admin SDK — לא חשוף ישירות ל-client
 */
exports.getSubscribers = functions.https.onCall(async (data, context) => {
  // בדוק שהמשתמש הוא admin
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admins only');
  }

  const snapshot = await db.collectionGroup('subscription')
    .where('status', '==', 'active')
    .orderBy('paidAt', 'desc')
    .limit(200)
    .get();

  return snapshot.docs.map(doc => ({
    uid:   doc.ref.parent.parent.id,
    ...doc.data(),
    paidAt:          doc.data().paidAt?.toDate?.()?.toISOString(),
    nextBillingDate: doc.data().nextBillingDate?.toDate?.()?.toISOString(),
    updatedAt:       doc.data().updatedAt?.toDate?.()?.toISOString(),
  }));
});
