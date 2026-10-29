import { FileText, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { invoiceIsOverdue, type InvoiceRecord } from './invoices';

function money(amount: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(amount || 0);
}

function dateLabel(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${parsed.getFullYear()}`;
}

type Filter = 'open' | 'overdue' | 'paid' | 'all';

export default function InvoiceLedger({ invoices, checking, onCheck }: { invoices: InvoiceRecord[]; checking?: boolean; onCheck?: () => void }) {
  const [filter, setFilter] = useState<Filter>('open');
  const counts = useMemo(() => {
    const overdue = invoices.filter(invoice => invoiceIsOverdue(invoice));
    const unpaid = invoices.filter(invoice => invoice.status === 'unpaid');
    const paid = invoices.filter(invoice => invoice.status === 'paid');
    return { overdue, unpaid, paid };
  }, [invoices]);
  const visible = invoices.filter(invoice => {
    if (filter === 'paid') return invoice.status === 'paid';
    if (filter === 'overdue') return invoiceIsOverdue(invoice);
    if (filter === 'open') return invoice.status === 'unpaid';
    return invoice.status !== 'void';
  });
  const openAmount = counts.unpaid.reduce((sum, invoice) => sum + invoice.amount, 0);
  const overdueAmount = counts.overdue.reduce((sum, invoice) => sum + invoice.amount, 0);

  return (
    <div className="panel table-panel" style={{ marginBottom: 18 }}>
      <div className="panel-heading padded-heading">
        <div>
          <h2>QuickFile invoices</h2>
          <p>{counts.unpaid.length} open · {money(openAmount)} · {counts.overdue.length} overdue · {money(overdueAmount)} · {counts.paid.length} paid</p>
        </div>
        <div className="heading-actions">
          {onCheck && <button type="button" className="button secondary" disabled={checking || invoices.every(invoice => invoice.status !== 'unpaid')} onClick={onCheck}><RefreshCw size={15} /> {checking ? 'Checking…' : 'Check QuickFile'}</button>}
          <div className="segmented">
          <button type="button" className={filter === 'open' ? 'chosen' : ''} onClick={() => setFilter('open')}>Open</button>
          <button type="button" className={filter === 'overdue' ? 'chosen' : ''} onClick={() => setFilter('overdue')}>Overdue</button>
          <button type="button" className={filter === 'paid' ? 'chosen' : ''} onClick={() => setFilter('paid')}>Paid</button>
          <button type="button" className={filter === 'all' ? 'chosen' : ''} onClick={() => setFilter('all')}>All</button>
          </div>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Job</th>
              <th>Issued</th>
              <th>Due</th>
              <th>Status</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(invoice => {
              const overdue = invoiceIsOverdue(invoice);
              return (
                <tr key={invoice.quickfileInvoiceId}>
                  <td><strong>{invoice.quickfileInvoiceNumber || invoice.quickfileInvoiceId}</strong></td>
                  <td>
                    <strong>{invoice.customerName || 'Customer'}</strong>
                    {invoice.address ? <small className="table-sub">{invoice.address}</small> : null}
                  </td>
                  <td><span>{invoice.service || 'Service'}</span>{invoice.jobDate ? <small className="table-sub">{dateLabel(invoice.jobDate)}</small> : null}</td>
                  <td>{dateLabel(invoice.issuedAt)}</td>
                  <td>{dateLabel(invoice.dueAt)}</td>
                  <td>
                    <span className={`cycle-pill ${invoice.status === 'paid' ? 'paid-pill' : ''}`}>
                      {invoice.status === 'paid' ? `Paid${invoice.paidAt ? ` ${dateLabel(invoice.paidAt)}` : ''}` : overdue ? 'Overdue' : invoice.status === 'void' ? 'Void' : 'Unpaid'}
                    </span>
                  </td>
                  <td><strong>{money(invoice.amount)}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon"><FileText size={21} /></div>
            <strong>{invoices.length === 0 ? 'No QuickFile invoices yet' : 'Nothing in this view'}</strong>
            <p>Mark a job as done to create an invoice. QuickFile marks it paid here when the customer pays.</p>
          </div>
        )}
      </div>
    </div>
  );
}
