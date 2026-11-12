/** Square Appointments (Bookings API) — read and write bookings, customers and services. */

import { randomUUID } from 'node:crypto';
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

export type SquareEnvironment = 'production' | 'sandbox';

export type SquareCredentials = {
  accessToken: string;
  environment: SquareEnvironment;
  locationId: string;
};

export type SquareLocation = { id: string; name: string };

export type SquareCalendarEvent = {
  id: string;
  status: 'Confirmed' | 'Pending' | 'Cancelled';
  date: string;
  time: string;
  duration: number;
  service: string;
  price: number;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  town: string;
  postcode: string;
  notes: string;
};

const SQUARE_VERSION = '2025-01-23';

type SquareMoney = { amount?: number; currency?: string };
type SquareAddress = { address_line_1?: string; locality?: string; postal_code?: string };
type SquareCustomer = {
  id?: string;
  given_name?: string;
  family_name?: string;
  company_name?: string;
  email_address?: string;
  phone_number?: string;
  address?: SquareAddress;
};
type SquareCatalogObject = {
  id?: string;
  type?: string;
  item_data?: { name?: string };
  item_variation_data?: { item_id?: string; name?: string; price_money?: SquareMoney };
};
type SquareSegment = {
  duration_minutes?: number;
  service_variation_id?: string;
  team_member_id?: string;
  service_variation_version?: number;
};
type SquareBooking = {
  id?: string;
  version?: number;
  status?: string;
  start_at?: string;
  location_id?: string;
  customer_id?: string;
  customer_note?: string;
  seller_note?: string;
  appointment_segments?: SquareSegment[];
};

export function parseSquareCredentials(body: any): SquareCredentials {
  const accessToken = String(body?.accessToken || '').trim();
  const environment: SquareEnvironment = body?.environment === 'sandbox' ? 'sandbox' : 'production';
  const locationId = String(body?.locationId || '').trim();
  if (!accessToken) throw new Error('Paste the Square access token from the Developer dashboard.');
  return { accessToken, environment, locationId };
}

function host(environment: SquareEnvironment) {
  return environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
}

function squareError(json: any, status: number) {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  const detail = errors.map((error: any) => error?.detail || error?.code).filter(Boolean).join(' · ');
  return detail || `Square request failed (${status}).`;
}

async function squareFetch(creds: SquareCredentials, path: string, init: RequestInit = {}) {
  ensureSystemCertificates();
  let res: Response;
  try {
    res = await fetch(`${host(creds.environment)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Square-Version': SQUARE_VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
    const intercepted = /certificate|UNABLE_TO_VERIFY/i.test(cause);
    throw new Error(
      intercepted
        ? `Could not reach Square because HTTPS is being intercepted (${cause}). Turn off HTTPS scanning in Avast Web Shield, then connect again.`
        : `Could not reach Square${cause ? `: ${cause}` : '.'}`,
    );
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(squareError(json, res.status));
  return json;
}

export function londonDateTime(iso: string): { date: string; time: string } | null {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const minute = get('minute');
  if (!year || !month || !day || !hour || !minute) return null;
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

function londonToday() {
  return londonDateTime(new Date().toISOString())?.date || new Date().toISOString().slice(0, 10);
}

function shiftIso(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMinutes(date: string, time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number);
  const total = (hour || 0) * 60 + (minute || 0) + minutes;
  const dayShift = Math.floor(total / (24 * 60));
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const nextTime = `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
  return { date: dayShift ? shiftIso(date, dayShift) : date, time: nextTime };
}

function bookingNotes(booking: SquareBooking) {
  const seller = String(booking.seller_note || '').trim();
  const customerNote = String(booking.customer_note || '').trim();
  const parts: string[] = [];
  if (seller && customerNote && !seller.includes(customerNote)) parts.push(customerNote, seller);
  else if (seller || customerNote) parts.push(seller || customerNote);
  if (String(booking.status || '').toUpperCase() === 'NO_SHOW') parts.push('No show');
  return parts.filter(Boolean).join(' · ');
}

function mapStatus(status: string): SquareCalendarEvent['status'] {
  const key = status.toUpperCase();
  if (key === 'PENDING') return 'Pending';
  if (key.startsWith('CANCEL') || key === 'DECLINED') return 'Cancelled';
  return 'Confirmed';
}

function moneyToPounds(money: SquareMoney | undefined) {
  const amount = Number(money?.amount);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount) / 100;
}

function customerName(customer: SquareCustomer | undefined, fallback: string) {
  const person = [customer?.given_name, customer?.family_name].map(part => String(part || '').trim()).filter(Boolean).join(' ');
  return person || String(customer?.company_name || '').trim() || fallback;
}

function serviceLabel(variation: SquareCatalogObject | undefined, related: SquareCatalogObject[]) {
  const variationName = String(variation?.item_variation_data?.name || '').trim();
  const item = related.find(object => object.id && object.id === variation?.item_variation_data?.item_id);
  const itemName = String(item?.item_data?.name || '').trim();
  if (itemName && (!variationName || /^(regular|default|standard)$/i.test(variationName))) return itemName;
  if (itemName && variationName && variationName.toLowerCase() !== itemName.toLowerCase()) return `${itemName} (${variationName})`;
  return itemName || variationName || 'Appointment';
}

/** Square rejects a bookings query whose start and end are more than 31 days apart. */
async function listBookingsInWindow(creds: SquareCredentials, from: string, to: string, final: boolean) {
  const bookings: SquareBooking[] = [];
  let cursor = '';
  const startAtMax = final ? `${to}T23:59:59Z` : `${to}T00:00:00Z`;
  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams({
      limit: '100',
      start_at_min: `${from}T00:00:00Z`,
      start_at_max: startAtMax,
    });
    if (creds.locationId) params.set('location_id', creds.locationId);
    if (cursor) params.set('cursor', cursor);
    const json: any = await squareFetch(creds, `/v2/bookings?${params.toString()}`);
    const batch = Array.isArray(json?.bookings) ? json.bookings as SquareBooking[] : [];
    bookings.push(...batch);
    cursor = String(json?.cursor || '');
    if (!cursor || !batch.length) break;
  }
  return bookings;
}

