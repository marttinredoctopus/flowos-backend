import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { env } from './config/env';
import { runMigrations } from './config/migrate';
import { errorHandler } from './middleware/errorHandler';
import { initSocket } from './socket';
import { startEmailWorker } from './workers/emailWorker';

// Routes
import authRoutes from './routes/auth';
import notificationRoutes from './routes/notifications';
import taskRoutes from './routes/tasks';
import projectRoutes from './routes/projects';
import clientRoutes from './routes/clients';
import teamRoutes from './routes/team';
import timeEntryRoutes from './routes/timeEntries';
import campaignRoutes from './routes/campaigns';
import meetingRoutes from './routes/meetings';
import shootRoutes from './routes/shoots';
import ideaRoutes from './routes/ideas';
import reportRoutes from './routes/reports';
import contentRoutes from './routes/content';
import uploadRoutes from './routes/upload';
import aiRoutes from './routes/ai';
import intelligenceRoutes from './routes/intelligence';
import docsRoutes from './routes/docs';
import goalsRoutes from './routes/goals';
import formsRoutes from './routes/forms';
import designRoutes from './routes/design';
import contentPiecesRoutes from './routes/contentPieces';
import debugRoutes from './routes/debug';
import invoicesRoutes from './routes/invoices';
import apiKeysRoutes from './routes/apiKeys';
import webhooksRoutes from './routes/webhooks';
import publicApiRoutes from './routes/publicApi';
import orgRoutes from './routes/org';
import chatRoutes from './routes/chat';
import dashboardRoutes from './routes/dashboard';
import billingRoutes from './routes/billing';
import adminRoutes from './routes/admin';
import automationsRoutes from './routes/automations';
import templatesRoutes from './routes/templates';
import clientPortalRoutes from './routes/clientPortal';

const app = express();
const httpServer = http.createServer(app);

app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      'https://tasksdone.cloud',
      'https://www.tasksdone.cloud',
      'http://localhost:3000',
      'http://localhost:3001',
    ];
    if (!origin || allowed.includes(origin) || origin.endsWith('.tasksdone.cloud') || origin.endsWith('.railway.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true });
app.use('/api', limiter);
app.use('/api/auth', authLimiter);

app.use('/uploads', express.static(path.join(process.cwd(), env.UPLOAD_DIR)));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/time-entries', timeEntryRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/shoots', shootRoutes);
app.use('/api/ideas', ideaRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/design', designRoutes);
app.use('/api/content-pieces', contentPiecesRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/api-keys', apiKeysRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/org', orgRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/automations', automationsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/client-portal', clientPortalRoutes);
app.use('/v1/public', publicApiRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', env: env.NODE_ENV, timestamp: new Date().toISOString() }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', env: env.NODE_ENV, timestamp: new Date().toISOString() }));

app.use(errorHandler);

initSocket(httpServer);
startEmailWorker();

const PORT = env.PORT;

runMigrations()
  .catch(err => console.error('[Migrations] Error (non-fatal):', err))
  .finally(() => {
    httpServer.listen(PORT, () => {
      console.log(`[FlowOS] Backend running on port ${PORT} (${env.NODE_ENV})`);
    });
  });

export default app;
