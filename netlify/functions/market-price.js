const CHESTS = {
  t1: { keyword: 'T1 Temporal Piece Chest x1,000', pieces: 1000 },
  t2: { keyword: 'T2 Temporal Piece Chest x5,000', pieces: 5000 },
  t3: { keyword: 'T3 Temporal Piece Chest x10,000', pieces: 10000 },
  t4: { keyword: 'T4 Temporal Piece Chest x50,000', pieces: 50000 },
  t5: { keyword: 'T5 Temporal Piece Chest x100,000', pieces: 100000 },
};

exports.handler = async (event) => {
  const tier  = (event.queryStringParameters?.tier || 't1').toLowerCase();
  const chest = CHESTS[tier] || CHESTS.t1;
  const CORS  = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try {
    // ── Step 1: session cookie ──
    let cookieHeader = 'lng=en-US';
    try {
      const sessionRes = await fetch('https://l9asia.nextmarket.games/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      const rawCookies = sessionRes.headers.get('set-cookie') ?? '';
      const sessionCookie = rawCookies
        .split(/,(?=[^ ])/)
        .map(c => c.trim().split(';')[0])
        .filter(c => c.includes('='))
        .join('; ');
      if (sessionCookie) cookieHeader += `; ${sessionCookie}`;
    } catch (_) {}

    // ── Step 2: fetch listings ──
    const res = await fetch('https://api.nextmarket.games/l9asia/v1/sale/c2c?page=0', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json, text/plain, */*',
        'Origin':        'https://l9asia.nextmarket.games',
        'Referer':       'https://l9asia.nextmarket.games/',
        'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Cookie':        cookieHeader,
      },
      body: JSON.stringify({
        keyword:   chest.keyword,
        sort:      'PRICE_ASC',
        realmCode: 'NEW_REALM',
      }),
      signal: AbortSignal.timeout(8000),
    });

    const data  = await res.json();
    const items = Array.isArray(data.content) ? data.content : [];

    const cheapest = items.find(i =>
      i?.item?.name === chest.keyword && !i?.isOrderInProgress
    ) ?? null;

    // ── Debug: log the full price info so we can see all fields ──
    if (cheapest) {
      console.log('cryptoPriceInfo:', JSON.stringify(cheapest.cryptoPriceInfo));
      console.log('fiatPriceInfo:',   JSON.stringify(cheapest.fiatPriceInfo));
    }

    // fiatPriceInfo may use 'displayPrice', 'krwPrice', 'phpPrice', or nested currency fields
    // Try every plausible field name for PHP price
    const extractPhp = (fiat) => {
      if (!fiat) return null;
      // direct candidates
      return fiat.phpPrice
          ?? fiat.displayPrice
          ?? fiat.localPrice
          ?? fiat.fiatPrice
          ?? fiat.convertedPrice
          ?? fiat.amount
          // some APIs nest by currency code
          ?? fiat['PHP']
          ?? fiat.currencies?.PHP
          ?? null;
    };

    const usdt = cheapest?.cryptoPriceInfo?.price ?? null;
    const php  = extractPhp(cheapest?.fiatPriceInfo);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        type: 'UPDATE',
        // expose raw price info in dev so you can inspect field names
        _debug: cheapest ? {
          cryptoPriceInfo: cheapest.cryptoPriceInfo,
          fiatPriceInfo:   cheapest.fiatPriceInfo,
        } : null,
        data: cheapest ? {
          [tier.toUpperCase()]: {
            pieces:      chest.pieces,
            price:       usdt,
            pricePhp:    php ?? usdt, // fallback to usdt if php extraction fails
            lastUpdated: Date.now(),
          },
        } : null,
      }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};