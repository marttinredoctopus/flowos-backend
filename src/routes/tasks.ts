import { Router } from 'express';
import { authenticate, staffOnly } from '../middleware/auth';
import * as ctrl from '../controllers/taskController';

const router = Router();
router.use(authenticate);

// READ: all roles (controller filters by clientId when role === 'client')
router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.get('/:id/comments', ctrl.getComments);

// WRITE: staff only (clients cannot create/edit tasks)
router.post('/', staffOnly, ctrl.create);
router.patch('/:id', staffOnly, ctrl.update);
router.delete('/:id', staffOnly, ctrl.remove);
router.post('/:id/comments', ctrl.addComment);   // clients can comment

export default router;
