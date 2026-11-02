import type { InvoiceRecord } from './invoices';

export type ScheduleJobMoney = {
  id: string;
  customerName: string;
  date: string;
  time: string;
  service: string;
  price: number;
  quickfileInvoiceId: number | null;
};

export type PaidAmountGap = {
  invoiceId: number;
  invoiceNumber: string | null;
  customerName: string;
  jobDate: string | null;
  invoiceAmount: number;
  quickfilePaid: number;
  scheduleTotal: number;
  difference: number;
  jobs: ScheduleJobMoney[];
};

function moneyClose(left: number, right: number) {
  return Math.abs(left - right) < 0.005;
}

/** Paid QuickFile invoices whose linked appointments do not match the recorded amount. */
export function findPaidAmountGaps(jobs: ScheduleJobMoney[], invoices: InvoiceRecord[]): PaidAmountGap[] {
  const gaps: PaidAmountGap[] = [];
  for (const invoice of invoices) {
    if (invoice.status !== 'paid' || invoice.quickfileInvoiceId <= 0 || invoice.source === 'local') continue;
    const linked = jobs
      .filter(job => job.quickfileInvoiceId === invoice.quickfileInvoiceId)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.service.localeCompare(b.service) || a.id.localeCompare(b.id));
    if (linked.length === 0) continue;
    const scheduleTotal = linked.reduce((sum, job) => sum + (Number(job.price) || 0), 0);
    const quickfilePaid = invoice.paidAmount == null ? invoice.amount : invoice.paidAmount;
    if (moneyClose(scheduleTotal, invoice.amount) && moneyClose(scheduleTotal, quickfilePaid)) continue;
    gaps.push({
      invoiceId: invoice.quickfileInvoiceId,
      invoiceNumber: invoice.quickfileInvoiceNumber,
      customerName: linked[0]?.customerName || invoice.customerName || 'Customer',
      jobDate: linked[0]?.date || invoice.jobDate,
      invoiceAmount: invoice.amount,
      quickfilePaid,
      scheduleTotal,
      difference: scheduleTotal - quickfilePaid,
      jobs: linked,
    });
  }
  return gaps.sort((a, b) => String(b.jobDate || '').localeCompare(String(a.jobDate || '')) || a.customerName.localeCompare(b.customerName));
}
