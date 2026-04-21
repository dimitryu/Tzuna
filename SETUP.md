# 🚀 TZUNA SaaS — מדריך התקנה מלא

## מה בנינו
- 🔐 **Firebase Auth** — כניסה עם Google
- 🏗️ **Multi-Tenancy** — כל משתמש רואה רק את הנתונים שלו
- 💳 **Lemon Squeezy** — תשלומים (חד-פעמי + מנוי חודשי)  
- 📊 **Admin Dashboard** — מעקב אחר כל המנויים
- ⚡ **Firebase Functions** — Webhook לאוטומציה של תשלומים

---

## שלב 1 — צור פרויקט Firebase

1. לך ל [console.firebase.google.com](https://console.firebase.google.com)
2. **"Add project"** → שם: `tzuna-app`
3. **Authentication** → Sign-in method → הפעל **Google**
4. **Firestore Database** → Create database → **Production mode**
5. **Project Settings** → הוסף Web App → קבל `firebaseConfig`

---

## שלב 2 — הגדר Firestore Rules

בטרמינל Firebase:
```bash
npm install -g firebase-tools
firebase login
firebase init firestore
```

העתק את תוכן `firestore.rules` ל-`firestore.rules` בפרויקט ← `firebase deploy --only firestore`

---

## שלב 3 — הגדר TZUNA (index.html)

ב-`index.html` מצא את בלוק ה-`APP CONFIGURATION` ועדכן:

```javascript
const FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",           // ← מ-Firebase Console
  authDomain: "tzuna-app.firebaseapp.com",
  projectId: "tzuna-app",
  storageBucket: "tzuna-app.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};

const ADMIN_UID = "YOUR_FIREBASE_UID";       // ← הUID שלך (ראה שלב 4)
const TRIAL_DAYS = 7;                         // ימי ניסיון חינם
const MONTHLY_PRICE = "₪29 / חודש";
const LIFETIME_PRICE = "₪149 פעם אחת";
const LEMON_CHECKOUT_MONTHLY  = "https://dimitryu.lemonsqueezy.com/checkout/buy/PRODUCT_ID_MONTHLY";
const LEMON_CHECKOUT_LIFETIME = "https://dimitryu.lemonsqueezy.com/checkout/buy/PRODUCT_ID_LIFETIME";
```

---

## שלב 4 — קבל את ה-UID שלך (Admin)

1. פתח TZUNA → כנס עם Google שלך
2. פתח Developer Tools → Console
3. הרץ: `firebase.auth().currentUser.uid`
4. העתק את ה-UID ← הכנס ל-`ADMIN_UID` בקובץ

---

## שלב 5 — Lemon Squeezy

### א. צור חשבון וחנות
1. [app.lemonsqueezy.com](https://app.lemonsqueezy.com) → Create store
2. Currency: ILS (₪) — אם אין, USD

### ב. צור Products
**Product 1 — מנוי חודשי:**
- Name: `תזונה Premium — חודשי`
- Type: Subscription (Monthly)
- Price: ₪29 / $8

**Product 2 — Lifetime:**
- Name: `תזונה Premium — לכל החיים`
- Type: Single payment
- Price: ₪149 / $40

### ג. הגדר Checkout URL עם Firebase UID
בכל Checkout URL הוסף:
```
?checkout[custom][uid]={FIREBASE_UID}
```

בקוד ה-index.html זה נעשה אוטומטית:
```javascript
const checkoutUrl = LEMON_CHECKOUT_MONTHLY + 
  `?checkout[custom][uid]=${currentUser.uid}&checkout[email]=${currentUser.email}`;
```

---

## שלב 6 — Firebase Functions (Webhook)

```bash
firebase init functions   # JavaScript
cd functions
npm install
```

העתק `webhook.js` ל-`functions/index.js`

הגדר secrets:
```bash
firebase functions:config:set lemonsqueezy.secret="your_signing_secret"
firebase functions:config:set lemonsqueezy.monthly_product_id="12345"
firebase functions:config:set lemonsqueezy.lifetime_product_id="67890"
```

Deploy:
```bash
firebase deploy --only functions
```

קבל את ה-URL:
```
https://us-central1-YOUR_PROJECT.cloudfunctions.net/lemonsqueezyWebhook
```

### ד. הגדר Webhook ב-Lemon Squeezy
- **Settings → Webhooks → Add webhook**
- URL: העתק מהפסקה למעלה
- Signing secret: צור סיסמה ← הכנס ל-`lemonsqueezy.secret`
- Events להפעיל:
  - ✅ order_created
  - ✅ subscription_created
  - ✅ subscription_updated
  - ✅ subscription_cancelled
  - ✅ subscription_expired
  - ✅ subscription_payment_success
  - ✅ subscription_payment_failed

---

## שלב 7 — Deploy לGitHub Pages

1. Push `index.html` ל-GitHub
2. Settings → Pages → Source: main branch
3. אפליקציה זמינה ב: `https://dimitryu.github.io/Tzuna-Claude/`

---

## מה המשתמשים רואים

```
פתיחה ← כניסה עם Google
      ← 7 ימי ניסיון חינם
      ← אחרי 7 ימים → Paywall:
          [₪29/חודש]  [₪149 לכל החיים]
      ← אחרי תשלום → Lemon Squeezy → Webhook → Firebase → פתוח!
```

---

## מעקב הכנסות

**ב-Lemon Squeezy:** Dashboard → Revenue → Sales

**ב-Firebase Admin Dashboard** (בתוך האפליקציה):
- כנס עם ה-Google שלך (ADMIN_UID)
- לחץ על "👑 דשבורד מנהל" בתפריט

**בFirestore Console:**
```
tenants/
  {uid}/
    subscription/current → { status, plan, paidAt, ... }
    transactions/ → [ { type, amount, createdAt } ]
    appdata → { S object }
```

---

## מחירים מומלצים (ישראל)

| תוכנית | מחיר | הכנסה (100 משתמשים) |
|--------|------|---------------------|
| חודשי  | ₪29  | ₪2,900/חודש         |
| שנתי   | ₪199 | ₪19,900/שנה         |
| Lifetime| ₪149 | ₪14,900 (חד-פעמי)  |

---

## תמיכה

שאלות? פתח Issue ב-GitHub או שלח אימייל.
