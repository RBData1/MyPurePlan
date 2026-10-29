/** QuickFile invoice register: created here, marked paid by the QuickFile webhook or in the app. */

import type { supabase as supabaseClient } from './supabase';

export type InvoiceStatus = 'unpaid' | 'paid' | 'void';

export type InvoiceRecord = {
  id: string;
  appointmentId: string | null;
  customerName: string;
  service: string;
  address: string;
  jobDate: string | null;
  amount: number;
  quickfileInvoiceId: number;
  quickfileInvoiceNumber: string | null;
  issuedAt: string;
  dueAt: string | null;
  status: InvoiceStatus;
  paidAt: string | null;
  paidAmount: number | null;
  paymentMethod: string | null;
};

type Client = NonNullable<typeof supabaseClient>;

const TERM_DAYS = 14;

export function addIsoDays(isoDate: string, days: number) {
  const parsed = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate.slice(0, 10);
  parsed.setDate(parsed.getDate() + days);
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function invoiceDueAt(issuedAt: string | null | undefined) {
  const day = String(issuedAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return addIsoDays(day, TERM_DAYS);
}

export function invoiceIsOverdue(invoice: Pick<InvoiceRecord, 'status' | 'dueAt'>, today = new Date()) {
  if (invoice.status !== 'unpaid' || !invoice.dueAt) return false;
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return invoice.dueAt < todayIso;
}

export function invoiceStorageKey(businessId: string | null) {
  return businessId ? `cs_invoices_${businessId}` : 'cs_invoices';
}

export function readInvoiceCache(businessId: string | null): InvoiceRecord[] {
  try {
    const raw = localStorage.getItem(invoiceStorageKey(businessId));
    const parsed = raw ? JSON.parse(raw) as InvoiceRecord[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeInvoiceCache(businessId: string | null, rows: InvoiceRecord[]) {
  try {
    localStorage.setItem(invoiceStorageKey(businessId), JSON.stringify(rows));
  } catch {
    /* the database copy is the register other devices read */
  }
}

export function combineInvoiceSources(cloud: InvoiceRecord[], cache: InvoiceRecord[], derived: InvoiceRecord[]) {
  const map = new Map<number, InvoiceRecord>();
  for (const row of [...derived, ...cache, ...cloud]) {
    const prev = map.get(row.quickfileInvoiceId);
    if (!prev) {
      map.set(row.quickfileInvoiceId, row);
      continue;
    }
    const paid = prev.status === 'paid' || row.status === 'paid';
    const voided = !paid && (prev.status === 'void' || row.status === 'void');
    const cloudRow = cloud.find(item => item.quickfileInvoiceId === row.quickfileInvoiceId);
    map.set(row.quickfileInvoiceId, {
      ...prev,
      ...row,
      id: cloudRow?.id || prev.id || row.id,
      status: paid ? 'paid' : voided ? 'void' : 'unpaid',
      paidAt: paid ? (row.paidAt || prev.paidAt) : null,
      paidAmount: paid ? (row.paidAmount ?? prev.paidAmount) : null,
      paymentMethod: paid ? (row.paymentMethod || prev.paymentMethod) : null,
      appointmentId: row.appointmentId ?? prev.appointmentId,
    });
  }
  return [...map.values()].sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
}

export function mergeInvoices(primary: InvoiceRecord[], secondary: InvoiceRecord[]) {
  const map = new Map<number, InvoiceRecord>();
  for (const row of secondary) map.set(row.quickfileInvoiceId, row);
  for (const row of primary) {
    const previous = map.get(row.quickfileInvoiceId);
    map.set(row.quickfileInvoiceId, previous ? { ...previous, ...row, id: previous.id || row.id } : row);
  }
  return [...map.values()].sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
}

function rowToInvoice(row: Record<string, unknown>): InvoiceRecord {
  const status = String(row.status || 'unpaid');
  return {
    id: String(row.id),
    appointmentId: row.appointment_id ? String(row.appointment_id) : null,
    customerName: String(row.customer_name || ''),
    service: String(row.service_name || ''),
    address: String(row.address || ''),
    jobDate: row.job_date ? String(row.job_date).slice(0, 10) : null,
    amount: Number(row.amount || 0),
    quickfileInvoiceId: Number(row.quickfile_invoice_id),
    quickfileInvoiceNumber: row.quickfile_invoice_number ? String(row.quickfile_invoice_number) : null,
    issuedAt: String(row.issued_at || ''),
    dueAt: row.due_at ? String(row.due_at).slice(0, 10) : null,
    status: status === 'paid' || status === 'void' ? status : 'unpaid',
    paidAt: row.paid_at ? String(row.paid_at) : null,
    paidAmount: row.paid_amount == null ? null : Number(row.paid_amount),
    paymentMethod: row.payment_method ? String(row.payment_method) : null,
  };
}

function toDbRow(businessId: string, invoice: InvoiceRecord) {
  return {
    id: invoice.id,
    business_id: businessId,
    appointment_id: invoice.appointmentId,
    customer_name: invoice.customerName || 'Customer',
    service_name: invoice.service || 'Service',
    address: invoice.address || '',
    job_date: invoice.jobDate,
    amount: Number.isFinite(invoice.amount) ? invoice.amount : 0,
    quickfile_invoice_id: invoice.quickfileInvoiceId,
    quickfile_invoice_number: invoice.quickfileInvoiceNumber,
    issued_at: invoice.issuedAt,
    due_at: invoice.dueAt,
    status: invoice.status,
    paid_at: invoice.paidAt,
    paid_amount: invoice.paidAmount,
    payment_method: invoice.paymentMethod,
  };
}

export async function loadInvoices(client: Client, businessId: string): Promise<{ rows: InvoiceRecord[]; error: string | null }> {
  const { data, error } = await client.from('invoices').select('*').eq('business_id', businessId).order('issued_at', { ascending: false });
  if (error) return { rows: [], error: error.message };
  return { rows: (data || []).map(row => rowToInvoice(row as Record<string, unknown>)), error: null };
}

export async function saveInvoices(client: Client, businessId: string, invoices: InvoiceRecord[]): Promise<string | null> {
  const unique = mergeInvoices(invoices, []);
  if (!unique.length) return null;
  const ids = unique.map(invoice => invoice.quickfileInvoiceId);
  const { data, error } = await client.from('invoices').select('id,quickfile_invoice_id').eq('business_id', businessId).in('quickfile_invoice_id', ids);
  if (error) return error.message;
  const existing = new Map((data || []).map(row => [Number((row as { quickfile_invoice_id: number }).quickfile_invoice_id), String((row as { id: string }).id)]));
  const payload = unique.map(invoice => toDbRow(businessId, { ...invoice, id: existing.get(invoice.quickfileInvoiceId) || invoice.id }));
  const { error: upsertError } = await client.from('invoices').upsert(payload, { onConflict: 'id' });
  return upsertError?.message || null;
}

export async function saveQuickFileIntegration(
  client: Client,
  businessId: string,
  settings: { accNumber: string; webhookSecret: string },
) {
  const { error } = await client.from('integrations').upsert({
    business_id: businessId,
    provider: 'quickfile',
    external_account_id: settings.accNumber,
    status: 'connected',
    settings: { accNumber: settings.accNumber.trim(), webhookSecret: settings.webhookSecret.trim() },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'business_id,provider' });
  return error?.message || null;
}
