import type { DragEvent, ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, List, MapPin, Plus, Search, Wrench, X } from 'lucide-react';
import UkDateInput from './UkDateInput';

export type ScheduleJob = {
  id: string;
  date: string;
  time: string;
  duration: number;
  service: string;
  price: number;
  address: string;
  notes?: string;
  missingFromSetmore?: boolean;
};

export type WaitingCustomer = {
  id: string;
  name: string;
  place: string;
  lastVisit: string | null;
  price: number;
};

type Mode = 'Day' | 'Week' | 'Month';

type Props = {
  view: 'list' | 'calendar';
  setView: (view: 'list' | 'calendar') => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  today: string;
  planOpen: boolean;
  setPlanOpen: (open: boolean) => void;
  jobs: ScheduleJob[];
  waiting: WaitingCustomer[];
  waitingTotal: number;
  search: string;
  setSearch: (value: string) => void;
  customerName: (job: ScheduleJob) => string;
  outcome: (job: ScheduleJob) => 'todo' | 'done' | 'paid';
  timeRange: (job: ScheduleJob) => string;
  money: (amount: number) => string;
  dateLabel: (date: string) => string;
  onAdd: (customerId?: string) => void;
  onOpenDay: (date: string) => void;
  onOpenJob: (job: ScheduleJob) => void;
  onDragStart: (event: DragEvent, token: string) => void;
  onDragOver: (event: DragEvent) => void;
  onDropDay: (event: DragEvent, date: string) => void;
  onDropJob: (event: DragEvent, jobId: string) => void;
  renderTools: (job: ScheduleJob) => ReactNode;
};

