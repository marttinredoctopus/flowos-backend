import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database';
import { env } from '../config/env';

const FIREBASE_API_KEY = env.FIREBASE_API_KEY;

async function verifyFirebaseIdToken(idToken: string) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  const data: any = await res.json();
  if (data.error || !data.users?.[0]) {
    throw Object.assign(new Error(data.error?.message || 'Invalid Firebase token'), { isFirebaseError: true });
  }
  return data.users[0] as {
    localId: string;
    email: string;
    displayName?: string;
    photoUrl?: string;
    emailVerified: boolean;
  };
}

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
  const isLocalDev = !env.FRONTEND_URL?.startsWith('https');
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: !isLocalDev,
    sameSite: isLocalDev ? 'lax' : 'none',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

// POST /api/auth/firebase
// Body: { idToken: string }
export async function firebaseAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });
    if (!FIREBASE_API_KEY) {
      console.error('[FirebaseAuth] FIREBASE_API_KEY is not set in environment variables');
      return res.status(500).json({ error: 'Authentication service not configured. Please contact support.' });
    }

    const firebaseUser = await verifyFirebaseIdToken(idToken);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Find user by firebase_uid first, then by email
      let userRow = (await client.query(
        `SELECT id, org_id, name, email, role, client_id, is_super_admin, is_active, onboarding_completed
         FROM users WHERE firebase_uid = $1 LIMIT 1`,
        [firebaseUser.localId]
      )).rows[0];

      if (!userRow) {
        userRow = (await client.query(
          `SELECT id, org_id, name, email, role, client_id, is_super_admin, is_active, onboarding_completed
           FROM users WHERE email = $1 LIMIT 1`,
          [firebaseUser.email]
        )).rows[0];
      }

      if (userRow) {
        if (!userRow.is_active) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Account suspended' });
        }
        // Bind firebase_uid + update avatar/verified
        await client.query(
          `UPDATE users SET firebase_uid=$1, email_verified=$2, last_seen_at=NOW(),
           avatar_url=COALESCE(NULLIF(avatar_url,''), $3) WHERE id=$4`,
          [firebaseUser.localId, firebaseUser.emailVerified, firebaseUser.photoUrl || null, userRow.id]
        );
      } else {
        // Brand new user — create org + user
        const displayName = firebaseUser.displayName || firebaseUser.email.split('@')[0];
        const orgName = `${displayName}'s Agency`;
        const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uuidv4().slice(0, 6);

        const orgRes = await client.query(
          'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
          [orgName, slug]
        );
        const orgId = orgRes.rows[0].id;

        const newUserRes = await client.query(
          `INSERT INTO users (org_id, name, email, password_hash, role, email_verified, avatar_url, firebase_uid, auth_provider)
           VALUES ($1, $2, $3, '', 'admin', $4, $5, $6, 'firebase')
           RETURNING id, org_id, name, email, role, client_id, is_super_admin, onboarding_completed`,
          [orgId, displayName, firebaseUser.email, firebaseUser.emailVerified, firebaseUser.photoUrl || null, firebaseUser.localId]
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
        onboardingCompleted: userRow.onboarding_completed || false,
      };

      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user.id);

      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      await pool.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, refreshToken, expiresAt]
      );

      setCookie(res, refreshToken);
      return res.json({ user, accessToken });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    if (err.isFirebaseError) {
      console.error('[FirebaseAuth] Token verification failed:', err.message);
      return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
    }
    console.error('[FirebaseAuth] Unexpected error:', err.message);
    return next(err);
  }
}
