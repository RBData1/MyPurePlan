import { Search } from 'lucide-react';

const CYCLES = [4, 6, 8, 10, 12] as const;
export type PlanCycle = 'all' | (typeof CYCLES)[number];

export type SetmorePlanCustomer = {
  id: string;
  name: string;
  place: string;
  cycles: number[];
  cycleLabel: string;
  lastVisit: string | null;
  planned: boolean;
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
  dateLabel: (date: string) => string;
};

function matches(customer: SetmorePlanCustomer, cycle: PlanCycle, search: string) {
  if (cycle !== 'all' && !customer.cycles.includes(cycle)) return false;
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return `${customer.name} ${customer.place} ${customer.cycleLabel}`.toLowerCase().includes(query);
}

export default function SetmorePlan(props: Props) {
  const visible = props.customers.filter(customer => matches(customer, props.cycle, props.search));
  const open = visible.filter(customer => !customer.planned);
  const planned = visible.filter(customer => customer.planned);
  const row = (customer: SetmorePlanCustomer) => (
    <label key={customer.id} className="plan-row">
      <input
        type="checkbox"
        checked={customer.planned}
        onChange={() => props.onToggle(customer.id)}
        aria-label={`Planned in Setmore: ${customer.name}`}
      />
      <span className="plan-row-copy">
        <strong>{customer.name}</strong>
        <small>{customer.place || 'No address'} · {customer.lastVisit ? `Last ${props.dateLabel(customer.lastVisit)}` : 'No past visit'}</small>
      </span>
      <em>{customer.cycleLabel}</em>
    </label>
  );

  return (
    <div className="list-screen">
      <div className="page-heading">
        <div>
          <h1>Setmore</h1>
          <p>Customers with no upcoming visit. Tick each one after you book them in Setmore. The next Setmore import rebuilds this list.</p>
        </div>
      </div>
      <div className="panel table-panel">
        <div className="table-controls plan-toolbar">
          <div className="search-field"><Search size={16} /><input value={props.search} onChange={event => props.setSearch(event.target.value)} placeholder="Name or postcode" /></div>
          <div className="plan-cycles" role="group" aria-label="Cycle">
            <button type="button" className={props.cycle === 'all' ? 'chosen' : ''} onClick={() => props.setCycle('all')}>All</button>
            {CYCLES.map(weeks => (
              <button key={weeks} type="button" className={props.cycle === weeks ? 'chosen' : ''} onClick={() => props.setCycle(weeks)}>{weeks} weeks</button>
            ))}
          </div>
          <span className="result-count">{open.length} to plan</span>
        </div>
        <div className="plan-list">
          {open.length === 0 && <div className="day-panel-empty">{planned.length ? 'Nothing left in this view.' : props.customers.length ? 'No customers match this cycle or search.' : 'Everyone has an upcoming visit.'}</div>}
          {open.map(row)}
        </div>
        {planned.length > 0 && (
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
