import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Check, Copy, History, Printer, Settings, Trash2, X } from 'lucide-react';
import {
  ADDONS_CATALOG,
  DEFAULT_PRICING,
  HISTORY_STORAGE_KEY,
  PRICING_STORAGE_KEY,
  buildClientMessage,
  computeLiveQuotes,
  emptyPanels,
  extractUkPostcode,
  multiplierFromPercent,
  panelTotal,
  panelUnits,
  percentFromMultiplier,
  type AiWindowReport,
  type PanelCounts,
  type PriceAdjustment,
  type PriceRevision,
  type PricingSettings,
  type QuoteHistoryEntry,
  type QuoteMethod,
  type QuoteMode,
  type QuotePlan,
  type QuoteSave,
  type StoredQuote,
} from './windowQuote';

type QuoteImage = { id: string; name: string; dataUrl: string; base64: string; mimeType: string };

type Props = {
  businessName?: string;
  businessPhone?: string;
  quotes?: StoredQuote[];
  revisions?: PriceRevision[];
  onSave: (quote: QuoteSave) => void;
  onRemember?: (quote: StoredQuote) => void;
  onForget?: (id: string) => void;
  onRevise?: (revision: PriceRevision) => void;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? { ...fallback, ...JSON.parse(saved) } : fallback;
  } catch {
    return fallback;
  }
}

function imageToPngBase64(srcUrl: string) {
  return new Promise<Pick<QuoteImage, 'dataUrl' | 'base64' | 'mimeType'>>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 1280;
      let w = img.width || 800;
      let h = img.height || 520;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not read that photo.'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/png', 0.9);
      resolve({ dataUrl, base64: dataUrl.split(',')[1] || '', mimeType: 'image/png' });
    };
    img.onerror = () => reject(new Error('Could not read that photo.'));
    img.src = srcUrl;
  });
}

function money(value: number) {
  return `£${value}`;
}

