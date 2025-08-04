"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zidAuthRedirectController = void 0;
const url_1 = require("url"); // This should now be resolved by @types/node
const zidAuthRedirectController = (req, res) => {
    const clientId = process.env.ZID_CLIENT_ID;
    const redirectUri = `${process.env.MY_BACKEND_URL}/auth/zid/callback`;
    const zidAuthBaseUrl = process.env.ZID_AUTH_URL;
    if (!clientId || !process.env.MY_BACKEND_URL || !zidAuthBaseUrl) {
        console.error("OAuth configuration missing in .env (ZID_CLIENT_ID, MY_BACKEND_URL, ZID_AUTH_URL)");
        return res.status(500).send("Server OAuth configuration is incomplete.");
    }
    const params = new url_1.URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'orders.read webhooks.read_write',
    });
    const authorizationUrl = `${zidAuthBaseUrl}/oauth/authorize?${params.toString()}`;
    console.log(`Redirecting user to Zid for authorization: ${authorizationUrl}`);
    res.redirect(authorizationUrl);
};
exports.zidAuthRedirectController = zidAuthRedirectController;
