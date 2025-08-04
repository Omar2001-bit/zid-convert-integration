import { Router } from 'express';
import { zidAuthRedirectController } from '../../../controllers/zid/auth/redirect';
import { zidAuthCallbackController } from '../../../controllers/zid/auth/callback';

const router = Router();

// Path: / (relative to its mount point, e.g., /auth/zid/)
// This will initiate the redirect to Zid.
router.get('/', zidAuthRedirectController);

// Path: /callback (relative to its mount point, e.g., /auth/zid/callback)
// This is where Zid will redirect the user back.
router.get('/callback', zidAuthCallbackController);

export default router;