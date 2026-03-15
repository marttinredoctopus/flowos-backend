import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

async function getNextInvoiceNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const result = await pool.query(
    `INSERT INTO finance_settings (org_id, invoice_next_number)
     VALUES ($1, 2)
     ON CONFLICT (org_id) DO UPDATE
     SET invoice_next_number = COALESCE(finance_settings.invoice_next_number, 1) + 1
     RETURNING invoice_prefix, invoice_next_number - 1 AS current_num`,
    [orgId]
  );
  const prefix = result.rows[0]?.invoice_prefix || 'INV';
  const num = parseInt(result.rows[0]?.current_num) || 1;
  return `${prefix}-${year}-${String(num).padStart(3, '0')}`;
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, clientId, from, to, page = '1', limit = '20' } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params: any[] = [req.user!.orgId];
    let where = 'WHERE i.org_id = $1';

    if (status) { params.push(status); where += ` AND i.status = $${params.length}`; }
    if (clientId) { params.push(clientId); where += ` AND i.client_id = $${params.length}`; }
    if (from) { params.push(from); where += ` AND i.issue_date >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND i.issue_date <= $${params.length}`; }

    // Auto-mark overdue
    await pool.query(
      `UPDATE invoices SET status = 'overdue' WHERE org_id = $1 AND status IN ('sent','viewed') AND due_date < CURRENT_DATE`,
      [req.user!.orgId]
    );

    params.push(parseInt(limit), offset);
    const result = await pool.query(
      `SELECT i.*, c.name as client_name, c.email as client_email
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
       ${where} ORDER BY i.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const countRes = await pool.query(`SELECT COUNT(*) FROM invoices WHERE org_id = $1`, [req.user!.orgId]);
    res.json({ invoices: result.rows, total: parseInt(countRes.rows[0].count) });
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { clientId, currency = 'USD', issueDate, dueDate, lineItems = [], subtotal = 0, taxAmount = 0, discountAmount = 0, total = 0, notes, terms, status = 'draft' } = req.body;
    if (!dueDate) throw new AppError('Due date is required', 400);

    const invoiceNumber = await getNextInvoiceNumber(req.user!.orgId);
    const today = new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `INSERT INTO invoices (org_id, invoice_number, client_id, status, currency, issue_date, due_date, line_items, subtotal, tax_amount, discount_amount, total, notes, terms, created_by, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [req.user!.orgId, invoiceNumber, clientId || null, status, currency, issueDate || today, dueDate,
       JSON.stringify(lineItems), subtotal, taxAmount, discountAmount, total,
       notes || null, terms || null, req.user!.id, status === 'sent' ? new Date() : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT i.*, c.name as client_name, c.email as client_email, c.company, c.phone as client_phone
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
       WHERE i.id = $1 AND i.org_id = $2`,
      [req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Invoice not found', 404);
    const payments = await pool.query('SELECT * FROM payments WHERE invoice_id = $1 ORDER BY paid_at DESC', [req.params.id]);
    res.json({ ...result.rows[0], payments: payments.rows });
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, clientId, currency, issueDate, dueDate, lineItems, subtotal, taxAmount, discountAmount, total, notes, terms } = req.body;
    const result = await pool.query(
      `UPDATE invoices SET
        status = COALESCE($1, status),
        client_id = COALESCE($2, client_id),
        currency = COALESCE($3, currency),
        issue_date = COALESCE($4, issue_date),
        due_date = COALESCE($5, due_date),
        line_items = COALESCE($6, line_items),
        subtotal = COALESCE($7, subtotal),
        tax_amount = COALESCE($8, tax_amount),
        discount_amount = COALESCE($9, discount_amount),
        total = COALESCE($10, total),
        notes = COALESCE($11, notes),
        terms = COALESCE($12, terms),
        sent_at = CASE WHEN $1 = 'sent' AND sent_at IS NULL THEN NOW() ELSE sent_at END,
        updated_at = NOW()
       WHERE id = $13 AND org_id = $14 RETURNING *`,
      [status, clientId, currency, issueDate, dueDate,
       lineItems ? JSON.stringify(lineItems) : null,
       subtotal, taxAmount, discountAmount, total, notes, terms,
       req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Invoice not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function markPaid(req: Request, res: Response, next: NextFunction) {
  try {
    const { method, reference, notes: payNotes, paidAt } = req.body;
    const inv = await pool.query('SELECT * FROM invoices WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    if (!inv.rows[0]) throw new AppError('Invoice not found', 404);

    const paymentDate = paidAt ? new Date(paidAt) : new Date();
    await pool.query(`UPDATE invoices SET status = 'paid', paid_at = $1, updated_at = NOW() WHERE id = $2`, [paymentDate, req.params.id]);

    const payment = await pool.query(
      `INSERT INTO payments (org_id, invoice_id, client_id, amount, currency, method, reference, notes, paid_at, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user!.orgId, req.params.id, inv.rows[0].client_id, inv.rows[0].total, inv.rows[0].currency,
       method || 'Bank Transfer', reference || null, payNotes || null, paymentDate, req.user!.id]
    );
    res.json({ success: true, payment: payment.rows[0] });
  } catch (err) { next(err); }
}

