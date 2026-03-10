import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { sendEmail, EmailJob } from '../services/emailService';
import { pool } from '../config/database';

export function startEmailWorker() {
  const worker = new Worker(
    'emails',
    async (job) => {
      await sendEmail(job.data as EmailJob);
    },
    {
      connection: redis as any,
      concurrency: 5,
    }
  );

  worker.on('failed', async (job, err) => {
    console.error(`[EmailWorker] Job ${job?.id} failed:`, err.message);
    if (job?.data?.to) {
      await pool.query(
        "INSERT INTO email_logs (recipient_email, template, status, error) VALUES ($1, $2, 'failed', $3)",
        [job.data.to, job.data.template, err.message]
      ).catch(() => {});
    }
  });

  worker.on('completed', (job) => {
    console.log(`[EmailWorker] Sent ${job.data.template} to ${job.data.to}`);
  });

  return worker;
}
