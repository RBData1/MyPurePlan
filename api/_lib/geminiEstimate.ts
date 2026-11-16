const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_IMAGES = 6;
const MAX_IMAGE_CHARS = 2_000_000;

export type EstimateImage = { mimeType: string; base64: string };

export type EstimateRequest = {
  images?: EstimateImage[];
  address?: string;
  method?: string;
  comment?: string;
  pricing?: { wfpRatePerUnit?: number; tradRatePerUnit?: number; minVisitPrice?: number };
  areaOnly?: boolean;
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    propertyType: { type: 'STRING', description: 'Np. 4-bed detached house (Dom wolnostojący)' },
    regionAssessment: { type: 'STRING', description: 'Ocena strefy cenowej UK na podstawie adresu/kodu' },
    locationMultiplier: { type: 'NUMBER', description: 'Mnożnik regionalny np. 1.35' },
    totalWindows: { type: 'INTEGER', description: 'Łączna liczba jednostek okiennych w całym domu' },
    breakdown: {
      type: 'OBJECT',
      properties: {
        front: { type: 'INTEGER' },
        rear: { type: 'INTEGER' },
        sidesEstimated: { type: 'INTEGER' },
        groundFloor: { type: 'INTEGER' },
        upperFloor: { type: 'INTEGER' },
      },
      required: ['front', 'rear', 'sidesEstimated', 'groundFloor', 'upperFloor'],
    },
    detectedDifficulties: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Lista 3-5 wykrytych trudności lub cech budynku ze zdjęć',
    },
    adjustments: {
      type: 'ARRAY',
      description: 'Lista dopłat i rabatów wywnioskowanych z komentarza użytkownika',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          amount: { type: 'NUMBER' },
          type: { type: 'STRING', enum: ['surcharge', 'discount'] },
          reason: { type: 'STRING' },
        },
        required: ['label', 'amount', 'type', 'reason'],
      },
    },
    commentSummary: { type: 'STRING', description: 'Podsumowanie po polsku, jak komentarz wpłynął na wycenę' },
  },
  required: ['propertyType', 'regionAssessment', 'locationMultiplier', 'totalWindows', 'breakdown', 'detectedDifficulties', 'adjustments', 'commentSummary'],
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchGeminiWithBackoff(url: string, options: RequestInit, maxRetries = 4) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return await response.json();
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      const errBody = await response.text();
      throw new Error(`Gemini error (${response.status}): ${errBody.slice(0, 400) || response.statusText}`);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error('Gemini did not respond.');
}

