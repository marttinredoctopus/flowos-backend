import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { pool } from '../config/database';
import { Queue } from 'bullmq';
import { redis } from '../config/redis';

export const emailQueue = new Queue('emails', { connection: redis as any });

export type EmailJob =
  | { template: 'welcome'; to: string; data: { name: string; orgName: string } }
  | { template: 'password_reset'; to: string; data: { name: string; resetUrl: string } }
  | { template: 'task_assigned'; to: string; data: { name: string; taskTitle: string; projectName: string; dueDate?: string; priority: string; taskUrl: string } }
  | { template: 'task_due_soon'; to: string; data: { name: string; taskTitle: string; taskUrl: string } }
  | { template: 'task_overdue'; to: string; data: { name: string; taskTitle: string; daysOverdue: number; taskUrl: string } }
  | { template: 'comment_notification'; to: string; data: { name: string; actorName: string; taskTitle: string; comment: string; replyUrl: string } };

export async function queueEmail(job: EmailJob) {
  await emailQueue.add(job.template, job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

function getTransport() {
  if (env.RESEND_API_KEY) {
    return nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: env.RESEND_API_KEY },
    });
  }
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
}

function baseHtml(content: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#06080f;font-family:'DM Sans',Arial,sans-serif;color:#e2e8f0}
.wrap{max-width:600px;margin:0 auto;padding:24px 16px}
.header{background:linear-gradient(135deg,#4f8cff,#7c3aed,#f472b6);padding:32px;text-align:center;border-radius:12px 12px 0 0}
.header h1{margin:0;color:#fff;font-size:24px;font-weight:700}
.body{background:#0d1117;padding:32px;border-radius:0 0 12px 12px}
.btn{display:inline-block;background:linear-gradient(135deg,#4f8cff,#7c3aed);color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0}
.footer{text-align:center;color:#64748b;font-size:12px;margin-top:24px}
a{color:#7c3aed}</style></head>
<body><div class="wrap">${content}<div class="footer"><p>FlowOS — Agency Management Platform</p><p><a href="#">Unsubscribe</a></p></div></div></body></html>`;
}

export function buildTemplate(job: EmailJob): { subject: string; html: string } {
  switch (job.template) {
    case 'welcome':
      return {
        subject: `Welcome to FlowOS, ${job.data.name}!`,
        html: baseHtml(`
          <div class="header"><h1>Welcome to FlowOS 🚀</h1></div>
          <div class="body">
            <h2>Hey ${job.data.name}, you're all set!</h2>
            <p>Your workspace <strong>${job.data.orgName}</strong> is ready. Start managing your agency smarter.</p>
            <a href="${env.FRONTEND_URL}/dashboard" class="btn">Open FlowOS</a>
            <p><strong>Quick start tips:</strong></p>
            <ul><li>Create your first project</li><li>Invite your team members</li><li>Set up your client portal</li></ul>
          </div>`),
      };
    case 'password_reset':
      return {
        subject: 'Reset your FlowOS password',
        html: baseHtml(`
          <div class="header"><h1>Password Reset</h1></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p>We received a request to reset your password. Click the button below — this link expires in 1 hour.</p>
            <a href="${job.data.resetUrl}" class="btn">Reset Password</a>
            <p>If you didn't request this, ignore this email.</p>
          </div>`),
      };
    case 'task_assigned':
      return {
        subject: `New task assigned: ${job.data.taskTitle}`,
        html: baseHtml(`
          <div class="header"><h1>New Task Assigned</h1></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p>A task has been assigned to you:</p>
            <div style="background:#161b27;border-radius:8px;padding:16px;margin:16px 0">
              <p style="margin:0 0 8px;font-size:18px;font-weight:600">${job.data.taskTitle}</p>
              <p style="margin:0;color:#64748b">Project: ${job.data.projectName} &nbsp;|&nbsp; Priority: <strong>${job.data.priority}</strong>${job.data.dueDate ? ` &nbsp;|&nbsp; Due: ${job.data.dueDate}` : ''}</p>
            </div>
            <a href="${job.data.taskUrl}" class="btn">View Task</a>
          </div>`),
      };
    case 'task_due_soon':
      return {
        subject: `Due tomorrow: ${job.data.taskTitle}`,
        html: baseHtml(`
          <div class="header"><h1>Task Due Tomorrow</h1></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p>This task is due <strong>tomorrow</strong>:</p>
            <p style="font-size:18px;font-weight:600">${job.data.taskTitle}</p>
            <a href="${job.data.taskUrl}" class="btn">View Task</a>
          </div>`),
      };
    case 'task_overdue':
      return {
        subject: `Overdue: ${job.data.taskTitle}`,
        html: baseHtml(`
          <div class="header"><h1>Task Overdue</h1></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p>This task is <strong>${job.data.daysOverdue} day(s) overdue</strong>:</p>
            <p style="font-size:18px;font-weight:600">${job.data.taskTitle}</p>
            <a href="${job.data.taskUrl}" class="btn">View Task</a>
          </div>`),
      };
    case 'comment_notification':
      return {
        subject: `${job.data.actorName} commented on ${job.data.taskTitle}`,
        html: baseHtml(`
          <div class="header"><h1>New Comment</h1></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p><strong>${job.data.actorName}</strong> commented on <em>${job.data.taskTitle}</em>:</p>
            <blockquote style="border-left:3px solid #7c3aed;margin:0;padding:12px 16px;background:#161b27;border-radius:0 8px 8px 0;color:#94a3b8">${job.data.comment}</blockquote>
            <a href="${job.data.replyUrl}" class="btn">Reply</a>
          </div>`),
      };
    default:
      return { subject: 'FlowOS notification', html: baseHtml('<div class="body"><p>You have a new notification.</p></div>') };
  }
}

export async function sendEmail(job: EmailJob) {
  const transport = getTransport();
  const { subject, html } = buildTemplate(job);
  await transport.sendMail({
    from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM}>`,
    to: job.to,
    subject,
    html,
  });
  await pool.query(
    "INSERT INTO email_logs (recipient_email, template, status, sent_at) VALUES ($1, $2, 'sent', NOW())",
    [job.to, job.template]
  );
}
