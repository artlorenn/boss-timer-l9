const CHESTS = {
  t1: { keyword: 'T1 Temporal Piece Chest x1,000',    pieces: 1000   },
  t2: { keyword: 'T2 Temporal Piece Chest x5,000',    pieces: 5000   },
  t3: { keyword: 'T3 Temporal Piece Chest x10,000',   pieces: 10000  },
  t4: { keyword: 'T4 Temporal Piece Chest x50,000',   pieces: 50000  },
  t5: { keyword: 'T5 Temporal Piece Chest x100,000',  pieces: 100000 },
};

const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const tier  = (event.queryStringParameters?.tier || 't1').toLowerCase();
  const chest = CHESTS[tier] || CHESTS.t1;

  try {
    // ── Step 1: session cookie (retry up to 3x) ──
    let cookieHeader = 'lng=en-US';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const sessionRes = await fetch('https://l9asia.nextmarket.games/', {
          headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(5000),
        });
        const raw = sessionRes.headers.get('set-cookie') ?? '';
        // split on comma NOT followed by space (avoids splitting expires= dates)
        const cookies = raw
          .split(/,(?=[^ ])/)
          .map(c => c.trim().split(';')[0])
          .filter(c => c.includes('='))
          .join('; ');
        if (cookies) { cookieHeader += `; ${cookies}`; break; }
      } catch (err) {
        console.warn(`Cookie attempt ${attempt + 1} failed:`, err.message);
      }
    }

    console.log('Final cookie header:', cookieHeader);

    // ── Step 2: market listings ──
    const res = await fetch('https://api.nextmarket.games/l9asia/v1/sale/c2c?page=0', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json, text/plain, */*',
        'Origin':       'https://l9asia.nextmarket.games',
        'Referer':      'https://l9asia.nextmarket.games/',
        'User-Agent':   UA,
        'Cookie':       cookieHeader,
      },
      body: JSON.stringify({
        keyword:   chest.keyword,
        sort:      'PRICE_ASC',
        realmCode: 'NEW_REALM',
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Market API returned ${res.status}`);

    const data     = await res.json();
    const items    = Array.isArray(data.content) ? data.content : [];
    const cheapest = items.find(i => i?.item?.name === chest.keyword && !i?.isOrderInProgress) ?? null;

    console.log(`Items found: ${items.length}, cheapest: ${cheapest ? 'yes' : 'no'}`);
    if (cheapest) {
      console.log('cryptoPriceInfo:', JSON.stringify(cheapest.cryptoPriceInfo));
      console.log('fiatPriceInfo:',   JSON.stringify(cheapest.fiatPriceInfo));
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        type: 'UPDATE',
        data: cheapest ? {
          [tier.toUpperCase()]: {
            pieces:      chest.pieces,
            price:       cheapest.cryptoPriceInfo?.price ?? null,
            pricePhp:    cheapest.fiatPriceInfo?.price   ?? null,
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