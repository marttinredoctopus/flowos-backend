import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { pool } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { setEx, get, del } from '../config/redis';
import { queueEmail } from './emailService';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: string;
  clientId?: string;    // only set when role === 'client'
  isSuperAdmin?: boolean;
}

function generateAccessToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      orgId: user.orgId,
      role: user.role,
      clientId: user.clientId || undefined,
      isSuperAdmin: user.isSuperAdmin || false,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES as any }
  );
}

function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId, jti: uuidv4() }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES as any,
  });
}

async function storeRefreshToken(userId: string, token: string, rememberMe: boolean): Promise<void> {
  const days = rememberMe ? 30 : 7;
  const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
}

async function cleanExpiredTokens(userId: string): Promise<void> {
  await pool.query(
    'DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at < NOW()',
    [userId]
  ).catch(() => {});
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function register(
  name: string,
  email: string,
  password: string,
  orgName: string
): Promise<{ userId: string; user: AuthUser; org: any; tokens: TokenPair }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) throw new AppError('Email already registered', 409);

    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uuidv4().slice(0, 6);
    const orgRes = await client.query(
      'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING *',
      [orgName, slug]
    );
    const org = orgRes.rows[0];

    const passwordHash = await bcrypt.hash(password, 12);
    const userRes = await client.query(
      `INSERT INTO users (org_id, name, email, password_hash, role, email_verified)
       VALUES ($1, $2, $3, $4, 'admin', TRUE) RETURNING id, org_id, name, email, role`,
      [org.id, name, email, passwordHash]
    );
    const row = userRes.rows[0];

    await client.query('COMMIT');

    const user: AuthUser = { id: row.id, orgId: row.org_id, name: row.name, email: row.email, role: row.role };
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user.id);
    await storeRefreshToken(user.id, refreshToken, false);
    return { userId: row.id, user, org, tokens: { accessToken, refreshToken } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function verifyEmail(userId: string, otp: string): Promise<{ tokens: TokenPair; user: AuthUser }> {
  const stored = await get(`verify:${userId}`);
  if (!stored || stored !== otp) throw new AppError('Invalid or expired verification code', 400);

  await del(`verify:${userId}`);
  await pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [userId]);

  const res = await pool.query(
    'SELECT id, org_id, name, email, role, client_id, is_super_admin FROM users WHERE id = $1',
    [userId]
  );
  const row = res.rows[0];
  if (!row) throw new AppError('User not found', 404);

  const user: AuthUser = { id: row.id, orgId: row.org_id, name: row.name, email: row.email, role: row.role, clientId: row.client_id || undefined, isSuperAdmin: row.is_super_admin };
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user.id);
  await storeRefreshToken(user.id, refreshToken, false);

  // Send welcome email after verification
  queueEmail({ template: 'welcome', to: user.email, data: { name: user.name, orgName: '' } }).catch(() => {});

  return { tokens: { accessToken, refreshToken }, user };
}

export async function resendVerification(userId: string): Promise<void> {
  const res = await pool.query(
    'SELECT name, email, email_verified FROM users WHERE id = $1',
    [userId]
  );
  const row = res.rows[0];
  if (!row) throw new AppError('User not found', 404);
  if (row.email_verified) throw new AppError('Email already verified', 400);

  const otp = generateOTP();
  await setEx(`verify:${userId}`, 900, otp);
  console.log(`[Auth] Resend OTP for ${row.email}: ${otp}`);
  await queueEmail({ template: 'email_verification', to: row.email, data: { name: row.name, otp } });
}

export async function login(
  email: string,
  password: string,
  rememberMe = false
): Promise<{ tokens: TokenPair; user: AuthUser; emailVerified: boolean; userId?: string }> {
  const res = await pool.query(
    'SELECT id, org_id, name, email, password_hash, role, client_id, is_active, email_verified, is_super_admin FROM users WHERE email = $1',
    [email]
  );
  const row = res.rows[0];

  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new AppError('Invalid credentials', 401);
  }
  if (!row.is_active) throw new AppError('Account suspended', 403);

  if (!row.email_verified) {
    const otp = generateOTP();
    await setEx(`verify:${row.id}`, 900, otp);
    console.log(`[Auth] Login OTP for ${email}: ${otp}`);
    queueEmail({ template: 'email_verification', to: row.email, data: { name: row.name, otp } }).catch(() => {});
    return {
      tokens: { accessToken: '', refreshToken: '' },
      user: { id: row.id, orgId: row.org_id, name: row.name, email: row.email, role: row.role, clientId: row.client_id || undefined },
      emailVerified: false,
      userId: row.id,
    };
  }

  await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [row.id]);

  const user: AuthUser = { id: row.id, orgId: row.org_id, name: row.name, email: row.email, role: row.role, clientId: row.client_id || undefined, isSuperAdmin: row.is_super_admin };
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user.id);
  await storeRefreshToken(user.id, refreshToken, rememberMe);
  cleanExpiredTokens(user.id);

  return { tokens: { accessToken, refreshToken }, user, emailVerified: true };
}

export async function logout(userId: string, refreshToken: string): Promise<void> {
  await pool.query(
    'DELETE FROM refresh_tokens WHERE user_id = $1 AND token = $2',
    [userId, refreshToken]
  );
}

export async function refreshTokens(oldRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  let payload: any;
  try {
    payload = jwt.verify(oldRefreshToken, env.JWT_REFRESH_SECRET);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }

  const stored = await pool.query(
    'SELECT id FROM refresh_tokens WHERE user_id = $1 AND token = $2 AND expires_at > NOW()',
    [payload.userId, oldRefreshToken]
  );
  if (!stored.rows[0]) throw new AppError('Session expired, please log in again', 401);

  await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [oldRefreshToken]);

  const userRes = await pool.query(
    'SELECT id, org_id, name, email, role, client_id, is_super_admin FROM users WHERE id = $1',
    [payload.userId]
  );
  const row = userRes.rows[0];
  if (!row) throw new AppError('User not found', 401);

  const user: AuthUser = { id: row.id, orgId: row.org_id, name: row.name, email: row.email, role: row.role, clientId: row.client_id || undefined, isSuperAdmin: row.is_super_admin };
  const accessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user.id);
  await storeRefreshToken(user.id, newRefreshToken, false);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function forgotPassword(email: string): Promise<void> {
  const res = await pool.query(
    'SELECT id, name FROM users WHERE email = $1',
    [email]
  );
  if (!res.rows[0]) return;

  const { id: userId, name } = res.rows[0];
  const otp = generateOTP();
  await setEx(`reset:${userId}`, 3600, otp);

  await queueEmail({ template: 'password_reset_otp', to: email, data: { name, otp } });
}

export async function verifyResetOtp(email: string, otp: string): Promise<string> {
  const res = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!res.rows[0]) throw new AppError('Invalid request', 400);

  const userId = res.rows[0].id;
  const stored = await get(`reset:${userId}`);
  if (!stored || stored !== otp) throw new AppError('Invalid or expired code', 400);

  const tempToken = crypto.randomBytes(32).toString('hex');
  await setEx(`resettoken:${tempToken}`, 600, userId);
  await del(`reset:${userId}`);

  return tempToken;
}

export async function resetPassword(tempToken: string, newPassword: string): Promise<void> {
  const userId = await get(`resettoken:${tempToken}`);
  if (!userId) throw new AppError('Invalid or expired reset session', 400);

  const hash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
  await del(`resettoken:${tempToken}`);
}
