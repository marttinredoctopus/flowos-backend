import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/reportController';

const router = Router();
router.use(authenticate);

router.get('/overview', ctrl.overview);
router.get('/projects', ctrl.projectProgress);
router.get('/team', ctrl.teamActivity);
router.get('/revenue', ctrl.revenueOverTime);
router.get('/project-status', ctrl.projectStatusDistribution);
router.get('/workload', ctrl.teamWorkload);
router.get('/tasks-over-time', ctrl.tasksOverTime);
router.get('/top-clients', ctrl.topClients);
router.get('/time-breakdown', ctrl.timeBreakdown);
router.get('/clients', ctrl.clientsReport);
router.get('/finance', ctrl.financeReport);
router.get('/scheduled', ctrl.getScheduledReports);
router.post('/scheduled', ctrl.createScheduledReport);
router.delete('/scheduled/:id', ctrl.deleteScheduledReport);

export default router;
