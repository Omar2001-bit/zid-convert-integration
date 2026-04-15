// == Zid-Convert Integration Script v64.1 - Enhanced Cart-Note Attribution ==
// MODIFIED: Now injects UUID into BOTH cart notes AND customer notes
// This ensures the UUID appears in webhook payloads
(function (window, document) {
    'use strict';

    var SCRIPT_NAMESPACE = 'ZidConvertTracker';
    console.log(SCRIPT_NAMESPACE + ': Enhanced Cart-Note Attribution Script (v64.1) initialized.');

    // --- Configuration ---
    var API_ENDPOINT = 'https://zid-convert-integration.onrender.com/api/capture-convert-context';
    var CONVERT_COOKIE_NAME = '_conv_v';
    var SESSION_STORAGE_KEY = SCRIPT_NAMESPACE + '_generated_visitor_id';
    var hasBeenCalled = false;
    var lastKnownZidCustomerId = null;

    // --- UTILITY FUNCTIONS ---
    function generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) { return crypto.randomUUID(); }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function getOrCreateConvertVisitorId() {
        let convertVisitorId = null;
        try {
            var rawCookieValue = ('; ' + document.cookie).split('; ' + CONVERT_COOKIE_NAME + '=').pop().split(';')[0];
            if (!rawCookieValue || rawCookieValue === document.cookie) { }
            else {
                var decodedCookieValue = decodeURIComponent(rawCookieValue);
                var match = decodedCookieValue.match(/^vi:([^~*]+)/) || decodedCookieValue.match(/~v:([^~]+)/);
                if (match && match[1]) {
                    convertVisitorId = match[1];
                }
            }
        } catch (e) { console.error(SCRIPT_NAMESPACE + ': Error reading Convert cookie.', e); }

        if (!convertVisitorId || convertVisitorId === '1') {
            let generatedId = sessionStorage.getItem(SESSION_STORAGE_KEY);
            if (!generatedId) {
                generatedId = generateUUID();
                sessionStorage.setItem(SESSION_STORAGE_KEY, generatedId);
            }
            return generatedId;
        }
        return convertVisitorId;
    }

    function getZidCustomerId() {
        if (window.customer && window.customer.id) { return window.customer.id.toString(); }
        if (window.customerHashed && window.customerHashed.external_id) { return window.customerHashed.external_id.toString(); }
        return null;
    }

    /**
     * MODIFIED: Injects UUID into BOTH cart notes AND customer notes
     * This ensures the ID appears in webhook payloads
     */
    function syncCidToZidCart(cid) {
        try {
            var headers = {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            };

            // Laravel / Zid CSRF Protection
            var csrfMeta = document.querySelector('meta[name="csrf-token"]');
            if (csrfMeta) {
                headers['X-CSRF-TOKEN'] = csrfMeta.getAttribute('content');
            } else {
                var xsrfToken = ('; ' + document.cookie).split('; XSRF-TOKEN=').pop().split(';')[0];
                if (xsrfToken) {
                    headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrfToken);
                }
            }

            // 1. Inject into Zid Cart Note (original method)
            fetch('/cart/update-note', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ note: 'convert_cid:' + cid })
            }).then(function (res) {
                if (res.ok) {
                    console.log(SCRIPT_NAMESPACE + ': [SUCCESS] CID synced to Zid Cart Note.');
                }
            }).catch(function (err) {
                console.warn(SCRIPT_NAMESPACE + ': [WARN] Failed to sync CID to cart note. Webhook fallback will be used.');
            });

            // 2. MODIFIED: Inject into Customer Note (appears in webhooks)
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
        } catch (e) {
            console.error(SCRIPT_NAMESPACE + ': Exception during cart sync.', e);
        }
    }

    // --- THE MAIN HANDLER ---
    function handleExperiencesEvaluated() {
        if (hasBeenCalled) return;
        hasBeenCalled = true;

        var convertVisitorId = getOrCreateConvertVisitorId();

        // --- Sync to Zid Cart immediately after CID is identified ---
        syncCidToZidCart(convertVisitorId);

        try {
            window._conv_q = window._conv_q || [];
            window._conv_q.push({
                what: 'identify',
                params: { visitorId: convertVisitorId }
            });
            console.log(SCRIPT_NAMESPACE + ': Executed Convert.identify with visitorId:', convertVisitorId);
        } catch (e) {
            console.error(SCRIPT_NAMESPACE + ': Error calling Convert.identify:', e);
        }

        var convertExperiments = window.convert.currentData.experiences;
        if (!convertExperiments || Object.keys(convertExperiments).length === 0) return;

        var experimentsToSend = [];
        var experimentIds = Object.keys(convertExperiments);
        for (var i = 0; i < experimentIds.length; i++) {
            var expId = experimentIds[i];
            if (convertExperiments[expId] && convertExperiments[expId].variation && convertExperiments[expId].variation.id) {
                experimentsToSend.push({
                    experienceId: String(expId),
                    variationId: String(convertExperiments[expId].variation.id)
                });
            }
        }
        if (experimentsToSend.length === 0) return;

        var zidCustomerId = getZidCustomerId();
        lastKnownZidCustomerId = zidCustomerId;

        var payload = {
            zidPagePath: document.location.pathname + document.location.search,
            convertVisitorId: convertVisitorId,
            convertBucketing: experimentsToSend,
            zidCustomerId: zidCustomerId
        };

        console.log(SCRIPT_NAMESPACE + ': [SENDING CONTEXT]', JSON.stringify(payload));
        var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(API_ENDPOINT, blob);
    }

    // --- PERSISTENT ID CHECK ---
    function checkForLogin() {
        var currentZidCustomerId = getZidCustomerId();
        if (currentZidCustomerId && lastKnownZidCustomerId !== currentZidCustomerId) {
            console.log(SCRIPT_NAMESPACE + ': [LOGIN DETECTED] Sending ID update.');
            handleExperiencesEvaluated();
            lastKnownZidCustomerId = currentZidCustomerId;
        } else if (!currentZidCustomerId && lastKnownZidCustomerId !== null) {
            lastKnownZidCustomerId = null;
        }
    }

    // --- SCRIPT EXECUTION ---
    lastKnownZidCustomerId = getZidCustomerId();

    window._conv_q = window._conv_q || [];
    window._conv_q.push({
        what: 'addListener',
        params: {
            event: 'snippet.experiences_evaluated',
            handler: handleExperiencesEvaluated
        }
    });
    console.log(SCRIPT_NAMESPACE + ': Event listener for Convert registered.');

    setInterval(checkForLogin, 3000);
    console.log(SCRIPT_NAMESPACE + ': Started polling for customer login state.');

})(window, document);