async function listBookings(creds: SquareCredentials, coverageFrom: string, coverageTo: string) {
  const bookings: SquareBooking[] = [];
  const seen = new Set<string>();
  let cursor = coverageFrom;
  while (cursor <= coverageTo) {
    const next = shiftIso(cursor, 30);
    const final = next >= coverageTo;
    const batch = await listBookingsInWindow(creds, cursor, final ? coverageTo : next, final);
    for (const booking of batch) {
      const id = String(booking.id || '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      bookings.push(booking);
    }
    if (final) break;
    cursor = next;
  }
  return bookings;
}

async function customersById(creds: SquareCredentials, ids: string[]) {
  const map = new Map<string, SquareCustomer>();
  for (let index = 0; index < ids.length; index += 100) {
    const customerIds = ids.slice(index, index + 100);
    if (!customerIds.length) continue;
    const json: any = await squareFetch(creds, '/v2/customers/bulk-retrieve', {
      method: 'POST',
      body: JSON.stringify({ customer_ids: customerIds }),
    });
    const responses = json?.responses && typeof json.responses === 'object' ? json.responses : {};
    for (const [id, row] of Object.entries(responses as Record<string, { customer?: SquareCustomer }>)) {
      if (row?.customer) map.set(id, row.customer);
    }
  }
  return map;
}

async function catalogById(creds: SquareCredentials, ids: string[]) {
  const objects: SquareCatalogObject[] = [];
  const related: SquareCatalogObject[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const objectIds = ids.slice(index, index + 100);
    if (!objectIds.length) continue;
    const json: any = await squareFetch(creds, '/v2/catalog/batch-retrieve', {
      method: 'POST',
      body: JSON.stringify({ object_ids: objectIds, include_related_objects: true }),
    });
    if (Array.isArray(json?.objects)) objects.push(...json.objects);
    if (Array.isArray(json?.related_objects)) related.push(...json.related_objects);
  }
  return { objects, related };
}

export async function testSquareConnection(creds: SquareCredentials): Promise<{ ok: true; merchantName: string; locations: SquareLocation[] }> {
  const json: any = await squareFetch(creds, '/v2/locations');
  const locations = (Array.isArray(json?.locations) ? json.locations : [])
    .filter((location: any) => String(location?.status || 'ACTIVE').toUpperCase() === 'ACTIVE')
    .map((location: any) => ({
      id: String(location?.id || ''),
      name: String(location?.name || location?.business_name || 'Location'),
    }))
    .filter((location: SquareLocation) => location.id);
  const merchantName = String(json?.locations?.[0]?.business_name || locations[0]?.name || 'Square');
  return { ok: true, merchantName, locations };
}

/** Bookings from 30 days ago through 120 days ahead, in UK local time. */
export async function fetchSquareCalendar(creds: SquareCredentials): Promise<{ events: SquareCalendarEvent[]; coverageFrom: string; coverageTo: string }> {
  const today = londonToday();
  const coverageFrom = shiftIso(today, -30);
  const coverageTo = shiftIso(today, 120);
  const bookings = await listBookings(creds, coverageFrom, coverageTo);
  const customerIds = [...new Set(bookings.map(booking => String(booking.customer_id || '')).filter(Boolean))];
  const variationIds = [...new Set(bookings.flatMap(booking => (booking.appointment_segments || []).map(segment => String(segment.service_variation_id || '')).filter(Boolean)))];
  const [customers, catalog] = await Promise.all([
    customersById(creds, customerIds),
    catalogById(creds, variationIds),
  ]);
  const variations = new Map<string, SquareCatalogObject>();
  for (const object of catalog.objects) {
    if (object.id) variations.set(object.id, object);
  }
  const events: SquareCalendarEvent[] = [];
  for (const booking of bookings) {
    const bookingId = String(booking.id || '').trim();
    const start = londonDateTime(String(booking.start_at || ''));
    if (!bookingId || !start) continue;
    const customer = booking.customer_id ? customers.get(booking.customer_id) : undefined;
    const segments = booking.appointment_segments?.length ? booking.appointment_segments : [{ duration_minutes: 30 }];
    let cursor = start;
    const status = mapStatus(String(booking.status || 'ACCEPTED'));
    const notes = bookingNotes(booking);
    segments.forEach((segment, index) => {
      const duration = Math.max(5, Number(segment.duration_minutes) || 30);
      const variation = segment.service_variation_id ? variations.get(segment.service_variation_id) : undefined;
      const id = segments.length === 1 ? bookingId : `${bookingId}:${index}`;
      events.push({
        id,
        status,
        date: cursor.date,
        time: cursor.time,
        duration,
        service: serviceLabel(variation, catalog.related),
        price: moneyToPounds(variation?.item_variation_data?.price_money),
        customerName: customerName(customer, 'Square customer'),
        email: String(customer?.email_address || '').trim(),
        phone: String(customer?.phone_number || '').trim(),
        address: String(customer?.address?.address_line_1 || '').trim(),
        town: String(customer?.address?.locality || '').trim(),
        postcode: String(customer?.address?.postal_code || '').trim().toUpperCase(),
        notes,
      });
      cursor = addMinutes(cursor.date, cursor.time, duration);
    });
  }
  return { events, coverageFrom, coverageTo };
}

export type SquareVisitWrite = {
  bookingId?: string | null;
  date?: string;
  time?: string;
  duration?: number;
  service?: string;
  notes?: string;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    town?: string;
    postcode?: string;
  };
};

