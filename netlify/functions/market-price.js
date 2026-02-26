const CHESTS = {
  t1: { keyword: 'T1 Temporal Piece Chest x1,000',    pieces: 1000   },
  t2: { keyword: 'T2 Temporal Piece Chest x5,000',    pieces: 5000   },
  t3: { keyword: 'T3 Temporal Piece Chest x10,000',   pieces: 10000  },
  t4: { keyword: 'T4 Temporal Piece Chest x50,000',   pieces: 50000  },
  t5: { keyword: 'T5 Temporal Piece Chest x100,000',  pieces: 100000 },
};

const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// USD → PHP conversion fallback (in case API never returns PHP)
const USD_TO_PHP = 57.5;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const tier  = (event.queryStringParameters?.tier || 't1').toLowerCase();
  const chest = CHESTS[tier] || CHESTS.t1;

  try {
    // ── Step 1: session cookie ──
    let cookieHeader = 'lng=en-US; country=PH; currency=PHP';
    try {
      const sessionRes = await fetch('https://l9asia.nextmarket.games/', {
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
      console.warn('Cookie fetch failed:', err.message);
    }

    // ── Step 2: market listings — request PHP fiat explicitly ──
    const res = await fetch('https://api.nextmarket.games/l9asia/v1/sale/c2c?page=0', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'en-PH,en;q=0.9',
        'Origin':          'https://l9asia.nextmarket.games',
        'Referer':         'https://l9asia.nextmarket.games/',
        'User-Agent':      UA,
        'Cookie':          cookieHeader,
        'X-Country-Code':  'PH',
        'X-Currency':      'PHP',
      },
      body: JSON.stringify({
        keyword:      chest.keyword,
        sort:         'PRICE_ASC',
        realmCode:    'NEW_REALM',
        fiatCurrency: 'PHP',   // explicit PHP request
        country:      'PH',
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Market API returned ${res.status}`);

    const data     = await res.json();
    const items    = Array.isArray(data.content) ? data.content : [];
    const cheapest = items.find(i => i?.item?.name === chest.keyword && !i?.isOrderInProgress) ?? null;

    console.log('fiatPriceInfo:', JSON.stringify(cheapest?.fiatPriceInfo));

    const usdt    = cheapest?.cryptoPriceInfo?.price ?? null;
    const fiat    = cheapest?.fiatPriceInfo;
    // use PHP if the API returned it, otherwise convert from USD
    const phpRaw  = fiat?.currencyType === 'PHP'
      ? fiat.price
      : fiat?.price
        ? Math.round(fiat.price * USD_TO_PHP * 100) / 100
        : null;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        type: 'UPDATE',
        data: cheapest ? {
          [tier.toUpperCase()]: {
            pieces:      chest.pieces,
            price:       usdt,
            pricePhp:    phpRaw,
            fiatCurrency: fiat?.currencyType ?? 'USD',
            lastUpdated: Date.now(),
          },
        } : null,
      }),
    };

  } catch (e) {
    console.error('Handler error:', e.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};