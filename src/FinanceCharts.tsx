import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { invoiceIsOverdue, type InvoiceRecord } from './invoices';

type Period = 'week' | 'month' | 'quarter' | 'year';

type FinanceJob = {
  id: string;
  date: string;
  price: number;
  service: string;
  paid: boolean;
  invoiceId: number | null;
};

type Bucket = {
  label: string;
  from: string;
  to: string;
  collected: number;
  outstanding: number;
};

const COLLECTED = '#1a9c77';
const OUTSTANDING = '#e0a33a';
const OPEN = '#316de4';
const OVERDUE = '#d4534a';

function money(amount: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(amount || 0);
}

function axisMoney(amount: number) {
  if (amount >= 1000) {
    const thousands = amount / 1000;
    const digits = thousands >= 10 || Number.isInteger(thousands) ? 0 : 1;
    return `£${thousands.toFixed(digits)}k`;
  }
  return `£${Math.round(amount)}`;
}

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDay(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

function eachDate(start: string, end: string) {
  const days: string[] = [];
  const cursor = parseDay(start);
  const last = parseDay(end);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return days;
  while (cursor <= last) {
    days.push(iso(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function dayNumber(value: string) {
  return String(parseDay(value).getDate());
}

function barPath(x: number, y: number, w: number, h: number, roundTop: boolean) {
  const radius = roundTop ? Math.min(6, w / 2, h / 2) : 0;
  if (h <= 0 || w <= 0) return '';
  if (radius <= 0) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  return `M ${x} ${y + radius} Q ${x} ${y} ${x + radius} ${y} H ${x + w - radius} Q ${x + w} ${y} ${x + w} ${y + radius} V ${y + h} H ${x} Z`;
}

function niceMax(value: number) {
  if (value <= 0) return 100;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

function buildBuckets(period: Period, start: string, end: string, jobs: FinanceJob[]): Bucket[] {
  const ranges: { label: string; from: string; to: string }[] = [];
  if (period === 'year' || period === 'quarter') {
    const cursor = parseDay(start);
    cursor.setDate(1);
    const last = parseDay(end);
    while (cursor <= last) {
      const monthStart = iso(cursor);
      const monthEndDate = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const monthEnd = iso(monthEndDate);
      ranges.push({
        label: cursor.toLocaleDateString('en-GB', { month: 'short' }),
        from: monthStart < start ? start : monthStart,
        to: monthEnd > end ? end : monthEnd,
      });
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }
  } else if (period === 'month') {
    const groups: string[][] = [];
    for (const day of eachDate(start, end)) {
      const mondayIndex = (parseDay(day).getDay() + 6) % 7;
      if (mondayIndex === 0 || groups.length === 0) groups.push([day]);
      else groups[groups.length - 1].push(day);
    }
    for (const days of groups) {
      const from = days[0];
      const to = days[days.length - 1];
      ranges.push({
        label: from === to ? dayNumber(from) : `${dayNumber(from)}–${dayNumber(to)}`,
        from,
        to,
      });
    }
  } else {
    for (const day of eachDate(start, end)) {
      ranges.push({
        label: parseDay(day).toLocaleDateString('en-GB', { weekday: 'short' }),
        from: day,
        to: day,
      });
    }
  }

  return ranges.map(range => {
    let collected = 0;
    let outstanding = 0;
    for (const job of jobs) {
      if (job.date < range.from || job.date > range.to) continue;
      const price = Number(job.price) || 0;
      if (job.paid) collected += price;
      else outstanding += price;
    }
    return { ...range, collected, outstanding };
  });
}

function Ring({ parts, label }: { parts: { value: number; color: string }[]; label: string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const active = parts.filter(part => part.value > 0);
  const size = 168;
  const center = size / 2;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const gap = active.length > 1 ? 12 : 0;
  const available = circumference - gap * active.length;
  const start = circumference / 4;
  let cursor = gap / 2;

  return (
    <svg className="finance-ring" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="#e7edf5" strokeWidth="16" />
      {total > 0 && active.length === 1 ? (
        <circle cx={center} cy={center} r={radius} fill="none" stroke={active[0].color} strokeWidth="16" />
      ) : active.map(part => {
        const length = (part.value / total) * available;
        const offset = start - cursor;
        cursor += length + gap;
        return <circle key={part.color} cx={center} cy={center} r={radius} fill="none" stroke={part.color} strokeWidth="16" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={offset} />;
      })}
      <text x={center} y={center - 4} textAnchor="middle" className={`finance-ring-value${label.length > 3 ? ' is-compact' : ''}`}>{total > 0 ? label : '—'}</text>
      <text x={center} y={center + 16} textAnchor="middle" className="finance-ring-caption">{total > 0 ? 'collected' : 'nothing billed'}</text>
    </svg>
  );
}

function splitBilledJobs(jobs: FinanceJob[], invoices: InvoiceRecord[]) {
  const byInvoice = new Map(invoices.map(invoice => [invoice.quickfileInvoiceId, invoice]));
  let collected = 0;
  let open = 0;
  let overdue = 0;
  for (const job of jobs) {
    const price = Number(job.price) || 0;
    if (job.paid) {
      collected += price;
      continue;
    }
    const invoice = job.invoiceId == null ? undefined : byInvoice.get(job.invoiceId);
    if (invoice && invoice.status !== 'void' && invoiceIsOverdue(invoice)) overdue += price;
    else open += price;
  }
  const billed = collected + open + overdue;
  const rate = billed > 0 ? (collected / billed) * 100 : 0;
  const rateLabel = billed <= 0 ? '—' : rate > 0 && rate < 1 ? '<1%' : `${Math.round(rate)}%`;
  return { collected, open, overdue, billed, rateLabel };
}

export default function FinanceCharts({
  period,
  start,
  end,
  jobs,
  invoices,
}: {
  period: Period;
  start: string;
  end: string;
  jobs: FinanceJob[];
  invoices: InvoiceRecord[];
}) {
  const [hot, setHot] = useState<number | null>(null);
  const buckets = useMemo(() => buildBuckets(period, start, end, jobs), [period, start, end, jobs]);
  const split = useMemo(() => splitBilledJobs(jobs, invoices), [jobs, invoices]);
  const { collected, open, overdue, billed, rateLabel } = split;
  const grain = period === 'week' ? 'Each day' : period === 'month' ? 'Each week' : 'Each month';

  const services = useMemo(() => {
    const map = new Map<string, { service: string; collected: number; outstanding: number }>();
    for (const job of jobs) {
      const name = job.service.trim() || 'Service';
      const row = map.get(name) || { service: name, collected: 0, outstanding: 0 };
      const price = Number(job.price) || 0;
      if (job.paid) row.collected += price;
      else row.outstanding += price;
      map.set(name, row);
    }
    const sorted = [...map.values()].filter(row => row.collected + row.outstanding > 0).sort((a, b) => (b.collected + b.outstanding) - (a.collected + a.outstanding));
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    if (rest.length) {
      top.push(rest.reduce((sum, row) => ({
        service: 'Other',
        collected: sum.collected + row.collected,
        outstanding: sum.outstanding + row.outstanding,
      }), { service: 'Other', collected: 0, outstanding: 0 }));
    }
    return top;
  }, [jobs]);

  const width = 640;
  const height = 214;
  const padL = 52;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const peak = Math.max(...buckets.map(bucket => bucket.collected + bucket.outstanding), 0);
  const max = niceMax(peak);
  const gap = buckets.length > 8 ? 6 : 10;
  const barW = buckets.length ? Math.max(4, (innerW - gap * Math.max(0, buckets.length - 1)) / buckets.length) : 0;
  const active = hot != null ? buckets[hot] : null;
  const tipX = active && buckets.length ? ((padL + hot! * (barW + gap) + barW / 2) / width) * 100 : 0;

  return (
    <>
      <p className="sr-only">{billed > 0 ? `Collected ${money(collected)}, open ${money(open)}, overdue ${money(overdue)}. Together ${money(billed)} billed.` : 'Nothing billed in this period.'}</p>
      <div className="finance-charts">
        <section className="panel finance-chart-card">
          <div className="finance-chart-head">
            <h2>Collected</h2>
            <p>The same jobs as the totals above. Collected, open and overdue add up to billed.</p>
          </div>
          <div className="finance-donut-layout">
            <Ring
              parts={[{ value: collected, color: COLLECTED }, { value: open, color: OPEN }, { value: overdue, color: OVERDUE }]}
              label={rateLabel}
            />
            <ul className="finance-legend">
              <li>
                <i style={{ background: COLLECTED }} />
                <span>Collected</span>
                <strong>{money(collected)}</strong>
              </li>
              <li>
                <i style={{ background: OPEN }} />
                <span>Open</span>
                <strong>{money(open)}</strong>
              </li>
              <li>
                <i style={{ background: OVERDUE }} />
                <span>Overdue</span>
                <strong>{money(overdue)}</strong>
              </li>
              <li className="finance-legend-total">
                <i style={{ background: '#d5dde8' }} />
                <span>Billed</span>
                <strong>{money(billed)}</strong>
              </li>
            </ul>
          </div>
        </section>

        <section className="panel finance-chart-card">
          <div className="finance-chart-head">
            <h2>Billed over time</h2>
            <p>{grain}. Green is collected, amber is still outstanding.</p>
          </div>
          <div className="finance-plot" onMouseLeave={() => setHot(null)}>
            <svg className="finance-bars" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${grain} billed and collected`}>
              {[1, 0.5].map(mark => {
                const y = padT + innerH * (1 - mark);
                return (
                  <g key={mark}>
                    <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="#e6edf5" />
                    <text x={padL - 8} y={y + 4} textAnchor="end" className="finance-axis">{axisMoney(max * mark)}</text>
                  </g>
                );
              })}
              <line x1={padL} x2={width - padR} y1={padT + innerH} y2={padT + innerH} stroke="#d5dde8" />
              <text x={padL - 8} y={padT + innerH + 4} textAnchor="end" className="finance-axis">£0</text>
              {buckets.map((bucket, index) => {
                const billedHeight = ((bucket.collected + bucket.outstanding) / max) * innerH;
                const collectedHeight = (bucket.collected / max) * innerH;
                const x = padL + index * (barW + gap);
                const base = padT + innerH;
                const hotBar = hot === index;
                return (
                  <g key={`${bucket.from}-${bucket.to}`} onMouseEnter={() => setHot(index)}>
                    <rect x={x} y={padT} width={barW} height={innerH} fill="transparent" />
                    {bucket.outstanding > 0 && (
                      <path className={hotBar ? 'is-hot' : ''} d={barPath(x, base - billedHeight, barW, Math.max(billedHeight - collectedHeight, 0), true)} fill={OUTSTANDING} />
                    )}
                    {bucket.collected > 0 && (
                      <path className={hotBar ? 'is-hot' : ''} d={barPath(x, base - collectedHeight, barW, collectedHeight, bucket.outstanding <= 0)} fill={COLLECTED} />
                    )}
                    <text x={x + barW / 2} y={height - 8} textAnchor="middle" className={`finance-axis ${hotBar ? 'is-hot' : ''}`}>{bucket.label}</text>
                  </g>
                );
              })}
            </svg>
            {active && (
              <div className="finance-tip" style={{ left: `${tipX}%`, transform: tipX < 16 ? 'translateX(0)' : tipX > 84 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                <strong>{active.label}</strong>
                <span><i style={{ background: COLLECTED }} />Collected {money(active.collected)}</span>
                <span><i style={{ background: OUTSTANDING }} />Outstanding {money(active.outstanding)}</span>
              </div>
            )}
          </div>
          {billed === 0 && <p className="finance-chart-empty">No billable jobs in this period.</p>}
        </section>

        {services.length > 1 && (
          <section className="panel finance-chart-card finance-chart-wide">
            <div className="finance-chart-head">
              <h2>By service</h2>
              <p>Billed amount in this period. Green is the part already collected.</p>
            </div>
            <div className="finance-services">
              {services.map(row => {
                const total = row.collected + row.outstanding;
                const scale = Math.max(...services.map(item => item.collected + item.outstanding), 1);
                return (
                  <div className="finance-service-row" key={row.service}>
                    <span title={row.service}>{row.service}</span>
                    <div className="finance-service-track" aria-hidden="true">
                      <i style={{ width: `${(row.collected / scale) * 100}%`, background: COLLECTED }} />
                      <i style={{ width: `${(row.outstanding / scale) * 100}%`, background: OUTSTANDING }} />
                    </div>
                    <strong>{money(total)}</strong>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

const BASIC_BAND = 37700;
const HIGHER_BAND_END = 125140;

type TaxForm = {
  expenses: string;
  lastYear: string;
  yourShare: string;
  personalAllowance: string;
  partnerAllowance: string;
  class4Lower: string;
  class4Rate: string;
  class4Upper: string;
  class4UpperRate: string;
  class2: string;
  partnerClass2: string;
};

const TAX_DEFAULTS: TaxForm = {
  expenses: '',
  lastYear: '',
  yourShare: '50',
  personalAllowance: '12570',
  partnerAllowance: '12570',
  class4Lower: '12570',
  class4Rate: '6',
  class4Upper: '50270',
  class4UpperRate: '2',
  class2: '0',
  partnerClass2: '0',
};

function roundPence(amount: number) {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function ukTaxYear(anchorIso: string) {
  const date = new Date(`${anchorIso.slice(0, 10)}T12:00:00`);
  const startYear = date.getMonth() > 3 || (date.getMonth() === 3 && date.getDate() >= 6) ? date.getFullYear() : date.getFullYear() - 1;
  return {
    startYear,
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
    label: `${startYear}/${String(startYear + 1).slice(2)}`,
    key: `${startYear}-${startYear + 1}`,
  };
}

function shiftTaxYear(anchorIso: string, delta: number) {
  const year = ukTaxYear(anchorIso);
  return `${year.startYear + delta}-04-06`;
}

function smallProfitsThreshold(startYear: number) {
  if (startYear <= 2025) return 6845;
  return 7105;
}

function inclusiveDays(startIso: string, endIso: string) {
  const start = Date.parse(`${startIso.slice(0, 10)}T12:00:00`);
  const end = Date.parse(`${endIso.slice(0, 10)}T12:00:00`);
  return Math.round((end - start) / 86400000) + 1;
}

function numberOr(value: string, fallback: number) {
  const cleaned = value.replace(/[£,%\s,]/g, '');
  if (!cleaned || cleaned === '.') return fallback;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
}

function parseMoneyInput(value: string) {
  return numberOr(value, 0);
}

function partnershipProfit(takings: number, expenses: number) {
  return roundPence(Math.max(0, takings - expenses));
}

function sharePercent(value: string) {
  return Math.min(100, numberOr(value, 50));
}

function splitProfit(profit: number, yoursPercent: number) {
  const yours = roundPence(profit * yoursPercent / 100);
  return { yours, partner: roundPence(profit - yours) };
}

function percentLabel(value: number) {
  return `${Number(value.toFixed(2))}%`;
}

function selfEmployedTax(profit: number, rates: { allowance: number; class4Lower: number; class4Rate: number; class4Upper: number; class4UpperRate: number; class2: number }) {
  const income = Math.max(0, profit);
  const taxable = Math.max(0, income - Math.max(0, rates.allowance));
  const basic = Math.min(taxable, BASIC_BAND);
  const higher = Math.min(Math.max(0, taxable - BASIC_BAND), HIGHER_BAND_END - BASIC_BAND);
  const additional = Math.max(0, taxable - HIGHER_BAND_END);
  const incomeTax = roundPence(basic * 0.2 + higher * 0.4 + additional * 0.45);
  const upper = Math.max(rates.class4Upper, rates.class4Lower);
  const class4Main = Math.max(0, Math.min(income, upper) - rates.class4Lower);
  const class4Upper = Math.max(0, income - upper);
  const class4 = roundPence(class4Main * (rates.class4Rate / 100) + class4Upper * (rates.class4UpperRate / 100));
  const class2 = roundPence(Math.max(0, rates.class2));
  return { incomeTax, class4, class2, total: roundPence(incomeTax + class4 + class2) };
}

function PartnerShare({ title, profit, tax }: { title: string; profit: number; tax: { incomeTax: number; class4: number; class2: number; total: number } }) {
  return (
    <div className="finance-tax-partner">
      <h4>{title}</h4>
      <div><span>Profit</span><strong>{money(profit)}</strong></div>
      <div><span>Income tax</span><strong>{money(tax.incomeTax)}</strong></div>
      <div><span>Class 4</span><strong>{money(tax.class4)}</strong></div>
      <div><span>Class 2</span><strong>{money(tax.class2)}</strong></div>
      <div><span>To set aside</span><strong>{money(tax.total)}</strong></div>
    </div>
  );
}

export function FinanceTax({ payments, businessId }: { payments: { paidAt?: string | null; amount: number }[]; businessId: string | null }) {
  const [anchor, setAnchor] = useState(todayIso);
  const [open, setOpen] = useState(false);
  const year = ukTaxYear(anchor);
  const storageKey = `cs_tax_${businessId || 'local'}_${year.key}`;
  const legacyKey = `cs_tax_expenses_${businessId || 'local'}_${year.key}`;
  const [form, setForm] = useState<TaxForm>(TAX_DEFAULTS);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      const parsed = saved ? JSON.parse(saved) as Partial<TaxForm> : {};
      const legacy = localStorage.getItem(legacyKey);
      setForm({ ...TAX_DEFAULTS, ...parsed, expenses: typeof parsed.expenses === 'string' ? parsed.expenses : (legacy || '') });
    } catch {
      setForm(TAX_DEFAULTS);
    }
  }, [storageKey, legacyKey]);

  const class4 = useMemo(() => ({
    class4Lower: numberOr(form.class4Lower, Number(TAX_DEFAULTS.class4Lower)),
    class4Rate: numberOr(form.class4Rate, Number(TAX_DEFAULTS.class4Rate)),
    class4Upper: numberOr(form.class4Upper, Number(TAX_DEFAULTS.class4Upper)),
    class4UpperRate: numberOr(form.class4UpperRate, Number(TAX_DEFAULTS.class4UpperRate)),
  }), [form.class4Lower, form.class4Rate, form.class4Upper, form.class4UpperRate]);
  const yourShare = sharePercent(form.yourShare);
  const partnerShare = roundPence(100 - yourShare);
  const yourAllowance = numberOr(form.personalAllowance, Number(TAX_DEFAULTS.personalAllowance));
  const partnerAllowance = numberOr(form.partnerAllowance, Number(TAX_DEFAULTS.partnerAllowance));
  const yourClass2 = parseMoneyInput(form.class2);
  const partnerClass2 = parseMoneyInput(form.partnerClass2);
  function taxOn(profit: number, allowance: number, class2: number) {
    return selfEmployedTax(profit, { ...class4, allowance, class2 });
  }
  function bill(profit: number) {
    const parts = splitProfit(profit, yourShare);
    const yours = taxOn(parts.yours, yourAllowance, yourClass2);
    const partner = taxOn(parts.partner, partnerAllowance, partnerClass2);
    return { parts, yours, partner, total: roundPence(yours.total + partner.total) };
  }
  const takings = roundPence(payments.reduce((sum, payment) => {
    const day = String(payment.paidAt || '').slice(0, 10);
    if (!day || day < year.start || day > year.end) return sum;
    return sum + (Number(payment.amount) || 0);
  }, 0));
  const enteredExpenses = parseMoneyInput(form.expenses);
  const actualProfit = partnershipProfit(takings, enteredExpenses);
  const actualBill = bill(actualProfit);
  const lastYearTakings = parseMoneyInput(form.lastYear);
  const progress = useMemo(() => {
    const today = todayIso();
    const yearDays = inclusiveDays(year.start, year.end);
    if (today < year.start) return { yearDays, elapsed: 0, status: 'future' as const };
    if (today > year.end) return { yearDays, elapsed: yearDays, status: 'past' as const };
    return { yearDays, elapsed: inclusiveDays(year.start, today), status: 'current' as const };
  }, [year.start, year.end]);
  const expectedByToday = lastYearTakings > 0 && progress.elapsed > 0 ? roundPence(lastYearTakings * (progress.elapsed / progress.yearDays)) : 0;
  const projectedTakings = progress.status === 'past'
    ? takings
    : lastYearTakings <= 0
      ? null
      : progress.status === 'future' || takings <= expectedByToday
        ? lastYearTakings
        : roundPence(takings * (progress.yearDays / progress.elapsed));
  const forecastProfit = partnershipProfit(projectedTakings || 0, enteredExpenses);
  const forecastBill = bill(forecastProfit);
  const assumptionBill = bill(partnershipProfit(lastYearTakings, enteredExpenses));
  const threshold = smallProfitsThreshold(year.startYear);
  const summary = projectedTakings == null
    ? `Received ${money(takings)} · partnership ${percentLabel(yourShare)} / ${percentLabel(partnerShare)} · enter last year to forecast`
    : `Received ${money(takings)} · Forecast ${money(projectedTakings)} · together ${money(forecastBill.total)}`;

  function update(field: keyof TaxForm, value: string) {
    setForm(current => {
      const next = { ...current, [field]: value };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* the figure still shows for this visit */ }
      return next;
    });
  }

  const paceNote = progress.status === 'past'
        ? `This tax year has finished, so the forecast matches money received.${lastYearTakings > 0 ? ` Matching last year exactly, the partnership would set aside ${money(assumptionBill.total)}.` : ''}`
    : projectedTakings == null
      ? 'Enter last year’s partnership takings to forecast the full year. The figures above stay on money received so far, split between the two partners.'
      : progress.status === 'future' || takings <= 0
        ? `No payments confirmed in this tax year yet, so the forecast stays on last year’s ${money(lastYearTakings)}. Together the partnership would set aside ${money(assumptionBill.total)}.`
        : takings <= expectedByToday
          ? `Confirmed payments are ${money(takings)}. Last year’s pace would already be ${money(expectedByToday)} by today, so the forecast stays at ${money(lastYearTakings)} until recorded payments pass that pace. Together that sets aside ${money(assumptionBill.total)}.`
          : `Confirmed payments are ahead of last year’s pace, so the full year is forecast at ${money(projectedTakings)}. Together the partnership sets aside ${money(forecastBill.total)}.`;

  return (
    <section className={`panel finance-tax finance-fold${open ? ' is-open' : ''}`}>
      <div className="finance-fold-head finance-tax-headbar">
        <button type="button" className="finance-fold-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <span>
            <h2>Tax year {year.label}</h2>
            <p>{summary}</p>
          </span>
        </button>
        <div className="finance-period-nav">
          <button type="button" className="icon-button" aria-label="Previous tax year" onClick={() => setAnchor(shiftTaxYear(anchor, -1))}><ChevronLeft size={16} /></button>
          <button type="button" className="icon-button" aria-label="Next tax year" onClick={() => setAnchor(shiftTaxYear(anchor, 1))}><ChevronRight size={16} /></button>
        </div>
        <button type="button" className="finance-tax-chevron" aria-expanded={open} aria-label={open ? 'Hide tax year' : 'Show tax year'} onClick={() => setOpen(value => !value)}>
          <ChevronDown size={18} />
        </button>
      </div>
      {open && (
        <div className="finance-tax-body">
          <h3>So far</h3>
          <div className="finance-tax-grid">
            <div><span>Money received</span><strong>{money(takings)}</strong></div>
            <label className="finance-tax-field">
              <span>Allowable expenses</span>
              <input inputMode="decimal" value={form.expenses} placeholder="0.00" aria-label="Allowable expenses" onChange={event => update('expenses', event.target.value)} />
            </label>
            <div><span>Partnership profit</span><strong>{money(actualProfit)}</strong></div>
          </div>
          <div className="finance-tax-partners">
            <PartnerShare title={`You · ${percentLabel(yourShare)}`} profit={actualBill.parts.yours} tax={actualBill.yours} />
            <PartnerShare title={`Partner · ${percentLabel(partnerShare)}`} profit={actualBill.parts.partner} tax={actualBill.partner} />
          </div>
          <p className="finance-tax-together">Together {money(actualBill.total)}</p>
          <p className="finance-tax-note">Profit is money received minus the expenses you entered, then split. The same expenses and share are used for the forecast.</p>

          <h3>Forecast</h3>
          <div className="finance-tax-grid">
            <label className="finance-tax-field">
              <span>Last year takings</span>
              <input inputMode="decimal" value={form.lastYear} placeholder="0.00" aria-label="Last year takings" onChange={event => update('lastYear', event.target.value)} />
            </label>
            <div><span>Forecast takings</span><strong>{projectedTakings == null ? '—' : money(projectedTakings)}</strong></div>
            <div><span>Forecast profit</span><strong>{projectedTakings == null ? '—' : money(forecastProfit)}</strong></div>
          </div>
          {projectedTakings != null && (
            <>
              <div className="finance-tax-partners">
                <PartnerShare title={`You · ${percentLabel(yourShare)}`} profit={forecastBill.parts.yours} tax={forecastBill.yours} />
                <PartnerShare title={`Partner · ${percentLabel(partnerShare)}`} profit={forecastBill.parts.partner} tax={forecastBill.partner} />
              </div>
              <p className="finance-tax-together">Together {money(forecastBill.total)}</p>
            </>
          )}
          <p className="finance-tax-note">{paceNote}</p>

          <h3>Rates</h3>
          <div className="finance-tax-grid">
            <label className="finance-tax-field">
              <span>Your share %</span>
              <input inputMode="decimal" value={form.yourShare} aria-label="Your share percent" onChange={event => update('yourShare', event.target.value)} />
            </label>
            <label className="finance-tax-field">
              <span>Your personal allowance</span>
              <input inputMode="decimal" value={form.personalAllowance} aria-label="Your personal allowance" onChange={event => update('personalAllowance', event.target.value)} />
            </label>
            <label className="finance-tax-field">
              <span>Partner personal allowance</span>
              <input inputMode="decimal" value={form.partnerAllowance} aria-label="Partner personal allowance" onChange={event => update('partnerAllowance', event.target.value)} />
            </label>
            <label className="finance-tax-field">
              <span>Class 4 from</span>
              <input inputMode="decimal" value={form.class4Lower} aria-label="Class 4 from" onChange={event => update('class4Lower', event.target.value)} />
            </label>
            <label className="finance-tax-field">
              <span>Class 4 rate %</span>
              <input inputMode="decimal" value={form.class4Rate} aria-label="Class 4 rate" onChange={event => update('class4Rate', event.target.value)} />
            </label>
            <label className="finance-tax-field">
              <span>Class 4 above</span>
              <input inputMode="decimal" value={form.class4Upper} aria-label="Class 4 above" onChange={event => update('class4Upper', event.target.value)} />
            </label>
            <label className="finance-tax-field">
              <span>Class 4 upper %</span>
              <input inputMode="decimal" value={form.class4UpperRate} aria-label="Class 4 upper rate" onChange={event => update('class4UpperRate', event.target.value)} />
            </label>
            <label className="finance-tax-field">
              <span>Your Class 2</span>
              <input inputMode="decimal" value={form.class2} aria-label="Your Class 2" onChange={event => update('class2', event.target.value)} />
            </label>
            <label className="finance-tax-field">
              <span>Partner Class 2</span>
              <input inputMode="decimal" value={form.partnerClass2} aria-label="Partner Class 2" onChange={event => update('partnerClass2', event.target.value)} />
            </label>
          </div>
          <p className="finance-tax-note">
            Each partner is taxed on their own share: 20% after their personal allowance, then 40% and 45%, and Class 4 on that share. England, Wales and Northern Ireland. This assumes the partnership is each person’s only income. The £1,000 trading allowance does not apply to partnership income.
            {' '}Class 2 stays at the amount you enter for each partner. Voluntary Class 2 is £3.65 a week (£189.80 for the year) when that partner’s profit is under £{threshold.toLocaleString('en-GB')}.
          </p>
        </div>
      )}
    </section>
  );
}
