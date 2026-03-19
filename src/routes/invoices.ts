import { Router } from 'express';
import { authenticate, adminOrManager, staffOnly } from '../middleware/auth';
import * as ctrl from '../controllers/invoicesController';

const router = Router();
router.use(authenticate);

// Finance is admin/manager only — team members and clients cannot access
router.use(adminOrManager);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/payments', ctrl.listPayments);
router.get('/expenses', ctrl.listExpenses);
router.post('/expenses', ctrl.createExpense);
router.patch('/expenses/:id', ctrl.updateExpense);
router.delete('/expenses/:id', ctrl.deleteExpense);
router.get('/tax-rates', ctrl.listTaxRates);
router.post('/tax-rates', ctrl.createTaxRate);
router.delete('/tax-rates/:id', ctrl.deleteTaxRate);
router.get('/finance-settings', ctrl.getFinanceSettings);
router.put('/finance-settings', ctrl.updateFinanceSettings);
router.patch('/finance-settings', ctrl.updateFinanceSettings);
router.get('/:id', ctrl.getOne);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/mark-paid', ctrl.markPaid);
router.post('/:id/send-reminder', ctrl.sendReminder);
router.post('/:id/duplicate', ctrl.duplicate);

export default router;
