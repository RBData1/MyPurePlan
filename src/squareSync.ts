/** Merge Square bookings into the workspace without changing Setmore appointments. */

import type { SquareCalendarEvent } from './square';

export type SquareSyncServiceLine = {
  service: string;
  price: number;
  duration: number;
  frequency: number;
  oneOff?: boolean;
};

export type SquareSyncCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  phone2: string;
  address: string;
  town: string;
  postcode: string;
  price: number;
  duration: number;
  frequency: number;
  notes: string;
  service: string;
  serviceLines: SquareSyncServiceLine[];
  archived?: boolean;
  quickfileClientId?: number | null;
};

export type SquareSyncAppointment = {
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
  setmoreBookingId?: string;
  squareBookingId?: string;
  calendarSource?: 'setmore' | 'square';
  quickfileInvoiceId?: number | null;
  quickfileInvoiceNumber?: string | null;
  quickfileInvoicedAt?: string | null;
  missingFromSetmore?: boolean;
};

export type SquareSyncService = { name: string; duration: number; price: number; color?: string };

export function isSquareAppointment(appointment: { squareBookingId?: string; calendarSource?: string }) {
  return appointment.calendarSource === 'square' || Boolean(appointment.squareBookingId);
}

/** Fields Square Bookings actually stores. Price, paid and invoiced stay in MyPurePlan. */
export function squareVisitKey(appointment: Pick<SquareSyncAppointment, 'date' | 'time' | 'duration' | 'service' | 'customerId' | 'notes'>) {
  return [
    appointment.date,
    String(appointment.time || '').slice(0, 5),
    String(Math.max(5, Number(appointment.duration) || 30)),
    appointment.service.trim().toLowerCase(),
    appointment.customerId,
    String(appointment.notes || '').trim(),
  ].join('|');
}

/** Square-owned visits whose booking details changed. Completed and invoiced status alone is ignored. */
export function changedSquareVisits<T extends SquareSyncAppointment>(before: T[], after: T[]): T[] {
  const previous = new Map(before.map(item => [item.id, item]));
  return after.filter(item => {
    if (!isSquareAppointment(item) || item.status === 'Cancelled') return false;
    const prior = previous.get(item.id);
    if (!prior || !isSquareAppointment(prior) || !prior.squareBookingId) return true;
    return squareVisitKey(prior) !== squareVisitKey(item);
  });
}

function normEmail(value: string) {
  return value.trim().toLowerCase();
}

function normPhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('44') && digits.length > 10) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

function phonesMatch(left: string, right: string) {
  if (left.length < 7 || right.length < 7) return false;
  return left.endsWith(right) || right.endsWith(left);
}

function normName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function blank(current: string, incoming: string) {
  return current.trim() ? current : incoming.trim();
}

function propertyOf(customer: Pick<SquareSyncCustomer, 'address' | 'town' | 'postcode'>) {
  return [customer.address, customer.town, customer.postcode].filter(Boolean).join(', ');
}

function inWindow(date: string, from: string, to: string) {
  return Boolean(from && to && date >= from && date <= to);
}

export type SquareSyncResult = {
  customers: SquareSyncCustomer[];
  appointments: SquareSyncAppointment[];
  services: SquareSyncService[];
  removedAppointments: SquareSyncAppointment[];
  summary: string;
};

