import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

/** Convert YYYY-MM-DD -> DD/MM/YYYY */
export function formatUkDate(isoDate: string) {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Convert DD/MM/YYYY (or D/M/YYYY) -> YYYY-MM-DD, or null if invalid */
export function parseUkDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthLabel(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

type Props = {
  name?: string;
  defaultValue?: string;
  value?: string;
  required?: boolean;
  min?: string;
  id?: string;
  onIsoChange?: (isoDate: string) => void;
};

export default function UkDateInput({
  name = 'date',
  defaultValue = '',
  value,
  required = false,
  min,
  id,
  onIsoChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const controlled = value !== undefined;
  const [display, setDisplay] = useState(() => {
    const initial = value ?? defaultValue;
    return initial ? formatUkDate(initial) : '';
  });
  const [isoValue, setIsoValue] = useState(() => value ?? defaultValue ?? '');
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => {
    const seed = value ?? defaultValue;
    if (seed && /^\d{4}-\d{2}-\d{2}$/.test(seed)) return Number(seed.slice(0, 4));
    return new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const seed = value ?? defaultValue;
    if (seed && /^\d{4}-\d{2}-\d{2}$/.test(seed)) return Number(seed.slice(5, 7)) - 1;
    return new Date().getMonth();
  });

  useEffect(() => {
    if (!controlled) return;
    const next = value || '';
    setIsoValue(next);
    setDisplay(next ? formatUkDate(next) : '');
  }, [controlled, value]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function commitIso(nextIso: string, notify = true) {
    setIsoValue(nextIso);
    if (notify && nextIso) onIsoChange?.(nextIso);
  }

  function applyDisplay(raw: string) {
    const digits = raw.replace(/[^\d]/g, '').slice(0, 8);
    let next = digits;
    if (digits.length > 4) next = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) next = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setDisplay(next);

    const parsed = parseUkDate(next);
    if (parsed) {
      if (min && parsed < min) {
        commitIso('', false);
        return;
      }
      commitIso(parsed);
      return;
    }
    commitIso('', false);
  }

  function openPicker() {
    const seed = isoValue || value || defaultValue;
    if (seed && /^\d{4}-\d{2}-\d{2}$/.test(seed)) {
      setViewYear(Number(seed.slice(0, 4)));
      setViewMonth(Number(seed.slice(5, 7)) - 1);
    } else {
      const now = new Date();
      setViewYear(now.getFullYear());
      setViewMonth(now.getMonth());
    }
    setOpen((prev) => !prev);
  }

  function selectDay(next: string) {
    if (min && next < min) return;
    setDisplay(formatUkDate(next));
    commitIso(next);
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  const todayIso = toIso(new Date());
  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const iso = toIso(d);
      return {
        iso,
        day: d.getDate(),
        inMonth: d.getMonth() === viewMonth,
        disabled: Boolean(min && iso < min),
        selected: iso === isoValue,
        isToday: iso === todayIso,
      };
    });
  }, [viewYear, viewMonth, isoValue, min, todayIso]);

  return (
    <div className={`uk-date-field${open ? ' is-open' : ''}`} ref={rootRef}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        value={display}
        onChange={(e) => applyDisplay(e.target.value)}
        onBlur={() => {
          const parsed = parseUkDate(display);
          if (parsed) {
            if (min && parsed < min) {
              commitIso('', false);
              return;
            }
            setDisplay(formatUkDate(parsed));
            commitIso(parsed);
          }
        }}
        required={required}
        pattern="\d{2}/\d{2}/\d{4}"
        title="Use DD/MM/YYYY"
        className="uk-date-input"
      />
      <button
        type="button"
        className="uk-date-picker-btn"
        aria-label="Choose date from calendar"
        aria-expanded={open}
        title="Choose date"
        onClick={openPicker}
      >
        <CalendarDays size={15} />
      </button>
      {open && (
        <div className="uk-date-popover" role="dialog" aria-label="Choose date">
          <div className="uk-date-popover-head">
            <button type="button" className="icon-button" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={16} />
            </button>
            <strong>{monthLabel(viewYear, viewMonth)}</strong>
            <button type="button" className="icon-button" aria-label="Next month" onClick={() => shiftMonth(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="uk-date-weekdays">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="uk-date-grid">
            {cells.map((cell) => (
              <button
                key={cell.iso}
                type="button"
                disabled={cell.disabled}
                className={`uk-date-day${cell.inMonth ? '' : ' is-outside'}${cell.selected ? ' is-selected' : ''}${cell.isToday ? ' is-today' : ''}`}
                onClick={() => selectDay(cell.iso)}
              >
                {cell.day}
              </button>
            ))}
          </div>
        </div>
      )}
      <input type="hidden" name={name} value={isoValue} />
    </div>
  );
}
