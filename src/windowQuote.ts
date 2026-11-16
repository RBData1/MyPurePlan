export const PRICING_STORAGE_KEY = 'windowclean_ai_pricing_v2';
export const HISTORY_STORAGE_KEY = 'windowclean_ai_history_v2';

export const DEFAULT_PRICING = {
  companyName: 'MyPurePlan',
  companyPhone: '',
  wfpRatePerUnit: 1.7,
  tradRatePerUnit: 2.3,
  minVisitPrice: 25,
  firstCleanMultiplier: 1.75,
  eightWeekMultiplier: 1.25,
  singlePanelPrice: 1,
  doublePanelPrice: 2,
  triplePanelPrice: 3,
};

export type PricingSettings = typeof DEFAULT_PRICING;
export type QuoteMethod = 'wfp' | 'traditional';
export type QuotePlan = 'oneoff' | '4weeks' | '8weeks';
export type QuoteMode = 'ai' | 'manual';
export type QuoteOutcome = 'quoted' | 'customer' | 'prospect';

export type PanelCounts = { single: number; double: number; triple: number };

export function percentFromMultiplier(multiplier: number, fallback = 0) {
  const percent = Math.round((Number(multiplier) - 1) * 100);
  return Number.isFinite(percent) ? Math.max(0, percent) : fallback;
}

export function multiplierFromPercent(percent: number) {
  return 1 + Math.max(0, Number(percent) || 0) / 100;
}

export function emptyPanels(): PanelCounts {
  return { single: 0, double: 0, triple: 0 };
}

export function panelTotal(counts: PanelCounts, pricing: Pick<PricingSettings, 'singlePanelPrice' | 'doublePanelPrice' | 'triplePanelPrice'>) {
  return counts.single * pricing.singlePanelPrice + counts.double * pricing.doublePanelPrice + counts.triple * pricing.triplePanelPrice;
}

export function panelUnits(counts: PanelCounts) {
  return counts.single + counts.double * 2 + counts.triple * 3;
}

export function extractUkPostcode(address: string) {
  const match = address.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  return match ? match[1].toUpperCase().replace(/(\S+?)\s*(\d[A-Z]{2})$/i, '$1 $2') : '';
}

export type PriceAdjustment = {
  id: string;
  label: string;
  amount: number;
  type: 'surcharge' | 'discount';
  reason: string;
};

export type WindowBreakdown = {
  front: number;
  rear: number;
  sidesEstimated: number;
  groundFloor: number;
  upperFloor: number;
};

export type AiWindowReport = {
  propertyType: string;
  regionAssessment: string;
  locationMultiplier: number;
  totalWindows: number;
  breakdown: WindowBreakdown;
  detectedDifficulties: string[];
  adjustments: Array<{ label: string; amount: number; type: string; reason: string }>;
  commentSummary: string;
};

export type QuoteHistoryEntry = {
  id: string;
  timestamp: string;
  address: string;
  method: QuoteMethod;
  commentText: string;
  thumbnail: string | null;
  report: AiWindowReport;
  windowCount: number;
  unitRate: number;
  adjustments: PriceAdjustment[];
  activeAddons: string[];
};

export const ADDONS_CATALOG = [
  { id: 'gutters', label: 'Gutter clearing', type: 'fixed' as const, value: 95, tagEn: 'Gutter Clearing' },
  { id: 'fascias', label: 'Fascias & soffits', type: 'fixed' as const, value: 85, tagEn: 'Fascias & Soffits Wash' },
  { id: 'conservatory', label: 'Conservatory roof', type: 'fixed' as const, value: 45, tagEn: 'Conservatory Roof Clean' },
  { id: 'velux', label: 'Velux / skylights', type: 'fixed' as const, value: 20, tagEn: 'Velux / Skylights' },
  { id: 'inside', label: 'Inside windows', type: 'percent' as const, value: 60, tagEn: 'Interior Window Cleaning' },
];

export type LiveQuotes = {
  base4Weeks: number;
  insideSurcharge: number;
  fixedAddonsTotal: number;
  selectedFixedAddons: Array<(typeof ADDONS_CATALOG)[number]>;
  hasInsideAddon: boolean;
  commentNetTotal: number;
  finalOneOff: number;
  final4Weeks: number;
  final8Weeks: number;
  activePlanPrice: number;
};

