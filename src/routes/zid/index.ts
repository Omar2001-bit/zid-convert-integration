import { Router } from 'express';
import authRoutes from './auth'; // Points to src/routes/zid/auth/index.ts

const router = Router();

// Mounts auth related routes (redirect, callback) directly under the parent mount point
// So, if parent is /auth/zid, then routes here will be /auth/zid/ and /auth/zid/callback
router.use('/', authRoutes);

export default router;