import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/goalsController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.listGoals);
router.post('/', ctrl.createGoal);
router.get('/:id', ctrl.getGoal);
router.patch('/:id', ctrl.updateGoal);
router.delete('/:id', ctrl.deleteGoal);
router.post('/:id/key-results', ctrl.addKeyResult);
router.patch('/:id/key-results/:krId', ctrl.updateKeyResult);
router.delete('/:id/key-results/:krId', ctrl.deleteKeyResult);

export default router;
