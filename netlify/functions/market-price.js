const CHESTS = {
  t1: { keyword: 'T1 Temporal Piece Chest x1,000',    pieces: 1000   },
  t2: { keyword: 'T2 Temporal Piece Chest x5,000',    pieces: 5000   },
  t3: { keyword: 'T3 Temporal Piece Chest x10,000',   pieces: 10000  },
  t4: { keyword: 'T4 Temporal Piece Chest x50,000',   pieces: 50000  },
  t5: { keyword: 'T5 Temporal Piece Chest x100,000',  pieces: 100000 },
};

const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const REALM_CODE = 'OLD_REALM';
const MARKET_ORIGIN = 'https://l9asia.nextmarket.games';
const MARKETPLACE_URL = `${MARKET_ORIGIN}/marketplace?viewType=fiat&realmCode=${REALM_CODE}`;
const MARKET_API_URL = 'https://api.nextmarket.games/l9asia/v1/sale/c2c?page=0';
const round2 = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;

// USD → PHP conversion fallback (in case API never returns PHP)
const USD_TO_PHP = 57.5;

export const handler = async (event) => {
  console.log('Market Price function called');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const tier   = (event.queryStringParameters?.tier || 't1').toLowerCase();
  const limit  = Math.min(parseInt(event.queryStringParameters?.limit || '5', 10), 30);
  const chest  = CHESTS[tier] || CHESTS.t1;
  const tierKey = tier.toUpperCase();

  try {
    // ── Step 1: session cookie ──
    let cookieHeader = 'lng=en-US; country=PH; currency=PHP';
    try {
      const sessionRes = await fetch(MARKETPLACE_URL, {
        headers: {
          'User-Agent':       UA,
          'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language':  'en-PH,en;q=0.9',
          'Cookie':           'lng=en-US; country=PH; currency=PHP',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      });
      const raw = sessionRes.headers.get('set-cookie') ?? '';
      const cookies = raw
        .split(/,(?=[^ ])/)
        .map(c => c.trim().split(';')[0])
        .filter(c => c.includes('='))
        .join('; ');
      if (cookies) cookieHeader += `; ${cookies}`;
    } catch (err) {
      console.warn('Cookie fetch failed:', err?.message);
    }

    // ── Step 2: market listings — request PHP fiat explicitly ──
    const res = await fetch(MARKET_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'en-PH,en;q=0.9',
        'Origin':          MARKET_ORIGIN,
        'Referer':         MARKETPLACE_URL,
        'User-Agent':      UA,
        'Cookie':          cookieHeader,
        'X-Country-Code':  'PH',
        'X-Currency':      'PHP',
      },
      body: JSON.stringify({
        keyword:      chest.keyword,
        sort:         'PRICE_ASC',
        realmCode:    REALM_CODE,
        fiatCurrency: 'PHP',
        country:      'PH',
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Market API returned ${res.status}`);

    const data  = await res.json();
    const items = (Array.isArray(data.content) ? data.content : [])
      .filter(i => i?.item?.name === chest.keyword && !i?.isOrderInProgress)
      .slice(0, limit);

    const listings = items.map((item, idx) => {
      const usdt    = item?.cryptoPriceInfo?.price ?? 0;
      const fiat    = item?.fiatPriceInfo;
      const phpRaw  = fiat?.currencyType === 'PHP'
        ? fiat.price
        : fiat?.price
          ? Math.round(fiat.price * USD_TO_PHP * 100) / 100
          : 0;
      const priceUsdt = round2(usdt);
      const pricePhp = round2(phpRaw);

      return {
        rank:            idx + 1,
        seller:          item?.seller?.userName || 'Unknown',
        quantity:        item?.quantity || 0,
        priceUsdt:       priceUsdt,
        pricePhp:        pricePhp,
        unitPriceUsdt:   round2(priceUsdt / chest.pieces),
        unitPricePhp:    round2(pricePhp / chest.pieces),
        fiatCurrency:    fiat?.currencyType ?? 'USD',
      };
    });

    const cheapest = listings[0] || null;
    const singlePriceUsdt = cheapest?.priceUsdt ?? null;
    const singlePricePhp = cheapest?.pricePhp ?? null;
    const singleFiatCurrency = cheapest?.fiatCurrency ?? 'USD';

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        type: 'UPDATE',
        tier: tierKey,
        pieces: chest.pieces,
        count: listings.length,
        listings: listings,
        data: cheapest
          ? {
              [tierKey]: {
                pieces: chest.pieces,
                price: singlePriceUsdt,
                pricePhp: singlePricePhp,
                fiatCurrency: singleFiatCurrency,
                lastUpdated: Date.now(),
              },
            }
          : null,
        lastUpdated: Date.now(),
      }),
    };

  } catch (e) {
    console.error('Handler error:', e?.message || e);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: e?.message || 'Unknown error' }),
    };
  }
};