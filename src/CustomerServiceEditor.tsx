import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

export type CustomerServiceLine = {
  service: string;
  price: number;
  duration: number;
};

type CatalogService = { name: string; duration: number; price: number };

type Props = {
  catalog: CatalogService[];
  initialLines?: CustomerServiceLine[];
  defaultServiceName?: string;
};

function emptyLine(catalog: CatalogService[], preferred?: string): CustomerServiceLine {
  const pick = catalog.find(s => s.name === preferred) || catalog[0];
  return {
    service: pick?.name || '',
    price: 0,
    duration: pick?.duration || 30,
  };
}

export default function CustomerServiceEditor({ catalog, initialLines = [], defaultServiceName }: Props) {
  const seed = useMemo(() => {
    if (initialLines.length) return initialLines.map(line => ({ ...line }));
    return [emptyLine(catalog, defaultServiceName)];
  }, [catalog, initialLines, defaultServiceName]);

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

  function addLine() {
    const used = new Set(lines.map(l => l.service).filter(Boolean));
    const next = catalog.find(s => !used.has(s.name)) || catalog[0];
    if (!next) return;
    setLines(prev => [...prev, emptyLine(catalog, next.name)]);
  }

  function removeLine(index: number) {
    setLines(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const usedNames = new Set(lines.map(l => l.service).filter(Boolean));
  const canAdd = catalog.some(s => !usedNames.has(s.name));

  return (
    <div className="customer-service-editor">
      <input type="hidden" name="serviceLines" value={JSON.stringify(lines)} />
      <div className="customer-service-editor-head">
        <div>
          <strong>Services</strong>
          <p>Add one or more services for this customer, each with its own duration and price.</p>
        </div>
        <button type="button" className="button secondary tiny" onClick={addLine} disabled={!canAdd}>
          <Plus size={14} /> Add service
        </button>
      </div>

      <div className="customer-service-lines">
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
              {lines.length > 1 && (
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
