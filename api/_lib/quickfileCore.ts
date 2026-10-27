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

export async function testQuickFileConnection(creds: QuickFileCredentials): Promise<{ ok: true; clientsFound: number }> {
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
    line: QuickFileInvoiceLineInput;
    vatMode: QuickFileVatMode;
    termDays?: number;
  },
): Promise<{ clientId: number; invoiceId: number; invoiceNumber: string }> {
  const clientId = await ensureQuickFileClient(creds, input.client);
  const { unitCost, taxPercentage, taxAmount } = moneyParts(input.line.price, input.vatMode);
  const itemNameRaw = String(input.line.service || 'Service').trim() || 'Service';
  const itemName = itemNameRaw.slice(0, 25);
  // InvoiceDescription has min length 2 in QuickFile schema.
  const invoiceDescription = (itemName.length >= 2 ? itemName : `${itemName} job`).slice(0, 35);
  const itemDescription = [
    input.line.description,
    input.line.date ? `Job date: ${input.line.date}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 5000);

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

  // Field order must match Invoice_Create XSD (JSON key order is preserved).
  const invoiceData: Record<string, unknown> = {
    InvoiceType: 'INVOICE',
    ClientID: clientId,
    Currency: 'GBP',
    TermDays: input.termDays ?? 14,
    Language: 'en',
    InvoiceDescription: invoiceDescription,
    Notes: 'Created from MyPurePlan',
  };
  if (input.vatMode === 'exempt') {
    invoiceData.VatCodes = { Code: 'exempt' };
  }
  invoiceData.InvoiceLines = {
    ItemLines: {
      ItemLine: [invoiceLine],
    },
  };
  invoiceData.Scheduling = {
    SingleInvoiceData: {
      IssueDate: input.line.date || new Date().toISOString().slice(0, 10),
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
  return cleaned;
}

export function parseCredentials(body: any, fallbackAppId?: string): QuickFileCredentials {
  const accNumber = String(body?.accNumber || body?.accountNumber || '').trim();
  const apiKey = String(body?.apiKey || '').trim();
  const applicationId = String(body?.applicationId || fallbackAppId || '').trim();
  if (!accNumber || !apiKey || !applicationId) {
    throw new Error('Account number, API key and Application ID are all required.');
  }
  if (accNumber.includes('@') || !/^\d{4,12}$/.test(accNumber)) {
    throw new Error('Account number must be the numeric QuickFile account number from Account Settings, not your login email.');
  }
  return { accNumber, apiKey, applicationId };
}