type BookableVariation = {
  id: string;
  version?: number;
  itemName: string;
  variationName: string;
  teamMemberIds: string[];
};

/** Wall-clock Europe/London date and time, returned as a UTC RFC3339 timestamp. */
export function londonWallToUtc(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  let guess = Date.UTC(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = londonDateTime(new Date(guess).toISOString());
    if (!shown) break;
    const [shownYear, shownMonth, shownDay] = shown.date.split('-').map(Number);
    const [shownHour, shownMinute] = shown.time.split(':').map(Number);
    const shownUtc = Date.UTC(shownYear, (shownMonth || 1) - 1, shownDay || 1, shownHour || 0, shownMinute || 0, 0);
    const wanted = Date.UTC(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0);
    if (shownUtc === wanted) break;
    guess += wanted - shownUtc;
  }
  return new Date(guess).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function shiftUtc(iso: string, minutes: number) {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) throw new Error('Square booking has no start time.');
  return new Date(value.getTime() + minutes * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function bookingRef(id: string) {
  const [parent, indexRaw] = id.split(':');
  const index = indexRaw == null || indexRaw === '' ? 0 : Number(indexRaw);
  return { parent, index: Number.isFinite(index) && index >= 0 ? index : 0 };
}

function cancelledStatus(status: string) {
  const key = status.toUpperCase();
  return key.startsWith('CANCEL') || key === 'DECLINED';
}

function normLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanEmail(value: string | undefined) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function toE164(value: string | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+') || digits.startsWith('44')) return `+${digits}`;
  if (digits.startsWith('0')) return `+44${digits.slice(1)}`;
  return '';
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { given_name: parts[0] || 'Customer' };
  return { given_name: parts[0], family_name: parts.slice(1).join(' ') };
}

async function resolveLocationId(creds: SquareCredentials) {
  if (creds.locationId) return creds.locationId;
  const tested = await testSquareConnection(creds);
  if (tested.locations.length === 1) return tested.locations[0].id;
  if (!tested.locations.length) throw new Error('Square has no active location.');
  throw new Error(`Choose a Square location in Settings before changing an appointment. Locations: ${tested.locations.map(location => location.name).join(', ')}.`);
}

async function searchSquareCustomer(creds: SquareCredentials, filter: Record<string, unknown>) {
  const json: any = await squareFetch(creds, '/v2/customers/search', {
    method: 'POST',
    body: JSON.stringify({ limit: 1, query: { filter } }),
  });
  const customer = Array.isArray(json?.customers) ? json.customers[0] : null;
  return customer?.id ? String(customer.id) : '';
}

async function createSquareCustomer(creds: SquareCredentials, body: Record<string, unknown>) {
  const json: any = await squareFetch(creds, '/v2/customers', {
    method: 'POST',
    body: JSON.stringify({ idempotency_key: randomUUID(), ...body }),
  });
  const id = String(json?.customer?.id || '');
  if (!id) throw new Error('Square did not return a customer.');
  return id;
}

async function findOrCreateSquareCustomer(creds: SquareCredentials, customer: SquareVisitWrite['customer']) {
  const email = cleanEmail(customer?.email);
  const phone = toE164(customer?.phone);
  if (email) {
    const found = await searchSquareCustomer(creds, { email_address: { exact: email } });
    if (found) return found;
  }
  if (phone) {
    const found = await searchSquareCustomer(creds, { phone_number: { exact: phone } });
    if (found) return found;
  }
  const address: Record<string, string> = {};
  if (customer?.address?.trim()) address.address_line_1 = customer.address.trim();
  if (customer?.town?.trim()) address.locality = customer.town.trim();
  if (customer?.postcode?.trim()) address.postal_code = customer.postcode.trim();
  const payload: Record<string, unknown> = { ...splitName(customer?.name || 'Customer') };
  if (email) payload.email_address = email;
  if (phone) payload.phone_number = phone;
  if (Object.keys(address).length) payload.address = address;
  try {
    return await createSquareCustomer(creds, payload);
  } catch (error) {
    if (!email && !phone) throw error;
    return createSquareCustomer(creds, splitName(customer?.name || 'Customer'));
  }
}

function variationLabel(variation: BookableVariation) {
  if (variation.itemName && (!variation.variationName || /^(regular|default|standard)$/i.test(variation.variationName))) return variation.itemName;
  if (variation.itemName && variation.variationName && variation.variationName.toLowerCase() !== variation.itemName.toLowerCase()) {
    return `${variation.itemName} (${variation.variationName})`;
  }
  return variation.itemName || variation.variationName || 'Appointment';
}

async function listAppointmentVariations(creds: SquareCredentials) {
  const bookable: BookableVariation[] = [];
  const hidden: BookableVariation[] = [];
  let cursor = '';
  for (let page = 0; page < 20; page += 1) {
    const body: Record<string, unknown> = { product_types: ['APPOINTMENTS_SERVICE'], limit: 100 };
    if (cursor) body.cursor = cursor;
    const json: any = await squareFetch(creds, '/v2/catalog/search-catalog-items', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const items = Array.isArray(json?.items) ? json.items : [];
    for (const item of items) {
      const itemName = String(item?.item_data?.name || '').trim();
      const variations = Array.isArray(item?.item_data?.variations) ? item.item_data.variations : [];
      for (const variation of variations) {
        const data = variation?.item_variation_data || {};
        const id = String(variation?.id || '').trim();
        if (!id) continue;
        const version = Number(variation?.version);
        const row: BookableVariation = {
          id,
          version: Number.isFinite(version) && version > 0 ? version : undefined,
          itemName,
          variationName: String(data.name || '').trim(),
          teamMemberIds: Array.isArray(data.team_member_ids) ? data.team_member_ids.map((memberId: unknown) => String(memberId)).filter(Boolean) : [],
        };
        if (data.available_for_booking === false) hidden.push(row);
        else bookable.push(row);
      }
    }
    cursor = String(json?.cursor || '');
    if (!cursor || !items.length) break;
  }
  return bookable.length ? bookable : hidden;
}

function matchAppointmentVariation(variations: BookableVariation[], service: string) {
  const want = normLabel(service);
  const names = [...new Set(variations.map(variationLabel))].slice(0, 12);
  const list = names.length ? names.join(', ') : 'none';
  if (!variations.length) throw new Error('Square has no appointment services. Add a service in Square Appointments, then try again.');
  const exact = variations.filter(variation => {
    return normLabel(variation.itemName) === want || normLabel(variation.variationName) === want || normLabel(variationLabel(variation)) === want;
  });
  const pool = exact.length ? exact : variations.filter(variation => {
    const item = normLabel(variation.itemName);
    return Boolean(item) && (item.includes(want) || want.includes(item));
  });
  const distinctItems = new Set(pool.map(variation => normLabel(variation.itemName))).size;
  if (!pool.length || (!exact.length && distinctItems > 1)) {
    throw new Error(`Square has no appointment service named "${service}". Square services: ${list}.`);
  }
  return pool.find(variation => /^(regular|default|standard)$/i.test(variation.variationName.trim())) || pool[0];
}

async function listBookableTeam(creds: SquareCredentials, locationId: string) {
  const ids: string[] = [];
  let cursor = '';
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: '100', bookable_only: 'true' });
    if (locationId) params.set('location_id', locationId);
    if (cursor) params.set('cursor', cursor);
    const json: any = await squareFetch(creds, `/v2/bookings/team-member-booking-profiles?${params.toString()}`);
    const rows = Array.isArray(json?.team_member_booking_profiles) ? json.team_member_booking_profiles : [];
    for (const row of rows) {
      const id = String(row?.team_member_id || '').trim();
      if (id) ids.push(id);
    }
    cursor = String(json?.cursor || '');
    if (!cursor || !rows.length) break;
  }
  return ids;
}

