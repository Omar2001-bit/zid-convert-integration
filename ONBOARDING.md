# Store Onboarding Manual

Step-by-step guide to onboard a new Zid store into the Zid-Convert integration.

---

## Prerequisites

Before you start, make sure you have:

1. **Backend deployed** with the `ADMIN_SECRET` environment variable set (any strong random string).
2. **Firebase Firestore** set up and accessible by the backend.
3. Access to the **Zid merchant dashboard** for the store being onboarded.
4. Access to the **Convert.com dashboard** for the store's account.

---

## Step 1: Gather Store Information

### From the Zid Dashboard

| Field | Where to Find It |
|-------|-----------------|
| **Store ID** | Zid merchant dashboard → Settings → Store ID. Also visible in any webhook payload under `store_id`. |
| **Store Name** | The merchant's store name (e.g., "REGAL HONEY"). For your reference only. |
| **Store Domain** | The live store URL, e.g., `https://regal-honey.com`. Must include `https://`. Used for CORS. |

### From the Convert.com Dashboard

Log into the Convert.com account that belongs to this store.

| Field | Where to Find It |
|-------|-----------------|
| **Account ID** | Convert.com → Account Settings → Account ID (numeric string, e.g., `100413475`) |
| **Project ID** | Convert.com → Project Settings → Project ID (numeric string, e.g., `100414640`) |
| **API Key Secret** | Convert.com → Account Settings → API Keys → copy the secret key (long hex string) |
| **Goal ID for Purchase** | Convert.com → Goals → find or create the "Purchase" goal → Goal ID (numeric, e.g., `100498319`) |

### Checkout Page CSS Selectors

You need the CSS selectors for the **email** and **phone** input fields on the store's checkout page. These are used to capture guest user contact info.

**How to find them:**

1. Go to the store's checkout page in a browser.
2. Right-click the **email input field** → Inspect Element.
3. Note the selector. Common patterns:
   - `#inputEmail` (by ID)
   - `input[name="email"]` (by name attribute)
   - `input[type="email"]` (by type)
   - `.login_guest-container input[id*="email"]` (by class + partial ID)
4. Repeat for the **phone input field**. Common patterns:
   - `#mobile`
   - `input[name="mobile"]`
   - `input[type="tel"]`
5. Also note the **checkout URL patterns** — what keywords appear in the URL when a user is on the checkout page (e.g., `checkout`, `payment`, `/cart`).

---

## Step 2: Create the Store Config via Admin API

Send a POST request to create the store configuration in Firestore.

### Endpoint

```
POST {YOUR_BACKEND_URL}/api/admin/store-config
```

### Headers

```
Content-Type: application/json
X-Admin-Secret: {your ADMIN_SECRET env var value}
```

### Body

```json
{
  "storeId": "210142",
  "storeName": "REGAL HONEY",
  "storeDomain": "https://regal-honey.com",
  "convertAccountId": "100413475",
  "convertProjectId": "100414640",
  "convertApiKeySecret": "e1b9da4f...",
  "convertGoalIdForPurchase": 100498319,
  "checkoutConfig": {
    "emailSelectors": [
      "#inputEmail",
      "input[name=\"email\"]",
      "input[type=\"email\"]"
    ],
    "phoneSelectors": [
      "#mobile",
      "input[name=\"mobile\"]",
      "input[type=\"tel\"]"
    ],
    "checkoutUrlKeywords": ["checkout", "payment", "/cart"],
    "guestLoginPattern": {
      "path": "/auth/login",
      "search": "checkout"
    }
  },
  "active": true
}
```

### Example curl

```bash
curl -X POST https://zid-convert-integration.onrender.com/api/admin/store-config \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -d '{
    "storeId": "210142",
    "storeName": "REGAL HONEY",
    "storeDomain": "https://regal-honey.com",
    "convertAccountId": "100413475",
    "convertProjectId": "100414640",
    "convertApiKeySecret": "e1b9da4fXXXXXXXX",
    "convertGoalIdForPurchase": 100498319,
    "checkoutConfig": {
      "emailSelectors": ["#inputEmail", "input[name=\"email\"]", "input[type=\"email\"]"],
      "phoneSelectors": ["#mobile", "input[name=\"mobile\"]", "input[type=\"tel\"]"],
      "checkoutUrlKeywords": ["checkout", "payment", "/cart"],
      "guestLoginPattern": { "path": "/auth/login", "search": "checkout" }
    },
    "active": true
  }'
```

### Response

The response includes the **webhook URL** and **webhook token** for this store:

```json
{
  "message": "Store config saved for REGAL HONEY (210142).",
  "storeId": "210142",
  "zidWebhookSecretToken": "token_wGZ4yBv7kLpX9eRj",
  "webhookUrl": "https://zid-convert-integration.onrender.com/webhooks/zid/order-events?token=token_wGZ4yBv7kLpX9eRj"
}
```

**Save the `webhookUrl`** — you'll need it in Step 3.

---

## Step 3: Register the Zid Webhook

### Option A: Automatic (via OAuth)

1. Direct the merchant to your app's OAuth URL:
   ```
   {YOUR_BACKEND_URL}/auth/zid
   ```
2. The merchant authorizes the app in Zid.
3. The OAuth callback automatically:
   - Detects the store ID
   - Creates a skeleton store config if one doesn't exist
   - Registers the webhook with the per-store token

**Note:** If you already created the store config in Step 2, the OAuth flow will use the existing config's webhook token.

### Option B: Manual (via Zid Dashboard)

