import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Fold } from './InvoiceLedger';
import { findPaidAmountGaps, type ScheduleJobMoney } from './paidAmountGaps';
import type { InvoiceRecord } from './invoices';

function money(amount: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(amount || 0);
}

function dateLabel(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${parsed.getFullYear()}`;
}

function moneyClose(left: number, right: number) {
  return Math.abs(left - right) < 0.005;
}

export default function FinancePaidGaps({ jobs, invoices }: { jobs: ScheduleJobMoney[]; invoices: InvoiceRecord[] }) {
  const gaps = findPaidAmountGaps(jobs, invoices);
  const scheduleTotal = gaps.reduce((sum, gap) => sum + gap.scheduleTotal, 0);
  const quickfileTotal = gaps.reduce((sum, gap) => sum + gap.quickfilePaid, 0);
  const jobCount = gaps.reduce((sum, gap) => sum + gap.jobs.length, 0);

  const summary = gaps.length === 0
    ? 'Paid QuickFile invoices match the schedule.'
    : `${gaps.length} invoice${gaps.length === 1 ? '' : 's'} · ${jobCount} appointment${jobCount === 1 ? '' : 's'} · difference ${money(Math.abs(scheduleTotal - quickfileTotal))}`;

  return (
    <Fold title="Paid differences" summary={summary}>
      {gaps.length === 0 ? (
        <div className="success-empty"><CheckCircle2 size={20} /> Paid QuickFile invoices match the schedule.</div>
      ) : (
        <>
          <div className="pay-gap-summary">
            <span>Schedule <b>{money(scheduleTotal)}</b></span>
            <span>QuickFile <b>{money(quickfileTotal)}</b></span>
            <span className="pay-gap-diff">Difference <b>{money(Math.abs(scheduleTotal - quickfileTotal))}</b></span>
          </div>
          <div className="pay-gap-list">
            {gaps.map(gap => (
              <article key={gap.invoiceId} className="pay-gap-card">
                <div className="pay-gap-head">
                  <div>
                    <strong>{gap.customerName}</strong>
                    <span>Invoice {gap.invoiceNumber || gap.invoiceId}{gap.jobDate ? ` · ${dateLabel(gap.jobDate)}` : ''}</span>
                  </div>
                  <em className={gap.difference > 0 ? 'is-over' : 'is-under'}>{gap.difference > 0 ? '+' : '−'}{money(Math.abs(gap.difference))}</em>
                </div>
                <div className="pay-gap-figures">
                  <span>Schedule <strong>{money(gap.scheduleTotal)}</strong></span>
                  <span>QuickFile paid <strong>{money(gap.quickfilePaid)}</strong></span>
                  {!moneyClose(gap.invoiceAmount, gap.quickfilePaid) && <span>Invoice total <strong>{money(gap.invoiceAmount)}</strong></span>}
                </div>
                {gap.jobs.length === 0 ? (
                  <p className="pay-gap-missing"><AlertCircle size={14} /> Paid in QuickFile, with no appointment left on the schedule.</p>
                ) : (
                  <ul className="pay-gap-jobs">
                    {gap.jobs.map(job => (
                      <li key={job.id}>
                        <span>{dateLabel(job.date)} · {job.time} · {job.service}</span>
                        <strong>{money(job.price)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </Fold>
  );
}
