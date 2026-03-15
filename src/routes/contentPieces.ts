import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/contentPiecesController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

// Copy bank
router.get('/copy-bank', ctrl.listCopyBank);
router.post('/copy-bank', ctrl.addToCopyBank);
router.delete('/copy-bank/:id', ctrl.removeCopyBankItem);

export default router;
