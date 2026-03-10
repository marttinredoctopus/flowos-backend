import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listContent,
  getContent,
  createContent,
  updateContent,
  deleteContent,
  getCalendarView,
} from '../controllers/contentController';

const router = Router();

router.use(authMiddleware);

router.get('/calendar', getCalendarView);
router.get('/', listContent);
router.get('/:id', getContent);
router.post('/', createContent);
router.put('/:id', updateContent);
router.delete('/:id', deleteContent);

export default router;