export function computeLiveQuotes(input: {
  windowCount: number;
  unitRate: number;
  pricing: PricingSettings;
  activeAddons: string[];
  adjustments: PriceAdjustment[];
  selectedPlan: QuotePlan;
  baseOverride?: number;
}): LiveQuotes {
  const { windowCount, unitRate, pricing, activeAddons, adjustments, selectedPlan } = input;
  const rawBase4Weeks = Math.round(input.baseOverride != null ? input.baseOverride : windowCount * unitRate);
  const base4Weeks = rawBase4Weeks <= 0 ? 0 : Math.max(pricing.minVisitPrice, rawBase4Weeks);
  const hasInsideAddon = activeAddons.includes('inside');
  const insideSurcharge = hasInsideAddon ? Math.round(base4Weeks * 0.6) : 0;
  const selectedFixedAddons = ADDONS_CATALOG.filter(addon => addon.type === 'fixed' && activeAddons.includes(addon.id));
  const fixedAddonsTotal = selectedFixedAddons.reduce((sum, item) => sum + item.value, 0);
  const commentNetTotal = Math.round(adjustments.reduce((sum, adj) => (adj.type === 'discount' ? sum - adj.amount : sum + adj.amount), 0));
  if (rawBase4Weeks <= 0 && !activeAddons.length && commentNetTotal === 0) {
    return {
      base4Weeks: 0, insideSurcharge: 0, fixedAddonsTotal: 0, selectedFixedAddons, hasInsideAddon,
      commentNetTotal: 0, finalOneOff: 0, final4Weeks: 0, final8Weeks: 0, activePlanPrice: 0,
    };
  }
  const recurringCore4Weeks = Math.max(pricing.minVisitPrice, base4Weeks + insideSurcharge + commentNetTotal);
  const recurringCore8Weeks = Math.max(
    pricing.minVisitPrice,
    Math.round((base4Weeks + insideSurcharge) * pricing.eightWeekMultiplier) + commentNetTotal,
  );
  const firstCleanCore = Math.max(
    pricing.minVisitPrice,
    Math.round((base4Weeks + insideSurcharge) * pricing.firstCleanMultiplier) + commentNetTotal,
  );
  const final4Weeks = recurringCore4Weeks + fixedAddonsTotal;
  const final8Weeks = recurringCore8Weeks + fixedAddonsTotal;
  const finalOneOff = firstCleanCore + fixedAddonsTotal;
  const activePlanPrice = selectedPlan === 'oneoff' ? finalOneOff : selectedPlan === '8weeks' ? final8Weeks : final4Weeks;
  return { base4Weeks, insideSurcharge, fixedAddonsTotal, selectedFixedAddons, hasInsideAddon, commentNetTotal, finalOneOff, final4Weeks, final8Weeks, activePlanPrice };
}