async function pickTeamMember(creds: SquareCredentials, locationId: string, preferred: string[]) {
  let bookable = await listBookableTeam(creds, locationId);
  if (!bookable.length && locationId) bookable = await listBookableTeam(creds, '');
  const match = preferred.find(id => bookable.includes(id));
  if (match) return match;
  if (bookable[0]) return bookable[0];
  if (preferred[0]) return preferred[0];
  throw new Error('Square has no bookable team member. In Square Appointments, mark a staff member as available for booking.');
}

function segmentBody(variation: BookableVariation, duration: number, teamMemberId: string) {
  const segment: Record<string, unknown> = {
    duration_minutes: duration,
    service_variation_id: variation.id,
    team_member_id: teamMemberId,
  };
  if (variation.version) segment.service_variation_version = variation.version;
  return segment;
}

function segmentFromExisting(segment: SquareSegment) {
  const body: Record<string, unknown> = {
    duration_minutes: Math.max(1, Number(segment.duration_minutes) || 30),
  };
  if (segment.service_variation_id) body.service_variation_id = segment.service_variation_id;
  if (segment.team_member_id) body.team_member_id = segment.team_member_id;
  if (segment.service_variation_version) body.service_variation_version = segment.service_variation_version;
  return body;
}

async function retrieveBooking(creds: SquareCredentials, bookingId: string) {
  const json: any = await squareFetch(creds, `/v2/bookings/${encodeURIComponent(bookingId)}`);
  const booking = json?.booking as SquareBooking | undefined;
  if (!booking?.id) throw new Error('Square could not find that booking.');
  return booking;
}