export async function sendReminder(req: Request, res: Response, next: NextFunction) {
  try {
    const inv = await pool.query(
      `SELECT i.*, c.name as client_name, c.email as client_email
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
       WHERE i.id = $1 AND i.org_id = $2`,
      [req.params.id, req.user!.orgId]
    );
    if (!inv.rows[0]) throw new AppError('Invoice not found', 404);
    if (!inv.rows[0].client_email) throw new AppError('Client has no email address', 400);
    // Queue reminder email (best effort)
    try {
      const { queueEmail } = await import('../services/emailService');
      await queueEmail({
        template: 'task_overdue' as any,
        to: inv.rows[0].client_email,
        data: {
          name: inv.rows[0].client_name,
          taskTitle: `Invoice ${inv.rows[0].invoice_number}`,
          daysOverdue: Math.floor((Date.now() - new Date(inv.rows[0].due_date).getTime()) / 86400000),
          taskUrl: `${process.env.FRONTEND_URL}/dashboard/finance/invoices/${inv.rows[0].id}`,
        },
      });
    } catch {}
    res.json({ message: 'Reminder queued' });
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const inv = await pool.query('SELECT status FROM invoices WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    if (!inv.rows[0]) throw new AppError('Invoice not found', 404);
    if (inv.rows[0].status !== 'draft') throw new AppError('Only draft invoices can be deleted', 400);
    await pool.query('DELETE FROM invoices WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function duplicate(req: Request, res: Response, next: NextFunction) {
  try {
    const inv = await pool.query('SELECT * FROM invoices WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    if (!inv.rows[0]) throw new AppError('Invoice not found', 404);
    const i = inv.rows[0];
    const newNumber = await getNextInvoiceNumber(req.user!.orgId);
    const today = new Date();
    const dueDate = new Date(today.getTime() + 30 * 86400000);
    const result = await pool.query(
      `INSERT INTO invoices (org_id, invoice_number, client_id, status, currency, issue_date, due_date, line_items, subtotal, tax_amount, discount_amount, total, notes, terms, created_by)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user!.orgId, newNumber, i.client_id, i.currency,
       today.toISOString().split('T')[0], dueDate.toISOString().split('T')[0],
       i.line_items, i.subtotal, i.tax_amount, i.discount_amount, i.total, i.notes, i.terms, req.user!.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function listPayments(req: Request, res: Response, next: NextFunction) {
  try {
    const { clientId, from, to } = req.query as Record<string, string>;
    const params: any[] = [req.user!.orgId];
    let where = 'WHERE p.org_id = $1';
    if (clientId) { params.push(clientId); where += ` AND p.client_id = $${params.length}`; }
    if (from) { params.push(from); where += ` AND p.paid_at >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND p.paid_at <= $${params.length}`; }
    const result = await pool.query(
      `SELECT p.*, i.invoice_number, c.name as client_name, u.name as recorded_by_name
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN clients c ON c.id = p.client_id
       LEFT JOIN users u ON u.id = p.recorded_by
       ${where} ORDER BY p.paid_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function listExpenses(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT e.*, p.name as project_name, u.name as created_by_name
       FROM expenses e
       LEFT JOIN projects p ON p.id = e.project_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.org_id = $1 ORDER BY e.expense_date DESC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function createExpense(req: Request, res: Response, next: NextFunction) {
  try {
    const { description, amount, currency = 'USD', category = 'Other', projectId, receiptUrl, expenseDate } = req.body;
    if (!description || !amount) throw new AppError('Description and amount are required', 400);
    const result = await pool.query(
      `INSERT INTO expenses (org_id, description, amount, currency, category, project_id, receipt_url, expense_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user!.orgId, description, amount, currency, category, projectId || null,
       receiptUrl || null, expenseDate || new Date().toISOString().split('T')[0], req.user!.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function updateExpense(req: Request, res: Response, next: NextFunction) {
  try {
    const { description, amount, currency, category, projectId, receiptUrl, expenseDate } = req.body;
    const result = await pool.query(
      `UPDATE expenses SET
        description = COALESCE($1, description), amount = COALESCE($2, amount),
        currency = COALESCE($3, currency), category = COALESCE($4, category),
        project_id = COALESCE($5, project_id), receipt_url = COALESCE($6, receipt_url),
        expense_date = COALESCE($7, expense_date)
       WHERE id = $8 AND org_id = $9 RETURNING *`,
      [description, amount, currency, category, projectId, receiptUrl, expenseDate, req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Expense not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function deleteExpense(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM expenses WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function listTaxRates(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query('SELECT * FROM tax_rates WHERE org_id = $1 ORDER BY created_at ASC', [req.user!.orgId]);
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function createTaxRate(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, rate, isDefault } = req.body;
    if (!name || rate == null) throw new AppError('Name and rate required', 400);
    if (isDefault) await pool.query('UPDATE tax_rates SET is_default = FALSE WHERE org_id = $1', [req.user!.orgId]);
    const result = await pool.query(
      'INSERT INTO tax_rates (org_id, name, rate, is_default) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user!.orgId, name, rate, isDefault || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function deleteTaxRate(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM tax_rates WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function getFinanceSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query('SELECT * FROM finance_settings WHERE org_id = $1', [req.user!.orgId]);
    res.json(result.rows[0] || {});
  } catch (err) { next(err); }
}

export async function updateFinanceSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const { agencyName, agencyAddress, agencyPhone, agencyEmail, agencyTaxId, agencyLogoUrl,
            defaultCurrency, defaultPaymentTerms, defaultNotes, invoicePrefix, paypalEmail } = req.body;
    const result = await pool.query(
      `INSERT INTO finance_settings (org_id, agency_name, agency_address, agency_phone, agency_email, agency_tax_id,
         agency_logo_url, default_currency, default_payment_terms, default_notes, invoice_prefix, paypal_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (org_id) DO UPDATE SET
         agency_name = COALESCE($2, finance_settings.agency_name),
         agency_address = COALESCE($3, finance_settings.agency_address),
         agency_phone = COALESCE($4, finance_settings.agency_phone),
         agency_email = COALESCE($5, finance_settings.agency_email),
         agency_tax_id = COALESCE($6, finance_settings.agency_tax_id),
         agency_logo_url = COALESCE($7, finance_settings.agency_logo_url),
         default_currency = COALESCE($8, finance_settings.default_currency),
         default_payment_terms = COALESCE($9, finance_settings.default_payment_terms),
         default_notes = COALESCE($10, finance_settings.default_notes),
         invoice_prefix = COALESCE($11, finance_settings.invoice_prefix),
         paypal_email = COALESCE($12, finance_settings.paypal_email),
         updated_at = NOW()
       RETURNING *`,
      [req.user!.orgId, agencyName, agencyAddress, agencyPhone, agencyEmail, agencyTaxId,
       agencyLogoUrl, defaultCurrency, defaultPaymentTerms, defaultNotes, invoicePrefix, paypalEmail]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}
