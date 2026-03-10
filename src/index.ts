import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { initSocket } from './socket';
import { startEmailWorker } from './workers/emailWorker';

// Routes
import authRoutes from './routes/auth';
import notificationRoutes from './routes/notifications';
import taskRoutes from './routes/tasks';
import projectRoutes from './routes/projects';
import contentRoutes from './routes/content';
import uploadRoutes from './routes/upload';

const app = express();
const httpServer = http.createServer(app);

// Security
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true });
app.use('/api', limiter);
app.use('/api/auth', authLimiter);

// Static uploads
app.use('/uploads', express.static(path.join(process.cwd(), env.UPLOAD_DIR)));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', env: env.NODE_ENV }));

// Error handler (must be last)
app.use(errorHandler);

// Socket.io
initSocket(httpServer);

// Email worker
startEmailWorker();

const PORT = env.PORT;
httpServer.listen(PORT, () => {
  console.log(`[FlowOS] Backend running on port ${PORT} (${env.NODE_ENV})`);
});

export default app;
