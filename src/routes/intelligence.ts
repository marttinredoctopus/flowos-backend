import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/intelligenceController';

const router = Router();
router.use(authenticate);

// Competitor analysis
router.get('/competitor-analyses', ctrl.listCompetitorAnalyses);
router.post('/competitor-analysis', ctrl.runCompetitorAnalysis);
router.get('/competitor-analyses/:id', ctrl.getCompetitorAnalysis);

// Market research chat
router.get('/conversations', ctrl.listConversations);
router.post('/conversations', ctrl.createConversation);
router.post('/chat', ctrl.chat);
router.delete('/conversations/:id', ctrl.deleteConversation);

// Campaign generator
router.get('/campaign-concepts', ctrl.listCampaignConcepts);
router.post('/campaign-concepts', ctrl.generateCampaign);
router.get('/campaign-concepts/:id', ctrl.getCampaignConcept);

export default router;
