import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { pool } from '../config/database';
import { Queue } from 'bullmq';
import { redis } from '../config/redis';

export const emailQueue = new Queue('emails', { connection: redis as any });

export type EmailJob =
  | { template: 'welcome'; to: string; data: { name: string; orgName: string } }
  | { template: 'email_verification'; to: string; data: { name: string; otp: string } }
  | { template: 'password_reset_otp'; to: string; data: { name: string; otp: string } }
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

// Resend sandbox: only delivers to the account owner's email unless domain is verified
// Set RESEND_TEST_EMAIL in Railway to your Resend account email to receive OTPs
function resolveRecipient(to: string): string {
  const testEmail = process.env.RESEND_TEST_EMAIL;
  const domainVerified = process.env.RESEND_DOMAIN_VERIFIED === 'true';
  if (testEmail && !domainVerified) {
    console.log(`[Email] Sandbox redirect: ${to} → ${testEmail}`);
    return testEmail;
  }
  return to;
}

function baseHtml(content: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#06080f;font-family:Arial,sans-serif;color:#f0f6fc}
  .wrap{max-width:600px;margin:0 auto;padding:24px 16px}
  .card{background:#0d1117;border:1px solid #21262d;border-radius:16px;overflow:hidden}
  .header{background:linear-gradient(135deg,#7c6fe0,#4a9eff);padding:32px;text-align:center}
  .header h1{margin:0;color:#fff;font-size:26px;font-weight:700}
  .header p{margin:8px 0 0;color:rgba(255,255,255,0.7);font-size:14px}
  .body{padding:32px;color:#f0f6fc}
  .body h2{font-size:20px;margin:0 0 12px;color:#fff}
  .body p{color:#8b949e;font-size:15px;line-height:1.6;margin:0 0 16px}
  .btn{display:inline-block;background:linear-gradient(135deg,#7c6fe0,#4a9eff);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin:8px 0}
  .otp-box{background:#161b22;border:2px solid #30363d;border-radius:12px;padding:24px;text-align:center;margin:24px 0}
  .otp-code{font-size:40px;font-weight:800;letter-spacing:10px;color:#7c6fe0;font-family:monospace}
  .otp-hint{font-size:13px;color:#6e7681;margin-top:8px}
  .footer{text-align:center;color:#6e7681;font-size:12px;margin-top:24px}
</style></head>
<body><div class="wrap">
  <div style="text-align:center;margin-bottom:24px">
    <span style="font-size:22px;font-weight:800;background:linear-gradient(135deg,#7c6fe0,#4a9eff);-webkit-background-clip:text;-webkit-text-fill-color:transparent">FlowOS</span>
  </div>
  <div class="card">${content}</div>
  <div class="footer"><p>FlowOS — Agency Management Platform</p></div>
</div></body></html>`;
}

export function buildTemplate(job: EmailJob): { subject: string; html: string } {
  switch (job.template) {
    case 'welcome':
      return {
        subject: `Welcome to FlowOS, ${job.data.name}! 🚀`,
        html: baseHtml(`
          <div class="header"><h1>Welcome to FlowOS 🚀</h1><p>Your workspace is ready</p></div>
          <div class="body">
            <h2>Hey ${job.data.name}, you're in!</h2>
            <p>Start managing your agency smarter today.</p>
            <a href="${env.FRONTEND_URL}/dashboard" class="btn">Open FlowOS →</a>
          </div>`),
      };

    case 'email_verification':
      return {
        subject: `${job.data.otp} is your FlowOS verification code`,
        html: baseHtml(`
          <div class="header"><h1>Verify Your Email</h1><p>Enter this code to activate your account</p></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p>Enter the 6-digit code below. Expires in <strong style="color:#fff">15 minutes</strong>.</p>
            <div class="otp-box">
              <div class="otp-code">${job.data.otp}</div>
              <div class="otp-hint">Expires in 15 minutes · Do not share this code</div>
            </div>
            <p>If you didn't create a FlowOS account, you can safely ignore this email.</p>
          </div>`),
      };

    case 'password_reset_otp':
      return {
        subject: `${job.data.otp} — Reset your FlowOS password`,
        html: baseHtml(`
          <div class="header"><h1>Password Reset</h1></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p>Use this code to reset your password. Expires in <strong style="color:#fff">1 hour</strong>.</p>
            <div class="otp-box">
              <div class="otp-code">${job.data.otp}</div>
              <div class="otp-hint">Valid for 1 hour · Do not share this code</div>
            </div>
          </div>`),
      };

    case 'task_assigned':
      return {
        subject: `New task assigned: ${job.data.taskTitle}`,
        html: baseHtml(`
          <div class="header"><h1>New Task Assigned</h1></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p>Task: <strong style="color:#fff">${job.data.taskTitle}</strong></p>
            <a href="${job.data.taskUrl}" class="btn">View Task →</a>
          </div>`),
      };

    case 'task_due_soon':
      return {
        subject: `Due tomorrow: ${job.data.taskTitle}`,
        html: baseHtml(`
          <div class="header"><h1>Task Due Tomorrow ⏰</h1></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p>Don't forget: <strong style="color:#fff">${job.data.taskTitle}</strong></p>
            <a href="${job.data.taskUrl}" class="btn">View Task →</a>
          </div>`),
      };

    case 'task_overdue':
      return {
        subject: `Overdue: ${job.data.taskTitle}`,
        html: baseHtml(`
          <div class="header"><h1>Task Overdue 🔴</h1></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p>This task is <strong style="color:#ef4444">${job.data.daysOverdue} day(s) overdue</strong>.</p>
            <p style="font-size:18px;font-weight:600;color:#fff">${job.data.taskTitle}</p>
            <a href="${job.data.taskUrl}" class="btn">View Task →</a>
          </div>`),
      };

    case 'comment_notification':
      return {
        subject: `${job.data.actorName} commented on "${job.data.taskTitle}"`,
        html: baseHtml(`
          <div class="header"><h1>New Comment 💬</h1></div>
          <div class="body">
            <h2>Hi ${job.data.name},</h2>
            <p><strong style="color:#fff">${job.data.actorName}</strong> commented on <em>${job.data.taskTitle}</em>:</p>
            <blockquote style="border-left:3px solid #7c6fe0;padding:12px 16px;background:#161b22;border-radius:0 8px 8px 0;color:#8b949e">${job.data.comment}</blockquote>
            <a href="${job.data.replyUrl}" class="btn">Reply →</a>
          </div>`),
      };

    default:
      return { subject: 'FlowOS notification', html: baseHtml('<div class="body"><p>You have a new notification.</p></div>') };
  }
}

export async function sendEmail(job: EmailJob) {
  const { subject, html } = buildTemplate(job);
  const recipient = resolveRecipient(job.to);

  console.log(`[Email] Sending "${job.template}" to ${recipient}...`);

  if (env.RESEND_API_KEY) {
    // Use Resend HTTP API (no SMTP, works everywhere)
    const resend = new Resend(env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`,
      to: [recipient],
      subject,
      html,
    });

    if (result.error) {
      console.error(`[Email] Resend error:`, result.error);
      throw new Error(result.error.message);
    }

    console.log(`[Email] Sent via Resend API! ID: ${result.data?.id}`);
    await pool.query(
      "INSERT INTO email_logs (recipient_email, template, status, sent_at) VALUES ($1, $2, 'sent', NOW())",
      [job.to, job.template]
    ).catch(() => {});
    return result;
  }

  // Fallback: SMTP
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  const result = await transport.sendMail({
    from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM}>`,
    to: recipient,
    subject,
    html,
  });

  console.log(`[Email] Sent via SMTP! ID: ${result.messageId}`);
  await pool.query(
    "INSERT INTO email_logs (recipient_email, template, status, sent_at) VALUES ($1, $2, 'sent', NOW())",
    [job.to, job.template]
  ).catch(() => {});
  return result;
}
