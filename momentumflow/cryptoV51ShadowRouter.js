import express from 'express';
import { cryptoV51ShadowStatus } from './cryptoV51ShadowMonitor.js';

const router = express.Router();
router.get('/status', (req, res) => res.json(cryptoV51ShadowStatus()));
export default router;
