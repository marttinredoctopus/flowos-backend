import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { setSocketServer } from '../services/notificationService';

export function initSocket(httpServer: HttpServer) {
  const io = new SocketServer(httpServer, {
    cors: { origin: env.FRONTEND_URL, credentials: true },
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as any;
      (socket as any).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket as any).user;
    socket.join(`user:${user.id}`);
    socket.join(`org:${user.orgId}`);
    console.log(`[Socket] ${user.id} connected`);

    socket.on('join_room', (room: string) => socket.join(room));
    socket.on('leave_room', (room: string) => socket.leave(room));

    socket.on('chat_message', (data: { channelId: string; body: string }) => {
      io.to(`channel:${data.channelId}`).emit('chat:message', {
        ...data,
        userId: user.id,
        createdAt: new Date().toISOString(),
      });
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
