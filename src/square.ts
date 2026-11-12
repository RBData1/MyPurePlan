/** Square Appointments connection. The token stays on this device and is sent only to the MyPurePlan API proxy. */

export type SquareEnvironment = 'production' | 'sandbox';

export type SquareConnection = {
  accessToken: string;
  environment: SquareEnvironment;
  locationId: string;
  connectedAt: string | null;
  syncedAt: string | null;
  merchantName: string;
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

export const defaultSquareConnection = (): SquareConnection => ({
  accessToken: '',
  environment: 'production',
  locationId: '',
  connectedAt: null,
  syncedAt: null,
  merchantName: '',
});

export function squareStorageKey(businessId: string | null) {
  return businessId ? `cs_square_${businessId}` : 'cs_square';
}

export function readSquareConnection(businessId: string | null): SquareConnection {
  try {
    const raw = localStorage.getItem(squareStorageKey(businessId));
    if (!raw) return defaultSquareConnection();
    const parsed = JSON.parse(raw) as Partial<SquareConnection>;
    return {
      ...defaultSquareConnection(),
      ...parsed,
      environment: parsed.environment === 'sandbox' ? 'sandbox' : 'production',
    };
  } catch {
    return defaultSquareConnection();
  }
}

export function writeSquareConnection(businessId: string | null, value: SquareConnection) {
  localStorage.setItem(squareStorageKey(businessId), JSON.stringify(value));
}

export function isSquareConnected(conn: SquareConnection) {
  return Boolean(conn.accessToken.trim() && conn.connectedAt);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Square request failed (${res.status})`);
  return data as T;
}

function payload(conn: SquareConnection) {
  return {
    accessToken: conn.accessToken,
    environment: conn.environment,
    locationId: conn.locationId,
  };
}

export async function testSquareConnection(conn: SquareConnection) {
  return postJson<{ ok: true; merchantName: string; locations: SquareLocation[] }>('/api/square/test', payload(conn));
}

export async function fetchSquareBookings(conn: SquareConnection) {
  return postJson<{ events: SquareCalendarEvent[]; coverageFrom: string; coverageTo: string }>('/api/square/bookings', payload(conn));
}

export type SquareVisitPush = {
  bookingId?: string | null;
  date: string;
  time: string;
  duration: number;
  service: string;
  notes?: string;
  customer: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    town?: string;
    postcode?: string;
  };
};

export async function pushSquareVisit(conn: SquareConnection, visit: SquareVisitPush) {
  return postJson<{ bookingId: string }>('/api/square/push', { ...payload(conn), ...visit });
}

export async function cancelSquareVisit(conn: SquareConnection, bookingId: string) {
  return postJson<{ ok: true }>('/api/square/cancel', { ...payload(conn), bookingId });
}
