import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { campaignInsights, analyzeCompetitors, saveAdAccount, listAdAccounts } from '../controllers/aiController';

const router = Router();
router.use(authenticate);

router.get('/ad-accounts', listAdAccounts);
router.post('/ad-accounts', saveAdAccount);
router.post('/campaign-insights/:id', campaignInsights);
router.post('/competitor-analysis', analyzeCompetitors);

export default router;
