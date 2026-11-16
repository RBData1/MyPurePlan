import { supabase } from './supabase';
import type { PanelCounts, PriceAdjustment, PriceRevision, QuoteMethod, QuoteMode, QuoteOutcome, QuotePlan, StoredQuote } from './windowQuote';

const QUOTE_CACHE = 'cs_window_quotes';
const REVISION_CACHE = 'cs_window_price_revisions';

function cacheKey(base: string, businessId: string | null) {
  return businessId ? `${base}_${businessId}` : base;
}

function readCache<T>(base: string, businessId: string | null, fallback: T): T {
  try {
    const saved = localStorage.getItem(cacheKey(base, businessId));
    return saved ? JSON.parse(saved) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeCache<T>(base: string, businessId: string | null, value: T) {
  try { localStorage.setItem(cacheKey(base, businessId), JSON.stringify(value)); } catch { /* quota */ }
}

function missingTable(message: string) {
  return /window_quotes|window_price_revisions|schema cache|relation/i.test(message);
}

function asPanels(value: unknown): PanelCounts {
  const row = value && typeof value === 'object' ? value as Partial<PanelCounts> : {};
  return {
    single: Math.max(0, Number(row.single) || 0),
    double: Math.max(0, Number(row.double) || 0),
    triple: Math.max(0, Number(row.triple) || 0),
  };
}

export function quoteFromRow(row: Record<string, unknown>): StoredQuote {
  const prices = row.panel_prices && typeof row.panel_prices === 'object' ? row.panel_prices as Record<string, unknown> : {};
  return {
    id: String(row.id),
    customerId: row.customer_id ? String(row.customer_id) : null,
    clientName: String(row.client_name || ''),
    address: String(row.address || ''),
    postcode: String(row.postcode || ''),
    mode: row.mode === 'manual' ? 'manual' : 'ai',
    outcome: row.outcome === 'customer' || row.outcome === 'prospect' ? row.outcome : 'quoted',
    method: row.method === 'traditional' ? 'traditional' : 'wfp',
    plan: row.plan === 'oneoff' || row.plan === '8weeks' ? row.plan : '4weeks',
    windowCount: Number(row.window_count) || 0,
    panels: asPanels(row.panels),
    panelPrices: {
      single: Number(prices.single) || 0,
      double: Number(prices.double) || 0,
      triple: Number(prices.triple) || 0,
    },
    unitRate: Number(row.unit_rate) || 0,
    firstCleanPercent: Number(row.first_clean_percent) || 0,
    eightWeekPercent: Number(row.eight_week_percent) || 0,
    price: Number(row.price) || 0,
    price4: Number(row.price_4) || 0,
    price8: Number(row.price_8) || 0,
    priceFirst: Number(row.price_first) || 0,
    addons: Array.isArray(row.addons) ? row.addons.map(String) : [],
    adjustments: Array.isArray(row.adjustments) ? row.adjustments as PriceAdjustment[] : [],
    comment: String(row.comment || ''),
    notes: String(row.notes || ''),
    propertyType: String(row.property_type || ''),
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

function quoteToRow(businessId: string, quote: StoredQuote) {
  return {
    id: quote.id,
    business_id: businessId,
    customer_id: quote.customerId,
    client_name: quote.clientName,
    address: quote.address,
    postcode: quote.postcode,
    mode: quote.mode satisfies QuoteMode,
    outcome: quote.outcome satisfies QuoteOutcome,
    method: quote.method satisfies QuoteMethod,
    plan: quote.plan satisfies QuotePlan,
    window_count: quote.windowCount,
    panels: quote.panels,
    panel_prices: quote.panelPrices,
    unit_rate: quote.unitRate,
    first_clean_percent: quote.firstCleanPercent,
    eight_week_percent: quote.eightWeekPercent,
    price: quote.price,
    price_4: quote.price4,
    price_8: quote.price8,
    price_first: quote.priceFirst,
    addons: quote.addons,
    adjustments: quote.adjustments,
    comment: quote.comment,
    notes: quote.notes,
    property_type: quote.propertyType,
    created_at: quote.createdAt,
  };
}

export function revisionFromRow(row: Record<string, unknown>): PriceRevision {
  return {
    id: String(row.id),
    confirmedAt: String(row.confirmed_at || new Date().toISOString()),
    singlePrice: Number(row.single_price) || 0,
    doublePrice: Number(row.double_price) || 0,
    triplePrice: Number(row.triple_price) || 0,
    wfpRate: Number(row.wfp_rate) || 0,
    tradRate: Number(row.trad_rate) || 0,
    minVisit: Number(row.min_visit) || 0,
    firstCleanPercent: Number(row.first_clean_percent) || 0,
    eightWeekPercent: Number(row.eight_week_percent) || 0,
  };
}

function revisionToRow(businessId: string, revision: PriceRevision) {
  return {
    id: revision.id,
    business_id: businessId,
    confirmed_at: revision.confirmedAt,
    single_price: revision.singlePrice,
    double_price: revision.doublePrice,
    triple_price: revision.triplePrice,
    wfp_rate: revision.wfpRate,
    trad_rate: revision.tradRate,
    min_visit: revision.minVisit,
    first_clean_percent: revision.firstCleanPercent,
    eight_week_percent: revision.eightWeekPercent,
  };
}

export function readQuoteCache(businessId: string | null) {
  return readCache<StoredQuote[]>(QUOTE_CACHE, businessId, []);
}

export function readRevisionCache(businessId: string | null) {
  return readCache<PriceRevision[]>(REVISION_CACHE, businessId, []);
}

export async function loadWindowQuotes(businessId: string | null): Promise<{ quotes: StoredQuote[]; unavailable: boolean }> {
  const cached = readQuoteCache(businessId);
  if (!businessId || !supabase) return { quotes: cached, unavailable: false };
  const { data, error } = await supabase.from('window_quotes').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(500);
  if (error) return { quotes: cached, unavailable: missingTable(error.message) };
  const quotes = (data || []).map(row => quoteFromRow(row as Record<string, unknown>));
  writeCache(QUOTE_CACHE, businessId, quotes);
  return { quotes, unavailable: false };
}

export async function loadPriceRevisions(businessId: string | null): Promise<{ revisions: PriceRevision[]; unavailable: boolean }> {
  const cached = readRevisionCache(businessId);
  if (!businessId || !supabase) return { revisions: cached, unavailable: false };
  const { data, error } = await supabase.from('window_price_revisions').select('*').eq('business_id', businessId).order('confirmed_at', { ascending: false }).limit(100);
  if (error) return { revisions: cached, unavailable: missingTable(error.message) };
  const revisions = (data || []).map(row => revisionFromRow(row as Record<string, unknown>));
  writeCache(REVISION_CACHE, businessId, revisions);
  return { revisions, unavailable: false };
}

export async function saveWindowQuote(businessId: string | null, quote: StoredQuote): Promise<string | null> {
  const next = [quote, ...readQuoteCache(businessId).filter(item => item.id !== quote.id)];
  writeCache(QUOTE_CACHE, businessId, next);
  if (!businessId || !supabase) return null;
  const { error } = await supabase.from('window_quotes').upsert(quoteToRow(businessId, quote), { onConflict: 'id' });
  if (!error) return null;
  return missingTable(error.message) ? 'missing-table' : error.message;
}

export async function deleteWindowQuote(businessId: string | null, id: string): Promise<string | null> {
  writeCache(QUOTE_CACHE, businessId, readQuoteCache(businessId).filter(item => item.id !== id));
  if (!businessId || !supabase) return null;
  const { error } = await supabase.from('window_quotes').delete().eq('id', id).eq('business_id', businessId);
  if (!error) return null;
  return missingTable(error.message) ? 'missing-table' : error.message;
}

export async function savePriceRevision(businessId: string | null, revision: PriceRevision): Promise<string | null> {
  const next = [revision, ...readRevisionCache(businessId).filter(item => item.id !== revision.id)];
  writeCache(REVISION_CACHE, businessId, next);
  if (!businessId || !supabase) return null;
  const { error } = await supabase.from('window_price_revisions').upsert(revisionToRow(businessId, revision), { onConflict: 'id' });
  if (!error) return null;
  return missingTable(error.message) ? 'missing-table' : error.message;
}
