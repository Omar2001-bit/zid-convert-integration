# Debugging Plan: Cart-Note Injection Issue

## Current Status
- Frontend cart note update returns 200 OK
- Webhook shows no `convert_cid` in order notes
- System falls back to IP-based heuristic (which fails because IPs don't match)

## Immediate Debugging Steps

### 1. Check Actual Order Notes in Zid Admin
- Log into Zid admin panel
- Find recent test order
- Check exact content of "notes" field
- Verify if `convert_cid:` is present but maybe in different format

### 2. Enhanced Logging Analysis
With the new debug logs, check for:
- `[DEBUG] Raw order notes received:` - Shows exactly what Zid sent
- `[DEBUG] No convert_cid pattern found in notes` - Indicates format issue
- `[DEBUG] No valid notes field in order object` - Indicates data structure issue

### 3. Client-Side Verification
In browser dev tools:
- Check Network tab for `/cart/update-note` request payload
- Verify `note: 'convert_cid:XXXXX'` format
- Check Console for any ZidConvertTracker errors

### 4. Timing Investigation
Possible timing issue where:
- Cart note is updated AFTER order creation
- Order webhook fires before note update completes

Test by:
- Adding delay before order placement in test scenario
- Checking if cart note appears after delay

## Additional Diagnostic Steps

### 5. Test Different Note Formats
Try updating the regex pattern in webhook controller:
Current: `/convert_cid:([^\s]+)/`
Alternatives to test:
- `/convert_cid:([a-zA-Z0-9\-]+)/` (specific UUID format)
- `/convert_cid:(.*?)"/` (if note is JSON formatted)
- `/convert_cid:([^\s,;]+)/` (allow common separators)

### 6. Manual Cart Note Inspection
Directly inspect cart contents via Zid API:
- Use Zid's cart API to retrieve current cart notes
- Verify `convert_cid` is actually being saved

### 7. Multiple Notes Handling
Check if other systems are overwriting cart notes:
- Does Zid allow multiple notes or just one?
- Are other plugins/extensions modifying cart notes?

## Next Steps Based on Findings

### If notes field is empty:
1. Investigate timing between cart update and order creation
2. Add explicit wait/check mechanism in client-side script

### If notes field has content but no convert_cid:
1. Check for conflicting scripts/plugins
2. Verify cart update endpoint accepts the note format

### If notes field has convert_cid but different format:
1. Adjust regex pattern in webhook controller
2. Update client-side script to match expected format

## Quick Test Procedure

1. Place test order with browser dev tools open
2. Monitor Network tab for:
   - `/cart/update-note` request (should show convert_cid in payload)
   - Webhook request (check notes field in response)
3. Check Console for any errors from ZidConvertTracker
4. Immediately check order in Zid admin after placement
5. Deploy enhanced logging and trigger another test order
6. Check Render logs for detailed debug output

## Expected Outcomes

Success - Cart note injection works:
- Webhook logs show: `[WEBHOOK] Found convertVisitorId in order notes: XXXXX`
- Attribution source shows: `Firestore (by convertVisitorId from cart note)`

Failure - Still using fallback:
- Webhook logs show: `[DEBUG] No convert_cid pattern found in notes`
- Attribution source shows: `Firestore (Heuristic: Time-based nearest match)` or similar fallback