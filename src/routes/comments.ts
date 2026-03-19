import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/commentsController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.delete('/:id', ctrl.remove);

export default router;
