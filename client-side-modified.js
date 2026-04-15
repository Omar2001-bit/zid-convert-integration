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
            if (!rawCookieValue || rawCookieValue === document.cookie) {
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] No Convert cookie found.');
            } else {
                var decodedCookieValue = decodeURIComponent(rawCookieValue);
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Convert cookie raw value:', decodedCookieValue);
                var match = decodedCookieValue.match(/^vi:([^~*]+)/) || decodedCookieValue.match(/~v:([^~]+)/);
                if (match && match[1]) {
                    convertVisitorId = match[1];
                    console.log(SCRIPT_NAMESPACE + ': [DEBUG] Extracted visitor ID from cookie:', convertVisitorId);
                } else {
                    console.log(SCRIPT_NAMESPACE + ': [DEBUG] Cookie found but no visitor ID pattern matched.');
                }
            }
        } catch (e) { console.error(SCRIPT_NAMESPACE + ': Error reading Convert cookie.', e); }

        if (!convertVisitorId || convertVisitorId === '1') {
            let generatedId = sessionStorage.getItem(SESSION_STORAGE_KEY);
            if (!generatedId) {
                generatedId = generateUUID();
                sessionStorage.setItem(SESSION_STORAGE_KEY, generatedId);
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Generated NEW visitor ID:', generatedId);
            } else {
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Reusing visitor ID from sessionStorage:', generatedId);
            }
            return generatedId;
        }
        return convertVisitorId;
    }

    function getZidCustomerId() {
        var id = null;
        if (window.customer && window.customer.id) { id = window.customer.id.toString(); }
        else if (window.customerHashed && window.customerHashed.external_id) { id = window.customerHashed.external_id.toString(); }
        console.log(SCRIPT_NAMESPACE + ': [DEBUG] getZidCustomerId =', id || 'null (guest user)');
        return id;
    }

    function getActiveExperiments() {
        var experiments = [];
        try {
            var convertExperiments = window.convert && window.convert.currentData && window.convert.currentData.experiences;
            if (convertExperiments && Object.keys(convertExperiments).length > 0) {
                var experimentIds = Object.keys(convertExperiments);
                for (var i = 0; i < experimentIds.length; i++) {
                    var expId = experimentIds[i];
                    if (convertExperiments[expId] && convertExperiments[expId].variation && convertExperiments[expId].variation.id) {
                        experiments.push({
                            experienceId: String(expId),
                            variationId: String(convertExperiments[expId].variation.id)
                        });
                    }
                }
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Found', experiments.length, 'active experiment(s) via Convert API');
            } else {
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] window.convert.currentData.experiences is empty');
            }
        } catch (e) {
            console.error(SCRIPT_NAMESPACE + ': Error reading experiments:', e);
        }
        return experiments;
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
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Contact unchanged, skipping send. Email:', email, 'Phone:', phone);
                return;
            }

            var payload = {
                convertVisitorId: convertVisitorId,
                zidCustomerId: null,
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

            console.log('%c' + SCRIPT_NAMESPACE + ': [SENDING GUEST CONTACT] ✓', 'color: green; font-weight: bold;');
            console.log(SCRIPT_NAMESPACE + ':   → convertVisitorId:', convertVisitorId);
            console.log(SCRIPT_NAMESPACE + ':   → guestEmail:', payload.guestEmail || '(not updated)');
            console.log(SCRIPT_NAMESPACE + ':   → guestPhone:', payload.guestPhone || '(not updated)');
            console.log(SCRIPT_NAMESPACE + ':   → endpoint:', API_ENDPOINT);
            console.log(SCRIPT_NAMESPACE + ':   → full payload:', JSON.stringify(payload));
            var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            var sent = navigator.sendBeacon(API_ENDPOINT, blob);
            console.log(SCRIPT_NAMESPACE + ':   → sendBeacon result:', sent ? 'QUEUED OK' : 'FAILED TO QUEUE');
        }

        function attachListeners() {
            var emailFields = document.querySelectorAll(EMAIL_SELECTORS);
            var phoneFields = document.querySelectorAll(PHONE_SELECTORS);

            console.log(SCRIPT_NAMESPACE + ': [DEBUG] Scanning for email fields with selectors:', EMAIL_SELECTORS);
            console.log(SCRIPT_NAMESPACE + ': [DEBUG] Scanning for phone fields with selectors:', PHONE_SELECTORS);
            console.log(SCRIPT_NAMESPACE + ': [DEBUG] Found', emailFields.length, 'email field(s) and', phoneFields.length, 'phone field(s)');

            emailFields.forEach(function (field) {
                if (field.dataset.zidConvertBound) return;
                field.dataset.zidConvertBound = 'true';
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Binding email field → id:', field.id, '| name:', field.name, '| type:', field.type, '| current value:', field.value ? '(has value)' : '(empty)');
                field.addEventListener('blur', function () {
                    var val = field.value.trim();
                    console.log(SCRIPT_NAMESPACE + ': [DEBUG] Email field blur event → value:', val || '(empty)');
                    if (val && val.includes('@')) {
                        sendContactUpdate(val, null);
                    }
                });
                field.addEventListener('change', function () {
                    var val = field.value.trim();
                    console.log(SCRIPT_NAMESPACE + ': [DEBUG] Email field change event → value:', val || '(empty)');
                    if (val && val.includes('@')) {
                        sendContactUpdate(val, null);
                    }
                });
            });

            phoneFields.forEach(function (field) {
                if (field.dataset.zidConvertBound) return;
                field.dataset.zidConvertBound = 'true';
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Binding phone field → id:', field.id, '| name:', field.name, '| type:', field.type, '| current value:', field.value ? '(has value)' : '(empty)');
                field.addEventListener('blur', function () {
                    var val = field.value.trim();
                    console.log(SCRIPT_NAMESPACE + ': [DEBUG] Phone field blur event → value:', val || '(empty)');
                    if (val && val.length >= 7) {
                        sendContactUpdate(null, val);
                    }
                });
                field.addEventListener('change', function () {
                    var val = field.value.trim();
                    console.log(SCRIPT_NAMESPACE + ': [DEBUG] Phone field change event → value:', val || '(empty)');
                    if (val && val.length >= 7) {
                        sendContactUpdate(null, val);
                    }
                });
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

    // --- SEND CONTEXT TO BACKEND ---
    function sendContext() {
        var convertVisitorId = getOrCreateConvertVisitorId();
        var experimentsToSend = getActiveExperiments();

        if (experimentsToSend.length === 0) {
            return false;
        }

        var zidCustomerId = getZidCustomerId();
        lastKnownZidCustomerId = zidCustomerId;

        var payload = {
            zidPagePath: document.location.pathname + document.location.search,
            convertVisitorId: convertVisitorId,
            convertBucketing: experimentsToSend,
            zidCustomerId: zidCustomerId
        };

        console.log('%c' + SCRIPT_NAMESPACE + ': [SENDING CONTEXT] ✓', 'color: blue; font-weight: bold;');
        console.log(SCRIPT_NAMESPACE + ':   → convertVisitorId:', convertVisitorId);
        console.log(SCRIPT_NAMESPACE + ':   → zidCustomerId:', zidCustomerId || 'null (guest)');
        console.log(SCRIPT_NAMESPACE + ':   → experiments:', JSON.stringify(experimentsToSend));
        console.log(SCRIPT_NAMESPACE + ':   → page:', payload.zidPagePath);
        console.log(SCRIPT_NAMESPACE + ':   → full payload:', JSON.stringify(payload));
        var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        var sent = navigator.sendBeacon(API_ENDPOINT, blob);
        console.log(SCRIPT_NAMESPACE + ':   → sendBeacon result:', sent ? 'QUEUED OK' : 'FAILED TO QUEUE');
        return true;
    }

    // --- THE MAIN HANDLER ---
    var contextSent = false;

    function handleExperiencesEvaluated() {
        if (contextSent) return;

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

        // Try to send immediately
        if (sendContext()) {
            contextSent = true;
            return;
        }

        // Experiments may not be populated yet — poll every 500ms for up to 10 seconds
        console.log(SCRIPT_NAMESPACE + ': [DEBUG] No experiments yet. Polling for Convert data...');
        var attempts = 0;
        var maxAttempts = 20;
        var pollInterval = setInterval(function () {
            attempts++;
            if (contextSent) {
                clearInterval(pollInterval);
                return;
            }
            if (sendContext()) {
                contextSent = true;
                clearInterval(pollInterval);
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Context sent after', attempts, 'poll attempt(s)');
                return;
            }
            if (attempts >= maxAttempts) {
                clearInterval(pollInterval);
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Gave up polling after', maxAttempts, 'attempts. No experiments found on this page.');
            }
        }, 500);
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
        var result = path.includes('checkout') || path.includes('payment') || path.includes('/cart')
            || (path.includes('/auth/login') && search.includes('checkout'));
        console.log(SCRIPT_NAMESPACE + ': [DEBUG] isCheckoutPage? path=' + path + ' search=' + search + ' → ' + result);
        return result;
    }

    if (isCheckoutPage()) {
        console.log('%c' + SCRIPT_NAMESPACE + ': [CHECKOUT PAGE DETECTED]', 'color: orange; font-weight: bold;');
        captureCheckoutContact();
    } else {
        console.log(SCRIPT_NAMESPACE + ': [DEBUG] Not a checkout page. Contact capture will activate on navigation to checkout.');
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
