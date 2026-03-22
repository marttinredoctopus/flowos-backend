import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database';
import { env } from '../config/env';

const GOOGLE_CLIENT_ID     = env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const CALLBACK_URL         = env.GOOGLE_CALLBACK_URL || 'https://api.tasksdone.cloud/api/auth/google/callback';
const FRONTEND_URL         = env.FRONTEND_URL;

function generateAccessToken(user: { id: string; orgId: string; role: string; clientId?: string; isSuperAdmin?: boolean }) {
  return jwt.sign(
    { id: user.id, orgId: user.orgId, role: user.role, clientId: user.clientId, isSuperAdmin: user.isSuperAdmin || false },
    env.JWT_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES as any }
  );
}

function generateRefreshToken(userId: string) {
  return jwt.sign({ userId, jti: uuidv4() }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES as any });
}

function setCookie(res: Response, token: string) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

// GET /api/auth/google
export function redirectToGoogle(req: Request, res: Response) {
  if (!GOOGLE_CLIENT_ID) {
    return res.redirect(`${FRONTEND_URL}/login?error=google_not_configured`);
  }
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  CALLBACK_URL,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
    prompt:        'select_account',
  });
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

// GET /api/auth/google/callback
export async function googleCallback(req: Request, res: Response, next: NextFunction) {
  try {
    const { code, error } = req.query as { code?: string; error?: string };

    if (error || !code) {
      return res.redirect(`${FRONTEND_URL}/login?error=google_denied`);
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  CALLBACK_URL,
        grant_type:    'authorization_code',
      }),
    });

    const tokenData: any = await tokenRes.json();
    if (tokenData.error) {
      console.error('[Google OAuth] Token exchange error:', tokenData.error_description);
      return res.redirect(`${FRONTEND_URL}/login?error=google_token_failed`);
    }

    // Get user info
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser: any = await userInfoRes.json();

    if (!googleUser.email) {
      return res.redirect(`${FRONTEND_URL}/login?error=google_no_email`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if user exists
      let userRow = (await client.query(
        'SELECT id, org_id, name, email, role, client_id, is_super_admin, is_active FROM users WHERE email = $1',
        [googleUser.email]
      )).rows[0];

      if (userRow) {
        // Existing user — update avatar if from Google
        if (googleUser.picture && !userRow.avatar_url) {
          await client.query('UPDATE users SET avatar_url=$1, email_verified=TRUE, last_seen_at=NOW() WHERE id=$2', [googleUser.picture, userRow.id]);
        } else {
          await client.query('UPDATE users SET email_verified=TRUE, last_seen_at=NOW() WHERE id=$1', [userRow.id]);
        }
        if (!userRow.is_active) {
          await client.query('ROLLBACK');
          return res.redirect(`${FRONTEND_URL}/login?error=account_suspended`);
        }
      } else {
        // New user — create org + user
        const orgName = googleUser.hd || `${googleUser.given_name || googleUser.name}'s Agency`;
        const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uuidv4().slice(0, 6);
        const orgRes = await client.query(
          'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
          [orgName, slug]
        );
        const orgId = orgRes.rows[0].id;

        const newUserRes = await client.query(
          `INSERT INTO users (org_id, name, email, password_hash, role, email_verified, avatar_url)
           VALUES ($1, $2, $3, '', 'admin', TRUE, $4)
           RETURNING id, org_id, name, email, role, client_id, is_super_admin`,
          [orgId, googleUser.name || googleUser.email, googleUser.email, googleUser.picture || null]
        );
        userRow = newUserRes.rows[0];
      }

      await client.query('COMMIT');

      const user = {
        id: userRow.id,
        orgId: userRow.org_id,
        name: userRow.name,
        email: userRow.email,
        role: userRow.role,
        clientId: userRow.client_id || undefined,
        isSuperAdmin: userRow.is_super_admin || false,
      };

      const accessToken  = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user.id);

      // Store refresh token
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      await pool.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, refreshToken, expiresAt]
      );

      setCookie(res, refreshToken);

      // Redirect to frontend with access token in query param (short-lived, handled by frontend)
      const params = new URLSearchParams({
        token: accessToken,
        name:  user.name,
        email: user.email,
        role:  user.role,
        orgId: user.orgId,
        id:    user.id,
      });
      return res.redirect(`${FRONTEND_URL}/auth/google-callback?${params}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Google OAuth] Error:', err);
    return res.redirect(`${FRONTEND_URL}/login?error=google_failed`);
  }
}