async function createBooking(creds: SquareCredentials, input: {
  locationId: string;
  startAt: string;
  customerId: string;
  note: string;
  duration: number;
  variation: BookableVariation;
  teamMemberId: string;
}) {
  const booking: Record<string, unknown> = {
    location_id: input.locationId,
    start_at: input.startAt,
    customer_id: input.customerId,
    appointment_segments: [segmentBody(input.variation, input.duration, input.teamMemberId)],
  };
  if (input.note) booking.seller_note = input.note;
  const json: any = await squareFetch(creds, '/v2/bookings', {
    method: 'POST',
    body: JSON.stringify({ idempotency_key: randomUUID(), booking }),
  });
  const id = String(json?.booking?.id || '');
  if (!id) throw new Error('Square did not return the new booking.');
  return id;
}

async function updateBooking(creds: SquareCredentials, bookingId: string, booking: Record<string, unknown>) {
  let version = booking.version;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await squareFetch(creds, `/v2/bookings/${encodeURIComponent(bookingId)}`, {
        method: 'PUT',
        body: JSON.stringify({ idempotency_key: randomUUID(), booking: { ...booking, version } }),
      });
      return;
    } catch (error) {
      const retry = error instanceof Error && /version/i.test(error.message) && attempt === 0;
      if (!retry) throw error;
      const fresh = await retrieveBooking(creds, bookingId);
      version = fresh.version;
    }
  }
}

