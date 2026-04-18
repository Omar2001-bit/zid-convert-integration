// == Zid-Convert Integration Script v66.0 - Multi-Tenant ==
// Supports multiple Zid stores. Each store sets STORE_ID below.
// Checkout selectors are fetched from the backend per store.
// Guest users are tracked by capturing email/phone at checkout.
// Logged-in users are tracked via zidCustomerId.
(function (window, document) {
    'use strict';

    // =====================================================================
    // *** STORE-SPECIFIC CONFIGURATION ***
    //
    // HOW TO SET UP FOR A NEW STORE:
    //   1. Set STORE_ID to the Zid store ID (found in Zid dashboard or webhook payloads)
    //   2. That's it! The script fetches checkout selectors from the backend.
    //      If the backend is unreachable, it falls back to DEFAULT selectors below.
    //
    // HOW TO FIND THE STORE ID:
    //   - In Zid merchant dashboard: look for your store ID in settings
    //   - In a webhook payload: the "store_id" field
    //   - Ask the store owner for their Zid store ID
    // =====================================================================
    var STORE_ID = '210142';

    var SCRIPT_NAMESPACE = 'ZidConvertTracker';
    var API_ENDPOINT = 'https://zid-convert-integration.onrender.com/api/capture-convert-context';
    var CONFIG_ENDPOINT = 'https://zid-convert-integration.onrender.com/api/store-config/' + STORE_ID;
    var CONVERT_COOKIE_NAME = '_conv_v';
    var SESSION_STORAGE_KEY = SCRIPT_NAMESPACE + '_generated_visitor_id';
    var hasBeenCalled = false;
    var lastKnownZidCustomerId = null;
    var lastSentEmail = null;
    var lastSentPhone = null;

    // Default checkout selectors (used if backend config fetch fails)
    var DEFAULT_EMAIL_SELECTORS = ['#inputEmail', 'input[name="email"]', 'input[type="email"]'];
    var DEFAULT_PHONE_SELECTORS = ['#mobile', 'input[name="mobile"]', 'input[type="tel"]'];
    var DEFAULT_CHECKOUT_KEYWORDS = ['checkout', 'payment', '/cart'];
    var DEFAULT_GUEST_LOGIN_PATTERN = { path: '/auth/login', search: 'checkout' };

    // Store config loaded from backend (populated by fetchStoreConfig)
    var storeCheckoutConfig = null;

    console.log(SCRIPT_NAMESPACE + ': Multi-Tenant Script (v66.0) initialized. Store ID:', STORE_ID);

    // --- FETCH STORE CONFIG FROM BACKEND ---
    function fetchStoreConfig(callback) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', CONFIG_ENDPOINT, true);
            xhr.timeout = 5000;
            xhr.onload = function () {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        storeCheckoutConfig = data.checkoutConfig || null;
                        console.log(SCRIPT_NAMESPACE + ': [CONFIG] Store config loaded from backend:', JSON.stringify(storeCheckoutConfig));
                    } catch (e) {
                        console.warn(SCRIPT_NAMESPACE + ': [CONFIG] Failed to parse store config response. Using defaults.');
                    }
                } else {
                    console.warn(SCRIPT_NAMESPACE + ': [CONFIG] Backend returned status', xhr.status, '. Using defaults.');
                }
                if (callback) callback();
            };
            xhr.onerror = function () {
                console.warn(SCRIPT_NAMESPACE + ': [CONFIG] Failed to fetch store config. Using defaults.');
                if (callback) callback();
            };
            xhr.ontimeout = function () {
                console.warn(SCRIPT_NAMESPACE + ': [CONFIG] Store config fetch timed out. Using defaults.');
                if (callback) callback();
            };
            xhr.send();
        } catch (e) {
            console.warn(SCRIPT_NAMESPACE + ': [CONFIG] Error fetching store config:', e);
            if (callback) callback();
        }
    }

    // --- Helper: get selectors from config or defaults ---
    function getEmailSelectors() {
        var selectors = (storeCheckoutConfig && storeCheckoutConfig.emailSelectors) || DEFAULT_EMAIL_SELECTORS;
        return selectors.join(',');
    }
    function getPhoneSelectors() {
        var selectors = (storeCheckoutConfig && storeCheckoutConfig.phoneSelectors) || DEFAULT_PHONE_SELECTORS;
        return selectors.join(',');
    }
    function getCheckoutKeywords() {
        return (storeCheckoutConfig && storeCheckoutConfig.checkoutUrlKeywords) || DEFAULT_CHECKOUT_KEYWORDS;
    }
    function getGuestLoginPattern() {
        return (storeCheckoutConfig && storeCheckoutConfig.guestLoginPattern) || DEFAULT_GUEST_LOGIN_PATTERN;
    }

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
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Generated NEW visitor ID:', generatedId);
            }
            return generatedId;
        }
        return convertVisitorId;
    }

    function getZidCustomerId() {
        var id = null;
        if (window.customer && window.customer.id) { id = window.customer.id.toString(); }
        else if (window.customerHashed && window.customerHashed.external_id) { id = window.customerHashed.external_id.toString(); }
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
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Found', experiments.length, 'active experiment(s)');
            }
        } catch (e) {
            console.error(SCRIPT_NAMESPACE + ': Error reading experiments:', e);
        }
        return experiments;
    }

    // --- CHECKOUT EMAIL/PHONE CAPTURE ---
    function captureCheckoutContact() {
        var convertVisitorId = getOrCreateConvertVisitorId();
        var zidCustomerId = getZidCustomerId();

        if (zidCustomerId) {
            console.log(SCRIPT_NAMESPACE + ': Logged-in user on checkout, skipping contact capture.');
            return;
        }

        console.log(SCRIPT_NAMESPACE + ': Guest user on checkout page. Monitoring for email/phone fields.');

        var EMAIL_SELECTORS = getEmailSelectors();
        var PHONE_SELECTORS = getPhoneSelectors();

        function sendContactUpdate(email, phone) {
            if ((!email || email === lastSentEmail) && (!phone || phone === lastSentPhone)) {
                return;
            }

            var payload = {
                convertVisitorId: convertVisitorId,
                storeId: STORE_ID,
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

            console.log('%c' + SCRIPT_NAMESPACE + ': [SENDING GUEST CONTACT]', 'color: green; font-weight: bold;');
            console.log(SCRIPT_NAMESPACE + ':   -> storeId:', STORE_ID);
            console.log(SCRIPT_NAMESPACE + ':   -> convertVisitorId:', convertVisitorId);
            console.log(SCRIPT_NAMESPACE + ':   -> guestEmail:', payload.guestEmail || '(not updated)');
            console.log(SCRIPT_NAMESPACE + ':   -> guestPhone:', payload.guestPhone || '(not updated)');
            var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            navigator.sendBeacon(API_ENDPOINT, blob);
        }

        function attachListeners() {
            var emailFields = document.querySelectorAll(EMAIL_SELECTORS);
            var phoneFields = document.querySelectorAll(PHONE_SELECTORS);

            console.log(SCRIPT_NAMESPACE + ': [DEBUG] Found', emailFields.length, 'email field(s) and', phoneFields.length, 'phone field(s)');

            emailFields.forEach(function (field) {
                if (field.dataset.zidConvertBound) return;
                field.dataset.zidConvertBound = 'true';
                field.addEventListener('blur', function () {
                    var val = field.value.trim();
                    if (val && val.includes('@')) { sendContactUpdate(val, null); }
                });
                field.addEventListener('change', function () {
                    var val = field.value.trim();
                    if (val && val.includes('@')) { sendContactUpdate(val, null); }
                });
            });

            phoneFields.forEach(function (field) {
                if (field.dataset.zidConvertBound) return;
                field.dataset.zidConvertBound = 'true';
                field.addEventListener('blur', function () {
                    var val = field.value.trim();
                    if (val && val.length >= 7) { sendContactUpdate(null, val); }
                });
                field.addEventListener('change', function () {
                    var val = field.value.trim();
                    if (val && val.length >= 7) { sendContactUpdate(null, val); }
                });
            });

            return emailFields.length + phoneFields.length;
        }

        var found = attachListeners();
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
            zidCustomerId: zidCustomerId,
            storeId: STORE_ID
        };

        console.log('%c' + SCRIPT_NAMESPACE + ': [SENDING CONTEXT]', 'color: blue; font-weight: bold;');
        console.log(SCRIPT_NAMESPACE + ':   -> storeId:', STORE_ID);
        console.log(SCRIPT_NAMESPACE + ':   -> convertVisitorId:', convertVisitorId);
        console.log(SCRIPT_NAMESPACE + ':   -> zidCustomerId:', zidCustomerId || 'null (guest)');
        console.log(SCRIPT_NAMESPACE + ':   -> experiments:', JSON.stringify(experimentsToSend));
        var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(API_ENDPOINT, blob);
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

        if (sendContext()) {
            contextSent = true;
            return;
        }

        console.log(SCRIPT_NAMESPACE + ': [DEBUG] No experiments yet. Polling for Convert data...');
        var attempts = 0;
        var maxAttempts = 20;
        var pollInterval = setInterval(function () {
            attempts++;
            if (contextSent) { clearInterval(pollInterval); return; }
            if (sendContext()) {
                contextSent = true;
                clearInterval(pollInterval);
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Context sent after', attempts, 'poll attempt(s)');
                return;
            }
            if (attempts >= maxAttempts) {
                clearInterval(pollInterval);
                console.log(SCRIPT_NAMESPACE + ': [DEBUG] Gave up polling after', maxAttempts, 'attempts.');
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

    // --- CHECKOUT PAGE DETECTION (uses config from backend) ---
    function isCheckoutPage() {
        var path = window.location.pathname.toLowerCase();
        var search = window.location.search.toLowerCase();
        var keywords = getCheckoutKeywords();
        var loginPattern = getGuestLoginPattern();

        var result = false;
        for (var i = 0; i < keywords.length; i++) {
            if (path.includes(keywords[i].toLowerCase())) {
                result = true;
                break;
            }
        }
        if (!result && loginPattern && path.includes(loginPattern.path) && search.includes(loginPattern.search)) {
            result = true;
        }

        console.log(SCRIPT_NAMESPACE + ': [DEBUG] isCheckoutPage? path=' + path + ' search=' + search + ' -> ' + result);
        return result;
    }

    // --- SCRIPT EXECUTION ---
    // Fetch store config first, then initialize everything
    fetchStoreConfig(function () {
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

        if (isCheckoutPage()) {
            console.log('%c' + SCRIPT_NAMESPACE + ': [CHECKOUT PAGE DETECTED]', 'color: orange; font-weight: bold;');
            captureCheckoutContact();
        }

        var lastPath = window.location.pathname.toLowerCase();
        setInterval(function () {
            var currentPath = window.location.pathname.toLowerCase();
            if (currentPath !== lastPath) {
                lastPath = currentPath;
                if (isCheckoutPage()) { captureCheckoutContact(); }
            }
        }, 2000);

        console.log(SCRIPT_NAMESPACE + ': Script fully initialized for store', STORE_ID);
    });

})(window, document);
