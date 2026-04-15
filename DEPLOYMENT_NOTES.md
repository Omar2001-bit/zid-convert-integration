# Zid-Convert Integration - Deployment Notes

## Problem Identified

The original webhook payload **did not include the cart note** because:
- Zid's webhook payload doesn't include `/cart/update-note` data by default
- The `notes` field in webhooks contains customer checkout notes, not cart notes

## Solution Implemented

### 1. Modified Frontend Script (v64.1)

The frontend script now injects the UUID into **TWO places**:

1. **Cart Note** (`/cart/update-note`) - Original method
2. **Customer Note** (`/api/customer-notes`) - NEW method

The customer note field **IS included in webhook payloads**, ensuring the UUID is captured.

**File:** `Public/index-new.html`

**Key Change:**
```javascript
// Inject into Customer Note (appears in webhooks)
fetch('/api/customer-notes', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ customer_note: 'convert_cid:' + cid })
}).then(function (res) {
    if (res.ok) {
        console.log(SCRIPT_NAMESPACE + ': [SUCCESS] CID synced to customer note.');
    }
}).catch(function (err) {
    console.warn(SCRIPT_NAMESPACE + ': [WARN] Failed to sync CID to customer note.');
});
```

### 2. Updated Webhook Controller

The webhook controller now extracts the UUID from **customer_note** as the primary source:

**File:** `src/controllers/webhooks/zidOrderEventsController.ts`

**Key Change:**
```typescript
// Extract from customer_note field (appears in webhooks)
let convertVisitorIdFromCustomerNote: string | null = null;
if (zidOrder.customer_note && typeof zidOrder.customer_note === 'string') {
    const cidMatch = zidOrder.customer_note.match(/convert_cid:([^\s]+)/);
    if (cidMatch && cidMatch[1]) {
        convertVisitorIdFromCustomerNote = cidMatch[1];
        console.log(`[WEBHOOK] Found convertVisitorId in customer_note: ${convertVisitorIdFromCustomerNote}`);
    }
}

// Use customer_note UUID if available, otherwise fall back to notes
if (convertVisitorIdFromCustomerNote) {
    convertVisitorIdFromNotes = convertVisitorIdFromCustomerNote;
}
```

## Deployment Steps

### Step 1: Update Frontend Script

1. Log into your Zid store admin panel
2. Go to **Settings → Custom Code** (or similar location)
3. Find the existing conversion tracking script
4. **Replace it** with the modified version from `Public/index-new.html`
5. Save and publish

### Step 2: Verify Backend is Running

Your backend is already deployed to Render:
- URL: `https://zid-convert-integration.onrender.com`
- Webhook endpoint: `https://zid-convert-integration.onrender.com/webhooks/zid/order-events`

### Step 3: Test the Flow

1. Visit your Zid store (e.g., `https://regal-honey.com/`)
2. Add a product to cart
3. Complete checkout
4. Check Render logs for webhook processing

**Expected logs:**
```
[WEBHOOK] Found convertVisitorId in customer_note: <UUID>
Firestore (by convertVisitorId from customer note)
```

### Step 4: Verify Context Retrieval

After a purchase, call the test endpoint from browser console:

```javascript
// Replace YOUR_UUID with the actual UUID from logs:
fetch('https://zid-convert-integration.onrender.com/api/test/verify-context?convertVisitorId=YOUR_UUID')
  .then(r => r.json())
  .then(console.log);
```

Expected response:
```json
{
  "success": true,
  "message": "Context found for convertVisitorId: YOUR_UUID",
  "data": { ... }
}
```

## Files Changed

| File | Change |
|------|--------|
| `Public/index-new.html` | Modified frontend script with dual injection |
| `src/controllers/webhooks/zidOrderEventsController.ts` | Added customer_note extraction |
| `src/routes/api/index.ts` | Added test endpoint |

## Testing Checklist

- [ ] Frontend script updated on Zid store
- [ ] UUID appears in webhook `customer_note` field
- [ ] Webhook logs show UUID extraction
- [ ] Context found in Firestore after purchase
- [ ] Test endpoint returns success

## Support

If you don't see the UUID in webhooks after updating the script:
1. Check Render logs for the webhook payload
2. Verify the `customer_note` field contains `convert_cid:UUID`
3. Check browser console for `[SUCCESS] CID synced to customer note.`
