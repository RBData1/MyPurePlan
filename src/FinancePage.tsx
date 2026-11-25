import { useRef, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, Download, Wallet } from 'lucide-react';
import FinanceCharts, { FinanceTax } from './FinanceCharts';
import InvoiceLedger from './InvoiceLedger';
import FinancePaidGaps from './FinancePaidGaps';
import UkDateInput from './UkDateInput';
import { invoiceIsOverdue, type InvoiceRecord } from './invoices';
import { findPaidAmountGaps } from './paidAmountGaps';
import type { Appointment, CalendarSource, FinancePeriod, Payment } from './DashboardApp';

export type FinanceTab = 'overview' | 'collect' | 'paid' | 'gaps' | 'tax';

export type FinancePageProps = {
  financeSource: CalendarSource;
  financePeriod: FinancePeriod;
  periodLabel: string;
  financeRange: { start: string; end: string };
  financeJobs: Appointment[];
  financePaid: Appointment[];
  financeUnpaid: Appointment[];
  financeInvoices: InvoiceRecord[];
  financeAppointments: Appointment[];
  financeBilled: number;
  financeCollected: number;
  financeOutstanding: number;
  payFrom: string;
  payTo: string;
  periodPayCount: number;
  periodPayTotal: number;
  payments: Payment[];
  businessId: string | null;
  invoiceNotice: string;
  checkingQuickFile: boolean;
  financeTab: FinanceTab;
  onTabChange: (tab: FinanceTab) => void;
  onSourceChange: (source: CalendarSource) => void;
  onPeriodChange: (period: FinancePeriod) => void;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;
  onToday: () => void;
  onPayFromChange: (value: string) => void;
  onPayToChange: (value: string) => void;
  payChosenPeriod: () => void;
  markJobPaid: (job: Appointment) => void | Promise<void>;
  markJobUnpaid: (id: string) => void | Promise<void>;
  markJobCompleted: (id: string) => void | Promise<void>;
  checkQuickFilePayments: () => void | Promise<void>;
  onExportCsv: () => void;
  customerName: (id: string) => string;
  isPaid: (id: string) => boolean;
  paymentFor: (id: string) => Payment | undefined;
};

function money(amount: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(amount || 0);
}

function dateLabel(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${parsed.getFullYear()}`;
}

function Stat({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon tone-${tone}`}>{icon}</div>
      <div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>
      <ArrowUpRight className="stat-arrow" size={15} />
    </div>
  );
}

function Status({ status }: { status: Appointment['status'] }) {
  return <span className={`status status-${status.toLowerCase()}`}><i />{status}</span>;
}

type TabSpec = { id: FinanceTab; label: string; badge?: number; alert?: boolean; dim?: boolean };

