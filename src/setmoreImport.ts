/** Parse and merge Setmore appointment / customer exports (CSV or Excel .xls/.xlsx) into MyPurePlan data. */
import { nextServiceColor } from './serviceColors';

import * as XLSX from 'xlsx';

export type ImportServiceLine = {
  service: string;
  price: number;
  duration: number;
  frequency: number;
  oneOff?: boolean;
};

export type ImportCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Secondary / alternate phone (Setmore often has Mobile + Phone). */
  phone2: string;
  address: string;
  town: string;
  postcode: string;
  price: number;
  duration: number;
  frequency: number;
  notes: string;
  service: string;
  serviceLines: ImportServiceLine[];
  archived?: boolean;
};

export type ImportAppointment = {
  id: string;
  customerId: string;
  date: string;
  time: string;
  duration: number;
  service: string;
  price: number;
  status: 'Confirmed' | 'Pending' | 'Completed' | 'Cancelled';
  address: string;
  notes?: string;
  oneOff?: boolean;
  frequency?: number;
  /** Setmore booking id when the export includes one. Survives a date/time move. */
  setmoreBookingId?: string;
  quickfileInvoiceId?: number | null;
  quickfileInvoiceNumber?: string | null;
  quickfileInvoicedAt?: string | null;
  /** Invoiced job that the latest Setmore report no longer lists. Kept on the calendar. */
  missingFromSetmore?: boolean;
};

export type ImportService = { name: string; duration: number; price: number; color?: string };
export type ImportPayment = { id: string; appointmentId: string; amount: number; paidAt: string | null; method: string };

export type SetmoreImportSummary = {
  customersAdded: number;
  customersUpdated: number;
  appointmentsAdded: number;
  appointmentsUpdated: number;
  /** Jobs whose date or time changed to match the new Setmore report. */
  appointmentsMoved: number;
  /** Jobs inside the report's date range that Setmore no longer lists. */
  appointmentsRemoved: number;
  /** Invoiced jobs kept on the calendar because Setmore no longer lists them. */
  appointmentsMissing: number;
  servicesAdded: number;
  paymentsAdded: number;
  skipped: number;
  rowCount: number;
  /** Earliest appointment date found in this file (YYYY-MM-DD). */
  coverageFrom: string | null;
  /** Latest appointment date found in this file (YYYY-MM-DD). */
  coverageTo: string | null;
  /** Column headers detected in the file. */
  detectedHeaders: string[];
  /** Rows where a start date/time was understood. */
  rowsWithSchedule: number;
  /** Rows with a customer but no usable schedule. */
  rowsCustomerOnly: number;
  fileKind: 'csv' | 'excel' | 'html-xls' | 'unknown';
  sheetName: string | null;
  sample: Array<{ customer: string; service: string; date: string; time: string }>;
};

export type SetmoreLastImport = {
  id: string;
  importedAt: string;
  fileName: string;
  fileModifiedAt: string | null;
  coverageFrom: string | null;
  coverageTo: string | null;
  summaryLine: string;
  detectedHeaders?: string[];
  rowsWithSchedule?: number;
  rowsCustomerOnly?: number;
  fileKind?: string;
  sheetName?: string | null;
  sample?: Array<{ customer: string; service: string; date: string; time: string }>;
};

export type SetmoreImportResult = {
  customers: ImportCustomer[];
  appointments: ImportAppointment[];
  services: ImportService[];
  payments: ImportPayment[];
  summary: SetmoreImportSummary;
  /** Appointments removed because they fall inside the report dates and are not in the file. */
  removedAppointments: ImportAppointment[];
};

export type SetmoreRow = Record<string, string>;
type CsvRow = SetmoreRow;

const HEADER_ALIASES: Record<string, string[]> = {
  customer: ['customer', 'customer name', 'client', 'client name', 'name', 'full name', 'contact', 'contact name', 'customer full name', 'client full name'],
  firstName: ['first name', 'firstname', 'given name'],
  lastName: ['last name', 'lastname', 'surname', 'family name'],
  email: ['email address', 'customer email', 'e-mail', 'e mail', 'email'],
  mobile: ['mobile', 'mobile number', 'cell', 'customer mobile', 'mobile phone', 'cell phone'],
  phone: ['phone', 'phone number', 'telephone', 'tel', 'customer phone', 'contact number', 'landline', 'home phone'],
  phone2: ['phone 2', 'phone2', 'secondary phone', 'alternate phone', 'additional phone', 'other phone', 'work phone', 'alt phone', 'second phone'],
  address: ['customer address', 'property address', 'street address', 'address line 1', 'address1', 'address', 'street', 'location'],
  town: ['town', 'city', 'locality', 'suburb'],
  postcode: ['postcode', 'post code', 'zip', 'zip code', 'postal code', 'zipcode'],
  service: ['service class event', 'service/class/event', 'service', 'service name', 'service type', 'appointment type', 'treatment', 'class', 'service title', 'event'],
  cost: ['cost', 'price', 'amount', 'service cost', 'service price', 'fee', 'charge', 'total', 'paid amount', 'net'],
  duration: ['duration', 'duration (mins)', 'duration (minutes)', 'mins', 'minutes', 'length', 'service duration'],
  date: ['appointment date', 'date', 'start date', 'booking date', 'day', 'scheduled date', 'appt date'],
  time: ['appointment time', 'time', 'start time', 'from time', 'scheduled time', 'appt time', 'begin time'],
  startDateTime: ['start datetime', 'start date time', 'datetime', 'date time', 'starts at', 'start at', 'appointment start', 'booking start'],
  endTime: ['end time', 'finish time', 'to time', 'stop time'],
  endDateTime: ['end datetime', 'end date time', 'ends at', 'end at', 'booking end'],
  status: ['status', 'appointment status', 'label', 'booking status', 'state'],
  /** Ambiguous — assigned by row context (appointment report vs customer export). */
  notes: ['notes', 'note', 'description', 'memo', 'internal notes'],
  /** Setmore customer profile notes (not tied to a single booking). */
  customerNotes: ['customer notes', 'customer note', 'client notes', 'private notes'],
  /** Setmore appointment / booking comments for that job only. */
  jobNotes: ['comments', 'comment', 'comment box', 'appointment notes', 'appointment note', 'appointment comments', 'job notes', 'booking notes', 'booking comments'],
  staff: ['team member', 'staff', 'staff name', 'provider', 'employee', 'resource', 'practitioner'],
  bookingId: ['booking id', 'appointment id', 'bookingid'],
};

