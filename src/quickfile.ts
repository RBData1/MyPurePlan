/** Client helpers for QuickFile connection + invoice creation via MyPurePlan API proxy. */

export type QuickFileVatMode = 'exempt' | 'standard20_gross' | 'standard20_net';

export type QuickFileConnection = {
  accNumber: string;
  apiKey: string;
  applicationId: string;
  vatMode: QuickFileVatMode;
  connectedAt: string | null;
  /** Secret from QuickFile → Webhooks. Used to verify payment notifications. */
  webhookSecret: string;
};

export const defaultQuickFileConnection = (): QuickFileConnection => ({
  accNumber: '',
  apiKey: '',
  applicationId: '',
  vatMode: 'exempt',
  connectedAt: null,
  webhookSecret: '',
});

export function quickFileStorageKey(businessId: string | null) {
  return businessId ? `cs_quickfile_${businessId}` : 'cs_quickfile';
}

export function readQuickFileConnection(businessId: string | null): QuickFileConnection {
  try {
    const raw = localStorage.getItem(quickFileStorageKey(businessId));
    if (!raw) return defaultQuickFileConnection();
    const parsed = JSON.parse(raw) as Partial<QuickFileConnection>;
    return {
      ...defaultQuickFileConnection(),
      ...parsed,
      vatMode: (['exempt', 'standard20_gross', 'standard20_net'].includes(String(parsed.vatMode))
        ? parsed.vatMode
        : 'exempt') as QuickFileVatMode,
    };
  } catch {
    return defaultQuickFileConnection();
  }
}

export function writeQuickFileConnection(businessId: string | null, value: QuickFileConnection) {
  localStorage.setItem(quickFileStorageKey(businessId), JSON.stringify(value));
}

export function isQuickFileConnected(conn: QuickFileConnection) {
  return Boolean(conn.accNumber.trim() && conn.apiKey.trim() && conn.applicationId.trim() && conn.connectedAt);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error || `QuickFile request failed (${res.status})`;
    console.error(message);
    throw new Error(message);
  }
  return data as T;
}

export async function checkQuickFileInvoices(conn: QuickFileConnection, invoiceIds: number[]) {
  return postJson<{ invoices: Array<{ invoiceId: number; state: 'paid' | 'unpaid' | 'part' | 'void'; paidAt: string | null; paidAmount: number | null }> }>('/api/quickfile/invoice-status', {
    accNumber: conn.accNumber,
    apiKey: conn.apiKey,
    applicationId: conn.applicationId,
    invoiceIds,
  });
}

export async function testQuickFileConnection(conn: QuickFileConnection) {
  return postJson<{ ok: true; clientsFound: number }>('/api/quickfile/test', {
    accNumber: conn.accNumber,
    apiKey: conn.apiKey,
    applicationId: conn.applicationId,
  });
}

export async function createQuickFileInvoiceRequest(
  conn: QuickFileConnection,
  payload: {
    client: {
      name: string;
      email?: string;
      phone?: string;
      phone2?: string;
      address?: string;
      town?: string;
      postcode?: string;
      quickfileClientId?: number | null;
    };
    lines: Array<{ service: string; description?: string; price: number; date: string }>;
  },
) {
  return postJson<{ clientId: number; invoiceId: number; invoiceNumber: string }>('/api/quickfile/create-invoice', {
    accNumber: conn.accNumber,
    apiKey: conn.apiKey,
    applicationId: conn.applicationId,
    vatMode: conn.vatMode,
    ...payload,
  });
}

export function vatModeLabel(mode: QuickFileVatMode) {
  if (mode === 'standard20_gross') return 'VAT 20% (price is gross)';
  if (mode === 'standard20_net') return 'VAT 20% (price is net)';
  return 'No VAT / exempt';
}
