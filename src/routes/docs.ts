import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/docsController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/search', ctrl.search);
router.get('/favorites', ctrl.getFavorites);
router.get('/:id', ctrl.getOne);
router.patch('/:id', ctrl.update);
router.post('/:id/archive', ctrl.archive);
router.delete('/:id', ctrl.remove);

export default router;