const ALL_HEADER_ALIASES = new Set(Object.values(HEADER_ALIASES).flat());

function normalizeHeader(raw: string): string {
  return raw.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ');
}

function headerTokens(header: string): string[] {
  return normalizeHeader(header).split(/[^a-z0-9]+/).filter(Boolean);
}

/** True when every word of the alias appears as a whole token in the header (order-independent). */
function headerMatchesAlias(header: string, alias: string): boolean {
  const h = normalizeHeader(header);
  const a = normalizeHeader(alias);
  if (!h || !a) return false;
  if (h === a) return true;
  // Never let a longer alias claim a shorter header (e.g. "email address" → "address").
  if (a.includes(h) && h !== a) return false;
  if (h.includes(a)) {
    // Require alias as a contiguous phrase or full-token cover.
    if (h === a || h.startsWith(a + ' ') || h.endsWith(' ' + a) || h.includes(' ' + a + ' ')) return true;
  }
  const aliasParts = a.split(/\s+/).filter(Boolean);
  if (!aliasParts.length) return false;
  const tokens = new Set(headerTokens(h));
  return aliasParts.every(part => tokens.has(part));
}

function pickField(row: CsvRow, key: keyof typeof HEADER_ALIASES): string {
  const aliases = [...HEADER_ALIASES[key]].sort((a, b) => b.length - a.length);
  // Exact header match first.
  for (const alias of aliases) {
    if (alias in row && row[alias]) return row[alias].trim();
  }
  // Fuzzy match for Setmore headers like "Service/class/event" → "service class event".
  // Prefer the longest matching alias; never match because the alias merely contains the header.
  const headers = Object.keys(row);
  for (const alias of aliases) {
    if (alias.length < 3) continue;
    for (const header of headers) {
      const value = row[header]?.trim();
      if (!value) continue;
      if (headerMatchesAlias(header, alias)) return value;
    }
  }
  return '';
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function resolveEmail(row: CsvRow): string {
  const raw = pickField(row, 'email').trim();
  if (looksLikeEmail(raw)) return raw;
  // Scan email-labelled columns only — never fall back to address-like text.
  for (const header of Object.keys(row)) {
    if (!headerMatchesAlias(header, 'email') && !headerMatchesAlias(header, 'e-mail')) continue;
    const value = row[header]?.trim();
    if (looksLikeEmail(value)) return value;
  }
  return '';
}

function parseCsv(text: string): CsvRow[] {
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!cleaned) return [];

  const firstLine = cleaned.split('\n')[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  let delimiter = ',';
  if (tabCount > commaCount && tabCount >= semiCount) delimiter = '\t';
  else if (semiCount > commaCount) delimiter = ';';

  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { current.push(field); field = ''; continue; }
    if (ch === '\n') {
      current.push(field);
      field = '';
      if (current.some(cell => cell.trim())) rows.push(current);
      current = [];
      continue;
    }
    field += ch;
  }
  current.push(field);
  if (current.some(cell => cell.trim())) rows.push(current);

  return matrixToRows(rows);
}

function excelSerialToParts(serial: number): { y: number; m: number; d: number; H: number; M: number } | null {
  if (!Number.isFinite(serial)) return null;
  try {
    // Prefer SheetJS when available (handles Excel leap-year quirks).
    const parsed = XLSX.SSF?.parse_date_code?.(serial) as
      | { y?: number; m?: number; d?: number; H?: number; M?: number }
      | null
      | undefined;
    if (parsed?.y && parsed.m && parsed.d) {
      return { y: parsed.y, m: parsed.m, d: parsed.d, H: parsed.H || 0, M: parsed.M || 0 };
    }
  } catch {
    /* fall through */
  }
  // Fallback: Excel day 0 == 1899-12-30 (UTC).
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    H: dt.getUTCHours(),
    M: dt.getUTCMinutes(),
  };
}

function formatExcelSerial(serial: number): string {
  // Pure time values are fractional days (e.g. 0.375 => 09:00).
  if (serial > 0 && serial < 1.5) {
    const totalMinutes = Math.round((serial % 1) * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${pad2(h)}:${pad2(m)}`;
  }
  // Real appointment dates in Excel are large day-serials (~40000+ for 2010s/2020s).
  // Small integers (prices, durations, phone fragments) must stay numeric.
  if (serial < 20000 || serial >= 90000) return String(serial);
  const parts = excelSerialToParts(serial);
  if (!parts) return String(serial);
  const datePart = `${pad2(parts.d)}/${pad2(parts.m)}/${parts.y}`;
  if (!parts.H && !parts.M) return datePart;
  return `${datePart} ${pad2(parts.H)}:${pad2(parts.M)}`;
}

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hasTime = value.getHours() !== 0 || value.getMinutes() !== 0 || value.getSeconds() !== 0;
    const datePart = `${pad2(value.getDate())}/${pad2(value.getMonth() + 1)}/${value.getFullYear()}`;
    if (!hasTime) return datePart;
    return `${datePart} ${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return formatExcelSerial(value);
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if ((serial >= 0 && serial < 1.5) || (serial >= 20000 && serial < 90000)) {
      return formatExcelSerial(serial);
    }
  }
  return text;
}

function headerMatchScore(cells: string[]): number {
  let score = 0;
  for (const raw of cells) {
    const header = normalizeHeader(raw);
    if (!header) continue;
    if (ALL_HEADER_ALIASES.has(header)) {
      score += 4;
      continue;
    }
    for (const alias of ALL_HEADER_ALIASES) {
      if (header.includes(alias) || alias.includes(header)) {
        score += 2;
        break;
      }
    }
  }
  return score;
}

function matrixToRows(matrix: unknown[][]): CsvRow[] {
  const rows = matrix
    .map(cells => (Array.isArray(cells) ? cells : [cells]).map(cellToString))
    .filter(cells => cells.some(cell => cell.trim()));
  if (rows.length < 2) return [];

  // Setmore .xls often has a title row above the real column headers.
  let headerIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length - 1, 20); i++) {
    const score = headerMatchScore(rows[i]);
    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }

  const headers = rows[headerIdx].map(normalizeHeader);
  return rows.slice(headerIdx + 1).map(cells => {
    const row: CsvRow = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      const value = String(cells[idx] ?? '').trim();
      if (!(header in row) || !row[header]) row[header] = value;
    });
    return row;
  });
}

