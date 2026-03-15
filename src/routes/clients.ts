import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/clientController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getOne);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
