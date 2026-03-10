import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/ideaController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.post('/:id/vote', ctrl.vote);
router.delete('/:id', ctrl.remove);

export default router;