export function buildClientMessage(input: {
  tab: 'whatsapp_en' | 'email_en' | 'summary_pl';
  clientName: string;
  address: string;
  method: QuoteMethod;
  windowCount: number;
  pricing: PricingSettings;
  quotes: LiveQuotes;
  adjustments: PriceAdjustment[];
}) {
  const { tab, pricing, quotes, adjustments, method, windowCount } = input;
  const greeting = input.clientName.trim() ? ` ${input.clientName.trim()}` : '';
  const locationStr = input.address.trim() ? ` at ${input.address.trim()}` : '';
  const methodEn = method === 'wfp'
    ? 'Pure Water Reach & Wash system (including glass, frames & sills)'
    : 'traditional hand-cleaning method (squeegee & ladder)';
  const scopeEn = quotes.hasInsideAddon ? 'exterior & interior windows' : 'exterior windows';
  const extraLinesEn: string[] = [];
  quotes.selectedFixedAddons.forEach(addon => extraLinesEn.push(`• ${addon.tagEn}: +£${addon.value}`));
  if (quotes.hasInsideAddon) extraLinesEn.push(`• Interior Window Cleaning: +£${quotes.insideSurcharge}`);
  adjustments.forEach(adj => {
    const sign = adj.type === 'discount' ? '-£' : '+£';
    extraLinesEn.push(`• ${adj.label}: ${sign}${adj.amount}`);
  });
  const extrasBlockEn = extraLinesEn.length ? `\nIncluded extras & bespoke adjustments:\n${extraLinesEn.join('\n')}\n` : '';
  if (tab === 'whatsapp_en') {
    return `Hi${greeting}, thanks for getting in touch with ${pricing.companyName}! 👋

I've reviewed the details for your property${locationStr} (approx. ${windowCount} window units, ${scopeEn}) using our ${methodEn}.
${extrasBlockEn}
Here is your tailored quotation:
✨ *First / One-Off Deep Clean* (frames, sills & glass): *£${quotes.finalOneOff}*
🗓️ *Regular 4-Weekly Clean*: *£${quotes.final4Weeks}* per visit
🗓️ *Regular 8-Weekly Clean*: *£${quotes.final8Weeks}* per visit

Fully insured with our 100% streak-free guarantee. Would you like me to book you in for next week?
📞 ${pricing.companyPhone}`;
  }
  if (tab === 'email_en') {
    return `Subject: Window Cleaning Quotation${locationStr} — ${pricing.companyName}

Dear${greeting || ' Homeowner'},

Thank you for your enquiry regarding window cleaning${locationStr}. Based on our assessment of your property (approx. ${windowCount} window units, ${scopeEn}) using our ${methodEn}, please find our quotation below:
${extrasBlockEn}
• First / One-Off Deep Clean (thorough frame, sill & glass wash): £${quotes.finalOneOff}
• Ongoing 4-Weekly Service: £${quotes.final4Weeks} per clean
• Ongoing 8-Weekly Service: £${quotes.final8Weeks} per clean

We carry full Public Liability Insurance and send a reminder text the evening before every scheduled visit. Please reply to this email or call ${pricing.companyPhone} to arrange your first clean.

Kind regards,
${pricing.companyName}
Tel: ${pricing.companyPhone}`;
  }
  const extraLinesPl: string[] = [];
  quotes.selectedFixedAddons.forEach(addon => extraLinesPl.push(`• ${addon.label}: +£${addon.value}`));
  if (quotes.hasInsideAddon) extraLinesPl.push(`• Mycie okien od wewnątrz: +£${quotes.insideSurcharge}`);
  adjustments.forEach(adj => {
    const sign = adj.type === 'discount' ? '-£' : '+£';
    extraLinesPl.push(`• ${adj.label}: ${sign}${adj.amount}`);
  });
  return `Podsumowanie wyceny — ${pricing.companyName}
Lokalizacja: ${input.address.trim() || 'UK'} | Metoda: ${method === 'wfp' ? 'WFP (Pure Water)' : 'Tradycyjna'} | Liczba jednostek: ${windowCount} szt.
${extraLinesPl.length ? `\nDodatki i korekty:\n${extraLinesPl.join('\n')}\n` : ''}
• Pierwsze mycie / One-off: £${quotes.finalOneOff}
• Regularnie co 4 tygodnie: £${quotes.final4Weeks} / wizyta
• Regularnie co 8 tygodni: £${quotes.final8Weeks} / wizyta`;
}

export type StoredQuote = {
  id: string;
  customerId: string | null;
  clientName: string;
  address: string;
  postcode: string;
  mode: QuoteMode;
  outcome: QuoteOutcome;
  method: QuoteMethod;
  plan: QuotePlan;
  windowCount: number;
  panels: PanelCounts;
  panelPrices: { single: number; double: number; triple: number };
  unitRate: number;
  firstCleanPercent: number;
  eightWeekPercent: number;
  price: number;
  price4: number;
  price8: number;
  priceFirst: number;
  addons: string[];
  adjustments: PriceAdjustment[];
  comment: string;
  notes: string;
  propertyType: string;
  createdAt: string;
};

export type PriceRevision = {
  id: string;
  confirmedAt: string;
  singlePrice: number;
  doublePrice: number;
  triplePrice: number;
  wfpRate: number;
  tradRate: number;
  minVisit: number;
  firstCleanPercent: number;
  eightWeekPercent: number;
};

export type QuoteSave = {
  clientName: string;
  address: string;
  method: QuoteMethod;
  windowCount: number;
  plan: QuotePlan;
  price: number;
  duration: number;
  addons: string[];
  adjustments: PriceAdjustment[];
  comment: string;
  propertyType: string;
  record: StoredQuote;
};