function moneyExact(value: number) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function DraftNumber({ label, value, onCommit }: { label: string; value: number; onCommit: (next: number) => void }) {
  const [text, setText] = useState(() => String(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);
  return (
    <label>{label}
      <input
        inputMode="decimal"
        value={text}
        onFocus={() => { editing.current = true; }}
        onChange={event => {
          const next = event.target.value.replace(',', '.');
          if (!(next === '' || /^\d*\.?\d*$/.test(next))) return;
          setText(next);
          if (next === '' || next === '.' || next.endsWith('.')) return;
          const parsed = Number(next);
          if (Number.isFinite(parsed)) onCommit(parsed);
        }}
        onBlur={event => {
          editing.current = false;
          const raw = event.currentTarget.value.replace(',', '.');
          const parsed = Number(raw);
          const next = raw.trim() === '' || !Number.isFinite(parsed) || parsed < 0 ? 0 : parsed;
          onCommit(next);
          setText(String(next));
        }}
      />
    </label>
  );
}

type AreaGuide = { single: number; double: number; triple: number };

function areaGuideFromMultiplier(wfpRate: number, multiplier: number): AreaGuide {
  const mult = Math.max(0.85, Math.min(1.8, Number(multiplier) || 1));
  const unit = Number((Math.max(0, wfpRate) * mult).toFixed(2));
  return { single: unit, double: Number((unit * 2).toFixed(2)), triple: Number((unit * 3).toFixed(2)) };
}

function firstCleanPercent(multiplier: number) {
  return percentFromMultiplier(multiplier, 75);
}

function eightWeekPercent(multiplier: number) {
  return percentFromMultiplier(multiplier, 25);
}

function WindowMark({ panes }: { panes: 1 | 2 | 3 }) {
  const cols = panes === 1 ? [8, 56] : panes === 2 ? [8, 26, 38, 26] : [6, 18, 27, 18, 48, 18];
  return (
    <svg className="quote-window-icon" viewBox="0 0 72 56" aria-hidden="true">
      <rect x="2" y="2" width="68" height="52" rx="4" />
      {Array.from({ length: panes }, (_, index) => (
        <rect key={index} x={cols[index * 2]} y="8" width={cols[index * 2 + 1]} height="40" rx="1" />
      ))}
    </svg>
  );
}

export default function WindowQuoteEstimator({ businessName, businessPhone, quotes: savedQuotes = [], revisions = [], onSave, onRemember, onForget, onRevise }: Props) {
  const [pricingSettings, setPricingSettings] = useState<PricingSettings>(() => {
    const saved = readJson(PRICING_STORAGE_KEY, {
      ...DEFAULT_PRICING,
      companyName: businessName || DEFAULT_PRICING.companyName,
      companyPhone: businessPhone || DEFAULT_PRICING.companyPhone,
    });
    const starter = (saved.singlePanelPrice === 8 || saved.singlePanelPrice === 7.95) && saved.doublePanelPrice === 14 && saved.triplePanelPrice === 20;
    return starter ? { ...saved, singlePanelPrice: 1, doublePanelPrice: 2, triplePanelPrice: 3 } : { ...DEFAULT_PRICING, ...saved, singlePanelPrice: saved.singlePanelPrice ?? 1, doublePanelPrice: saved.doublePanelPrice ?? 2, triplePanelPrice: saved.triplePanelPrice ?? 3 };
  });
  const [historyList, setHistoryList] = useState<QuoteHistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      return saved ? JSON.parse(saved) as QuoteHistoryEntry[] : [];
    } catch {
      return [];
    }
  });
  const [pricingOpen, setPricingOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [images, setImages] = useState<QuoteImage[]>([]);
  const [address, setAddress] = useState('');
  const [addressReady, setAddressReady] = useState(false);
  const [areaGuide, setAreaGuide] = useState<AreaGuide | null>(null);
  const [areaPending, setAreaPending] = useState(false);
  const [method, setMethod] = useState<QuoteMethod>('wfp');
  const [commentText, setCommentText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [aiReport, setAiReport] = useState<AiWindowReport | null>(null);
  const [liveWindowCount, setLiveWindowCount] = useState(22);
  const [liveUnitRate, setLiveUnitRate] = useState(DEFAULT_PRICING.wfpRatePerUnit);
  const [selectedPlan, setSelectedPlan] = useState<QuotePlan>('4weeks');
  const [activeAddons, setActiveAddons] = useState<string[]>([]);
  const [adjustments, setAdjustments] = useState<PriceAdjustment[]>([]);
  const [customAdjLabel, setCustomAdjLabel] = useState('');
  const [customAdjAmount, setCustomAdjAmount] = useState('');
  const [customAdjType, setCustomAdjType] = useState<'surcharge' | 'discount'>('surcharge');
  const [msgTab, setMsgTab] = useState<'whatsapp_en' | 'email_en' | 'summary_pl'>('whatsapp_en');
  const [clientName, setClientName] = useState('');
  const [copied, setCopied] = useState(false);
  const [quoteMode, setQuoteMode] = useState<QuoteMode>('manual');
  const [panels, setPanels] = useState<PanelCounts>(emptyPanels);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyTab, setHistoryTab] = useState<'all' | 'prospect'>('all');
  const [prospectNotes, setProspectNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const appliedRevision = useRef(false);
  const areaCache = useRef(new Map<string, AreaGuide>());

  useEffect(() => {
    const latest = revisions[0];
    if (!latest || appliedRevision.current) return;
    appliedRevision.current = true;
    setPricingSettings(prev => ({
      ...prev,
      singlePanelPrice: latest.singlePrice,
      doublePanelPrice: latest.doublePrice,
      triplePanelPrice: latest.triplePrice,
      wfpRatePerUnit: latest.wfpRate || prev.wfpRatePerUnit,
      tradRatePerUnit: latest.tradRate || prev.tradRatePerUnit,
      minVisitPrice: latest.minVisit || prev.minVisitPrice,
      firstCleanMultiplier: multiplierFromPercent(latest.firstCleanPercent),
      eightWeekMultiplier: multiplierFromPercent(latest.eightWeekPercent),
    }));
  }, [revisions]);

  useEffect(() => {
    if (quoteMode !== 'manual') return;
    const query = address.trim();
    const postcode = extractUkPostcode(query);
    const key = postcode ? postcode.toUpperCase().replace(/\s+/g, '') : (addressReady && query.length >= 4 ? query.toLowerCase() : '');
    if (!key) {
      setAreaGuide(null);
      setAreaPending(false);
      return;
    }
    const cached = areaCache.current.get(key);
    if (cached) {
      setAreaGuide(cached);
      setAreaPending(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setAreaPending(true);
      void (async () => {
        try {
          const response = await fetch('/api/estimate-windows', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: query, areaOnly: true }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || 'Area guide unavailable');
          const guide = areaGuideFromMultiplier(pricingSettings.wfpRatePerUnit, payload.quote?.locationMultiplier);
          areaCache.current.set(key, guide);
          setAreaGuide(guide);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return;
          setAreaGuide(null);
        } finally {
          if (!controller.signal.aborted) setAreaPending(false);
        }
      })();
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address, addressReady, quoteMode, pricingSettings.wfpRatePerUnit]);

  useEffect(() => {
    try { localStorage.setItem(PRICING_STORAGE_KEY, JSON.stringify(pricingSettings)); } catch { /* quota */ }
  }, [pricingSettings]);

  const manualBase = panelTotal(panels, pricingSettings);
  const activeWindowCount = quoteMode === 'manual' ? panelUnits(panels) : liveWindowCount;
  const quotes = computeLiveQuotes({
    windowCount: activeWindowCount,
    unitRate: liveUnitRate,
    pricing: pricingSettings,
    activeAddons,
    adjustments,
    selectedPlan,
    baseOverride: quoteMode === 'manual' ? manualBase : undefined,
  });

  function switchMethod(next: QuoteMethod) {
    setMethod(next);
    const mult = aiReport?.locationMultiplier || 1;
    const base = next === 'wfp' ? pricingSettings.wfpRatePerUnit : pricingSettings.tradRatePerUnit;
    setLiveUnitRate(Number((base * mult).toFixed(2)));
  }

  function pushHistory(entry: QuoteHistoryEntry) {
    setHistoryList(prev => {
      const updated = [entry, ...prev].slice(0, 20);
      try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated)); } catch { /* quota */ }
      return updated;
    });
  }

  function deleteHistoryItem(id: string) {
    setHistoryList(prev => {
      const updated = prev.filter(item => item.id !== id);
      try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated)); } catch { /* quota */ }
      return updated;
    });
  }

  async function handleFiles(fileList: FileList | File[]) {
    setErrorMsg('');
    const files = Array.from(fileList).filter(file => file.type.startsWith('image/'));
    if (!files.length) {
      setErrorMsg('Choose a photo (JPG, PNG, or WebP).');
      return;
    }
    try {
      const processed = await Promise.all(files.slice(0, 6).map(file => new Promise<QuoteImage>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const png = await imageToPngBase64(String(reader.result || ''));
            resolve({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, ...png });
          } catch (error) { reject(error); }
        };
        reader.onerror = () => reject(new Error('Could not read that photo.'));
        reader.readAsDataURL(file);
      })));
      setImages(prev => [...prev, ...processed].slice(0, 6));
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not process the photos.');
    }
  }

  async function runEstimate() {
    if (!images.length && !address.trim()) {
      setErrorMsg('Add a photo or a UK address / postcode before running the estimate.');
      return;
    }
    setAnalyzing(true);
    setErrorMsg('');
    try {
      const response = await fetch('/api/estimate-windows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: images.map(image => ({ mimeType: image.mimeType, base64: image.base64 })),
          address: address.trim(),
          method,
          comment: commentText.trim(),
          pricing: {
            wfpRatePerUnit: pricingSettings.wfpRatePerUnit,
            tradRatePerUnit: pricingSettings.tradRatePerUnit,
            minVisitPrice: pricingSettings.minVisitPrice,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'The estimate could not be completed.');
      const parsed = payload.quote as AiWindowReport;
      const mult = Math.max(0.85, Math.min(1.8, Number(parsed.locationMultiplier) || 1.15));
      const baseRate = method === 'wfp' ? pricingSettings.wfpRatePerUnit : pricingSettings.tradRatePerUnit;
      const calculatedRate = Number((baseRate * mult).toFixed(2));
      const winCount = Math.max(1, Number(parsed.totalWindows) || 18);
      const normalized: PriceAdjustment[] = (parsed.adjustments || []).map((item, index) => ({
        id: `ai-${Date.now()}-${index}`,
        label: item.label,
        amount: Math.abs(Number(item.amount) || 0),
        type: item.type === 'discount' ? 'discount' : 'surcharge',
        reason: item.reason || '',
      }));
      const report = { ...parsed, locationMultiplier: mult, totalWindows: winCount };
      setAiReport(report);
      setLiveWindowCount(winCount);
      setLiveUnitRate(calculatedRate);
      setAdjustments(normalized);
      setActiveAddons([]);
      setSelectedPlan('4weeks');
      const priced = computeLiveQuotes({
        windowCount: winCount,
        unitRate: calculatedRate,
        pricing: pricingSettings,
        activeAddons: [],
        adjustments: normalized,
        selectedPlan: '4weeks',
      });
      pushHistory({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        address: address.trim() || parsed.propertyType,
        method,
        commentText: commentText.trim(),
        thumbnail: images[0]?.dataUrl || null,
        report,
        windowCount: winCount,
        unitRate: calculatedRate,
        adjustments: normalized,
        activeAddons: [],
      });
      onRemember?.({
        id: crypto.randomUUID(),
        customerId: null,
        clientName: clientName.trim(),
        address: address.trim(),
        postcode: extractUkPostcode(address),
        mode: 'ai',
        outcome: 'quoted',
        method,
        plan: '4weeks',
        windowCount: winCount,
        panels: emptyPanels(),
        panelPrices: { single: pricingSettings.singlePanelPrice, double: pricingSettings.doublePanelPrice, triple: pricingSettings.triplePanelPrice },
        unitRate: calculatedRate,
        firstCleanPercent: firstCleanPercent(pricingSettings.firstCleanMultiplier),
        eightWeekPercent: eightWeekPercent(pricingSettings.eightWeekMultiplier),
        price: priced.final4Weeks,
        price4: priced.final4Weeks,
        price8: priced.final8Weeks,
        priceFirst: priced.finalOneOff,
        addons: [],
        adjustments: normalized,
        comment: commentText.trim(),
        notes: prospectNotes.trim(),
        propertyType: report.propertyType || '',
        createdAt: new Date().toISOString(),
      });
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'The estimate could not be completed.');
    } finally {
      setAnalyzing(false);
    }
  }

  function restoreHistory(item: QuoteHistoryEntry) {
    setAddress(item.address);
    setMethod(item.method);
    setCommentText(item.commentText || '');
    setAiReport(item.report);
    setLiveWindowCount(item.windowCount);
    setLiveUnitRate(item.unitRate);
    setAdjustments(item.adjustments || []);
    setActiveAddons(item.activeAddons || []);
    setHistoryOpen(false);
  }

  function addCustomAdjustment(event: FormEvent) {
    event.preventDefault();
    const val = parseFloat(customAdjAmount);
    if (!customAdjLabel.trim() || Number.isNaN(val) || val <= 0) return;
    setAdjustments(prev => [...prev, {
      id: `manual-${Date.now()}`,
      label: customAdjLabel.trim(),
      amount: Math.round(val * 100) / 100,
      type: customAdjType,
      reason: 'Added in the calculator',
    }]);
    setCustomAdjLabel('');
    setCustomAdjAmount('');
  }

  const message = buildClientMessage({
    tab: msgTab,
    clientName,
    address,
    method,
    windowCount: activeWindowCount,
    pricing: pricingSettings,
    quotes,
    adjustments,
  });

  function copyMessage() {
    void navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  function currentRecord(outcome: StoredQuote['outcome'], notes = prospectNotes.trim()): StoredQuote {
    return {
      id: crypto.randomUUID(),
      customerId: null,
      clientName: clientName.trim(),
      address: address.trim(),
      postcode: extractUkPostcode(address),
      mode: quoteMode,
      outcome,
      method,
      plan: selectedPlan,
      windowCount: activeWindowCount,
      panels: quoteMode === 'manual' ? panels : emptyPanels(),
      panelPrices: {
        single: pricingSettings.singlePanelPrice,
        double: pricingSettings.doublePanelPrice,
        triple: pricingSettings.triplePanelPrice,
      },
      unitRate: liveUnitRate,
      firstCleanPercent: firstCleanPercent(pricingSettings.firstCleanMultiplier),
      eightWeekPercent: eightWeekPercent(pricingSettings.eightWeekMultiplier),
      price: quotes.activePlanPrice,
      price4: quotes.final4Weeks,
      price8: quotes.final8Weeks,
      priceFirst: quotes.finalOneOff,
      addons: ADDONS_CATALOG.filter(addon => activeAddons.includes(addon.id)).map(addon => addon.tagEn),
      adjustments,
      comment: commentText.trim(),
      notes,
      propertyType: aiReport?.propertyType || '',
      createdAt: new Date().toISOString(),
    };
  }

  function saveQuote() {
    const record = currentRecord('customer');
    onSave({
      clientName,
      address,
      method,
      windowCount: activeWindowCount,
      plan: selectedPlan,
      price: quotes.activePlanPrice,
      duration: Math.min(180, Math.max(30, activeWindowCount * 3)),
      addons: record.addons,
      adjustments,
      comment: commentText,
      propertyType: aiReport?.propertyType || '',
      record,
    });
  }

  function setPanel(key: keyof PanelCounts, value: number) {
    setPanels(prev => ({ ...prev, [key]: Math.max(0, Math.round(Number(value) || 0)) }));
  }

  const latestRevision = revisions[0];
  const pricesDirty = !latestRevision
    || latestRevision.singlePrice !== pricingSettings.singlePanelPrice
    || latestRevision.doublePrice !== pricingSettings.doublePanelPrice
    || latestRevision.triplePrice !== pricingSettings.triplePanelPrice
    || latestRevision.wfpRate !== pricingSettings.wfpRatePerUnit
    || latestRevision.tradRate !== pricingSettings.tradRatePerUnit
    || latestRevision.minVisit !== pricingSettings.minVisitPrice
    || latestRevision.firstCleanPercent !== firstCleanPercent(pricingSettings.firstCleanMultiplier)
    || latestRevision.eightWeekPercent !== eightWeekPercent(pricingSettings.eightWeekMultiplier);
  const historyQueryText = historyQuery.trim().toLowerCase();
  const visibleQuotes = savedQuotes.filter(item => {
    if (historyTab === 'prospect' && item.outcome !== 'prospect') return false;
    if (!historyQueryText) return true;
    return [item.clientName, item.address, item.postcode].join(' ').toLowerCase().includes(historyQueryText);
  });

  return (
    <div className="quote-screen">
      <div className="page-heading">
        <h1>Window quote</h1>
        <div className="heading-actions quote-tools">
          <div className="segmented quote-mode" role="group" aria-label="Quote mode">
            <button type="button" className={quoteMode === 'ai' ? 'chosen' : ''} onClick={() => setQuoteMode('ai')}>AI</button>
            <button type="button" className={quoteMode === 'manual' ? 'chosen' : ''} onClick={() => setQuoteMode('manual')}>Manual</button>
          </div>
          <button type="button" className="button secondary" onClick={() => setPricingOpen(true)}><Settings size={16} /> Price list</button>
          <button type="button" className="button secondary" onClick={() => setHistoryOpen(true)}><History size={16} /> History{savedQuotes.length ? ` · ${savedQuotes.length}` : ''}</button>
        </div>
      </div>
      <section className="panel quote-card quote-one" ref={resultsRef}>
        {quoteMode === 'manual' ? (
          <div className="quote-panels">
            {([
              ['single', 'Single', 1, pricingSettings.singlePanelPrice],
              ['double', 'Double', 2, pricingSettings.doublePanelPrice],
              ['triple', 'Triple', 3, pricingSettings.triplePanelPrice],
            ] as const).map(([key, label, panes, unit]) => (
              <div className="quote-panel-row" key={key}>
                <WindowMark panes={panes} />
                <div>
                  <strong>{label}</strong>
                  <span className="quote-panel-prices"><em>{moneyExact(unit)} each</em><b>{moneyExact(panels[key] * unit)}</b></span>
                  {areaGuide && <small className="quote-area-hint">Suggested {moneyExact(areaGuide[key])}</small>}
                </div>
                <div className="quote-stepper">
                  <button type="button" aria-label={`Fewer ${label}`} onClick={() => setPanel(key, panels[key] - 1)}>−</button>
                  <input inputMode="numeric" aria-label={`${label} quantity`} value={panels[key]} onChange={event => setPanel(key, Number(event.target.value))} />
                  <button type="button" aria-label={`More ${label}`} onClick={() => setPanel(key, panels[key] + 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="quote-block">
            <div
              className={`quote-drop${dragging ? ' is-over' : ''}`}
              onDragOver={event => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files) void handleFiles(event.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click(); }}
            >
              Add photos · {images.length}/6
              <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={event => { if (event.target.files) void handleFiles(event.target.files); event.target.value = ''; }} />
            </div>
            <div className="quote-photo-actions">
              <button type="button" className="button secondary" onClick={() => cameraInputRef.current?.click()}><Camera size={16} /> Take photo</button>
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={event => { if (event.target.files) void handleFiles(event.target.files); event.target.value = ''; }} />
            </div>
            {images.length > 0 && (
              <div className="quote-thumbs">
                {images.map(image => (
                  <figure key={image.id}>
                    <img src={image.dataUrl} alt="" />
                    <button type="button" aria-label={`Remove ${image.name}`} onClick={() => setImages(prev => prev.filter(item => item.id !== image.id))}><X size={14} /></button>
                  </figure>
                ))}
              </div>
            )}
            {aiReport && <p className="quote-panel-total">{aiReport.propertyType} · {liveWindowCount} windows · {money(quotes.base4Weeks)}</p>}
          </div>
        )}
        <div className="quote-inline">
          <div className="quote-address">
            <label>Address or postcode<input value={address} onChange={event => { setAddress(event.target.value); setAddressReady(false); }} onBlur={() => setAddressReady(true)} /></label>
            {quoteMode === 'manual' && (areaPending || areaGuide) && (
              <p className="quote-area-guide">{areaPending && !areaGuide ? 'Checking this area…' : `Suggested here · 1 panel ${moneyExact(areaGuide?.single || 0)} · 2 panels ${moneyExact(areaGuide?.double || 0)} · 3 panels ${moneyExact(areaGuide?.triple || 0)}`}</p>
            )}
            {quoteMode === 'ai' && <button type="button" className="button primary quote-estimate" disabled={analyzing} onClick={() => void runEstimate()}>{analyzing ? 'Estimating…' : 'Estimate'}</button>}
          </div>
          <label>Customer name<input value={clientName} onChange={event => setClientName(event.target.value)} placeholder="Optional" /></label>
        </div>
        {errorMsg && <p className="quote-error">{errorMsg}</p>}
        <div className="quote-plans" role="group" aria-label="Price plan">
          <div className={`quote-plan${selectedPlan === 'oneoff' ? ' chosen' : ''}`}>
            <button type="button" onClick={() => setSelectedPlan('oneoff')}>
              <span>First clean</span><strong>{money(quotes.finalOneOff)}</strong>
            </button>
            <label className="quote-percent">+<input type="number" min={0} step={5} aria-label="First clean percent" value={firstCleanPercent(pricingSettings.firstCleanMultiplier)} onChange={event => { setSelectedPlan('oneoff'); setPricingSettings(prev => ({ ...prev, firstCleanMultiplier: multiplierFromPercent(Number(event.target.value)) })); }} />%</label>
          </div>
          <button type="button" className={selectedPlan === '4weeks' ? 'chosen' : ''} onClick={() => setSelectedPlan('4weeks')}>
            <span>Every 4 weeks</span><strong>{money(quotes.final4Weeks)}</strong><em>Regular</em>
          </button>
          <div className={`quote-plan${selectedPlan === '8weeks' ? ' chosen' : ''}`}>
            <button type="button" onClick={() => setSelectedPlan('8weeks')}>
              <span>Every 8 weeks</span><strong>{money(quotes.final8Weeks)}</strong>
            </button>
            <label className="quote-percent">+<input type="number" min={0} step={5} aria-label="Eight week percent" value={eightWeekPercent(pricingSettings.eightWeekMultiplier)} onChange={event => { setSelectedPlan('8weeks'); setPricingSettings(prev => ({ ...prev, eightWeekMultiplier: multiplierFromPercent(Number(event.target.value)) })); }} />%</label>
          </div>
        </div>
        <label className="quote-field">Notes
          <textarea value={prospectNotes} onChange={event => setProspectNotes(event.target.value)} rows={2} placeholder="Access, timing, what they asked" />
        </label>
        <div className="quote-save">
          <button type="button" className="button secondary" onClick={() => onRemember?.(currentRecord('quoted'))}>Save quote</button>
          <button type="button" className="button primary" onClick={saveQuote}>Save as customer</button>
          <button type="button" className="button secondary" onClick={() => { onRemember?.(currentRecord('prospect', prospectNotes.trim())); setProspectNotes(''); }}>Not taken</button>
          <button type="button" className="button secondary" onClick={() => setPrintOpen(true)}><Printer size={16} /> Print</button>
          <button type="button" className="button tiny secondary" onClick={() => { setMsgTab('whatsapp_en'); copyMessage(); }}>Copy message</button>
        </div>
      </section>
      {(aiReport || quoteMode === 'manual') && (
        <article className="quote-print-sheet">
          <header>
            <div><strong>{pricingSettings.companyName}</strong><span>{pricingSettings.companyPhone}</span></div>
            <div><em>Official quotation</em><span>{new Date().toLocaleDateString('en-GB')}</span></div>
          </header>
          <p><b>Property:</b> {address.trim() || aiReport?.propertyType || 'Address not provided'}</p>
          <p><b>Specification:</b> {activeWindowCount} window units · {method === 'wfp' ? 'Pure water (WFP)' : 'Traditional'}</p>
          <table>
            <thead><tr><th>Service</th><th>Scope</th><th>Total</th></tr></thead>
            <tbody>
              <tr><td>First / one-off deep clean</td><td>Frames, sills, doors and glass, plus selected extras (+{firstCleanPercent(pricingSettings.firstCleanMultiplier)}%)</td><td>{money(quotes.finalOneOff)}</td></tr>
              <tr><td>Regular 4-weekly clean</td><td>Glass, frames and sills every 4 weeks</td><td>{money(quotes.final4Weeks)}</td></tr>
              <tr><td>Regular 8-weekly clean</td><td>Glass, frames and sills every 8 weeks</td><td>{money(quotes.final8Weeks)}</td></tr>
            </tbody>
          </table>
          {(quotes.selectedFixedAddons.length > 0 || quotes.hasInsideAddon || adjustments.length > 0) && (
            <ul>
              {quotes.selectedFixedAddons.map(addon => <li key={addon.id}>{addon.tagEn} +£{addon.value}</li>)}
              {quotes.hasInsideAddon && <li>Interior window cleaning +£{quotes.insideSurcharge}</li>}
              {adjustments.map(adj => <li key={adj.id}>{adj.label} {adj.type === 'discount' ? '−' : '+'}£{adj.amount}</li>)}
            </ul>
          )}
        </article>
      )}
      {pricingOpen && (
        <div className="quote-overlay" role="presentation" onClick={() => setPricingOpen(false)}>
          <form className="quote-dialog" onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); setPricingOpen(false); }}>
            <header><h2>Price list</h2><button type="button" className="icon-button" aria-label="Close" onClick={() => setPricingOpen(false)}><X size={16} /></button></header>
            <label>Company<input value={pricingSettings.companyName} onChange={event => setPricingSettings(prev => ({ ...prev, companyName: event.target.value }))} /></label>
            <label>Phone<input value={pricingSettings.companyPhone} onChange={event => setPricingSettings(prev => ({ ...prev, companyPhone: event.target.value }))} /></label>
            <DraftNumber label="WFP £ / unit" value={pricingSettings.wfpRatePerUnit} onCommit={next => setPricingSettings(prev => ({ ...prev, wfpRatePerUnit: next }))} />
            <DraftNumber label="Traditional £ / unit" value={pricingSettings.tradRatePerUnit} onCommit={next => setPricingSettings(prev => ({ ...prev, tradRatePerUnit: next }))} />
            <DraftNumber label="Minimum visit £" value={pricingSettings.minVisitPrice} onCommit={next => setPricingSettings(prev => ({ ...prev, minVisitPrice: next }))} />
            <DraftNumber label="Single panel £" value={pricingSettings.singlePanelPrice} onCommit={next => setPricingSettings(prev => ({ ...prev, singlePanelPrice: next }))} />
            <DraftNumber label="Double panel £" value={pricingSettings.doublePanelPrice} onCommit={next => setPricingSettings(prev => ({ ...prev, doublePanelPrice: next }))} />
            <DraftNumber label="Triple panel £" value={pricingSettings.triplePanelPrice} onCommit={next => setPricingSettings(prev => ({ ...prev, triplePanelPrice: next }))} />
            <DraftNumber label="First clean +%" value={firstCleanPercent(pricingSettings.firstCleanMultiplier)} onCommit={next => setPricingSettings(prev => ({ ...prev, firstCleanMultiplier: multiplierFromPercent(next) }))} />
            <DraftNumber label="Every 8 weeks +%" value={eightWeekPercent(pricingSettings.eightWeekMultiplier)} onCommit={next => setPricingSettings(prev => ({ ...prev, eightWeekMultiplier: multiplierFromPercent(next) }))} />
            <p className="quote-price-status">{pricesDirty ? 'Unit prices changed. Confirm once to date this price list.' : `Confirmed ${latestRevision ? new Date(latestRevision.confirmedAt).toLocaleString('en-GB') : ''}`}</p>
            <button type="button" className="button primary" disabled={!pricesDirty} onClick={() => onRevise?.({
              id: crypto.randomUUID(),
              confirmedAt: new Date().toISOString(),
              singlePrice: pricingSettings.singlePanelPrice,
              doublePrice: pricingSettings.doublePanelPrice,
              triplePrice: pricingSettings.triplePanelPrice,
              wfpRate: pricingSettings.wfpRatePerUnit,
              tradRate: pricingSettings.tradRatePerUnit,
              minVisit: pricingSettings.minVisitPrice,
              firstCleanPercent: firstCleanPercent(pricingSettings.firstCleanMultiplier),
              eightWeekPercent: eightWeekPercent(pricingSettings.eightWeekMultiplier),
            })}>Confirm prices</button>
            {revisions.length > 0 && (
              <div className="quote-revision-list">
                {revisions.map(item => (
                  <p key={item.id}><strong>{new Date(item.confirmedAt).toLocaleString('en-GB')}</strong> · single {moneyExact(item.singlePrice)} · double {moneyExact(item.doublePrice)} · triple {moneyExact(item.triplePrice)}</p>
                ))}
              </div>
            )}
            <button type="submit" className="button secondary">Close</button>
          </form>
        </div>
      )}
      {historyOpen && (
        <div className="quote-overlay" role="presentation" onClick={() => setHistoryOpen(false)}>
          <div className="quote-dialog" onClick={event => event.stopPropagation()}>
            <header><h2>Quote history</h2><button type="button" className="icon-button" aria-label="Close" onClick={() => setHistoryOpen(false)}><X size={16} /></button></header>
            <input value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} placeholder="Name, address or postcode" aria-label="Search quotes" />
            <div className="segmented">
              <button type="button" className={historyTab === 'all' ? 'chosen' : ''} onClick={() => setHistoryTab('all')}>All quotes</button>
              <button type="button" className={historyTab === 'prospect' ? 'chosen' : ''} onClick={() => setHistoryTab('prospect')}>Not taken</button>
            </div>
            {visibleQuotes.length === 0 ? <p>{historyQueryText || historyTab === 'prospect' ? 'No quotes match that search.' : 'No saved quotes yet.'}</p> : visibleQuotes.map(item => (
              <div className="quote-history-row" key={item.id}>
                <button type="button" onClick={() => {
                  setAddress(item.address);
                  setClientName(item.clientName);
                  setMethod(item.method);
                  setCommentText(item.comment);
                  setQuoteMode(item.mode);
                  setPanels(item.panels || emptyPanels());
                  setSelectedPlan(item.plan);
                  setProspectNotes(item.notes);
                  setLiveWindowCount(Math.max(1, item.windowCount || 1));
                  setLiveUnitRate(item.unitRate || liveUnitRate);
                  setAdjustments(item.adjustments || []);
                  setHistoryOpen(false);
                }}>
                  <strong>{item.clientName || item.address || 'Quote'}</strong>
                  <span>{new Date(item.createdAt).toLocaleString('en-GB')} · {item.outcome === 'prospect' ? 'Not taken' : item.outcome === 'customer' ? 'Customer' : 'Quote'} · {item.postcode || item.address || 'No address'} · {money(item.price)}{item.notes ? ` · ${item.notes}` : ''}</span>
                </button>
                <textarea rows={2} defaultValue={item.notes} aria-label="Quote notes" placeholder="Notes" onBlur={event => { if (event.target.value !== item.notes) onRemember?.({ ...item, notes: event.target.value }); }} />
                <button type="button" className="icon-button" aria-label="Delete quote" onClick={() => { deleteHistoryItem(item.id); onForget?.(item.id); }}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {printOpen && (aiReport || quoteMode === 'manual') && (
        <div className="quote-overlay quote-tools" role="presentation" onClick={() => setPrintOpen(false)}>
          <div className="quote-dialog" onClick={event => event.stopPropagation()}>
            <header><h2>Print quotation</h2><button type="button" className="icon-button" aria-label="Close" onClick={() => setPrintOpen(false)}><X size={16} /></button></header>
            <p>{address.trim() || aiReport?.propertyType || 'Quote'} · {activeWindowCount} units · {method === 'wfp' ? 'WFP' : 'Traditional'}</p>
            <p>First clean {money(quotes.finalOneOff)} · 4 weeks {money(quotes.final4Weeks)} · 8 weeks {money(quotes.final8Weeks)}</p>
            <div className="quote-save">
              <button type="button" className="button secondary" onClick={() => setPrintOpen(false)}>Close</button>
              <button type="button" className="button primary" onClick={() => window.print()}><Printer size={16} /> Print / save PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
