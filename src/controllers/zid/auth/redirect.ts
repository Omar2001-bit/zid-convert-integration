// src/controllers/zid/auth/redirect.ts
import { Request, Response } from 'express';
import { URLSearchParams } from 'url'; // This should now be resolved by @types/node

export const zidAuthRedirectController = (req: Request, res: Response) => {
    const clientId = process.env.ZID_CLIENT_ID;
    const redirectUri = `${process.env.MY_BACKEND_URL}/auth/zid/callback`;
    const zidAuthBaseUrl = process.env.ZID_AUTH_URL;

    if (!clientId || !process.env.MY_BACKEND_URL || !zidAuthBaseUrl) {
        console.error("OAuth configuration missing in .env (ZID_CLIENT_ID, MY_BACKEND_URL, ZID_AUTH_URL)");
        return res.status(500).send("Server OAuth configuration is incomplete.");
    }

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'orders.read webhooks.read_write',
    });

    const authorizationUrl = `${zidAuthBaseUrl}/oauth/authorize?${params.toString()}`;
    console.log(`Redirecting user to Zid for authorization: ${authorizationUrl}`);
    res.redirect(authorizationUrl);
};