/** Create or update one Square booking. Setmore visits are never sent here. */
export async function upsertSquareVisit(creds: SquareCredentials, body: SquareVisitWrite) {
  const date = String(body.date || '').trim();
  const time = String(body.time || '').slice(0, 5);
  const service = String(body.service || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Square needs a visit date.');
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('Square needs a start time.');
  if (!service) throw new Error('Choose a service before sending this visit to Square.');
  const duration = Math.max(1, Math.round(Number(body.duration) || 30));
  const note = String(body.notes || '').trim().slice(0, 4000);
  const locationId = await resolveLocationId(creds);
  const customerId = await findOrCreateSquareCustomer(creds, body.customer);
  const variation = matchAppointmentVariation(await listAppointmentVariations(creds), service);
  const teamMemberId = await pickTeamMember(creds, locationId, variation.teamMemberIds);
  const startAt = londonWallToUtc(date, time);
  const draft = { locationId, startAt, customerId, note, duration, variation, teamMemberId };
  const existingId = String(body.bookingId || '').trim();
  if (!existingId) return { bookingId: await createBooking(creds, draft) };

  const { parent, index } = bookingRef(existingId);
  let booking: SquareBooking;
  try {
    booking = await retrieveBooking(creds, parent);
  } catch (error) {
    if (error instanceof Error && /not find|not found|does not exist/i.test(error.message)) {
      return { bookingId: await createBooking(creds, draft) };
    }
    throw error;
  }
  if (cancelledStatus(String(booking.status || ''))) return { bookingId: await createBooking(creds, draft) };

  const segments = booking.appointment_segments || [];
  const segmentIndex = segments.length ? Math.min(index, segments.length - 1) : 0;
  let offset = 0;
  for (let cursor = 0; cursor < segmentIndex; cursor += 1) offset += Number(segments[cursor]?.duration_minutes) || 0;
  const nextSegments = segments.length
    ? segments.map((segment, segmentCursor) => segmentCursor === segmentIndex
      ? segmentBody(variation, duration, segment.team_member_id || teamMemberId)
      : segmentFromExisting(segment))
    : [segmentBody(variation, duration, teamMemberId)];
  await updateBooking(creds, parent, {
    version: booking.version,
    location_id: booking.location_id || locationId,
    start_at: offset ? shiftUtc(startAt, -offset) : startAt,
    customer_id: customerId,
    seller_note: note,
    appointment_segments: nextSegments,
  });
  return { bookingId: existingId };
}

/** Cancel a Square booking, or remove one segment when the visit is part of a multi-service booking. */
export async function cancelSquareVisit(creds: SquareCredentials, bookingId: string) {
  const id = String(bookingId || '').trim();
  if (!id) throw new Error('This visit is not linked to a Square booking.');
  const { parent, index } = bookingRef(id);
  const booking = await retrieveBooking(creds, parent);
  if (cancelledStatus(String(booking.status || ''))) return { ok: true as const };
  const segments = booking.appointment_segments || [];
  if (segments.length > 1 && id.includes(':')) {
    const kept = segments.filter((_, segmentCursor) => segmentCursor !== index);
    const start = index === 0 ? shiftUtc(String(booking.start_at || ''), Number(segments[0]?.duration_minutes) || 0) : String(booking.start_at || '');
    await updateBooking(creds, parent, {
      version: booking.version,
      location_id: booking.location_id,
      start_at: start,
      customer_id: booking.customer_id,
      appointment_segments: kept.map(segmentFromExisting),
    });
    return { ok: true as const };
  }
  await squareFetch(creds, `/v2/bookings/${encodeURIComponent(parent)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ idempotency_key: randomUUID(), booking_version: booking.version }),
  });
  return { ok: true as const };
}
