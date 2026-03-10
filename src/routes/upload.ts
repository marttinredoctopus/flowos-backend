import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { listFiles, uploadSingle, uploadMultiple, deleteFile } from '../controllers/uploadController';

const router = Router();

router.use(authMiddleware);

router.get('/list', listFiles);
router.post('/single', upload.single('file'), uploadSingle);
router.post('/multiple', upload.array('files', 10), uploadMultiple);
router.delete('/:filename', deleteFile);

export default router;