type ParsedSheet = { rows: CsvRow[]; sheetName: string; headerScore: number; fileKind: SetmoreImportSummary['fileKind'] };

function sheetMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  // Prefer formatted display values (what Setmore shows). Fall back to raw serials if needed.
  const formatted = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
  if (formatted.some(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim()))) return formatted;
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true }) as unknown[][];
}

function scoreRows(rows: CsvRow[]): number {
  if (!rows.length) return 0;
  let score = rows.length;
  const sample = rows.slice(0, 30);
  for (const row of sample) {
    if (resolveStart(row)) score += 5;
    if (resolveCustomerName(row) || resolveEmail(row) || pickField(row, 'phone') || pickField(row, 'mobile')) score += 2;
    if (pickField(row, 'service')) score += 2;
  }
  return score;
}

function pickBestSheet(workbook: XLSX.WorkBook, fileKind: SetmoreImportSummary['fileKind']): ParsedSheet {
  let best: ParsedSheet = { rows: [], sheetName: workbook.SheetNames[0] || '', headerScore: -1, fileKind };
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = matrixToRows(sheetMatrix(sheet));
    const headerScore = scoreRows(rows);
    if (headerScore > best.headerScore) best = { rows, sheetName, headerScore, fileKind };
  }
  return best;
}

function decodeSpreadsheetText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function parseSpreadsheet(buffer: ArrayBuffer): ParsedSheet {
  const bytes = new Uint8Array(buffer);
  const head = decodeSpreadsheetText(bytes.slice(0, 800)).trim().toLowerCase();
  // Setmore often exports "Excel" as an HTML/XML table with a .xls extension.
  if (
    head.startsWith('<html')
    || head.startsWith('<!doctype')
    || head.startsWith('<?xml')
    || head.includes('<table')
    || head.includes('<workbook')
    || head.includes('xmlns:x=')
  ) {
    const text = decodeSpreadsheetText(bytes);
    const workbook = XLSX.read(text, { type: 'string', cellDates: true });
    return pickBestSheet(workbook, 'html-xls');
  }
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  return pickBestSheet(workbook, 'excel');
}

function isSpreadsheetFile(file: Pick<File, 'name' | 'type'>): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.xlsm')) return true;
  const type = (file.type || '').toLowerCase();
  return type.includes('excel') || type.includes('spreadsheet') || type.includes('sheet') || type.includes('html');
}

export type SetmoreReadResult = {
  rows: CsvRow[];
  fileKind: SetmoreImportSummary['fileKind'];
  sheetName: string | null;
  detectedHeaders: string[];
};

/** Read Setmore export rows from CSV text or Excel/HTML (.xls / .xlsx). */
export async function readSetmoreRows(file: File): Promise<SetmoreReadResult> {
  if (isSpreadsheetFile(file)) {
    const parsed = parseSpreadsheet(await file.arrayBuffer());
    const detectedHeaders = parsed.rows[0] ? Object.keys(parsed.rows[0]) : [];
    return {
      rows: parsed.rows,
      fileKind: parsed.fileKind,
      sheetName: parsed.sheetName || null,
      detectedHeaders,
    };
  }
  const rows = parseCsv(await file.text());
  return {
    rows,
    fileKind: 'csv',
    sheetName: null,
    detectedHeaders: rows[0] ? Object.keys(rows[0]) : [],
  };
}

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

function normalizePhone(value: string): string {
  const digits = digitsOnly(value);
  if (!digits) return '';
  if (digits.startsWith('44') && digits.length >= 12) return `0${digits.slice(2)}`;
  return digits;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function moneyNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[£$€,\s]/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function durationMinutes(raw: string): number | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  const hm = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return Math.max(5, Number(hm[1]) * 60 + Number(hm[2]));
  const hoursMins = trimmed.match(/(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/);
  if (hoursMins) return Math.max(5, Number(hoursMins[1]) * 60 + Number(hoursMins[2] || 0));
  const mins = trimmed.match(/(\d+)\s*m/);
  if (mins) return Math.max(5, Number(mins[1]));
  const n = Number(trimmed.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.max(5, Math.round(n)) : null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(y: number, m: number, d: number): string | null {
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseTimeToken(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  // Setmore uses ranges: "08:00 AM - 08:00 PM" — take the start.
  const range = text.split(/\s*[-–—]\s*/);
  if (range.length >= 2) {
    const start = parseTimeToken(range[0]);
    if (start) return start;
  }
  // Excel time serial / fraction (0.375 => 09:00) or datetime serial with time component
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 0 && serial < 1.5) return formatExcelSerial(serial);
    if (serial >= 20000 && serial < 90000) {
      const parts = excelSerialToParts(serial);
      if (parts && (parts.H || parts.M)) return `${pad2(parts.H)}:${pad2(parts.M)}`;
    }
  }
  const ampm = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2] || 0);
    const mer = ampm[3].toLowerCase();
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    return `${pad2(h)}:${pad2(m)}`;
  }
  const hm = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h > 23 || m > 59) return null;
    return `${pad2(h)}:${pad2(m)}`;
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseDateToken(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  // Excel serial left as a plain number/string (e.g. 45512 or 45512.375)
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial >= 20000 && serial < 90000) {
      const parts = excelSerialToParts(serial);
      if (parts) return toIsoDate(parts.y, parts.m, parts.d);
    }
  }
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Setmore: "1 Jan 2026" / "13 Nov 2025"
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})$/);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()];
    let year = Number(named[3]);
    if (year < 100) year += 2000;
    if (month) return toIsoDate(year, month, day);
  }

  const slash = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (slash) {
    let a = Number(slash[1]);
    let b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    // Prefer UK DD/MM/YYYY when day part can be > 12 or both plausible.
    if (a > 12 && b <= 12) return toIsoDate(y, b, a);
    if (b > 12 && a <= 12) return toIsoDate(y, a, b);
    // Default UK ordering for Setmore UK businesses.
    return toIsoDate(y, b, a);
  }
  return null;
}

