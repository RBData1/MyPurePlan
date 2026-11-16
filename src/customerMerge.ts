/**
 * Collapse duplicate customer cards created when a Setmore import
 * did not recognise an existing name, and point every visit at the card that remains.
 */

export type MergeCustomer = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  phone2?: string;
  address?: string;
  town?: string;
  postcode?: string;
  notes?: string;
  archived?: boolean;
  service?: string;
  price?: number;
  duration?: number;
  frequency?: number;
  serviceLines?: Array<{ service: string; price: number; duration: number; frequency: number; oneOff?: boolean }>;
};

export type MergeAppointment = {
  id: string;
  customerId: string;
  date: string;
  time: string;
  service: string;
  notes?: string;
  quickfileInvoiceId?: number | null;
  status?: string;
};

export type MergePayment = {
  id: string;
  appointmentId: string;
  paidAt?: string | null;
};

const FILLER = new Set(['the', 'and', 'from', 'of', 'a', 'at', 'mr', 'mrs', 'ms', 'miss']);

export function normalizePhone(value: string): string {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('44') && digits.length >= 12) return `0${digits.slice(2)}`;
  return digits;
}

export function phonesMatch(a: string, b: string): boolean {
  const pa = normalizePhone(a);
  const pb = normalizePhone(b);
  if (!pa || !pb || pa.length < 7 || pb.length < 7) return false;
  return pa === pb || pa.endsWith(pb.slice(-10)) || pb.endsWith(pa.slice(-10));
}

export function customerNameTokens(name: string): string[] {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(token => token && !FILLER.has(token));
}

/** Real UK postcode. Placeholders such as UNKNOWN do not distinguish two houses. */
export function realPostcode(value: string): string {
  const compact = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!compact || compact === 'UNKNOWN' || compact === 'NA' || compact === 'N/A' || compact === 'NONE') return '';
  return compact;
}

