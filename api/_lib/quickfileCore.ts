import { createHash, randomUUID } from 'node:crypto';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';

/** Avast/antivirus HTTPS scanning uses a local root that browsers trust via Windows, but Node's bundled CAs do not. */
function trustSystemCertificates() {
  const merged = [...getCACertificates('default'), ...getCACertificates('system')];
  if (merged.length) setDefaultCACertificates(merged);
}

let systemCasApplied = false;
function ensureSystemCertificates() {
  if (systemCasApplied) return;
  systemCasApplied = true;
  try {
    trustSystemCertificates();
  } catch {
    systemCasApplied = false;
  }
}

export type QuickFileCredentials = {
  accNumber: string;
  apiKey: string;
  applicationId: string;
  /** Personal bearer token for https://api-beta.quickfile.co.uk */
  restToken?: string;
};

export type QuickFileVatMode = 'exempt' | 'standard20_gross' | 'standard20_net';

export type QuickFileClientInput = {
  name: string;
  email?: string;
  phone?: string;
  phone2?: string;
  address?: string;
  town?: string;
  postcode?: string;
  quickfileClientId?: number | null;
};

export type QuickFileInvoiceLineInput = {
  service: string;
  description?: string;
  price: number;
  date: string;
};

function md5Lower(value: string) {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

function authHeader(creds: QuickFileCredentials) {
  const submissionNumber = randomUUID().replace(/-/g, '');
  const md5Value = md5Lower(`${creds.accNumber}${creds.apiKey}${submissionNumber}`);
  return {
    MessageType: 'Request',
    SubmissionNumber: submissionNumber,
    Authentication: {
      AccNumber: String(creds.accNumber).trim(),
      MD5Value: md5Value,
      ApplicationID: String(creds.applicationId).trim(),
    },
  };
}

function collectQuickFileErrors(json: any): string[] {
  const roots = [
    json,
    json?.payload,
    json?.Header,
    json?.payload?.Header,
    json?.Body,
    json?.payload?.Body,
  ];
  const out: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    const raw = root.Errors ?? root.Error;
    if (!raw) continue;
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(raw.Error)
        ? raw.Error
        : raw.Error
          ? [raw.Error]
          : typeof raw === 'string'
            ? [raw]
            : [];
    for (const e of list) {
      const msg = typeof e === 'string' ? e : e?.Message || e?.message || '';
      if (msg && !out.includes(msg)) out.push(msg);
    }
  }
  const status = String(json?.Header?.Status || json?.payload?.Header?.Status || '').toLowerCase();
  if (status === 'failure' && out.length === 0) {
    out.push('QuickFile request failed.');
  }
  return out;
}