function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return iso(next);
}

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekOf(date: string) {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${date}T12:00:00`);
    day.setDate(day.getDate() - ((day.getDay() + 6) % 7) + index);
    return iso(day);
  });
}

function monthGrid(date: string) {
  const anchor = new Date(`${date}T12:00:00`);
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const end = new Date(last);
  end.setDate(last.getDate() + ((7 - last.getDay()) % 7));
  const days: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) days.push(iso(cursor));
  return days;
}

function weekday(date: string, style: 'long' | 'short' = 'long') {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: style });
}

function monthTitle(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export default function ScheduleBoard(props: Props) {
  const week = weekOf(props.selectedDate);
  const month = monthGrid(props.selectedDate);
  const selectedMonth = new Date(`${props.selectedDate}T12:00:00`).getMonth();
  const jobsOn = (date: string) => props.jobs.filter(job => job.date === date).sort((a, b) => a.time.localeCompare(b.time));
  const step = props.view === 'list' || props.mode === 'Week' ? 7 : props.mode === 'Month' ? 0 : 1;
  const title = props.view === 'list' || props.mode === 'Week'
    ? `${props.dateLabel(week[0])} – ${props.dateLabel(week[6])}`
    : props.mode === 'Month'
      ? monthTitle(props.selectedDate)
      : props.dateLabel(props.selectedDate);

  const move = (direction: -1 | 1) => {
    if (props.view === 'calendar' && props.mode === 'Month') {
      const next = new Date(`${props.selectedDate}T12:00:00`);
      next.setMonth(next.getMonth() + direction, 1);
      props.setSelectedDate(iso(next));
      return;
    }
    props.setSelectedDate(shiftDate(props.selectedDate, step * direction));
  };

  const card = (job: ScheduleJob) => (
    <div
      key={job.id}
      className={`schedule-item schedule-item-clickable board-job outcome-${props.outcome(job)}${job.missingFromSetmore ? ' is-missing' : ''}`}
      draggable
      role="button"
      tabIndex={0}
      onDragStart={event => props.onDragStart(event, `appt:${job.id}`)}
      onDragOver={props.onDragOver}
      onDrop={event => props.onDropJob(event, job.id)}
      onClick={() => props.onOpenJob(job)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onOpenJob(job); } }}
    >
      <div className="time-col"><strong>{props.timeRange(job)}</strong></div>
      <div className="schedule-details">
        <div className="schedule-title-row"><strong>{props.customerName(job)}</strong></div>
        <div className="schedule-meta">
          {job.address ? <span><MapPin size={13} />{job.address}</span> : null}
          <span><Wrench size={13} />{job.service}</span>
        </div>
        {job.notes ? <p className="board-notes">{job.notes}</p> : null}
      </div>
      <div className="schedule-price board-job-side" onClick={event => event.stopPropagation()}>
        <strong className="schedule-amount">{props.money(job.price)}</strong>
        {props.renderTools(job)}
      </div>
    </div>
  );

  const dayBlock = (date: string, emptyText: string) => {
    const dayJobs = jobsOn(date);
    return (
      <section key={date} className={`schedule-day-group${date === props.today ? ' is-today' : ''}`} onDragOver={props.onDragOver} onDrop={event => props.onDropDay(event, date)}>
        <div className="schedule-day-label">
          <strong>{weekday(date)}</strong>
          <span>{props.dateLabel(date)}</span>
          <em>{dayJobs.length} job{dayJobs.length === 1 ? '' : 's'} · {props.money(dayJobs.reduce((sum, job) => sum + job.price, 0))}</em>
        </div>
        {dayJobs.length === 0 ? <div className="schedule-day-empty">{emptyText}</div> : dayJobs.map(card)}
      </section>
    );
  };

  return (
    <>
      <div className="page-heading board-heading">
        <div>
          <h1>Schedule</h1>
          <p>The round for the day, invoices on each job, and customers still waiting for a visit.</p>
        </div>
        <div className="heading-actions board-actions">
          <div className="segmented" role="group" aria-label="Schedule layout">
            <button type="button" className={props.view === 'calendar' ? 'chosen' : ''} onClick={() => props.setView('calendar')}><CalendarDays size={15} /> Calendar</button>
            <button type="button" className={props.view === 'list' ? 'chosen' : ''} onClick={() => props.setView('list')}><List size={15} /> List</button>
          </div>
          {props.view === 'calendar' && (
            <div className="segmented" role="group" aria-label="Calendar range">
              <button type="button" className={props.mode === 'Day' ? 'chosen' : ''} onClick={() => props.setMode('Day')}>Day</button>
              <button type="button" className={props.mode === 'Week' ? 'chosen' : ''} onClick={() => props.setMode('Week')}>Week</button>
              <button type="button" className={props.mode === 'Month' ? 'chosen' : ''} onClick={() => props.setMode('Month')}>Month</button>
            </div>
          )}
          <div className="schedule-date-nav">
            <button type="button" className="icon-button" aria-label="Previous" onClick={() => move(-1)}><ChevronLeft size={16} /></button>
            {props.view === 'calendar' && props.mode === 'Day'
              ? <UkDateInput name="scheduleDate" value={props.selectedDate} onIsoChange={props.setSelectedDate} required />
              : <span className="schedule-week-range">{title}</span>}
            <button type="button" className="icon-button" aria-label="Next" onClick={() => move(1)}><ChevronRight size={16} /></button>
            <button type="button" className="button tiny secondary" onClick={() => props.setSelectedDate(props.today)}>Today</button>
          </div>
          <button type="button" className={`button secondary${props.planOpen ? ' chosen' : ''}`} onClick={() => props.setPlanOpen(!props.planOpen)}>To plan <span className="board-count">{props.waitingTotal}</span></button>
          <button type="button" className="button primary" onClick={() => props.onAdd()}><Plus size={16} /> Appointment</button>
        </div>
      </div>

      <div className={`board-layout${props.planOpen ? ' has-plan' : ''}`}>
        <div className="panel board-main">
          {props.view === 'list' && (
            <div className="schedule-list">
              {week.every(date => jobsOn(date).length === 0)
                ? <div className="day-panel-empty">Nothing this week. Drop a customer on a day, or add an appointment.</div>
                : week.map(date => dayBlock(date, 'No jobs'))}
            </div>
          )}

          {props.view === 'calendar' && props.mode === 'Day' && (
            <div className="schedule-list" onDragOver={props.onDragOver} onDrop={event => props.onDropDay(event, props.selectedDate)}>
              <div className="board-day-title">
                <strong>{weekday(props.selectedDate)} {props.dateLabel(props.selectedDate)}</strong>
                <span>{jobsOn(props.selectedDate).length} job{jobsOn(props.selectedDate).length === 1 ? '' : 's'} · {props.money(jobsOn(props.selectedDate).reduce((sum, job) => sum + job.price, 0))}</span>
              </div>
              {jobsOn(props.selectedDate).length === 0
                ? <div className="day-panel-empty">Nothing scheduled. Drop a customer here, or add an appointment.</div>
                : jobsOn(props.selectedDate).map(card)}
              <button className="add-inline" type="button" onClick={() => props.onAdd()}><Plus size={15} /> Add appointment</button>
            </div>
          )}

          {props.view === 'calendar' && props.mode !== 'Day' && (
            <>
              <div className="calendar-weekday-row">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>
              <div className={`calendar-grid ${props.mode === 'Month' ? 'calendar-grid-month' : 'calendar-grid-week'}`}>
                {(props.mode === 'Month' ? month : week).map(date => {
                  const dayJobs = jobsOn(date);
                  const outside = props.mode === 'Month' && new Date(`${date}T12:00:00`).getMonth() !== selectedMonth;
                  const shown = dayJobs.slice(0, props.mode === 'Month' ? 3 : 5);
                  return (
                    <div
                      key={date}
                      className={`calendar-day ${date === props.today ? 'day-today' : ''} ${date === props.selectedDate ? 'day-selected' : ''} ${outside ? 'day-outside' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => props.onOpenDay(date)}
                      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onOpenDay(date); } }}
                      onDragOver={props.onDragOver}
                      onDrop={event => props.onDropDay(event, date)}
                    >
                      <div className="day-head"><span>{props.mode === 'Week' ? weekday(date, 'short') : ''}</span><strong>{new Date(`${date}T12:00:00`).getDate()}</strong></div>
                      <div className="day-events">
                        {shown.map(job => (
                          <div
                            key={job.id}
                            draggable
                            className={`event-chip outcome-${props.outcome(job)}${job.missingFromSetmore ? ' is-missing' : ''}`}
                            title={job.missingFromSetmore ? 'Not in Setmore' : undefined}
                            onDragStart={event => { event.stopPropagation(); props.onDragStart(event, `appt:${job.id}`); }}
                            onClick={event => { event.stopPropagation(); props.onOpenJob(job); }}
                          >
                            <b>{job.time}</b> {props.customerName(job)}{job.missingFromSetmore ? <span className="chip-missing">Not in Setmore</span> : null}
                          </div>
                        ))}
                        {dayJobs.length > shown.length && <span className="more-events">+{dayJobs.length - shown.length} more</span>}
                        {dayJobs.length === 0 && !outside && <span className="no-event">Open day</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {props.planOpen && (
          <aside className="board-plan">
            <div className="unassigned-rail-head">
              <h3>To plan</h3>
              <button type="button" className="icon-button" aria-label="Close to plan" onClick={() => props.setPlanOpen(false)}><X size={16} /></button>
            </div>
            <p className="queue-hint">No upcoming visit. Use this list when you build the round in Setmore.</p>
            <div className="search-field schedule-search"><Search size={16} /><input value={props.search} onChange={event => props.setSearch(event.target.value)} placeholder="Name or postcode" /></div>
            <div className="queue-list">
              {props.waitingTotal === 0 && <div className="day-panel-empty">Everyone has an upcoming visit.</div>}
              {props.waitingTotal > 0 && props.waiting.length === 0 && <div className="day-panel-empty">No customers match.</div>}
              {props.waiting.map(customer => (
                <div key={customer.id} className="queue-card" draggable onDragStart={event => props.onDragStart(event, `cust:${customer.id}`)}>
                  <div className="queue-card-info">
                    <strong>{customer.name}</strong>
                    <span>{customer.place || 'No address'}{customer.lastVisit ? ` · Last ${props.dateLabel(customer.lastVisit)}` : ' · No past visit'}</span>
                  </div>
                  <button type="button" className="round-plus" title={`Book ${customer.name}`} onClick={() => props.onAdd(customer.id)}><Plus size={15} /></button>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