function normText(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function phonesOf(customer: MergeCustomer): string[] {
  return [customer.phone || '', customer.phone2 || ''].map(normalizePhone).filter(phone => phone.length >= 7);
}

function phonesAgree(a: MergeCustomer, b: MergeCustomer): boolean {
  const left = phonesOf(a);
  const right = phonesOf(b);
  if (!left.length || !right.length) return false;
  return left.some(phone => right.some(other => phonesMatch(phone, other)));
}

function phonesConflict(a: MergeCustomer, b: MergeCustomer): boolean {
  const left = phonesOf(a);
  const right = phonesOf(b);
  if (!left.length || !right.length) return false;
  return !phonesAgree(a, b);
}

function postcodesAgree(a: MergeCustomer, b: MergeCustomer): boolean {
  const left = realPostcode(a.postcode || '');
  const right = realPostcode(b.postcode || '');
  return Boolean(left && right && left === right);
}

function postcodesConflict(a: MergeCustomer, b: MergeCustomer): boolean {
  const left = realPostcode(a.postcode || '');
  const right = realPostcode(b.postcode || '');
  return Boolean(left && right && left !== right);
}

function addressesAgree(a: MergeCustomer, b: MergeCustomer): boolean {
  const left = normText(a.address || '');
  const right = normText(b.address || '');
  if (left.length < 4 || right.length < 4) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function addressInOtherName(a: MergeCustomer, b: MergeCustomer): boolean {
  const address = normText(a.address || '');
  const name = normText(b.name || '');
  if (address.length < 6 || !name) return false;
  return name.includes(address);
}

function propertyAgrees(a: MergeCustomer, b: MergeCustomer): boolean {
  return postcodesAgree(a, b) || addressesAgree(a, b) || addressInOtherName(a, b) || addressInOtherName(b, a);
}

/** exact = same words. similar = one name is the other plus extra words (address, couple notes). */
export function nameRelation(a: string, b: string): 'exact' | 'similar' | 'weak' | 'no' {
  const left = customerNameTokens(a);
  const right = customerNameTokens(b);
  if (!left.length || !right.length) return 'no';
  if (left.join(' ') === right.join(' ')) return 'exact';
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  let index = 0;
  for (const token of longer) {
    if (token === shorter[index]) index += 1;
    if (index === shorter.length) break;
  }
  if (index !== shorter.length) return 'no';
  if (shorter.length >= 2) return 'similar';
  if (longer[0] === shorter[0]) return 'weak';
  return 'no';
}

function sharedNameToken(a: string, b: string): boolean {
  const left = new Set(customerNameTokens(a).filter(token => token.length >= 4 && !/^\d+$/.test(token)));
  return customerNameTokens(b).some(token => token.length >= 4 && !/^\d+$/.test(token) && left.has(token));
}

function compactNameIncludes(a: string, b: string): boolean {
  const left = customerNameTokens(a).join('');
  const right = customerNameTokens(b).join('');
  if (left.length < 6 || right.length < 6) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return longer.includes(shorter);
}

/** True when two cards are the same household, not merely a shared first name. */
export function sameCustomer(a: MergeCustomer, b: MergeCustomer): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  const relation = nameRelation(a.name, b.name);
  if (relation === 'no') {
    if (!phonesAgree(a, b) || postcodesConflict(a, b)) return false;
    return sharedNameToken(a.name, b.name) || compactNameIncludes(a.name, b.name);
  }
  if (phonesConflict(a, b)) return false;
  if (postcodesConflict(a, b) && !phonesAgree(a, b)) return false;
  if (relation === 'exact') return true;
  if (relation === 'weak') return phonesAgree(a, b) && !postcodesConflict(a, b);
  return phonesAgree(a, b) || propertyAgrees(a, b);
}

function filled(value: string | undefined): string {
  return String(value || '').trim();
}

function betterPostcode(keeper: string, other: string): string {
  const keeperReal = realPostcode(keeper);
  const otherReal = realPostcode(other);
  if (keeperReal) return keeper.trim();
  if (otherReal) return other.trim();
  return keeper.trim() || other.trim();
}

function mergeServiceLines(keeper: MergeCustomer, other: MergeCustomer) {
  const lines = [...(keeper.serviceLines || [])];
  for (const line of other.serviceLines || []) {
    if (!line?.service) continue;
    const index = lines.findIndex(item => item.service.toLowerCase() === line.service.toLowerCase());
    if (index < 0) lines.push(line);
    else if ((lines[index].price || 0) <= 0 && line.price > 0) lines[index] = { ...lines[index], price: line.price };
  }
  return lines;
}

function mergeNotes(keeper: string, other: string): string {
  const left = filled(keeper);
  const right = filled(other);
  if (!right || left.includes(right)) return left;
  if (!left) return right;
  return `${left}\n${right}`;
}

function combineCustomers<C extends MergeCustomer>(keeper: C, other: C): C {
  const lines = mergeServiceLines(keeper, other);
  const primary = lines[0];
  return {
    ...keeper,
    email: filled(keeper.email) || filled(other.email),
    phone: filled(keeper.phone) || filled(other.phone),
    phone2: filled(keeper.phone2) || filled(other.phone2),
    address: filled(keeper.address) || filled(other.address),
    town: filled(keeper.town) || filled(other.town),
    postcode: betterPostcode(keeper.postcode || '', other.postcode || ''),
    notes: mergeNotes(keeper.notes || '', other.notes || ''),
    service: keeper.service || other.service || primary?.service || '',
    price: (keeper.price || 0) > 0 ? keeper.price : (other.price || primary?.price || 0),
    duration: (keeper.duration || 0) > 0 ? keeper.duration : (other.duration || primary?.duration || 30),
    frequency: keeper.frequency || other.frequency || primary?.frequency || 6,
    serviceLines: lines,
    archived: Boolean(keeper.archived),
  };
}

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
}

export type CustomerMergeResult<C extends MergeCustomer, A extends MergeAppointment, P extends MergePayment> = {
  customers: C[];
  appointments: A[];
  payments: P[];
  removedCustomerIds: string[];
  removedAppointmentIds: string[];
  /** Dropped appointment id → the visit that was kept. */
  appointmentRedirect: Map<string, string>;
  mergedGroups: number;
  removedCustomers: number;
};

