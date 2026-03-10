import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from '../services/authService';
import { AppError } from '../middleware/errorHandler';

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  orgName: z.string().min(2),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
});

const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({ token: z.string(), password: z.string().min(8) });

function setCookie(res: Response, token: string, rememberMe = false) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: (rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const data = registerSchema.parse(req.body);
    const result = await authService.register(data.name, data.email, data.password, data.orgName);
    setCookie(res, result.tokens.refreshToken);
    res.status(201).json({ accessToken: result.tokens.accessToken, user: result.user, org: result.org });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data.email, data.password, data.rememberMe);
    setCookie(res, result.tokens.refreshToken, data.rememberMe);
    res.json({ accessToken: result.tokens.accessToken, user: result.user });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.refresh_token;
    if (token && req.user) await authService.logout(req.user.id, token);
    res.clearCookie('refresh_token', { path: '/api/auth' });
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.refresh_token;
    if (!token) throw new AppError('No refresh token', 401);
    const tokens = await authService.refreshTokens(token);
    setCookie(res, tokens.refreshToken);
    res.json({ accessToken: tokens.accessToken });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = forgotSchema.parse(req.body);
    await authService.forgotPassword(email);
    // Always 200 — don't leak if email exists
    res.json({ message: 'If that email is registered you will receive a reset link' });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = resetSchema.parse(req.body);
    await authService.resetPassword(token, password);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const { pool } = await import('../config/database');
    const result = await pool.query(
      'SELECT id, org_id, name, email, role, avatar_url, last_seen_at FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (!result.rows[0]) throw new AppError('User not found', 404);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}