1. Go to the Zid merchant dashboard → Settings → Webhooks.
2. Add a new webhook:
   - **Event:** Order Created
   - **URL:** The `webhookUrl` from Step 2's response
3. Save.

---

## Step 4: Add the Frontend Script to the Store

1. Open `client-side-modified.js` in this repository.
2. Change the `STORE_ID` variable at the top of the script:

```javascript
// Line 22 — Change this to the new store's Zid Store ID
var STORE_ID = '210142';  // <-- Replace with the actual store ID
```

3. That's it for the script configuration. The script automatically:
   - Fetches the checkout CSS selectors from the backend using the store ID
   - Falls back to default selectors if the backend is unreachable
   - Sends the `storeId` with every payload for multi-tenant isolation

4. **Install the script** in the store's theme:
   - Go to the Zid merchant dashboard → Online Store → Theme → Custom Code
   - Paste the script (with the correct `STORE_ID`) into the footer scripts section
   - Make sure the Convert.com tracking script is also installed on the same pages

---

## Step 5: Verify the Integration

### 5a. Verify Config Fetch

Open the store's website, open browser DevTools (F12) → Console. You should see:

```
ZidConvertTracker: [CONFIG] Store config loaded from backend: {...}
ZidConvertTracker: Script fully initialized for store 210142
```

### 5b. Verify Context Capture

1. Browse a page where a Convert.com experiment is running.
2. In the console, you should see:
   ```
   ZidConvertTracker: [SENDING CONTEXT]
   ```
3. Verify in Firestore: check `conversionContext` collection for a document with the correct `storeId`.

### 5c. Verify Webhook (Logged-in User)

Simulate or place a test order with a logged-in customer:

```bash
curl -X POST "https://zid-convert-integration.onrender.com/webhooks/zid/order-events?token=TOKEN_FROM_STEP_2" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "order.create",
    "store_id": "210142",
    "order_id": "TEST-001",
    "payload": {
      "id": 99999,
      "order_number": "TEST-001",
      "order_total": "150.00",
      "currency_code": "SAR",
      "customer": { "id": 12345 },
      "products": [
        { "id": 1, "name": "Test Product", "price": "150.00", "quantity": 1, "sku": "TEST-SKU" }
      ],
      "customer_note": ""
    }
  }'
```

### 5d. Verify Guest User Checkout Capture

1. Go to the store's checkout page as a guest (not logged in).
2. Fill in the email and phone fields.
3. In the console, you should see:
   ```
   ZidConvertTracker: [SENDING GUEST CONTACT]
   ```

---

## Step 6: Verify in Convert.com

1. Log into the Convert.com account for the store.
2. Go to the experiment's results.
3. Check that the goal shows conversions and revenue being tracked.

---

## Updating a Store Config

To update an existing store's config (e.g., change CSS selectors or Convert credentials), just POST to the same admin endpoint again with the same `storeId`. It will overwrite the existing config.

```bash
curl -X POST https://zid-convert-integration.onrender.com/api/admin/store-config \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -d '{ "storeId": "210142", "storeName": "REGAL HONEY", "storeDomain": "https://regal-honey.com", "convertAccountId": "100413475", "convertProjectId": "100414640", "convertApiKeySecret": "NEW_KEY_HERE", "convertGoalIdForPurchase": 100498319 }'
```

**Note:** The config cache refreshes every 5 minutes. Changes take effect within 5 minutes without a restart.

---

## Viewing a Store Config (Admin)

```bash
curl https://zid-convert-integration.onrender.com/api/admin/store-config/210142 \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET"
```

---

## Quick Reference: Required Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `storeId` | string | Yes | Zid store ID |
| `storeName` | string | Yes | Display name |
| `storeDomain` | string | Yes | Full URL with https:// (for CORS) |
| `convertAccountId` | string | Yes | Convert.com account ID |
| `convertProjectId` | string | Yes | Convert.com project ID |
| `convertApiKeySecret` | string | Yes | Convert.com API key secret |
| `convertGoalIdForPurchase` | number | Yes | Convert.com goal ID for purchase tracking |
| `checkoutConfig` | object | No | CSS selectors for checkout fields (defaults provided) |
| `active` | boolean | No | Whether this store is active (default: true) |

---

## Environment Variables (Backend)

These are set once on the backend and shared across all stores:

| Variable | Purpose |
|----------|---------|
| `ADMIN_SECRET` | Secret for admin API endpoints (store config management) |
| `MY_BACKEND_URL` | The backend's public URL (e.g., `https://zid-convert-integration.onrender.com`) |
| `PORT` | Server port (default: 3000) |
| `ZID_CLIENT_ID` | Zid OAuth app client ID |
| `ZID_CLIENT_SECRET` | Zid OAuth app client secret |
| `ZID_AUTH_URL` | Zid OAuth URL |
| `ZID_BASE_API_URL` | Zid API base URL |
| `EXCHANGERATE_API_KEY` | For currency conversion to SAR |

Per-store credentials (Convert account/project/API key, webhook tokens) are stored in **Firestore**, NOT in env vars.

---

## Firestore Indexes Required

After deploying, create these composite indexes in the Firebase Console under Firestore → Indexes:

Collection: `conversionContext`

1. `storeId` ASC, `zidCustomerId` ASC, `timestamp` DESC
2. `storeId` ASC, `guestEmail` ASC, `timestamp` DESC
3. `storeId` ASC, `guestPhone` ASC, `timestamp` DESC
4. `storeId` ASC, `zidCustomerId` ASC, `consumed` ASC, `timestamp` DESC