function findNumericField(node: any, keys: string[], depth = 0): number | null {
  if (!node || depth > 6) return null;
  if (typeof node === 'object') {
    for (const key of keys) {
      if (node[key] != null) {
        const n = Number(node[key]);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    for (const value of Object.values(node)) {
      const found = findNumericField(value, keys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findStringField(node: any, keys: string[], depth = 0): string | null {
  if (!node || depth > 6) return null;
  if (typeof node === 'object') {
    for (const key of keys) {
      if (node[key] != null && String(node[key]).trim()) return String(node[key]).trim();
    }
    for (const value of Object.values(node)) {
      const found = findStringField(value, keys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function quickfilePost<T = any>(methodPath: string, creds: QuickFileCredentials, body: Record<string, unknown>): Promise<T> {
  const payload = {
    payload: {
      Header: authHeader(creds),
      Body: body,
    },
  };
  ensureSystemCertificates();
  let res: Response;
  try {
    res = await fetch(`https://api.quickfile.co.uk/1_2/${methodPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
    const intercepted = /certificate|UNABLE_TO_VERIFY/i.test(cause);
    throw new Error(
      intercepted
        ? `Could not reach QuickFile because HTTPS is being intercepted (${cause}). Turn off HTTPS scanning in Avast Web Shield, then connect again.`
        : `Could not reach QuickFile${cause ? `: ${cause}` : '.'}`,
    );
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`QuickFile returned non-JSON (${res.status}): ${text.slice(0, 240)}`);
  }
  const errors = collectQuickFileErrors(json);
  if (!res.ok || errors.length) {
    const message = explainQuickFileError(errors.join(' · ') || json?.error || `QuickFile HTTP ${res.status}`);
    console.error('[quickfile]', methodPath, res.status, message);
    throw new Error(message);
  }
  const root = json?.payload ?? json;
  if (root && typeof root === 'object' && !Array.isArray(root) && !root.Header && !root.Body) {
    const keys = Object.keys(root);
    const inner = keys.length === 1 ? root[keys[0]] : null;
    if (inner && typeof inner === 'object' && (inner.Header || inner.Body)) return inner as T;
  }
  return root as T;
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || 'Customer', surname: 'Client' };
  return { firstName: parts[0], surname: parts.slice(1).join(' ') };
}

export type QuickFileInvoicePayment = {
  invoiceId: number;
  state: 'paid' | 'unpaid' | 'part' | 'void';
  paidAt: string | null;
  paidAmount: number | null;
  clientName: string | null;
  address: string | null;
  total: number | null;
};

function quickFileDay(value: string | null) {
  if (!value) return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function readInvoiceStatus(result: any) {
  const details = result?.Body?.InvoiceDetails || result?.InvoiceDetails || result?.Body || {};
  const raw = String(details.Status || details.InvoiceStatus || '').trim().toUpperCase();
  if (!raw || raw === 'SUCCESS' || raw === 'FAILURE') return { status: '', details };
  return { status: raw, details };
}

/** Ask QuickFile for the current status of invoices the webhook may have missed. */
export async function fetchQuickFileInvoicePayments(creds: QuickFileCredentials, invoiceIds: number[]): Promise<QuickFileInvoicePayment[]> {
  if (usesRest(creds)) return fetchQuickFileInvoicePaymentsRest(creds, invoiceIds);
  const unique = [...new Set(invoiceIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0))].slice(0, 40);
  const out: QuickFileInvoicePayment[] = [];
  for (const invoiceId of unique) {
    const result: any = await quickfilePost('invoice/get', creds, { InvoiceID: invoiceId });
    const { status, details } = readInvoiceStatus(result);
    if (!status) throw new Error('QuickFile did not return an invoice status. Enable Invoice_Get on your QuickFile app, then try again.');
    const paidAt = quickFileDay(findStringField(details, ['PaymentDate', 'PaidDate', 'DatePaid', 'LastPaymentDate']));
    const paidAmount = findNumericField(details, ['AmountPaid', 'PaidAmount', 'TotalPaid']);
    const clientName = String(details?.ClientCompanyName || '').trim() || null;
    const address = String(details?.ClientAddress || '').replace(/<br\s*\/?>/gi, ', ').replace(/\s+,/g, ',').replace(/,\s*,/g, ', ').replace(/\s+/g, ' ').trim() || null;
    const total = findNumericField(details, ['TotalAmount', 'InvoiceTotal', 'GrossAmount']);
    const identity = { clientName, address, total };
    if (status === 'PAIDFULL' || status === 'PAID') out.push({ invoiceId, state: 'paid', paidAt, paidAmount, ...identity });
    else if (status === 'PAIDPART') out.push({ invoiceId, state: 'part', paidAt, paidAmount, ...identity });
    else if (status === 'DELETED') out.push({ invoiceId, state: 'void', paidAt: null, paidAmount: null, ...identity });
    else out.push({ invoiceId, state: 'unpaid', paidAt: null, paidAmount: null, ...identity });
  }
  return out;
}

export type QuickFileFoundInvoice = QuickFileInvoicePayment & {
  invoiceNumber: string;
  issueDate: string | null;
};

function invoiceNumberKey(value: string) {
  return value.replace(/\D/g, '').replace(/^0+/, '') || '';
}

function collectInvoiceRecords(result: any): any[] {
  const out: any[] = [];
  const visit = (node: any, depth: number) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    if (node.InvoiceNumber != null || node.InvoiceID != null || node.InvoiceId != null) out.push(node);
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };
  visit(result?.Body ?? result, 0);
  return out;
}

/** Find a QuickFile invoice that was created earlier, including one typed in by hand. */
export async function findQuickFileInvoiceByNumber(creds: QuickFileCredentials, invoiceNumber: string): Promise<QuickFileFoundInvoice> {
  if (usesRest(creds)) return findQuickFileInvoiceByNumberRest(creds, invoiceNumber);
  const wanted = invoiceNumber.trim();
  const key = invoiceNumberKey(wanted);
  if (!key) throw new Error('Enter the QuickFile invoice number.');
  const queries = [...new Set([wanted, key.padStart(6, '0'), key])];
  let invoiceId: number | null = null;
  let number = wanted;
  let issueDate: string | null = null;
  for (const query of queries) {
    const result: any = await quickfilePost('invoice/search', creds, {
      SearchParameters: {
        ReturnCount: 20,
        Offset: 0,
        OrderResultsBy: 'InvoiceNumber',
        OrderDirection: 'DESC',
        InvoiceType: 'INVOICE',
        InvoiceNumber: query,
      },
    });
    const match = collectInvoiceRecords(result).find(record => invoiceNumberKey(String(record.InvoiceNumber || '')) === key);
    const foundId = Number(match?.InvoiceID || match?.InvoiceId);
    if (match && Number.isFinite(foundId) && foundId > 0) {
      invoiceId = foundId;
      number = String(match.InvoiceNumber || query);
      issueDate = match.IssueDate ? String(match.IssueDate).slice(0, 10) : null;
      break;
    }
  }
  if (!invoiceId) throw new Error(`QuickFile has no invoice numbered ${wanted}.`);
  const [details] = await fetchQuickFileInvoicePayments(creds, [invoiceId]);
  if (!details) throw new Error(`QuickFile invoice ${number} could not be read. Enable Invoice_Search and Invoice_Get on your QuickFile app.`);
  return { ...details, invoiceNumber: number, issueDate };
}

export async function testQuickFileConnection(creds: QuickFileCredentials): Promise<{ ok: true; clientsFound: number }> {
  if (usesRest(creds)) return testQuickFileConnectionRest(creds);
  const result: any = await quickfilePost('client/search', creds, {
    SearchParameters: {
      ReturnCount: 1,
      Offset: 0,
      OrderResultsBy: 'CreatedDate',
      OrderDirection: 'DESC',
    },
  });
  const body = result?.Body || result;
  const records = body?.Record || body?.Clients?.Client || body?.ClientRecords?.Client || [];
  const list = Array.isArray(records) ? records : records ? [records] : [];
  return { ok: true, clientsFound: list.length };
}

async function searchClientId(creds: QuickFileCredentials, client: QuickFileClientInput): Promise<number | null> {
  if (client.quickfileClientId && Number.isFinite(client.quickfileClientId)) {
    return Number(client.quickfileClientId);
  }
  const email = String(client.email || '').trim();
  if (email) {
    const byEmail: any = await quickfilePost('client/search', creds, {
      SearchParameters: {
        ReturnCount: 5,
        Offset: 0,
        OrderResultsBy: 'CompanyName',
        OrderDirection: 'ASC',
        Email: email,
      },
    });
    const id = extractFirstClientId(byEmail, client.name);
    if (id) return id;
  }
  const name = String(client.name || '').trim();
  if (name) {
    const byName: any = await quickfilePost('client/search', creds, {
      SearchParameters: {
        ReturnCount: 5,
        Offset: 0,
        OrderResultsBy: 'CompanyName',
        OrderDirection: 'ASC',
        CompanyName: name,
      },
    });
    const id = extractFirstClientId(byName, name);
    if (id) return id;
  }
  return null;
}

function clientRows(result: any) {
  const body = result?.Body || result;
  const candidates =
    body?.Record ||
    body?.Clients?.Client ||
    body?.ClientRecords?.Client ||
    body?.ClientDetails ||
    [];
  return (Array.isArray(candidates) ? candidates : candidates ? [candidates] : []) as any[];
}

function rowClientId(row: any) {
  const id = Number(row?.ClientID ?? row?.ClientId ?? row?.ID ?? row?.Id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function extractFirstClientId(result: any, preferredName?: string): number | null {
  const list = clientRows(result);
  const wanted = String(preferredName || '').trim().toLowerCase();
  if (wanted) {
    const exact = list.find(row => String(row?.CompanyName || '').trim().toLowerCase() === wanted);
    const exactId = exact ? rowClientId(exact) : null;
    if (exactId) return exactId;
  }
  if (list.length === 1) return rowClientId(list[0]);
  return null;
}

/** Keep QuickFile Company Name aligned with the Setmore / MyPurePlan customer name. */
async function syncQuickFileClientName(creds: QuickFileCredentials, clientId: number, name: string) {
  const companyName = String(name || '').trim().slice(0, 100);
  if (!companyName || !clientId) return;
  await quickfilePost('client/update', creds, {
    ClientDetails: {
      ClientID: clientId,
      CompanyName: companyName,
    },
  });
}

export async function ensureQuickFileClient(creds: QuickFileCredentials, client: QuickFileClientInput): Promise<number> {
  if (usesRest(creds)) return ensureQuickFileClientRest(creds, client);
  const displayName = String(client.name || '').trim() || 'Customer';
  const existing = await searchClientId(creds, client);
  if (existing) {
    try {
      await syncQuickFileClientName(creds, existing, displayName);
    } catch {
      // Name sync is best-effort — invoice can still proceed if Client_Update is not enabled.
    }
    return existing;
  }

  const { firstName, surname } = splitName(displayName);
  // ClientContacts is a Body sibling of ClientDetails. Password is required (6–20 chars) even if unused.
  const phones = [client.phone, client.phone2].map(p => String(p || '').trim()).filter(Boolean).slice(0, 2);
  // Email and TelephoneNumbers are required by the Client_Create schema even when the customer has neither.
  const defaultContact: Record<string, unknown> = {
    FirstName: firstName,
    Surname: surname,
    Email: String(client.email || '').trim(),
    Password: `mpp${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    TelephoneNumbers: { Telephone: phones },
  };
  const clientDetails: Record<string, unknown> = {
    CompanyName: displayName.slice(0, 100),
    AddressLine1: (client.address || 'Address not provided').slice(0, 75),
  };
  if (client.town) clientDetails.Town = String(client.town).slice(0, 75);
  clientDetails.CountryISO = 'GB';
  clientDetails.Postcode = (client.postcode || 'UNKNOWN').slice(0, 15);

  let createResult: any;
  try {
    createResult = await quickfilePost('client/create', creds, {
      ClientDetails: clientDetails,
      ClientContacts: { DefaultContact: defaultContact },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists/i.test(message)) {
      const existing = await searchClientId(creds, client);
      if (existing) return existing;
    }
    throw error;
  }
  const createdId =
    findNumericField(createResult, ['ClientID', 'ClientId']) || extractFirstClientId(createResult);
  if (!createdId) {
    throw new Error(
      'QuickFile did not return a ClientID. Enable Client_Create on your QuickFile app, then reconnect in Settings.',
    );
  }
  return createdId;
}

function invoiceHeading(lines: QuickFileInvoiceLineInput[]) {
  const names = lines.map(line => String(line.service || 'Service').trim() || 'Service');
  if (names.length <= 1) {
    const name = names[0] || 'Service';
    return (name.length >= 2 ? name : `${name} job`).slice(0, 35);
  }
  const joined = names.join(', ');
  if (joined.length >= 2 && joined.length <= 35) return joined;
  return `${names.length} services`.slice(0, 35);
}

function buildInvoiceLine(line: QuickFileInvoiceLineInput, vatMode: QuickFileVatMode) {
  const { unitCost, taxPercentage, taxAmount } = moneyParts(line.price, vatMode);
  const itemNameRaw = String(line.service || 'Service').trim() || 'Service';
  const itemName = itemNameRaw.slice(0, 25);
  const address = String(line.description || '').trim();
  const itemDescription = [itemNameRaw, address].filter(Boolean).join('\n').slice(0, 5000);
  const invoiceLine: Record<string, unknown> = {
    ItemID: 0,
    ItemName: itemName,
    ItemDescription: itemDescription || itemName,
    ItemNominalCode: '4000',
  };
  if (taxPercentage > 0) {
    invoiceLine.Tax1 = {
      TaxName: 'VAT',
      TaxPercentage: taxPercentage,
      TaxAmount: Number(taxAmount.toFixed(2)),
    };
  }
  invoiceLine.UnitCost = Number(unitCost.toFixed(2));
  invoiceLine.Qty = 1;
  return invoiceLine;
}

function moneyParts(price: number, vatMode: QuickFileVatMode) {
  const amount = Math.max(0, Number(price) || 0);
  if (vatMode === 'standard20_gross') {
    const net = Math.round((amount / 1.2) * 100) / 100;
    const vat = Math.round((amount - net) * 100) / 100;
    return { unitCost: net, taxPercentage: 20, taxAmount: vat };
  }
  if (vatMode === 'standard20_net') {
    const vat = Math.round(amount * 0.2 * 100) / 100;
    return { unitCost: amount, taxPercentage: 20, taxAmount: vat };
  }
  return { unitCost: amount, taxPercentage: 0, taxAmount: 0 };
}

export async function createQuickFileInvoice(
  creds: QuickFileCredentials,
  input: {
    client: QuickFileClientInput;
    lines: QuickFileInvoiceLineInput[];
    vatMode: QuickFileVatMode;
    termDays?: number;
  },
): Promise<{ clientId: number; invoiceId: number; invoiceNumber: string }> {
  if (usesRest(creds)) return createQuickFileInvoiceRest(creds, input);
  const lines = input.lines.filter(line => String(line?.service || '').trim() || Number(line?.price) > 0);
  if (!lines.length) throw new Error('Add at least one service before creating an invoice.');
  const clientId = await ensureQuickFileClient(creds, input.client);
  const invoiceDescription = invoiceHeading(lines);
  const itemLines = lines.map(line => buildInvoiceLine(line, input.vatMode));

  // Field order must match Invoice_Create XSD (JSON key order is preserved).
  const invoiceData: Record<string, unknown> = {
    InvoiceType: 'INVOICE',
    ClientID: clientId,
    Currency: 'GBP',
    TermDays: input.termDays ?? 14,
    Language: 'en',
    InvoiceDescription: invoiceDescription,
  };
  if (input.vatMode === 'exempt') {
    invoiceData.VatCodes = { Code: 'exempt' };
  }
  invoiceData.InvoiceLines = {
    ItemLines: {
      ItemLine: itemLines,
    },
  };
  invoiceData.Scheduling = {
    SingleInvoiceData: {
      IssueDate: lines.find(line => line.date)?.date || new Date().toISOString().slice(0, 10),
    },
  };

  const result: any = await quickfilePost('invoice/create', creds, { InvoiceData: invoiceData });
  const invoiceId = findNumericField(result, ['InvoiceID', 'InvoiceId']);
  const invoiceNumber =
    findStringField(result, ['InvoiceNumber']) || (invoiceId ? String(invoiceId) : '');
  if (!invoiceId) {
    throw new Error(
      'QuickFile did not return an InvoiceID. In QuickFile → Create a QuickFile App, enable Invoice_Create (and Client_Search / Client_Create), then reconnect in Settings.',
    );
  }

  // Create leaves invoices as Draft — mark Sent (email if we have an address, else flag only).
  const sendByEmail = Boolean(String(input.client.email || '').trim());
  try {
    await quickfilePost('invoice/send', creds, {
      SendItem: {
        InvoiceID: invoiceId,
        SendByEmail: sendByEmail,
        SendBySnailMail: false,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invoice ${invoiceNumber || invoiceId} created as draft, but could not mark as Sent: ${detail}. Enable Invoice_Send on your QuickFile app.`,
    );
  }

  return { clientId, invoiceId, invoiceNumber };
}

function explainQuickFileError(message: string) {
  const cleaned = message.replace(/^\d+(?=[A-Za-z])/, '');
  const text = cleaned.toLowerCase();
  if (text.includes('missing account')) {
    return 'QuickFile does not recognise that account number. Use the numeric account number from Account Settings, not your login email.';
  }
  if (text.includes('invalid login') || text.includes('authentication failed')) {
    return 'QuickFile rejected the API key. Copy the API key from Account Settings → API, not your login password.';
  }
  if (text.includes('not permitted') || text.includes('not authorised') || text.includes('not authorized') || text.includes('access denied')) {
    return `${cleaned} In QuickFile → Create a QuickFile App, enable the method named in that error.`;
  }
  if (text.includes('cannot load the schema')) {
    return 'QuickFile’s older API cannot load its schema right now. In Settings → QuickFile paste the REST API token, then press Connect QuickFile.';
  }
  return cleaned;
}

export function parseCredentials(body: any, fallbackAppId?: string): QuickFileCredentials {
  const accNumber = String(body?.accNumber || body?.accountNumber || '').trim();
  const apiKey = String(body?.apiKey || '').trim();
  const applicationId = String(body?.applicationId || fallbackAppId || '').trim();
  const restToken = String(body?.restToken || '').trim();
  if (restToken) return { accNumber, apiKey, applicationId, restToken };
  if (!accNumber || !apiKey || !applicationId) {
    throw new Error('Paste the REST API token, or the account number, API key and Application ID.');
  }
  if (accNumber.includes('@') || !/^\d{4,12}$/.test(accNumber)) {
    throw new Error('Account number must be the numeric QuickFile account number from Account Settings, not your login email.');
  }
  return { accNumber, apiKey, applicationId };
}

const QUICKFILE_REST = 'https://api-beta.quickfile.co.uk';

function usesRest(creds: QuickFileCredentials) {
  return Boolean(creds.restToken?.trim());
}

function restAuthorization(token: string) {
  const trimmed = token.trim();
  return /^bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function restErrorMessage(json: any, text: string, status: number) {
  const nested = json?.error;
  if (nested && typeof nested === 'object' && typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim();
  if (typeof json?.message === 'string' && json.message.trim()) return json.message.trim();
  if (typeof json?.error === 'string' && json.error.trim()) return json.error.trim();
  if (json?.errors && typeof json.errors === 'object') {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(json.errors)) {
      const list = Array.isArray(value) ? value : [value];
      for (const item of list) {
        if (item) parts.push(`${key}: ${item}`);
      }
    }
    if (parts.length) return parts.join(' · ');
  }
  return text.slice(0, 240) || `QuickFile HTTP ${status}`;
}

async function restFetch(creds: QuickFileCredentials, method: string, path: string, body?: unknown) {
  ensureSystemCertificates();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: restAuthorization(creds.restToken || ''),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${QUICKFILE_REST}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
    const intercepted = /certificate|UNABLE_TO_VERIFY/i.test(cause);
    throw new Error(
      intercepted
        ? `Could not reach QuickFile because HTTPS is being intercepted (${cause}). Turn off HTTPS scanning in Avast Web Shield, then connect again.`
        : `Could not reach QuickFile${cause ? `: ${cause}` : '.'}`,
    );
  }
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    throw new Error(restErrorMessage(json, text, res.status));
  }
  return json;
}

function restRows(result: any) {
  if (Array.isArray(result?.data)) return result.data as any[];
  if (Array.isArray(result)) return result as any[];
  return [];
}

async function restClients(creds: QuickFileCredentials, query: Record<string, string | number>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  const result = await restFetch(creds, 'GET', `/clients?${params.toString()}`);
  return restRows(result);
}

function restClientId(row: any) {
  const id = Number(row?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function restInvoiceState(status: string): QuickFileInvoicePayment['state'] {
  const raw = status.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (['paid', 'paidfull', 'paidinfull'].includes(raw)) return 'paid';
  if (['part', 'partial', 'paidpart', 'partpaid', 'partiallypaid'].includes(raw)) return 'part';
  if (['deleted', 'void', 'cancelled', 'canceled', 'writtenoff'].includes(raw)) return 'void';
  return 'unpaid';
}

function paymentFromRestInvoice(invoiceId: number, details: any): QuickFileInvoicePayment {
  const state = restInvoiceState(String(details?.status || ''));
  const gross = Number(details?.gross_total);
  const balance = Number(details?.balance);
  const total = Number.isFinite(gross) ? gross : null;
  // On a paid-in-full invoice the REST balance stays equal to the total, so
  // gross minus balance is not the money received. PAIDFULL collected the total.
  let paidAmount: number | null = null;
  if (state === 'paid') paidAmount = total;
  else if (state === 'part' && Number.isFinite(gross) && Number.isFinite(balance) && balance < gross) {
    paidAmount = Math.round((gross - balance) * 100) / 100;
  }
  const clientName = String(details?.client_company_name || details?.client_contact_name || '').trim() || null;
  const address = String(details?.client_address || '').replace(/\s+/g, ' ').trim() || null;
  return {
    invoiceId,
    state,
    paidAt: null,
    paidAmount: state === 'unpaid' || state === 'void' ? null : paidAmount,
    clientName,
    address,
    total,
  };
}

async function testQuickFileConnectionRest(creds: QuickFileCredentials): Promise<{ ok: true; clientsFound: number }> {
  const rows = await restClients(creds, { limit: 1, offset: 0, order_column: 'created_date', order_direction: 'desc' });
  return { ok: true, clientsFound: rows.length };
}

async function searchClientIdRest(creds: QuickFileCredentials, client: QuickFileClientInput): Promise<number | null> {
  if (client.quickfileClientId && Number.isFinite(client.quickfileClientId)) return Number(client.quickfileClientId);
  const email = String(client.email || '').trim();
  if (email) {
    const rows = await restClients(creds, { email, limit: 5, offset: 0, order_column: 'company_name', order_direction: 'asc' });
    const wanted = String(client.name || '').trim().toLowerCase();
    const exact = wanted ? rows.find(row => String(row?.company_name || '').trim().toLowerCase() === wanted) : null;
    const exactId = exact ? restClientId(exact) : null;
    if (exactId) return exactId;
    if (rows.length === 1) return restClientId(rows[0]);
  }
  const name = String(client.name || '').trim();
  if (name) {
    const rows = await restClients(creds, { company_name: name, limit: 5, offset: 0, order_column: 'company_name', order_direction: 'asc' });
    const exact = rows.find(row => String(row?.company_name || '').trim().toLowerCase() === name.toLowerCase());
    const exactId = exact ? restClientId(exact) : null;
    if (exactId) return exactId;
    if (rows.length === 1) return restClientId(rows[0]);
  }
  return null;
}

async function ensureQuickFileClientRest(creds: QuickFileCredentials, client: QuickFileClientInput): Promise<number> {
  const displayName = String(client.name || '').trim() || 'Customer';
  const existing = await searchClientIdRest(creds, client);
  if (existing) {
    try {
      await restFetch(creds, 'PUT', `/clients/${existing}`, { company_name: displayName.slice(0, 100) });
    } catch {
      // Name sync is best-effort.
    }
    return existing;
  }
  const { firstName, surname } = splitName(displayName);
  const created = await restFetch(creds, 'POST', '/clients', {
    company_name: displayName.slice(0, 100),
    address_line1: (client.address || 'Address not provided').slice(0, 75),
    town: client.town ? String(client.town).slice(0, 75) : undefined,
    country_iso: 'GB',
    post_code: (client.postcode || 'UNKNOWN').slice(0, 15),
  });
  const createdId = restClientId(created);
  if (!createdId) throw new Error('QuickFile did not return a client id. Enable Clients on the REST API token, then connect again.');
  const email = String(client.email || '').trim();
  if (email) {
    const phones = [client.phone, client.phone2].map(phone => String(phone || '').trim()).filter(Boolean);
    try {
      await restFetch(creds, 'POST', `/clients/${createdId}/contacts`, {
        first_name: firstName.slice(0, 50),
        surname: surname.slice(0, 50),
        email: email.slice(0, 100),
        is_default: true,
        telephone1: phones[0]?.slice(0, 20),
        telephone2: phones[1]?.slice(0, 20),
      });
    } catch {
      // The client exists; the invoice can still be created without a contact.
    }
  }
  return createdId;
}

function buildRestInvoiceLine(line: QuickFileInvoiceLineInput, vatMode: QuickFileVatMode) {
  const { unitCost, taxPercentage, taxAmount } = moneyParts(line.price, vatMode);
  const itemNameRaw = String(line.service || 'Service').trim() || 'Service';
  const itemName = itemNameRaw.slice(0, 25);
  const address = String(line.description || '').trim();
  const description = [itemNameRaw, address].filter(Boolean).join('\n').slice(0, 5000);
  const row: Record<string, unknown> = {
    item_name: itemName,
    description: description || itemName,
    nominal_code: 4000,
    unit_cost: Number(unitCost.toFixed(2)),
    qty: 1,
    vat_rate: taxPercentage,
  };
  if (taxPercentage > 0) row.vat_amount = Number(taxAmount.toFixed(2));
  return row;
}

async function createQuickFileInvoiceRest(
  creds: QuickFileCredentials,
  input: {
    client: QuickFileClientInput;
    lines: QuickFileInvoiceLineInput[];
    vatMode: QuickFileVatMode;
    termDays?: number;
  },
): Promise<{ clientId: number; invoiceId: number; invoiceNumber: string }> {
  const lines = input.lines.filter(line => String(line?.service || '').trim() || Number(line?.price) > 0);
  if (!lines.length) throw new Error('Add at least one service before creating an invoice.');
  const clientId = await ensureQuickFileClientRest(creds, input.client);
  const invoiceBody: Record<string, unknown> = {
    type: 'invoice',
    client_id: clientId,
    currency: 'GBP',
    term_days: input.termDays ?? 14,
    language: 'en',
    description: invoiceHeading(lines),
    issue_date: lines.find(line => line.date)?.date || new Date().toISOString().slice(0, 10),
    item_lines: lines.map(line => buildRestInvoiceLine(line, input.vatMode)),
  };
  if (input.vatMode === 'exempt') invoiceBody.vat_codes = ['exempt'];
  const created = await restFetch(creds, 'POST', '/invoices', invoiceBody);
  const invoiceId = Number(created?.id);
  const invoiceNumber = String(created?.invoice_number || invoiceId || '').trim();
  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    throw new Error('QuickFile did not return an invoice id. Enable Invoices on the REST API token, then connect again.');
  }
  const sendByEmail = Boolean(String(input.client.email || '').trim());
  try {
    await restFetch(creds, 'POST', `/invoices/${invoiceId}/send`, {
      by_email: sendByEmail,
      by_snail_mail: false,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invoice ${invoiceNumber || invoiceId} created as draft, but could not mark as Sent: ${detail}. Enable Invoices on the REST API token.`);
  }
  return { clientId, invoiceId, invoiceNumber };
}

async function fetchQuickFileInvoicePaymentsRest(creds: QuickFileCredentials, invoiceIds: number[]): Promise<QuickFileInvoicePayment[]> {
  const unique = [...new Set(invoiceIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0))].slice(0, 40);
  const out: QuickFileInvoicePayment[] = [];
  for (const invoiceId of unique) {
    const details = await restFetch(creds, 'GET', `/invoices/${invoiceId}`);
    if (!details?.status && !details?.id) throw new Error('QuickFile did not return an invoice status. Enable Invoices on the REST API token, then try again.');
    out.push(paymentFromRestInvoice(invoiceId, details));
  }
  return out;
}

async function findQuickFileInvoiceByNumberRest(creds: QuickFileCredentials, invoiceNumber: string): Promise<QuickFileFoundInvoice> {
  const wanted = invoiceNumber.trim();
  const key = invoiceNumberKey(wanted);
  if (!key) throw new Error('Enter the QuickFile invoice number.');
  const queries = [...new Set([wanted, key.padStart(6, '0'), key])];
  let invoiceId: number | null = null;
  let number = wanted;
  let issueDate: string | null = null;
  for (const query of queries) {
    const params = new URLSearchParams({
      invoice_number: query,
      type: 'invoice',
      limit: '20',
      offset: '0',
      order_column: 'invoice_number',
      order_direction: 'desc',
    });
    const result = await restFetch(creds, 'GET', `/invoices?${params.toString()}`);
    const match = restRows(result).find(record => invoiceNumberKey(String(record.invoice_number || '')) === key);
    const foundId = Number(match?.id);
    if (match && Number.isFinite(foundId) && foundId > 0) {
      invoiceId = foundId;
      number = String(match.invoice_number || query);
      issueDate = match.issue_date ? String(match.issue_date).slice(0, 10) : null;
      break;
    }
  }
  if (!invoiceId) throw new Error(`QuickFile has no invoice numbered ${wanted}.`);
  const [details] = await fetchQuickFileInvoicePaymentsRest(creds, [invoiceId]);
  if (!details) throw new Error(`QuickFile invoice ${number} could not be read. Enable Invoices on the REST API token.`);
  return { ...details, invoiceNumber: number, issueDate: issueDate || null };
}
