import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/notificationController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.patch('/read-all', ctrl.markAllRead);
router.patch('/:id/read', ctrl.markRead);
router.delete('/:id', ctrl.remove);

export default router;
