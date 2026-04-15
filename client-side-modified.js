// == Zid-Convert Integration Script v65.0 - Email/Phone Guest Attribution ==
// Guest users are tracked by capturing email/phone at checkout
// Logged-in users are tracked via zidCustomerId
(function (window, document) {
    'use strict';

    var SCRIPT_NAMESPACE = 'ZidConvertTracker';
    console.log(SCRIPT_NAMESPACE + ': Email/Phone Guest Attribution Script (v65.0) initialized.');

    // --- Configuration ---
    var API_ENDPOINT = 'https://zid-convert-integration.onrender.com/api/capture-convert-context';
    var CONVERT_COOKIE_NAME = '_conv_v';
    var SESSION_STORAGE_KEY = SCRIPT_NAMESPACE + '_generated_visitor_id';
    var hasBeenCalled = false;
    var lastKnownZidCustomerId = null;
    var lastSentEmail = null;
    var lastSentPhone = null;

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

    // --- CHECKOUT EMAIL/PHONE CAPTURE ---
    // Monitors checkout form fields to capture guest contact info.
    // This links the frontend convertVisitorId to the guest's email/phone,
    // which also appears in the Zid webhook payload for matching.
    function captureCheckoutContact() {
        var convertVisitorId = getOrCreateConvertVisitorId();
        var zidCustomerId = getZidCustomerId();

        // Skip for logged-in users — they are tracked by zidCustomerId
        if (zidCustomerId) {
            console.log(SCRIPT_NAMESPACE + ': Logged-in user on checkout, skipping contact capture.');
            return;
        }

        console.log(SCRIPT_NAMESPACE + ': Guest user on checkout page. Monitoring for email/phone fields.');

        // Zid checkout form selectors (inside .login_guest-container)
        var EMAIL_SELECTORS = [
            '#inputEmail',
            'input[name="email"]',
            'input[type="email"]',
            '.login_guest-container input[id*="email"]'
        ].join(',');

        var PHONE_SELECTORS = [
            '#mobile',
            'input[name="mobile"]',
            'input[type="tel"]',
            '.login_guest-container input[id*="mobile"]'
        ].join(',');

        function sendContactUpdate(email, phone) {
            // Only send if we have new data
            if ((!email || email === lastSentEmail) && (!phone || phone === lastSentPhone)) {
                return;
            }

            var payload = {
                convertVisitorId: convertVisitorId,
                zidCustomerId: null,
                convertBucketing: [],
                zidPagePath: document.location.pathname + document.location.search
            };

            if (email && email !== lastSentEmail) {
                payload.guestEmail = email;
                lastSentEmail = email;
            }
            if (phone && phone !== lastSentPhone) {
                payload.guestPhone = phone;
                lastSentPhone = phone;
            }

            console.log(SCRIPT_NAMESPACE + ': [SENDING GUEST CONTACT]', JSON.stringify(payload));
            var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            navigator.sendBeacon(API_ENDPOINT, blob);
        }

        function attachListeners() {
            var emailFields = document.querySelectorAll(EMAIL_SELECTORS);
            var phoneFields = document.querySelectorAll(PHONE_SELECTORS);

            emailFields.forEach(function (field) {
                if (field.dataset.zidConvertBound) return;
                field.dataset.zidConvertBound = 'true';
                field.addEventListener('blur', function () {
                    var val = field.value.trim();
                    if (val && val.includes('@')) {
                        sendContactUpdate(val, null);
                    }
                });
                field.addEventListener('change', function () {
                    var val = field.value.trim();
                    if (val && val.includes('@')) {
                        sendContactUpdate(val, null);
                    }
                });
                console.log(SCRIPT_NAMESPACE + ': Attached listener to email field:', field.name || field.id || field.type);
            });

            phoneFields.forEach(function (field) {
                if (field.dataset.zidConvertBound) return;
                field.dataset.zidConvertBound = 'true';
                field.addEventListener('blur', function () {
                    var val = field.value.trim();
                    if (val && val.length >= 7) {
                        sendContactUpdate(null, val);
                    }
                });
                field.addEventListener('change', function () {
                    var val = field.value.trim();
                    if (val && val.length >= 7) {
                        sendContactUpdate(null, val);
                    }
                });
                console.log(SCRIPT_NAMESPACE + ': Attached listener to phone field:', field.name || field.id || field.type);
            });

            return emailFields.length + phoneFields.length;
        }

        // Try attaching immediately
        var found = attachListeners();

        // Use MutationObserver to catch dynamically-rendered checkout forms
        if (found === 0) {
            console.log(SCRIPT_NAMESPACE + ': No checkout fields found yet. Watching for dynamic form rendering.');
            var observer = new MutationObserver(function () {
                var newFound = attachListeners();
                if (newFound > 0) {
                    console.log(SCRIPT_NAMESPACE + ': Checkout fields found via MutationObserver.');
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            // Stop watching after 30 seconds to avoid performance impact
            setTimeout(function () { observer.disconnect(); }, 30000);
        }
    }

    // --- THE MAIN HANDLER ---
    function handleExperiencesEvaluated() {
        if (hasBeenCalled) return;
        hasBeenCalled = true;

        var convertVisitorId = getOrCreateConvertVisitorId();

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

    // --- CHECKOUT CONTACT CAPTURE ---
    // Detect checkout pages and start monitoring email/phone fields
    // Zid guest checkout is at /auth/login?redirect_to=/checkout/...
    function isCheckoutPage() {
        var path = window.location.pathname.toLowerCase();
        var search = window.location.search.toLowerCase();
        return path.includes('checkout') || path.includes('payment') || path.includes('/cart')
            || (path.includes('/auth/login') && search.includes('checkout'));
    }

    if (isCheckoutPage()) {
        captureCheckoutContact();
    }
    // Also watch for SPA navigation to checkout
    var lastPath = window.location.pathname.toLowerCase();
    setInterval(function () {
        var currentPath = window.location.pathname.toLowerCase();
        if (currentPath !== lastPath) {
            lastPath = currentPath;
            if (isCheckoutPage()) {
                captureCheckoutContact();
            }
        }
    }, 2000);

})(window, document);