export function applySquareBookings(input: {
  customers: SquareSyncCustomer[];
  appointments: SquareSyncAppointment[];
  services: SquareSyncService[];
  events: SquareCalendarEvent[];
  coverageFrom: string;
  coverageTo: string;
  /** Booking ids created here moments ago — a pull started before Square listed them must not delete the local visit. */
  retainBookingIds?: string[];
}): SquareSyncResult {
  const customers = input.customers.map(customer => ({ ...customer, serviceLines: [...(customer.serviceLines || [])] }));
  const services = input.services.map(service => ({ ...service }));
  const appointments = input.appointments.map(appointment => ({ ...appointment }));
  let added = 0;
  let updated = 0;
  let removed = 0;
  let customersAdded = 0;

  const ensureService = (name: string, duration: number, price: number) => {
    const found = services.find(service => service.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (found) return found.name;
    services.push({ name, duration: duration || 30, price: price || 0 });
    return name;
  };

  const findCustomer = (event: SquareCalendarEvent) => {
    const email = normEmail(event.email);
    if (email) {
      const match = customers.find(customer => normEmail(customer.email) === email);
      if (match) return match;
    }
    const phone = normPhone(event.phone);
    if (phone.length >= 7) {
      const match = customers.find(customer => phonesMatch(normPhone(customer.phone), phone) || phonesMatch(normPhone(customer.phone2), phone));
      if (match) return match;
    }
    const name = normName(event.customerName);
    if (!name || name === 'square customer') return null;
    const named = customers.filter(customer => normName(customer.name) === name);
    if (named.length === 1) return named[0];
    const postcode = event.postcode.replace(/\s+/g, '').toLowerCase();
    if (!postcode) return null;
    return named.find(customer => customer.postcode.replace(/\s+/g, '').toLowerCase() === postcode) || null;
  };

  const ensureCustomer = (event: SquareCalendarEvent, service: string, price: number, duration: number) => {
    let customer = findCustomer(event);
    if (!customer) {
      customer = {
        id: crypto.randomUUID(),
        name: event.customerName.trim() || 'Square customer',
        email: event.email,
        phone: event.phone,
        phone2: '',
        address: event.address,
        town: event.town,
        postcode: event.postcode,
        price: price || 0,
        duration: duration || 30,
        frequency: 6,
        notes: '',
        service,
        serviceLines: [{ service, price: price || 0, duration: duration || 30, frequency: 6 }],
        archived: false,
        quickfileClientId: null,
      };
      customers.push(customer);
      customersAdded += 1;
      return customer;
    }
    customer.email = blank(customer.email, event.email);
    customer.phone = blank(customer.phone, event.phone);
    customer.address = blank(customer.address, event.address);
    customer.town = blank(customer.town, event.town);
    customer.postcode = blank(customer.postcode, event.postcode);
    const lines = customer.serviceLines?.length ? customer.serviceLines : [];
    if (service && !lines.some(line => line.service.trim().toLowerCase() === service.trim().toLowerCase())) {
      lines.push({ service, price: price || customer.price || 0, duration: duration || customer.duration || 30, frequency: customer.frequency || 6 });
    }
    customer.serviceLines = lines;
    if (!customer.service && lines[0]) customer.service = lines[0].service;
    return customer;
  };

  const byBooking = new Map<string, number>();
  appointments.forEach((appointment, index) => {
    if (appointment.squareBookingId && !byBooking.has(appointment.squareBookingId)) byBooking.set(appointment.squareBookingId, index);
  });
  const owner = new Map<string, string>();

  const priceFor = (customer: SquareSyncCustomer, service: string, eventPrice: number, previous?: SquareSyncAppointment) => {
    if (previous?.quickfileInvoiceId) return previous.price;
    if (eventPrice > 0) return eventPrice;
    const line = customer.serviceLines.find(item => item.service.trim().toLowerCase() === service.trim().toLowerCase());
    if (line && line.price > 0) return line.price;
    if (previous && previous.price > 0) return previous.price;
    return customer.price || 0;
  };

  for (const event of input.events) {
    let existingIndex = byBooking.has(event.id) ? byBooking.get(event.id) : undefined;
    let previous = existingIndex == null ? undefined : appointments[existingIndex];
    if (event.status === 'Cancelled') {
      if (!previous) continue;
      owner.set(event.id, previous.id);
      if (!previous.quickfileInvoiceId) appointments[existingIndex!] = { ...previous, status: 'Cancelled', calendarSource: 'square' };
      continue;
    }
    const service = ensureService(event.service || 'Appointment', event.duration, event.price);
    const customer = ensureCustomer(event, service, event.price, event.duration);
    if (previous == null) {
      const orphanIndex = appointments.findIndex(appointment =>
        !appointment.squareBookingId
        && isSquareAppointment(appointment)
        && appointment.status !== 'Cancelled'
        && appointment.customerId === customer.id
        && appointment.date === event.date
        && String(appointment.time || '').slice(0, 5) === String(event.time || '').slice(0, 5),
      );
      if (orphanIndex >= 0) {
        existingIndex = orphanIndex;
        previous = appointments[orphanIndex];
      }
    }
    const price = priceFor(customer, service, event.price, previous);
    const next: SquareSyncAppointment = {
      id: previous?.id || crypto.randomUUID(),
      customerId: customer.id,
      date: event.date,
      time: event.time,
      duration: event.duration || previous?.duration || 30,
      service,
      price,
      status: previous?.quickfileInvoiceId ? 'Completed' : event.status,
      address: propertyOf(customer) || [event.address, event.town, event.postcode].filter(Boolean).join(', '),
      notes: event.notes || previous?.notes || '',
      oneOff: previous?.oneOff ?? true,
      frequency: previous?.frequency || customer.frequency || 6,
      setmoreBookingId: previous?.setmoreBookingId,
      squareBookingId: event.id,
      calendarSource: 'square',
      quickfileInvoiceId: previous?.quickfileInvoiceId ?? null,
      quickfileInvoiceNumber: previous?.quickfileInvoiceNumber ?? null,
      quickfileInvoicedAt: previous?.quickfileInvoicedAt ?? null,
      missingFromSetmore: false,
    };
    if (previous && existingIndex != null) {
      appointments[existingIndex] = next;
      byBooking.set(event.id, existingIndex);
      updated += 1;
    } else {
      appointments.push(next);
      byBooking.set(event.id, appointments.length - 1);
      added += 1;
    }
    owner.set(event.id, next.id);
  }

  const retain = new Set((input.retainBookingIds || []).filter(Boolean));
  const kept: SquareSyncAppointment[] = [];
  const removedAppointments: SquareSyncAppointment[] = [];
  for (const appointment of appointments) {
    const bookingId = appointment.squareBookingId;
    if (!bookingId || !isSquareAppointment(appointment)) {
      kept.push(appointment);
      continue;
    }
    const keptId = owner.get(bookingId);
    if (keptId && keptId !== appointment.id) {
      if (appointment.quickfileInvoiceId || retain.has(bookingId)) kept.push(appointment);
      else { removedAppointments.push(appointment); removed += 1; }
      continue;
    }
    if (keptId || retain.has(bookingId) || !inWindow(appointment.date, input.coverageFrom, input.coverageTo)) {
      kept.push(appointment);
      continue;
    }
    if (appointment.quickfileInvoiceId) {
      kept.push({ ...appointment, status: 'Completed' });
      continue;
    }
    removedAppointments.push(appointment);
    removed += 1;
  }

  const summary = [
    `Square: ${added} added, ${updated} updated${removed ? `, ${removed} removed` : ''}.`,
    customersAdded ? `${customersAdded} new customer${customersAdded === 1 ? '' : 's'}.` : '',
    'Setmore jobs were left unchanged.',
  ].filter(Boolean).join(' ');

  return { customers, appointments: kept, services, removedAppointments, summary };
}