function FinanceTabs({ tabs, active, onChange }: { tabs: TabSpec[]; active: FinanceTab; onChange: (tab: FinanceTab) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = tabs.length;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % count;
    else if (event.key === 'ArrowLeft') next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  }
  return (
    <div className="finance-tabs" role="tablist" aria-label="Finance sections">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={element => { refs.current[index] = element; }}
          type="button"
          role="tab"
          id={`finance-tab-${tab.id}`}
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          className={`finance-tab${active === tab.id ? ' is-active' : ''}${tab.dim ? ' is-dim' : ''}`}
          onClick={() => onChange(tab.id)}
          onKeyDown={event => onKeyDown(event, index)}
        >
          <span>{tab.label}</span>
          {tab.badge != null && <span className={`finance-tab-badge${tab.alert ? ' is-alert' : ''}`}>{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export default function FinancePage({
  financeSource,
  financePeriod,
  periodLabel,
  financeRange,
  financeJobs,
  financePaid,
  financeUnpaid,
  financeInvoices,
  financeAppointments,
  financeBilled,
  financeCollected,
  financeOutstanding,
  payFrom,
  payTo,
  periodPayCount,
  periodPayTotal,
  payments,
  businessId,
  invoiceNotice,
  checkingQuickFile,
  financeTab,
  onTabChange,
  onSourceChange,
  onPeriodChange,
  onPrevPeriod,
  onNextPeriod,
  onToday,
  onPayFromChange,
  onPayToChange,
  payChosenPeriod,
  markJobPaid,
  markJobUnpaid,
  markJobCompleted,
  checkQuickFilePayments,
  onExportCsv,
  customerName,
  isPaid,
  paymentFor,
}: FinancePageProps) {
  const chartJobs = financeJobs.map(job => ({
    id: job.id,
    date: job.date,
    price: job.price,
    service: job.service || 'Service',
    paid: isPaid(job.id) || Number(job.price) === 0,
    invoiceId: job.quickfileInvoiceId ?? null,
  }));
  const gapJobs = financeAppointments.filter(a => a.status !== 'Cancelled').map(a => ({
    id: a.id,
    customerName: customerName(a.customerId),
    date: a.date,
    time: a.time,
    service: a.service || 'Service',
    price: Number(a.price) || 0,
    quickfileInvoiceId: a.quickfileInvoiceId ?? null,
  }));
  const gapsCount = findPaidAmountGaps(gapJobs, financeInvoices).length;
  const openInvoices = financeInvoices.filter(invoice => invoice.status === 'unpaid');
  const overdueCount = financeInvoices.filter(invoice => invoiceIsOverdue(invoice)).length;

  const tabs: TabSpec[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'collect', label: 'To collect', badge: openInvoices.length, alert: overdueCount > 0 },
    { id: 'paid', label: 'Paid', badge: financePaid.length },
    { id: 'gaps', label: 'Differences', badge: gapsCount, dim: gapsCount === 0 },
    { id: 'tax', label: 'Tax' },
  ];

  return (
    <div className="page-scroll finance-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><Wallet size={14} /> MONEY IN &amp; OUTSTANDING</div>
          <h1>Finance</h1>
          <p className="finance-headline">{financeSource === 'square' ? 'Square jobs only.' : 'Setmore jobs only.'} QuickFile is shared across both calendars.</p>
          <div className="calendar-source-switch" style={{ marginTop: 12 }}>
            <div className="segmented" role="group" aria-label="Finance source">
              <button type="button" className={financeSource !== 'square' ? 'chosen' : ''} onClick={() => onSourceChange('setmore')}>Setmore</button>
              <button type="button" className={financeSource === 'square' ? 'chosen' : ''} onClick={() => onSourceChange('square')}>Square</button>
            </div>
            <span>{financeSource === 'square' ? 'Showing Square finance' : 'Showing Setmore finance'}</span>
          </div>
        </div>
        {financeTab !== 'tax' && (
          <div className="heading-actions finance-heading-actions">
            <div className="finance-period-nav">
              <div className="finance-period-stepper">
                <button type="button" className="icon-button" aria-label="Previous period" onClick={onPrevPeriod}><ChevronLeft size={16} /></button>
                <div className="segmented">
                  <button className={financePeriod === 'week' ? 'chosen' : ''} onClick={() => onPeriodChange('week')}>Week</button>
                  <button className={financePeriod === 'month' ? 'chosen' : ''} onClick={() => onPeriodChange('month')}>Month</button>
                  <button className={financePeriod === 'quarter' ? 'chosen' : ''} onClick={() => onPeriodChange('quarter')}>Quarter</button>
                  <button className={financePeriod === 'year' ? 'chosen' : ''} onClick={() => onPeriodChange('year')}>Year</button>
                </div>
                <button type="button" className="icon-button" aria-label="Next period" onClick={onNextPeriod}><ChevronRight size={16} /></button>
              </div>
              <div className="finance-period-actions">
                <button type="button" className="button secondary" onClick={onToday}>Today</button>
                <button className="button secondary" onClick={onExportCsv}><Download size={16} /> Export CSV</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {financeTab !== 'tax' && <p className="finance-period-label">{periodLabel}</p>}

      <FinanceTabs tabs={tabs} active={financeTab} onChange={onTabChange} />

      {invoiceNotice && <div className="info-note"><AlertCircle size={17} /><p>{invoiceNotice}</p></div>}

      {financeTab === 'overview' && (
        <section role="tabpanel" id="finance-panel-overview" aria-labelledby="finance-tab-overview" className="finance-tab-panel">
          <div className="stats-grid">
            <Stat icon={<CircleDollarSign size={20} />} label="Billed in period" value={money(financeBilled)} sub={`${financeJobs.length} billable jobs`} tone="blue" />
            <Stat icon={<CheckCircle2 size={19} />} label="Collected" value={money(financeCollected)} sub={`${financePaid.length} paid`} tone="green" />
            <Stat icon={<AlertCircle size={19} />} label="Outstanding" value={money(financeOutstanding)} sub={`${financeUnpaid.length} unpaid`} tone="amber" />
            <Stat icon={<CalendarCheck size={19} />} label="Completed jobs" value={String(financeJobs.filter(a => a.status === 'Completed').length)} sub="Marked complete" tone="purple" />
          </div>
          <FinanceCharts period={financePeriod} start={financeRange.start} end={financeRange.end} jobs={chartJobs} invoices={financeInvoices} />
        </section>
      )}

      {financeTab === 'collect' && (
        <section role="tabpanel" id="finance-panel-collect" aria-labelledby="finance-tab-collect" className="finance-tab-panel">
          <p className="finance-tab-hint">Open invoices turn overdue 14 days after the invoice date. The invoice list covers every period; unpaid visits follow the period above.</p>
          <InvoiceLedger invoices={financeInvoices} checking={checkingQuickFile} onCheck={() => void checkQuickFilePayments()} defaultOpen />
          <section className="panel table-panel finance-tab-section">
            <div className="finance-tab-panel-head">
              <h2>Unpaid visits</h2>
              <p>Confirmed and completed visits in the selected period with no payment recorded.</p>
            </div>
            <div className="finance-pay-period">
              <div>
                <h2>Pay a period</h2>
                <p>Unpaid jobs between these dates are marked paid. The payment date is the invoice issue date, or the job date when there is no invoice.</p>
              </div>
              <div className="finance-pay-period-controls">
                <label>From<UkDateInput name="payFrom" value={payFrom} aria-label="Pay from" onIsoChange={onPayFromChange} /></label>
                <label>To<UkDateInput name="payTo" value={payTo} aria-label="Pay to" onIsoChange={onPayToChange} /></label>
                <button type="button" className="button primary" disabled={!periodPayCount} onClick={payChosenPeriod}>Pay {periodPayCount ? `${periodPayCount} · ${money(periodPayTotal)}` : 'period'}</button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Customer</th><th>Service</th><th>Status</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {financeUnpaid.map(a => (
                    <tr key={a.id}>
                      <td><strong>{dateLabel(a.date)}</strong><small className="table-sub">{a.time}</small></td>
                      <td><strong>{customerName(a.customerId)}</strong></td>
                      <td><span>{a.service}</span></td>
                      <td><Status status={a.status} /></td>
                      <td><strong>{money(a.price)}</strong></td>
                      <td>
                        <div className="row-actions">
                          {a.status !== 'Completed' && !isPaid(a.id)
                            ? <button className="button tiny primary" onClick={() => markJobCompleted(a.id)}>Done</button>
                            : <button className="button tiny primary" onClick={() => void markJobPaid(a)}>Pay</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {financeUnpaid.length === 0 && <div className="success-empty"><CheckCircle2 size={20} /> No outstanding payments in this period.</div>}
            </div>
          </section>
        </section>
      )}

      {financeTab === 'paid' && (
        <section role="tabpanel" id="finance-panel-paid" aria-labelledby="finance-tab-paid" className="finance-tab-panel">
          <section className="panel table-panel finance-tab-section">
            <div className="finance-tab-panel-head">
              <h2>Paid visits</h2>
              <p>Visits in the selected period with a recorded payment. Undo removes the payment but keeps the job done.</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Customer</th><th>Service</th><th>Paid on</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {financePaid.map(a => {
                    const pay = paymentFor(a.id);
                    return (
                      <tr key={a.id}>
                        <td><strong>{dateLabel(a.date)}</strong><small className="table-sub">{a.time}</small></td>
                        <td><strong>{customerName(a.customerId)}</strong></td>
                        <td><span>{a.service}</span></td>
                        <td>{pay ? <span className="cycle-pill paid-pill">{pay.paidAt ? dateLabel(pay.paidAt) : '—'} · {pay.method || '—'}</span> : <span className="cycle-pill paid-pill">£0 · no payment needed</span>}</td>
                        <td><strong>{money(a.price)}</strong></td>
                        <td>{pay ? <button className="button tiny secondary" onClick={() => void markJobUnpaid(a.id)}>Undo</button> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {financePaid.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon"><Wallet size={21} /></div>
                  <strong>No payments recorded yet</strong>
                  <p>Mark a job as paid to build your collection history.</p>
                </div>
              )}
            </div>
          </section>
        </section>
      )}

      {financeTab === 'gaps' && (
        <section role="tabpanel" id="finance-panel-gaps" aria-labelledby="finance-tab-gaps" className="finance-tab-panel">
          <section className="panel table-panel finance-tab-section">
            <div className="finance-tab-panel-head">
              <h2>Paid differences</h2>
              <p>Paid QuickFile invoices compared with the linked visits on the schedule. Covers every period.</p>
            </div>
            <FinancePaidGaps jobs={gapJobs} invoices={financeInvoices} embedded />
          </section>
        </section>
      )}

      {financeTab === 'tax' && (
        <section role="tabpanel" id="finance-panel-tax" aria-labelledby="finance-tab-tax" className="finance-tab-panel">
          <p className="finance-tab-hint">UK tax year, split between partners. Independent of the period above — use the arrows inside the card to change the tax year.</p>
          <FinanceTax payments={payments} businessId={businessId} defaultOpen />
        </section>
      )}
    </div>
  );
}
