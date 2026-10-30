/** QuickFile invoice register: created here, marked paid by the QuickFile webhook or in the app. */

import type { supabase as supabaseClient } from './supabase';
import { defaultQuickFileConnection, isQuickFileConnected, type QuickFileConnection, type QuickFileVatMode } from './quickfile';

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
  /** Missing on older rows. A negative id is a local invoice. */
  source?: 'quickfile' | 'local';
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

function visitLabel(value: string) {
  return value.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function invoiceServiceMatches(invoiceService: string, jobService: string) {
  const job = visitLabel(jobService);
  const parts = invoiceService.split(',').map(visitLabel).filter(Boolean);
  if (!parts.length || !job) return true;
  return parts.some(part => part === job);
}

type InvoicedVisit = {
  id: string;
  customerId: string;
  date: string;
  time: string;
  service: string;
  status: string;
  setmoreBookingId?: string;
  quickfileInvoiceId?: number | null;
  quickfileInvoiceNumber?: string | null;
  quickfileInvoicedAt?: string | null;
};

/**
 * A Setmore import can replace the visit id while the invoice register still
 * points at the old one. Put that invoice back on the surviving visit, and
 * drop a second copy of the same slot that has no invoice.
 */
export function settleInvoicedVisits<T extends InvoicedVisit>(
  appointments: T[],
  invoices: InvoiceRecord[],
  nameOf: (customerId: string) => string,
): { appointments: T[]; invoices: InvoiceRecord[]; removedIds: string[] } {
  const person = (customerId: string) => visitLabel(nameOf(customerId));
  const next = appointments.map(appointment => ({ ...appointment }));
  const removed = new Set<string>();
  let appointmentChanged = false;
  let invoiceChanged = false;
  const invoicesNext = invoices.map(invoice => ({ ...invoice }));
  const holdersOf = (invoiceId: number) => next.filter(appointment => !removed.has(appointment.id) && appointment.quickfileInvoiceId === invoiceId);

  for (const invoice of invoicesNext) {
    if (invoice.status === 'void' || !invoice.jobDate || holdersOf(invoice.quickfileInvoiceId).length) continue;
    const wanted = visitLabel(invoice.customerName);
    if (!wanted) continue;
    const candidates = next.filter(appointment => {
      if (removed.has(appointment.id) || appointment.status === 'Cancelled' || appointment.quickfileInvoiceId) return false;
      return appointment.date === invoice.jobDate && person(appointment.customerId) === wanted && invoiceServiceMatches(invoice.service, appointment.service);
    });
    if (candidates.length !== 1) continue;
    const target = candidates[0];
    target.quickfileInvoiceId = invoice.quickfileInvoiceId;
    target.quickfileInvoiceNumber = invoice.quickfileInvoiceNumber;
    target.quickfileInvoicedAt = invoice.issuedAt || target.quickfileInvoicedAt || null;
    if (target.status !== 'Cancelled') target.status = 'Completed';
    if (invoice.appointmentId !== target.id) {
      invoice.appointmentId = target.id;
      invoiceChanged = true;
    }
    appointmentChanged = true;
  }

  const groups = new Map<string, T[]>();
  for (const appointment of next) {
    if (removed.has(appointment.id) || appointment.status === 'Cancelled') continue;
    const key = `${person(appointment.customerId)}|${appointment.date}|${appointment.time}|${visitLabel(appointment.service)}`;
    const group = groups.get(key);
    if (group) group.push(appointment);
    else groups.set(key, [appointment]);
  }
  for (const group of groups.values()) {
    const invoiced = group.filter(appointment => appointment.quickfileInvoiceId);
    if (!invoiced.length || invoiced.length === group.length) continue;
    if (new Set(invoiced.map(appointment => appointment.quickfileInvoiceId)).size > 1) continue;
    const keeper = invoiced[0];
    for (const other of group) {
      if (other.id === keeper.id || (other.quickfileInvoiceId && other.quickfileInvoiceId !== keeper.quickfileInvoiceId)) continue;
      if (!keeper.setmoreBookingId && other.setmoreBookingId) {
        keeper.setmoreBookingId = other.setmoreBookingId;
        appointmentChanged = true;
      }
      removed.add(other.id);
    }
  }

  for (const invoice of invoicesNext) {
    const holders = holdersOf(invoice.quickfileInvoiceId);
    if (!holders.length || holders.some(appointment => appointment.id === invoice.appointmentId)) continue;
    invoice.appointmentId = holders[0].id;
    invoiceChanged = true;
  }

  if (!appointmentChanged && removed.size === 0 && !invoiceChanged) {
    return { appointments, invoices, removedIds: [] };
  }
  return {
    appointments: next.filter(appointment => !removed.has(appointment.id)),
    invoices: invoiceChanged ? invoicesNext : invoices,
    removedIds: [...removed],
  };
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
    source: String(row.source || '') === 'local' || Number(row.quickfile_invoice_id) < 0 ? 'local' : 'quickfile',
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
    source: invoice.source === 'local' || invoice.quickfileInvoiceId < 0 ? 'local' : 'quickfile',
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

function quickFileFromSettings(raw: unknown): QuickFileConnection {
  const parsed = raw && typeof raw === 'object' ? raw as Partial<QuickFileConnection> : {};
  const vat = String(parsed.vatMode || '');
  const vatMode: QuickFileVatMode = vat === 'standard20_gross' || vat === 'standard20_net' || vat === 'exempt' ? vat : 'exempt';
  return {
    ...defaultQuickFileConnection(),
    accNumber: String(parsed.accNumber || ''),
    apiKey: String(parsed.apiKey || ''),
    applicationId: String(parsed.applicationId || ''),
    webhookSecret: String(parsed.webhookSecret || ''),
    connectedAt: parsed.connectedAt ? String(parsed.connectedAt) : null,
    vatMode,
  };
}

export async function loadQuickFileIntegration(
  client: Client,
  businessId: string,
): Promise<{ connection: QuickFileConnection | null; status: 'connected' | 'disconnected' | 'missing'; updatedAt: string | null; error: string | null }> {
  const { data, error } = await client.from('integrations').select('settings,status,updated_at').eq('business_id', businessId).eq('provider', 'quickfile').maybeSingle();
  if (error) return { connection: null, status: 'missing', updatedAt: null, error: error.message };
  if (!data) return { connection: null, status: 'missing', updatedAt: null, error: null };
  const row = data as { settings?: unknown; status?: string; updated_at?: string };
  const connection = quickFileFromSettings(row.settings);
  const updatedAt = row.updated_at ? String(row.updated_at) : null;
  if (isQuickFileConnected(connection)) return { connection, status: 'connected', updatedAt, error: null };
  if (String(row.status) === 'disconnected') return { connection: null, status: 'disconnected', updatedAt, error: null };
  return { connection: null, status: 'missing', updatedAt, error: null };
}

export async function saveQuickFileIntegration(
  client: Client,
  businessId: string,
  connection: QuickFileConnection,
) {
  const connected = isQuickFileConnected(connection);
  const accNumber = connection.accNumber.trim();
  const { error } = await client.from('integrations').upsert({
    business_id: businessId,
    provider: 'quickfile',
    external_account_id: accNumber || null,
    status: connected ? 'connected' : 'disconnected',
    settings: {
      accNumber,
      apiKey: connection.apiKey.trim(),
      applicationId: connection.applicationId.trim(),
      vatMode: connection.vatMode,
      webhookSecret: connection.webhookSecret.trim(),
      connectedAt: connected ? connection.connectedAt : null,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'business_id,provider' });
  return error?.message || null;
}
