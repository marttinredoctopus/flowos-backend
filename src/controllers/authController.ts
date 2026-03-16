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
const verifyEmailSchema = z.object({ userId: z.string().uuid(), otp: z.string().length(6) });
const verifyResetOtpSchema = z.object({ email: z.string().email(), otp: z.string().length(6) });
const resetPasswordNewSchema = z.object({ tempToken: z.string(), newPassword: z.string().min(8) });

function setCookie(res: Response, token: string, rememberMe = false) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: (rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const data = registerSchema.parse(req.body);
    const result = await authService.register(data.name, data.email, data.password, data.orgName);
    // Return userId only — user must verify email before getting access token
    res.status(201).json({
      userId: result.userId,
      email: data.email,
      emailVerified: false,
      message: 'Check your email for the verification code',
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data.email, data.password, data.rememberMe);

    if (!result.emailVerified) {
      return res.status(200).json({
        emailVerified: false,
        userId: result.userId,
        email: data.email,
        message: 'Please verify your email. A new code has been sent.',
      });
    }

    setCookie(res, result.tokens.refreshToken, data.rememberMe);
    return res.json({ accessToken: result.tokens.accessToken, user: result.user, emailVerified: true });
  } catch (err) {
    return next(err);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, otp } = verifyEmailSchema.parse(req.body);
    const result = await authService.verifyEmail(userId, otp);
    setCookie(res, result.tokens.refreshToken);
    res.json({ accessToken: result.tokens.accessToken, user: result.user, emailVerified: true });
  } catch (err) {
    next(err);
  }
}

export async function resendVerification(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    await authService.resendVerification(userId);
    res.json({ message: 'Verification code resent' });
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
    res.json({ message: 'If that email is registered, you will receive a reset code' });
  } catch (err) {
    next(err);
  }
}

export async function verifyResetOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, otp } = verifyResetOtpSchema.parse(req.body);
    const tempToken = await authService.verifyResetOtp(email, otp);
    res.json({ tempToken });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken, newPassword } = resetPasswordNewSchema.parse(req.body);
    await authService.resetPassword(tempToken, newPassword);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const { pool } = await import('../config/database');
    const result = await pool.query(
      'SELECT id, org_id, name, email, role, avatar_url, last_seen_at, email_verified FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (!result.rows[0]) throw new AppError('User not found', 404);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, jobTitle, phone, avatarUrl, notificationPrefs, themePreference } = req.body;
    const { pool } = await import('../config/database');
    const result = await pool.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        job_title = COALESCE($2, job_title),
        phone = COALESCE($3, phone),
        avatar_url = COALESCE($4, avatar_url),
        notification_prefs = COALESCE($5::jsonb, notification_prefs),
        theme_preference = COALESCE($6, theme_preference)
       WHERE id = $7
       RETURNING id, org_id, name, email, role, avatar_url, job_title, phone, notification_prefs, theme_preference`,
      [name || null, jobTitle || null, phone || null, avatarUrl || null,
       notificationPrefs ? JSON.stringify(notificationPrefs) : null,
       themePreference || null, req.user!.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) throw new AppError('Both passwords required', 400);
    if (newPassword.length < 8) throw new AppError('New password must be at least 8 characters', 400);
    const { pool } = await import('../config/database');
    const bcrypt = await import('bcryptjs');
    const user = await pool.query('SELECT * FROM users WHERE id=$1', [req.user!.id]);
    if (!user.rows[0]) throw new AppError('User not found', 404);
    const valid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
    if (!valid) throw new AppError('Current password is incorrect', 400);
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user!.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (err) { next(err); }
}
