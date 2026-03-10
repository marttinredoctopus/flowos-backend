import Redis from 'ioredis';
import { env } from './env';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected');
});

export async function setEx(key: string, seconds: number, value: string): Promise<void> {
  await redis.setex(key, seconds, value);
}

export async function get(key: string): Promise<string | null> {
  return redis.get(key);
}

export async function del(key: string): Promise<void> {
  await redis.del(key);
}