export function mergeDuplicateCustomers<C extends MergeCustomer, A extends MergeAppointment, P extends MergePayment>(
  customers: C[],
  appointments: A[],
  payments: P[],
): CustomerMergeResult<C, A, P> {
  const visitCount = new Map<string, number>();
  for (const appointment of appointments) {
    visitCount.set(appointment.customerId, (visitCount.get(appointment.customerId) || 0) + 1);
  }

  const rankOf = (customer: C) => [
    visitCount.get(customer.id) || 0,
    customer.archived ? 0 : 1,
    -customerNameTokens(customer.name).join(' ').length,
    realPostcode(customer.postcode || '') ? 1 : 0,
  ];

  const order = customers.map((customer, index) => ({ customer, index }));
  order.sort((a, b) => compareRank(rankOf(a.customer), rankOf(b.customer)) || a.index - b.index);

  const groups: C[][] = [];
  for (const { customer } of order) {
    const matches = groups.filter(group => group.every(member => sameCustomer(member, customer)));
    if (!matches.length) {
      groups.push([customer]);
      continue;
    }
    matches.sort((a, b) => (visitCount.get(a[0].id) || 0) - (visitCount.get(b[0].id) || 0));
    matches[matches.length - 1].push(customer);
  }

  const removedCustomerIds: string[] = [];
  const keeperById = new Map<string, string>();
  const combined: C[] = [];
  let mergedGroups = 0;

  for (const group of groups) {
    if (group.length === 1) {
      combined.push(group[0]);
      keeperById.set(group[0].id, group[0].id);
      continue;
    }
    mergedGroups += 1;
    const [keeper, ...rest] = [...group].sort((a, b) => compareRank(rankOf(a), rankOf(b)) || a.name.length - b.name.length);
    let card = keeper;
    for (const other of rest) {
      card = combineCustomers(card, other);
      removedCustomerIds.push(other.id);
      keeperById.set(other.id, keeper.id);
    }
    keeperById.set(keeper.id, keeper.id);
    combined.push(card);
  }

  const reassigned = appointments.map(appointment => {
    const keeperId = keeperById.get(appointment.customerId) || appointment.customerId;
    return keeperId === appointment.customerId ? appointment : { ...appointment, customerId: keeperId };
  });

  const removedAppointmentIds: string[] = [];
  const appointmentRedirect = new Map<string, string>();
  const bySlot = new Map<string, A>();
  for (const appointment of reassigned) {
    const key = `${appointment.customerId}|${appointment.date}|${String(appointment.time || '').slice(0, 5)}|${appointment.service.trim().toLowerCase()}`;
    const previous = bySlot.get(key);
    if (!previous) {
      bySlot.set(key, appointment);
      continue;
    }
    const previousScore = (previous.quickfileInvoiceId ? 4 : 0) + (previous.notes ? 1 : 0) + (previous.status === 'Cancelled' ? 0 : 2);
    const nextScore = (appointment.quickfileInvoiceId ? 4 : 0) + (appointment.notes ? 1 : 0) + (appointment.status === 'Cancelled' ? 0 : 2);
    const winner = nextScore > previousScore ? appointment : previous;
    const loser = winner === appointment ? previous : appointment;
    if (winner.quickfileInvoiceId && loser.quickfileInvoiceId && winner.quickfileInvoiceId !== loser.quickfileInvoiceId) {
      bySlot.set(`${key}|${appointment.id}`, appointment);
      continue;
    }
    const kept: A = {
      ...winner,
      notes: winner.notes || loser.notes,
      quickfileInvoiceId: winner.quickfileInvoiceId || loser.quickfileInvoiceId,
    };
    bySlot.set(key, kept);
    removedAppointmentIds.push(loser.id);
    appointmentRedirect.set(loser.id, kept.id);
  }

  const keptAppointments = [...bySlot.values()];
  const nextPayments = payments.flatMap(payment => {
    const target = appointmentRedirect.get(payment.appointmentId);
    if (!target) return [payment];
    const keptHasPayment = payments.some(other => other.appointmentId === target && other.id !== payment.id && other.paidAt);
    if (keptHasPayment) return [];
    return [{ ...payment, appointmentId: target }];
  });

  return {
    customers: combined,
    appointments: keptAppointments,
    payments: nextPayments,
    removedCustomerIds,
    removedAppointmentIds,
    appointmentRedirect,
    mergedGroups,
    removedCustomers: removedCustomerIds.length,
  };
}

/** Which existing card a Setmore row belongs to. -1 means this is a new customer. */
export function matchCustomerIndex(list: MergeCustomer[], candidate: MergeCustomer): number {
  const score = (customer: MergeCustomer) =>
    (nameRelation(customer.name, candidate.name) === 'exact' ? 4 : 0)
    + (phonesAgree(customer, candidate) ? 2 : 0)
    + (postcodesAgree(customer, candidate) ? 1 : 0);
  const matches = list
    .map((customer, index) => ({ customer, index }))
    .filter(item => sameCustomer(item.customer, candidate));
  if (matches.length) {
    matches.sort((a, b) => score(b.customer) - score(a.customer));
    return matches[0].index;
  }
  const byPhone = list
    .map((customer, index) => ({ customer, index }))
    .filter(item => phonesAgree(item.customer, candidate));
  if (byPhone.length === 1) return byPhone[0].index;
  return -1;
}
