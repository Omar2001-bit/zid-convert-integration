import { Router } from 'express';
import zidAppRoutes from './zid';     // Also making this explicit for consistency
import apiRoutes from './api';      
import webhookRoutes from './webhooks'; // ADDED: Import the new webhook routes

const router = Router();

// Mount Zid specific application routes under /auth/zid
router.use('/auth/zid', zidAppRoutes);

// Mount our new API routes (e.g., for /api/capture-convert-context)
router.use('/api', apiRoutes);

// ADDED: Mount our new webhook routes
router.use('/webhooks', webhookRoutes);

router.get('/', (req, res) => {
    res.send('<h1>Welcome to Zid TypeScript OAuth App!</h1><p><a href="/auth/zid">Login with Zid</a></p>');
});

// Example dashboard route
router.get('/dashboard', (req, res) => {
    res.send('<h1>Application Dashboard</h1><p>Successfully authenticated with Zid (presumably)!</p>');
});

export default router;