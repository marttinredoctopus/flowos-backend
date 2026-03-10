import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/timeEntryController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.get('/running', ctrl.getRunning);
router.get('/summary', ctrl.summary);
router.post('/', ctrl.create);
router.post('/start', ctrl.start);
router.patch('/:id/stop', ctrl.stop);
router.delete('/:id', ctrl.remove);

export default router;