function parseDateTime(raw: string): { date: string; time: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/);
  if (iso) {
    const time = parseTimeToken(iso[2]);
    return time ? { date: iso[1], time } : null;
  }
  const parts = text.split(/\s+/);
  if (parts.length >= 2) {
    const date = parseDateToken(parts[0]);
    const time = parseTimeToken(parts.slice(1).join(' '));
    if (date && time) return { date, time };
  }
  const dateOnly = parseDateToken(text);
  if (dateOnly) return { date: dateOnly, time: '09:00' };
  return null;
}

function extractUkPostcode(text: string): string {
  const m = text.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function splitAddress(raw: string): { address: string; town: string; postcode: string } {
  const text = raw.trim();
  if (!text) return { address: '', town: '', postcode: '' };
  const postcode = extractUkPostcode(text);
  let rest = text;
  if (postcode) rest = text.replace(new RegExp(postcode.replace(/\s+/g, '\\s+'), 'i'), '').trim().replace(/[,\s]+$/, '');
  const bits = rest.split(',').map(s => s.trim()).filter(Boolean);
  if (bits.length === 0) return { address: rest || text, town: '', postcode };
  if (bits.length === 1) return { address: bits[0], town: '', postcode };
  return { address: bits.slice(0, -1).join(', '), town: bits[bits.length - 1], postcode };
}

function mapStatus(raw: string, date: string, paidHint: boolean): ImportAppointment['status'] {
  const s = raw.trim().toLowerCase();
  if (paidHint || /\bpaid\b/.test(s)) return 'Completed';
  if (/cancel|no[-\s]?show|deleted|rejected/.test(s)) return 'Cancelled';
  if (/complete|done|finished|closed|checked\s*out/.test(s)) return 'Completed';
  if (/pending|request|await|unconfirm/.test(s)) return 'Pending';
  if (/confirm|booked|approved|accepted|arrived|show/.test(s)) return 'Confirmed';
  if (date && date < todayIso()) return 'Completed';
  return 'Confirmed';
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function customerProperty(c: Pick<ImportCustomer, 'address' | 'town' | 'postcode'>): string {
  return [c.address, c.town, c.postcode].filter(Boolean).join(', ');
}

function withServiceLines(customer: ImportCustomer, lines: ImportServiceLine[]): ImportCustomer {
  const seen = new Set<string>();
  const serviceLines = lines
    .filter(line => line.service.trim())
    .map(line => ({
      service: line.service.trim(),
      price: Number.isFinite(line.price) ? line.price : 0,
      duration: Math.max(5, Number(line.duration) || 30),
      frequency: [4, 6, 8, 10, 12].includes(Number(line.frequency)) ? Number(line.frequency) : 6,
      oneOff: Boolean(line.oneOff),
    }))
    .filter(line => {
      const key = line.service.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const primary = serviceLines[0];
  return {
    ...customer,
    serviceLines,
    service: primary?.service ?? customer.service,
    price: primary?.price ?? customer.price,
    duration: primary?.duration ?? customer.duration,
    frequency: primary && !primary.oneOff ? primary.frequency : customer.frequency,
  };
}

function mergeCustomerFields(existing: ImportCustomer, incoming: Partial<ImportCustomer>): ImportCustomer {
  const merged: ImportCustomer = {
    ...existing,
    name: incoming.name?.trim() || existing.name,
    email: (() => {
      const next = incoming.email?.trim() || '';
      if (next) return next;
      // Clear previously mis-mapped addresses that landed in the email field.
      if (existing.email && !looksLikeEmail(existing.email)) return '';
      return existing.email;
    })(),
    phone: incoming.phone?.trim() || existing.phone,
    phone2: incoming.phone2?.trim() || existing.phone2 || '',
    address: incoming.address?.trim() || existing.address,
    town: incoming.town?.trim() || existing.town,
    postcode: (incoming.postcode?.trim() || existing.postcode).toUpperCase(),
    // Only customer-profile notes update the customer card — never appointment comments.
    notes: incoming.notes?.trim() || existing.notes || '',
    // Keep past-customer status — Setmore re-import must not reactivate archived clients.
    archived: Boolean(existing.archived),
  };
  const lines = [...(existing.serviceLines || [])];
  for (const line of incoming.serviceLines || []) {
    const idx = lines.findIndex(l => l.service.toLowerCase() === line.service.toLowerCase());
    if (idx >= 0) {
      lines[idx] = {
        ...lines[idx],
        price: line.price > 0 ? line.price : lines[idx].price,
        duration: line.duration || lines[idx].duration,
      };
    } else if (line.service) {
      lines.push(line);
    }
  }
  return withServiceLines(merged, lines.length ? lines : existing.serviceLines);
}

function phonesMatch(a: string, b: string): boolean {
  const pa = normalizePhone(a);
  const pb = normalizePhone(b);
  if (!pa || !pb || pa.length < 7 || pb.length < 7) return false;
  return pa === pb || pa.endsWith(pb.slice(-10)) || pb.endsWith(pa.slice(-10));
}

function findCustomerIndex(list: ImportCustomer[], candidate: { name: string; email: string; phone: string; phone2?: string; postcode: string }): number {
  const email = normalizeEmail(candidate.email);
  const phone = normalizePhone(candidate.phone);
  const phone2 = normalizePhone(candidate.phone2 || '');
  const name = normalizeName(candidate.name);
  const postcode = candidate.postcode.trim().toUpperCase().replace(/\s+/g, '');

  if (email && looksLikeEmail(candidate.email)) {
    const byEmail = list.findIndex(c => looksLikeEmail(c.email) && normalizeEmail(c.email) === email);
    if (byEmail >= 0) return byEmail;
  }
  if (phone.length >= 7 || phone2.length >= 7) {
    const byPhone = list.findIndex(c =>
      phonesMatch(c.phone, candidate.phone) ||
      phonesMatch(c.phone2 || '', candidate.phone) ||
      phonesMatch(c.phone, candidate.phone2 || '') ||
      phonesMatch(c.phone2 || '', candidate.phone2 || ''),
    );
    if (byPhone >= 0) return byPhone;
  }
  if (name) {
    const byNamePostcode = list.findIndex(c => {
      if (normalizeName(c.name) !== name) return false;
      if (!postcode) return true;
      return c.postcode.trim().toUpperCase().replace(/\s+/g, '') === postcode;
    });
    if (byNamePostcode >= 0) return byNamePostcode;
  }
  return -1;
}

function appointmentKey(customerId: string, date: string, time: string, service: string): string {
  return `${customerId}|${date}|${time}|${service.trim().toLowerCase()}`;
}

function detectPaid(row: CsvRow, statusRaw: string): boolean {
  const status = statusRaw.toLowerCase();
  if (/\bpaid\b/.test(status)) return true;
  for (const [key, value] of Object.entries(row)) {
    if (/payment|paid|pay status/.test(key) && /\b(paid|yes|true|collected|complete)\b/i.test(value)) return true;
  }
  return false;
}

function resolveCustomerName(row: CsvRow): string {
  const first = pickField(row, 'firstName');
  const last = pickField(row, 'lastName');
  const combined = [first, last].filter(Boolean).join(' ').trim();
  if (combined) return combined;
  return pickField(row, 'customer');
}

/** Prefer mobile as primary; keep a distinct second number when Setmore has both. */
function resolvePhones(row: CsvRow): { phone: string; phone2: string } {
  const candidates = [pickField(row, 'mobile'), pickField(row, 'phone'), pickField(row, 'phone2')]
    .map(s => s.trim())
    .filter(Boolean);
  const unique: string[] = [];
  for (const p of candidates) {
    const n = normalizePhone(p);
    if (!n || unique.some(u => normalizePhone(u) === n)) continue;
    unique.push(p);
  }
  return { phone: unique[0] || '', phone2: unique[1] || '' };
}

/**
 * Keep Setmore customer profile notes separate from appointment/job comments.
 * Appointment report rows → job notes; customer-only export rows → customer notes.
 */
function resolveNotes(row: CsvRow, hasAppointment: boolean): { customerNotes: string; jobNotes: string } {
  const customerNotes = pickField(row, 'customerNotes').trim();
  const jobNotes = pickField(row, 'jobNotes').trim();
  const ambiguous = pickField(row, 'notes').trim();
  if (customerNotes || jobNotes) {
    return {
      customerNotes: customerNotes || (!hasAppointment ? ambiguous : ''),
      jobNotes: jobNotes || (hasAppointment ? ambiguous : ''),
    };
  }
  if (hasAppointment) return { customerNotes: '', jobNotes: ambiguous };
  return { customerNotes: ambiguous, jobNotes: '' };
}

function resolveStart(row: CsvRow): { date: string; time: string } | null {
  const startDt = pickField(row, 'startDateTime');
  if (startDt) {
    const parsed = parseDateTime(startDt);
    if (parsed) return parsed;
  }
  const dateRaw = pickField(row, 'date');
  const timeRaw = pickField(row, 'time');
  if (dateRaw && timeRaw) {
    const date = parseDateToken(dateRaw) || parseDateTime(dateRaw)?.date;
    const time = parseTimeToken(timeRaw) || parseDateTime(`${dateRaw} ${timeRaw}`)?.time;
    if (date && time) return { date, time };
  }
  if (dateRaw) return parseDateTime(dateRaw);
  if (timeRaw && /\d{4}/.test(timeRaw)) return parseDateTime(timeRaw);
  return null;
}

function durationFromTimeRange(raw: string): number | null {
  const parts = raw.trim().split(/\s*[-–—]\s*/);
  if (parts.length < 2) return null;
  const start = parseTimeToken(parts[0]);
  const end = parseTimeToken(parts[1]);
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  if (mins >= 5 && mins <= 720) return mins;
  return null;
}

function resolveDuration(row: CsvRow, start: { date: string; time: string } | null, fallback: number): number {
  const fromField = durationMinutes(pickField(row, 'duration'));
  if (fromField) return fromField;
  const timeRaw = pickField(row, 'time');
  const fromRange = durationFromTimeRange(timeRaw);
  if (fromRange) return fromRange;
  const endTimeRaw = pickField(row, 'endTime');
  const endDtRaw = pickField(row, 'endDateTime');
  if (start && (endTimeRaw || endDtRaw)) {
    const end = endDtRaw
      ? parseDateTime(endDtRaw)
      : { date: start.date, time: parseTimeToken(endTimeRaw) || '' };
    if (end?.time) {
      const [sh, sm] = start.time.split(':').map(Number);
      const [eh, em] = end.time.split(':').map(Number);
      let mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins <= 0) mins += 24 * 60;
      if (mins >= 5 && mins <= 720) return mins;
    }
  }
  return fallback;
}

type SetmoreExisting = {
  customers: ImportCustomer[];
  appointments: ImportAppointment[];
  services: ImportService[];
  payments: ImportPayment[];
};

type SetmoreReadMeta = {
  fileKind?: SetmoreImportSummary['fileKind'];
  sheetName?: string | null;
  detectedHeaders?: string[];
};

type IncomingSetmoreJob = {
  customerId: string;
  date: string;
  time: string;
  duration: number;
  service: string;
  price: number;
  status: ImportAppointment['status'];
  address: string;
  notes: string;
  bookingId: string;
  paid: boolean;
  frequency: number;
};

function inReportRange(date: string, from: string | null, to: string | null) {
  return Boolean(from && to && date >= from && date <= to);
}

/**
 * Setmore is the schedule inside the report's first and last dates.
 * Same booking id, or the same customer/date/time/service, is updated in place.
 * A single unmatched job for the same customer and service is treated as a move.
 * Anything else in that date range that the file does not list is removed,
 * except an invoiced job: that work is done, so it stays and is marked missing.
 */
function reconcileSetmoreSchedule(
  existing: ImportAppointment[],
  incoming: IncomingSetmoreJob[],
  payments: ImportPayment[],
  coverageFrom: string | null,
  coverageTo: string | null,
) {
  const pool = existing.map(a => ({ ...a }));
  const taken = new Set<number>();
  const consumed = new Set<number>();
  let updated = 0;
  let moved = 0;
  let added = 0;
  let paymentsAdded = 0;

  const apply = (idx: number, job: IncomingSetmoreJob, incomingIndex: number) => {
    const prev = pool[idx];
    const timeChanged = prev.date !== job.date || prev.time !== job.time;
    pool[idx] = {
      ...prev,
      customerId: job.customerId,
      date: job.date,
      time: job.time,
      duration: job.duration,
      service: job.service,
      price: Number.isFinite(job.price) ? job.price : prev.price,
      status: prev.quickfileInvoiceId ? 'Completed' : job.status,
      address: job.address || prev.address,
      notes: job.notes || prev.notes,
      setmoreBookingId: job.bookingId || prev.setmoreBookingId,
      missingFromSetmore: false,
    };
    taken.add(idx);
    consumed.add(incomingIndex);
    if (timeChanged) moved += 1;
    else updated += 1;
    if (job.paid && !payments.some(p => p.appointmentId === prev.id && p.paidAt)) {
      payments.push({
        id: crypto.randomUUID(),
        appointmentId: prev.id,
        amount: pool[idx].price,
        paidAt: job.date,
        method: 'setmore',
      });
      paymentsAdded += 1;
    }
  };

  const free = () => pool.map((_, index) => index).filter(index => !taken.has(index));

  const byBooking = new Map<string, number>();
  for (const index of free()) {
    const bookingId = pool[index].setmoreBookingId;
    if (!bookingId || byBooking.has(bookingId)) continue;
    byBooking.set(bookingId, index);
  }
  incoming.forEach((job, incomingIndex) => {
    if (!job.bookingId || consumed.has(incomingIndex)) return;
    const index = byBooking.get(job.bookingId);
    if (index == null || taken.has(index)) return;
    apply(index, job, incomingIndex);
  });

  const bySlot = new Map<string, number>();
  for (const index of free()) {
    const appointment = pool[index];
    const key = appointmentKey(appointment.customerId, appointment.date, appointment.time, appointment.service);
    const previous = bySlot.get(key);
    if (previous == null || (appointment.quickfileInvoiceId && !pool[previous].quickfileInvoiceId)) bySlot.set(key, index);
  }
  incoming.forEach((job, incomingIndex) => {
    if (consumed.has(incomingIndex)) return;
    const index = bySlot.get(appointmentKey(job.customerId, job.date, job.time, job.service));
    if (index == null || taken.has(index)) return;
    apply(index, job, incomingIndex);
  });

  const groups = new Map<string, { local: number[]; jobs: number[] }>();
  const groupKey = (customerId: string, service: string) => `${customerId}|${service.trim().toLowerCase()}`;
  const groupFor = (key: string) => {
    const current = groups.get(key);
    if (current) return current;
    const created = { local: [] as number[], jobs: [] as number[] };
    groups.set(key, created);
    return created;
  };
  for (const index of free()) {
    const appointment = pool[index];
    if (!inReportRange(appointment.date, coverageFrom, coverageTo)) continue;
    groupFor(groupKey(appointment.customerId, appointment.service)).local.push(index);
  }
  incoming.forEach((job, incomingIndex) => {
    if (consumed.has(incomingIndex)) return;
    groupFor(groupKey(job.customerId, job.service)).jobs.push(incomingIndex);
  });
  for (const group of groups.values()) {
    if (group.local.length !== 1 || group.jobs.length !== 1) continue;
    apply(group.local[0], incoming[group.jobs[0]], group.jobs[0]);
  }

  incoming.forEach((job, incomingIndex) => {
    if (consumed.has(incomingIndex)) return;
    const id = crypto.randomUUID();
    pool.push({
      id,
      customerId: job.customerId,
      date: job.date,
      time: job.time,
      duration: job.duration,
      service: job.service,
      price: job.price,
      status: job.status,
      address: job.address,
      notes: job.notes || undefined,
      oneOff: false,
      frequency: job.frequency || 6,
      setmoreBookingId: job.bookingId || undefined,
    });
    taken.add(pool.length - 1);
    added += 1;
    if (job.paid) {
      payments.push({
        id: crypto.randomUUID(),
        appointmentId: id,
        amount: job.price,
        paidAt: job.date,
        method: 'setmore',
      });
      paymentsAdded += 1;
    }
  });

  const removed: ImportAppointment[] = [];
  const kept: ImportAppointment[] = [];
  let missing = 0;
  pool.forEach((appointment, index) => {
    if (taken.has(index) || !inReportRange(appointment.date, coverageFrom, coverageTo)) {
      kept.push(appointment);
      return;
    }
    if (appointment.quickfileInvoiceId) {
      kept.push({ ...appointment, status: 'Completed', missingFromSetmore: true });
      missing += 1;
      return;
    }
    removed.push(appointment);
  });
  const keptIds = new Set(kept.map(appointment => appointment.id));
  return {
    appointments: kept,
    payments: payments.filter(payment => keptIds.has(payment.appointmentId)),
    removed,
    missing,
    updated,
    moved,
    added,
    paymentsAdded,
  };
}

/**
 * Apply parsed Setmore rows onto the workspace.
 * Inside the report's date range, Setmore replaces the schedule.
 * Jobs outside that range are left as they are.
 */
export function applySetmoreRows(rows: CsvRow[], existing: SetmoreExisting, meta: SetmoreReadMeta = {}): SetmoreImportResult {
  if (!rows.length) {
    throw new Error('No data rows found. Upload the Setmore report as .xls, .xlsx or CSV and try again.');
  }

  const isPlaceholderRow = (row: CsvRow) => {
    const nameKey = resolveCustomerName(row).trim().toLowerCase();
    const serviceKey = pickField(row, 'service').trim().toLowerCase();
    const email = resolveEmail(row);
    const { phone, phone2 } = resolvePhones(row);
    const meetingType = String(row['meeting type'] || '').trim().toLowerCase();
    if (serviceKey === 'off') return true;
    if ((nameKey === 'n/a' || nameKey === 'na' || nameKey === '-') && !email && !phone && !phone2) return true;
    if (meetingType === 'event' && (nameKey === 'n/a' || nameKey === 'na') && !email && !phone && !phone2) return true;
    return false;
  };

  const detectedHeaders = meta.detectedHeaders || (rows[0] ? Object.keys(rows[0]) : []);
  const usableRows = rows.filter(row => !isPlaceholderRow(row));
  const preview = usableRows.slice(0, 5).map(row => {
    const start = resolveStart(row);
    return {
      customer: resolveCustomerName(row) || resolveEmail(row) || pickField(row, 'phone') || pickField(row, 'mobile') || '(no name)',
      service: pickField(row, 'service') || '(none)',
      date: start?.date || '(no date)',
      time: start?.time || '(no time)',
    };
  });
  const scheduledCount = usableRows.reduce((n, row) => n + (resolveStart(row) ? 1 : 0), 0);
  if (scheduledCount === 0) {
    throw new Error(
      [
        'No customer appointments found in this Setmore file — nothing was imported.',
        `(Time-off / N/A blocks are skipped.)`,
        `File type: ${meta.fileKind || 'unknown'}${meta.sheetName ? ` · sheet “${meta.sheetName}”` : ''}`,
        `Columns seen: ${detectedHeaders.join(', ') || '(none)'}`,
        `Sample rows: ${preview.map(s => `${s.customer} | ${s.date} ${s.time} | ${s.service}`).join(' · ') || '(only Off/N/A rows in file)'}`,
        'Export a date range that includes real customer bookings from Settings → Booking Page → Reports.',
      ].join(' '),
    );
  }

  const customers = existing.customers.map(c => ({ ...c, serviceLines: [...(c.serviceLines || [])] }));
  const appointments = existing.appointments.map(a => ({ ...a }));
  const services = existing.services.map(s => ({ ...s }));
  const payments = existing.payments.map(p => ({ ...p }));

  const summary: SetmoreImportSummary = {
    customersAdded: 0,
    customersUpdated: 0,
    appointmentsAdded: 0,
    appointmentsUpdated: 0,
    appointmentsMoved: 0,
    appointmentsRemoved: 0,
    appointmentsMissing: 0,
    servicesAdded: 0,
    paymentsAdded: 0,
    skipped: 0,
    rowCount: rows.length,
    coverageFrom: null,
    coverageTo: null,
    detectedHeaders,
    rowsWithSchedule: 0,
    rowsCustomerOnly: 0,
    fileKind: meta.fileKind || 'unknown',
    sheetName: meta.sheetName || null,
    sample: preview,
  };

  const incomingJobs: IncomingSetmoreJob[] = [];
  const touchedNewCustomers = new Set<string>();
  const touchedUpdatedCustomers = new Set<string>();

  const noteCoverage = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (!summary.coverageFrom || date < summary.coverageFrom) summary.coverageFrom = date;
    if (!summary.coverageTo || date > summary.coverageTo) summary.coverageTo = date;
  };

  for (const row of rows) {
    const name = resolveCustomerName(row);
    const email = resolveEmail(row);
    const { phone, phone2 } = resolvePhones(row);
    const start = resolveStart(row);
    // Setmore rows almost always have a service; if the column is oddly named, still keep the job.
    let serviceName = pickField(row, 'service');
    if (!serviceName && start) serviceName = 'Window cleaning';
    if (isPlaceholderRow(row)) {
      summary.skipped += 1;
      continue;
    }
    const hasAppointmentSignal = Boolean(start && serviceName);
    const hasCustomerSignal = Boolean(name || email || phone || phone2);

    if (!hasCustomerSignal && !hasAppointmentSignal) {
      summary.skipped += 1;
      continue;
    }
    if (start) summary.rowsWithSchedule += 1;
    else if (hasCustomerSignal) summary.rowsCustomerOnly += 1;
    if (start?.date) noteCoverage(start.date);

    const addressRaw = pickField(row, 'address');
    const townField = pickField(row, 'town');
    const postcodeField = pickField(row, 'postcode') || extractUkPostcode(addressRaw);
    const split = splitAddress(addressRaw);
    const address = split.address || addressRaw;
    const town = townField || split.town;
    const postcode = (postcodeField || split.postcode).toUpperCase();
    const { customerNotes, jobNotes } = resolveNotes(row, hasAppointmentSignal);
    const price = moneyNumber(pickField(row, 'cost'));
    const duration = resolveDuration(row, start, 30);

    let customerId = '';
    if (hasCustomerSignal || hasAppointmentSignal) {
      const customerName = name || email || phone || phone2 || 'Setmore customer';
      const candidate = {
        name: customerName,
        email,
        phone,
        phone2,
        address,
        town,
        postcode,
        notes: customerNotes,
        service: serviceName,
        price: price ?? 0,
        duration,
        frequency: 6,
        serviceLines: serviceName
          ? [{ service: serviceName, price: price ?? 0, duration, frequency: 6 }]
          : [] as ImportServiceLine[],
      };
      const idx = findCustomerIndex(customers, candidate);
      if (idx >= 0) {
        customers[idx] = mergeCustomerFields(customers[idx], candidate);
        customerId = customers[idx].id;
        if (!touchedNewCustomers.has(customerId)) touchedUpdatedCustomers.add(customerId);
      } else {
        const created: ImportCustomer = {
          id: crypto.randomUUID(),
          name: customerName,
          email,
          phone,
          phone2,
          address,
          town,
          postcode,
          price: price ?? 0,
          duration,
          frequency: 6,
          notes: customerNotes,
          service: serviceName,
          serviceLines: [],
          archived: false,
        };
        customers.push(withServiceLines(created, candidate.serviceLines));
        customerId = created.id;
        touchedNewCustomers.add(customerId);
      }
    }

    if (serviceName) {
      const existingService = services.find(s => s.name.toLowerCase() === serviceName.toLowerCase());
      if (!existingService) {
        services.push({ name: serviceName, duration, price: price ?? 0, color: nextServiceColor(services) });
        summary.servicesAdded += 1;
      } else {
        if ((price ?? 0) > 0 && existingService.price <= 0) existingService.price = price!;
        if (duration && existingService.duration === 30 && duration !== 30) existingService.duration = duration;
      }
    }

    if (!hasAppointmentSignal || !customerId || !start || !serviceName) {
      if (!hasAppointmentSignal && hasCustomerSignal) continue;
      summary.skipped += 1;
      continue;
    }

    const statusRaw = pickField(row, 'status');
    const paid = detectPaid(row, statusRaw);
    const status = mapStatus(statusRaw, start.date, paid);
    const customer = customers.find(c => c.id === customerId)!;
    const addressSnapshot = customerProperty(customer) || address || '';
    incomingJobs.push({
      customerId,
      date: start.date,
      time: start.time,
      duration,
      service: serviceName,
      price: price ?? customer.price ?? 0,
      status,
      address: addressSnapshot,
      notes: jobNotes,
      bookingId: pickField(row, 'bookingId').trim(),
      paid,
      frequency: customer.frequency || 6,
    });
  }

  const reconciled = reconcileSetmoreSchedule(appointments, incomingJobs, payments, summary.coverageFrom, summary.coverageTo);
  summary.appointmentsAdded = reconciled.added;
  summary.appointmentsUpdated = reconciled.updated;
  summary.appointmentsMoved = reconciled.moved;
  summary.appointmentsRemoved = reconciled.removed.length;
  summary.appointmentsMissing = reconciled.missing;
  summary.paymentsAdded += reconciled.paymentsAdded;
  summary.customersAdded = touchedNewCustomers.size;
  summary.customersUpdated = touchedUpdatedCustomers.size;

  return {
    customers,
    appointments: reconciled.appointments,
    services,
    payments: reconciled.payments,
    summary,
    removedAppointments: reconciled.removed,
  };
}

/** @deprecated Prefer applySetmoreFileImport — kept for CSV text tests. */
export function applySetmoreCsvImport(csvText: string, existing: SetmoreExisting): SetmoreImportResult {
  return applySetmoreRows(parseCsv(csvText), existing);
}

/** Import a Setmore .xls / .xlsx / CSV export into the current workspace. */
export async function applySetmoreFileImport(file: File, existing: SetmoreExisting): Promise<SetmoreImportResult> {
  const read = await readSetmoreRows(file);
  return applySetmoreRows(read.rows, existing, {
    fileKind: read.fileKind,
    sheetName: read.sheetName,
    detectedHeaders: read.detectedHeaders,
  });
}

export function formatSetmoreImportSummary(summary: SetmoreImportSummary): string {
  const parts = [
    `${summary.customersAdded} new customer${summary.customersAdded === 1 ? '' : 's'}`,
    `${summary.customersUpdated} updated`,
    `${summary.appointmentsAdded} new appointment${summary.appointmentsAdded === 1 ? '' : 's'}`,
    `${summary.appointmentsUpdated} appointment${summary.appointmentsUpdated === 1 ? '' : 's'} refreshed`,
    `${summary.appointmentsMoved || 0} moved`,
    `${summary.appointmentsRemoved || 0} removed`,
  ];
  if (summary.appointmentsMissing) {
    parts.push(`${summary.appointmentsMissing} invoiced job${summary.appointmentsMissing === 1 ? '' : 's'} kept — not in Setmore`);
  }
  if (summary.servicesAdded) parts.push(`${summary.servicesAdded} service${summary.servicesAdded === 1 ? '' : 's'} added`);
  if (summary.paymentsAdded) parts.push(`${summary.paymentsAdded} payment${summary.paymentsAdded === 1 ? '' : 's'} recorded`);
  if (summary.skipped) parts.push(`${summary.skipped} row${summary.skipped === 1 ? '' : 's'} skipped`);
  if (summary.coverageFrom && summary.coverageTo) {
    parts.push(summary.coverageFrom === summary.coverageTo
      ? `jobs on ${summary.coverageFrom}`
      : `jobs ${summary.coverageFrom} → ${summary.coverageTo}`);
  }
  if (summary.rowsWithSchedule === 0) {
    parts.push('no schedule columns detected');
  }
  return `Setmore import complete — ${parts.join(' · ')}.`;
}

export function buildSetmoreLastImport(
  file: Pick<File, 'name' | 'lastModified'>,
  summary: SetmoreImportSummary,
  importedAt = new Date(),
): SetmoreLastImport {
  return {
    id: crypto.randomUUID(),
    importedAt: importedAt.toISOString(),
    fileName: file.name,
    fileModifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    coverageFrom: summary.coverageFrom,
    coverageTo: summary.coverageTo,
    summaryLine: formatSetmoreImportSummary(summary),
    detectedHeaders: summary.detectedHeaders,
    rowsWithSchedule: summary.rowsWithSchedule,
    rowsCustomerOnly: summary.rowsCustomerOnly,
    fileKind: summary.fileKind,
    sheetName: summary.sheetName,
    sample: summary.sample,
  };
}
