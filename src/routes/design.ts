import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/designController';

const router = Router();
router.use(authenticate);

// Design briefs
router.get('/briefs', ctrl.listBriefs);
router.post('/briefs', ctrl.createBrief);
router.patch('/briefs/:id', ctrl.updateBrief);
router.delete('/briefs/:id', ctrl.deleteBrief);
router.post('/briefs/:id/approve', ctrl.approveBrief);

// Assets / Library
router.get('/assets', ctrl.listAssets);
router.post('/assets', ctrl.uploadAsset);
router.get('/assets/:id/versions', ctrl.getAssetVersions);

// Feedback pins
router.get('/assets/:assetId/feedback', ctrl.getFeedback);
router.post('/assets/:assetId/feedback', ctrl.addFeedback);
router.patch('/feedback/:feedbackId/resolve', ctrl.resolveFeedback);

// Brand guidelines
router.get('/brand/:clientId', ctrl.getBrandGuidelines);
router.put('/brand/:clientId', ctrl.upsertBrandGuidelines);

export default router;