export async function estimateWindows(body: EstimateRequest, apiKey: string) {
  const key = apiKey.trim();
  if (!key) throw new Error('GEMINI_API_KEY is not set on the server.');
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  for (const image of images) {
    const mime = String(image?.mimeType || '');
    const data = String(image?.base64 || '');
    if (!/^image\/(png|jpeg|webp)$/.test(mime)) throw new Error('Photos must be PNG, JPEG, or WebP.');
    if (!data || data.length > MAX_IMAGE_CHARS) throw new Error('One of the photos is too large. Use a smaller image.');
  }
  const address = String(body.address || '').trim().slice(0, 300);
  const comment = String(body.comment || '').trim().slice(0, 4000);
  if (body.areaOnly) {
    if (!address) throw new Error('Add a UK address / postcode first.');
    const areaInstruction = `Jesteś kosztorysantem mycia okien w UK. Na podstawie adresu lub kodu pocztowego wyznacz wyłącznie mnożnik lokalizacyjny (locationMultiplier). Nie licz okien.
- Zamożne dzielnice Londynu, Kent, Surrey (np. Chislehurst BR7, Bromley BR1/BR2, Sevenoaks, Wimbledon SW19, Richmond): 1.30 - 1.45
- Standardowy Południowy Wschód / przedmieścia Londynu (np. Sidcup DA14, Bexley, Orpington): 1.15 - 1.25
- Pozostałe regiony UK: 1.00 - 1.10
regionAssessment napisz po polsku, krótko.`;
    const areaSchema = {
      type: 'OBJECT',
      properties: {
        regionAssessment: { type: 'STRING' },
        locationMultiplier: { type: 'NUMBER' },
      },
      required: ['regionAssessment', 'locationMultiplier'],
    };
    const areaPayload = {
      contents: [{ role: 'user', parts: [{ text: `Adres / kod pocztowy UK: ${address}` }] }],
      systemInstruction: { parts: [{ text: areaInstruction }] },
      generationConfig: { responseMimeType: 'application/json', responseSchema: areaSchema },
    };
    const areaUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const areaResp = await fetchGeminiWithBackoff(areaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(areaPayload),
    });
    const areaJson = areaResp?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!areaJson) throw new Error('Gemini did not return an area guide.');
    const areaParsed = JSON.parse(areaJson);
    if (!areaParsed || typeof areaParsed !== 'object') throw new Error('Gemini returned an unreadable area guide.');
    return areaParsed;
  }
  if (!images.length && !address) throw new Error('Add a photo or a UK address / postcode first.');
  const method = body.method === 'traditional' ? 'traditional' : 'wfp';
  const pricing = body.pricing || {};
  const wfp = Number(pricing.wfpRatePerUnit) || 1.7;
  const trad = Number(pricing.tradRatePerUnit) || 2.3;
  const minimum = Number(pricing.minVisitPrice) || 25;
  const systemInstruction = `Jesteś profesjonalnym kosztorysantem usług mycia okien (Window Cleaning Estimator) działającym na rynku brytyjskim (UK).
Analizujesz przesłane zdjęcia nieruchomości, brytyjski adres/kod pocztowy oraz komentarz operatora, zwracając wyłącznie ustrukturyzowany obiekt JSON zgodny ze schematem.

Zasady analizy:
1. Policz wszystkie jednostki szklane (pojedyncze i wieloskrzydłowe okna, lufciki w ramach jednego okna licz jako część tego okna, podwójne drzwi French doors = 2 jednostki, wykusz bay window = 3-4 jednostki). Jeśli zdjęcia pokazują tylko przód lub tył, doszacuj 1-3 okna na niewidocznych ścianach bocznych.
2. Oceń zamożność lokalizacji UK na podstawie kodu pocztowego / miejscowości i wyznacz mnożnik lokalizacyjny (locationMultiplier):
   - Zamożne dzielnice Londynu, Kent, Surrey (np. Chislehurst BR7, Bromley BR1/BR2, Sevenoaks, Wimbledon SW19, Richmond): 1.30 - 1.45
   - Standardowy Południowy Wschód / przedmieścia Londynu (np. Sidcup DA14, Bexley, Orpington): 1.15 - 1.25
   - Pozostałe regiony UK: 1.00 - 1.10
3. Przeanalizuj komentarz operatora i wyodrębnij z niego WSZYSTKIE konkretne korekty finansowe do tablicy "adjustments" (np. dopłata za remont, conservatory, trudny dostęp, czyszczenie rynien lub rabat dla sąsiada). Każda pozycja ma mieć dodatnią kwotę w GBP ("amount") oraz typ "surcharge" (+£) lub "discount" (-£).
4. Wszystkie opisy tekstowe przygotuj w języku polskim (z zachowaniem brytyjskich terminów branżowych w nawiasach, np. Georgian bars, French doors, render).`;
  const promptText = `Wyceń mycie okien dla poniższego zlecenia w UK:
- Adres / Kod pocztowy UK: ${address || 'Nie podano (zastosuj standard South East UK, mnożnik 1.15)'}
- Preferowana metoda pracy: ${method === 'wfp' ? 'WFP (Pure Water / kij teleskopowy)' : 'Tradycyjna (Drabina + ściągaczka)'}
- Własna stawka bazowa operatora: WFP = £${wfp}/pkt, Tradycyjna = £${trad}/pkt, Minimum wizyty = £${minimum}
- Komentarz / Uwagi wpływające na cenę: ${comment || 'Brak uwag dodatkowych'}
- Liczba wgranych zdjęć: ${images.length}`;
  const parts: Array<Record<string, unknown>> = [{ text: promptText }];
  for (const image of images) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
  }
  const payload = {
    contents: [{ role: 'user', parts }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const apiResp = await fetchGeminiWithBackoff(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(payload),
  });
  const jsonStr = apiResp?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonStr) throw new Error('Gemini did not return a quote. Try again.');
  const parsed = JSON.parse(jsonStr);
  if (!parsed || typeof parsed !== 'object') throw new Error('Gemini returned an unreadable quote.');
  return parsed;
}
