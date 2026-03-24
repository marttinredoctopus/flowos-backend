import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as s from '../controllers/spacesController';

const router = Router();
router.use(authenticate);

router.get('/',                             s.listSpaces);
router.post('/',                            s.createSpace);
router.get('/:id',                          s.getSpace);
router.patch('/:id',                        s.updateSpace);
router.delete('/:id',                       s.deleteSpace);

router.post('/:id/members',                 s.addMember);
router.delete('/:id/members/:userId',       s.removeMember);

router.post('/:id/projects',                s.createSpaceProject);

router.get('/:id/tasks',                    s.getSpaceTasks);
router.post('/:id/tasks',                   s.createSpaceTask);

router.get('/:id/assets',                   s.listAssets);
router.post('/:id/assets',                  s.createAsset);
router.delete('/:id/assets/:assetId',       s.deleteAsset);

router.get('/:id/videos',                   s.listVideos);
router.post('/:id/videos',                  s.createVideo);
router.patch('/:id/videos/:videoId',        s.updateVideo);
router.delete('/:id/videos/:videoId',       s.deleteVideo);

export default router;
