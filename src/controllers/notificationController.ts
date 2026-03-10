import { Request, Response, NextFunction } from 'express';
import * as svc from '../services/notificationService';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const result = await svc.getNotifications(req.user!.id, page);
    res.json(result);
  } catch (err) { next(err); }
}

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.markAsRead(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.markAllAsRead(req.user!.id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.deleteNotification(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function unreadCount(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await svc.getUnreadCount(req.user!.id);
    res.json({ count });
  } catch (err) { next(err); }
}
