import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/messages', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.body, m.user_id, m.created_at, u.name as user_name
       FROM chat_messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1
       ORDER BY m.created_at ASC
       LIMIT 100`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

export default router;
