import { useState } from 'react';
import { Check, Pause, Search, Undo2 } from 'lucide-react';

const CYCLES = [4, 6, 8, 10, 12] as const;
export type PlanCycle = 'all' | (typeof CYCLES)[number];
export type PlanSort = 'due' | 'oldest' | 'newest' | 'az' | 'za';

export type SetmorePlanCustomer = {
  id: string;
  name: string;
  place: string;
  cycles: number[];
  cycleLabel: string;
  lastVisit: string | null;
  planned: boolean;
  held: boolean;
};

type Props = {
  customers: SetmorePlanCustomer[];
  cycle: PlanCycle;
  setCycle: (cycle: PlanCycle) => void;
  search: string;
  setSearch: (value: string) => void;
  showPlanned: boolean;
  setShowPlanned: (open: boolean) => void;
  onToggle: (id: string) => void;
  onHold: (id: string) => void;
  onRelease: (id: string) => void;
  onOpen: (id: string) => void;
  dateLabel: (date: string) => string;
};

function isoToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function daysBetween(start: string, end: string) {
  const from = new Date(`${start}T12:00:00`);
  const to = new Date(`${end}T12:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function daysUntilNextCycle(lastVisit: string | null, cycles: number[], today: string) {
  if (!lastVisit || cycles.length === 0) return null;
  const elapsed = daysBetween(lastVisit, today);
  return Math.min(...cycles.map(weeks => weeks * 7 - elapsed));
}

function dueLabel(daysLeft: number) {
  if (daysLeft > 1) return `${daysLeft} days left`;
  if (daysLeft === 1) return '1 day left';
  if (daysLeft === 0) return 'Due today';
  const overdue = -daysLeft;
  return overdue === 1 ? '1 day overdue' : `${overdue} days overdue`;
}

function matches(customer: SetmorePlanCustomer, cycle: PlanCycle, search: string) {
  if (cycle !== 'all' && !customer.cycles.includes(cycle)) return false;
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return `${customer.name} ${customer.place} ${customer.cycleLabel}`.toLowerCase().includes(query);
}

function compareCustomers(a: SetmorePlanCustomer, b: SetmorePlanCustomer, sort: PlanSort) {
  const byName = a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  if (sort === 'az') return byName;
  if (sort === 'za') return -byName;
  if (sort === 'due') {
    const today = isoToday();
    const aDue = daysUntilNextCycle(a.lastVisit, a.cycles, today);
    const bDue = daysUntilNextCycle(b.lastVisit, b.cycles, today);
    if (aDue === null && bDue === null) return byName;
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    if (aDue !== bDue) return aDue - bDue;
    return byName;
  }
  const aDate = a.lastVisit || '';
  const bDate = b.lastVisit || '';
  if (!aDate && !bDate) return byName;
  if (!aDate) return sort === 'oldest' ? -1 : 1;
  if (!bDate) return sort === 'oldest' ? 1 : -1;
  const byDate = aDate.localeCompare(bDate);
  if (byDate !== 0) return sort === 'oldest' ? byDate : -byDate;
  return byName;
}

export default function SetmorePlan(props: Props) {
  const [sort, setSort] = useState<PlanSort>('due');
  const [showHold, setShowHold] = useState(false);
  const today = isoToday();
  const visible = props.customers
    .filter(customer => matches(customer, props.cycle, props.search))
    .sort((a, b) => compareCustomers(a, b, sort));
  const open = visible.filter(customer => !customer.held && !customer.planned);
  const planned = visible.filter(customer => !customer.held && customer.planned);
  const held = visible.filter(customer => customer.held);
  const heldTotal = props.customers.filter(customer => customer.held).length;
  const listed = showHold ? held : open;
  const row = (customer: SetmorePlanCustomer) => {
    const daysLeft = daysUntilNextCycle(customer.lastVisit, customer.cycles, today);
    const due = daysLeft !== null && daysLeft <= 0;
    return (
    <div key={customer.id} className={`plan-row${customer.planned ? ' is-planned' : ''}${due ? ' is-due' : ''}${showHold ? ' is-hold' : ''}`}>
      <button type="button" className="plan-row-open" onClick={() => props.onOpen(customer.id)}>
        <span className="plan-row-copy">
          <strong>{customer.name}</strong>
          <small>{customer.place || 'No address'} · {customer.lastVisit ? `Last ${props.dateLabel(customer.lastVisit)}` : 'No past visit'}</small>
        </span>
        <span className="plan-row-side">
          {daysLeft !== null && <strong>{dueLabel(daysLeft)}</strong>}
          <em>{customer.cycleLabel}</em>
        </span>
      </button>
      {!showHold && (
        <button
          type="button"
          className={`plan-mark${customer.planned ? ' is-planned' : ''}`}
          aria-label={customer.planned ? `Put ${customer.name} back on the list` : `Mark ${customer.name} as planned in Setmore`}
          title={customer.planned ? 'Put back on the list' : 'Mark as planned in Setmore'}
          onClick={() => props.onToggle(customer.id)}
        >
          {customer.planned ? <Undo2 size={16} /> : <Check size={16} />}
        </button>
      )}
      <button
        type="button"
        className="plan-hold"
        aria-label={showHold ? `Put ${customer.name} back on the list` : `Put ${customer.name} on hold`}
        title={showHold ? 'Put back on the list' : 'Put on hold'}
        onClick={() => showHold ? props.onRelease(customer.id) : props.onHold(customer.id)}
      >
        {showHold ? <Undo2 size={16} /> : <Pause size={16} />}
      </button>
    </div>
    );
  };

  return (
    <div className="list-screen">
      <div className="page-heading">
        <div>
          <h1>To Plan</h1>
          <p>{showHold
            ? 'Parked for now, for example during a renovation. They stay out of Past customers. Put them back when you are ready, or load a Setmore report that books their next visit and they return to the schedule.'
            : 'Customers with no upcoming visit. The tick marks them as booked in Setmore. The pause parks them on hold without moving them to Past customers.'}</p>
        </div>
        <div className="heading-actions">
          <button type="button" className={`button secondary${showHold ? ' chosen' : ''}`} aria-pressed={showHold} onClick={() => setShowHold(open => !open)}>
            <Pause size={16} /> On hold{heldTotal ? ` · ${heldTotal}` : ''}
          </button>
        </div>
      </div>
      <div className="panel table-panel">
        <div className="table-controls plan-toolbar">
          <div className="search-field"><Search size={16} /><input value={props.search} onChange={event => props.setSearch(event.target.value)} placeholder="Name or postcode" /></div>
          <label className="plan-sort">
            Sort
            <select aria-label="Sort customers" value={sort} onChange={event => setSort(event.target.value as PlanSort)}>
              <option value="due">Due soonest</option>
              <option value="oldest">Oldest to newest</option>
              <option value="newest">Newest to oldest</option>
              <option value="az">A to Z</option>
              <option value="za">Z to A</option>
            </select>
          </label>
          <div className="plan-cycles" role="group" aria-label="Cycle">
            <button type="button" className={props.cycle === 'all' ? 'chosen' : ''} onClick={() => props.setCycle('all')}>All</button>
            {CYCLES.map(weeks => (
              <button key={weeks} type="button" className={props.cycle === weeks ? 'chosen' : ''} onClick={() => props.setCycle(weeks)}>{weeks} weeks</button>
            ))}
          </div>
          <span className="result-count">{showHold ? `${listed.length} on hold` : `${open.length} to plan`}</span>
        </div>
        <div className="plan-list">
          {listed.length === 0 && <div className="day-panel-empty">{showHold ? (heldTotal ? 'No customers on hold match this cycle or search.' : 'No one is on hold.') : planned.length ? 'Nothing left in this view.' : props.customers.some(customer => !customer.held) ? 'No customers match this cycle or search.' : heldTotal ? 'Everyone waiting is on hold.' : 'Everyone has an upcoming visit.'}</div>}
          {listed.map(row)}
        </div>
        {!showHold && planned.length > 0 && (
          <div className="plan-done">
            <button type="button" className="button tiny secondary" onClick={() => props.setShowPlanned(!props.showPlanned)}>
              {props.showPlanned ? 'Hide' : 'Show'} planned in Setmore · {planned.length}
            </button>
            {props.showPlanned && <div className="plan-list">{planned.map(row)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
