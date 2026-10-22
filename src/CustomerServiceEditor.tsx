import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

export const SERVICE_CYCLE_WEEKS = [4, 6, 8, 10, 12] as const;

export type CustomerServiceLine = {
  service: string;
  price: number;
  duration: number;
  frequency: number;
  oneOff?: boolean;
};

type CatalogService = { name: string; duration: number; price: number };

type Props = {
  catalog: CatalogService[];
  initialLines?: CustomerServiceLine[];
  defaultServiceName?: string;
  defaultFrequency?: number;
  /** When true, the last service can be removed (customer becomes Unassigned; history stays). */
  allowEmpty?: boolean;
};

export function normalizeServiceLine(
  line: Partial<CustomerServiceLine> & Pick<CustomerServiceLine, 'service'>,
  fallbacks?: { price?: number; duration?: number; frequency?: number; oneOff?: boolean },
): CustomerServiceLine {
  const frequencyRaw = Number(line.frequency);
  const frequency = SERVICE_CYCLE_WEEKS.includes(frequencyRaw as typeof SERVICE_CYCLE_WEEKS[number])
    ? frequencyRaw
    : (SERVICE_CYCLE_WEEKS.includes(Number(fallbacks?.frequency) as typeof SERVICE_CYCLE_WEEKS[number])
      ? Number(fallbacks?.frequency)
      : 6);
  return {
    service: String(line.service || '').trim(),
    price: Number.isFinite(Number(line.price)) ? Number(line.price) : (fallbacks?.price ?? 0),
    duration: Number.isFinite(Number(line.duration)) && Number(line.duration) > 0
      ? Number(line.duration)
      : (fallbacks?.duration ?? 30),
    frequency,
    oneOff: Boolean(line.oneOff ?? fallbacks?.oneOff),
  };
}

export function serviceCycleLabel(line: Pick<CustomerServiceLine, 'frequency' | 'oneOff'> | null | undefined, fallbackFrequency = 6) {
  if (!line) return `Every ${fallbackFrequency} weeks`;
  if (line.oneOff) return 'One-off';
  return `Every ${line.frequency || fallbackFrequency} weeks`;
}

function emptyLine(catalog: CatalogService[], preferred?: string, asOneOff = false): CustomerServiceLine {
  const pick = catalog.find(s => s.name === preferred) || catalog[0];
  return {
    service: pick?.name || '',
    price: 0,
    duration: pick?.duration || 30,
    frequency: 6,
    oneOff: asOneOff,
  };
}

function cycleValue(line: CustomerServiceLine) {
  return line.oneOff ? 'oneoff' : String(line.frequency || 6);
}

export default function CustomerServiceEditor({
  catalog,
  initialLines = [],
  defaultServiceName,
  defaultFrequency = 6,
  allowEmpty = false,
}: Props) {
  const seed = useMemo(() => {
    if (initialLines.length) {
      return initialLines.map(line => normalizeServiceLine(line, { frequency: defaultFrequency }));
    }
    if (allowEmpty) return [];
    return [emptyLine(catalog, defaultServiceName, false)];
  }, [catalog, initialLines, defaultServiceName, defaultFrequency, allowEmpty]);

  const [lines, setLines] = useState<CustomerServiceLine[]>(seed);

  function updateLine(index: number, patch: Partial<CustomerServiceLine>) {
    setLines(prev => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function changeService(index: number, serviceName: string) {
    const catalogItem = catalog.find(s => s.name === serviceName);
    updateLine(index, {
      service: serviceName,
      duration: catalogItem?.duration || 30,
    });
  }

  function changeCycle(index: number, value: string) {
    if (value === 'oneoff') {
      updateLine(index, { oneOff: true });
      return;
    }
    const frequency = Number(value);
    updateLine(index, {
      oneOff: false,
      frequency: SERVICE_CYCLE_WEEKS.includes(frequency as typeof SERVICE_CYCLE_WEEKS[number]) ? frequency : 6,
    });
  }

  function addLine() {
    const used = new Set(lines.map(l => l.service).filter(Boolean));
    const next = catalog.find(s => !used.has(s.name)) || catalog[0];
    if (!next) return;
    // Extra services default to one-off; main/first line stays recurring.
    setLines(prev => [...prev, emptyLine(catalog, next.name, true)]);
  }

  function removeLine(index: number) {
    setLines(prev => {
      if (prev.length <= 1 && !allowEmpty) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }

  const usedNames = new Set(lines.map(l => l.service).filter(Boolean));
  const canAdd = catalog.some(s => !usedNames.has(s.name));

  return (
    <div className="customer-service-editor">
      <input type="hidden" name="serviceLines" value={JSON.stringify(lines)} />
      <div className="customer-service-editor-head">
        <div>
          <strong>Services</strong>
          <p>Each service can have its own duration, price and cleaning cycle (regular or one-off).</p>
        </div>
        <button type="button" className="button secondary tiny" onClick={addLine} disabled={!canAdd}>
          <Plus size={14} /> Add service
        </button>
      </div>

      <div className="customer-service-lines">
        {lines.length===0&&allowEmpty&&(
          <div className="customer-service-empty">
            No assigned services — this customer is Unassigned. Visit history is kept.
          </div>
        )}
        {lines.map((line, index) => {
          const options = catalog.filter(s => s.name === line.service || !usedNames.has(s.name));
          return (
            <div className="customer-service-line" key={`${line.service}-${index}`}>
              <label>
                Service
                <select
                  value={line.service}
                  onChange={e => changeService(index, e.target.value)}
                  required
                >
                  {!line.service && <option value="">Select a service</option>}
                  {options.map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label>
                  Duration (minutes)
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={line.duration || ''}
                    onChange={e => updateLine(index, { duration: Number(e.target.value) || 0 })}
                    required
                  />
                </label>
                <label>
                  Job price (£)
                  <input
                    className="price-input"
                    type="number"
                    min={0}
                    step={0.01}
                    inputMode="decimal"
                    value={line.price > 0 ? line.price : ''}
                    placeholder="Enter price"
                    onChange={e => updateLine(index, { price: e.target.value === '' ? 0 : Number(e.target.value) })}
                    required
                  />
                </label>
              </div>
              <label>
                Cleaning cycle
                <select value={cycleValue(line)} onChange={e => changeCycle(index, e.target.value)}>
                  <option value="oneoff">One-off / as needed</option>
                  {SERVICE_CYCLE_WEEKS.map(w => (
                    <option key={w} value={w}>Every {w} weeks</option>
                  ))}
                </select>
              </label>
              {(lines.length > 1 || allowEmpty) && (
                <button
                  type="button"
                  className="text-button service-line-remove"
                  onClick={() => removeLine(index)}
                >
                  <Trash2 size={14} /> Remove service
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
