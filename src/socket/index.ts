import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { setSocketServer } from '../services/notificationService';
import { pool } from '../config/database';

export function initSocket(httpServer: HttpServer) {
  const allowedOrigins = [
    env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:3001',
  ].filter(Boolean);

  const io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.railway.app')) {
          callback(null, true);
        } else {
          callback(new Error('CORS not allowed'));
        }
      },
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Unauthorized'));
    }
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as any;
      // JWT payload uses 'id' (not 'userId') — normalize here
      (socket as any).user = {
        id:           payload.id || payload.userId,
        orgId:        payload.orgId,
        role:         payload.role,
        isSuperAdmin: payload.isSuperAdmin || false,
      };
      next();
    } catch (err: any) {
      console.log('[Socket] Auth failed:', err.message);
      return next(new Error('jwt expired'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket as any).user;
    socket.join(`user:${user.id}`);
    socket.join(`org:${user.orgId}`);
    console.log(`[Socket] ${user.id} connected`);

    socket.on('join_room', (room: string) => socket.join(room));
    socket.on('leave_room', (room: string) => socket.leave(room));

    socket.on('chat_message', async (data: { channelId: string; body: string }) => {
      try {
        const result = await pool.query(
          'INSERT INTO chat_messages (org_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, created_at',
          [user.orgId, user.id, data.body]
        );
        const msg = {
          id: result.rows[0].id,
          body: data.body,
          user_id: user.id,
          user_name: user.name,
          created_at: result.rows[0].created_at,
        };
        io.to(`channel:${data.channelId}`).emit('chat:message', msg);
      } catch (err) {
        console.error('[Socket] chat_message persist error:', err);
      }
    });

    socket.on('typing_start', (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit('typing:start', { userId: user.id });
    });

    socket.on('typing_stop', (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit('typing:stop', { userId: user.id });
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] ${user.id} disconnected`);
    });
  });

  setSocketServer(io);
  return io;
}
