const CHESTS = {
  t1: { keyword: 'T1 Temporal Piece Chest x1,000', pieces: 1000 },
  t2: { keyword: 'T2 Temporal Piece Chest x5,000', pieces: 5000 },
  t3: { keyword: 'T3 Temporal Piece Chest x10,000', pieces: 10000 },
  t4: { keyword: 'T4 Temporal Piece Chest x50,000', pieces: 50000 },
  t5: { keyword: 'T5 Temporal Piece Chest x100,000', pieces: 100000 },
};

exports.handler = async (event) => {
  const tier = event.queryStringParameters?.tier || 't1';
  const chest = CHESTS[tier] || CHESTS.t1;

  try {
    // Get guest session cookie first
    const sessionRes = await fetch('https://l9asia.nextmarket.games/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });

    const rawCookies = sessionRes.headers.get('set-cookie') || '';
    const sessionCookie = rawCookies
      .split(',')
      .map(c => c.trim().split(';')[0])
      .filter(c => c.startsWith('SESSION_COOKIE_STORE'))
      .join('; ');

    const cookieHeader = `lng=en-US; ${sessionCookie}`;

    // Fetch listings
    const res = await fetch('https://api.nextmarket.games/l9asia/v1/sale/c2c?page=0', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://l9asia.nextmarket.games',
        'Referer': 'https://l9asia.nextmarket.games/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Cookie': cookieHeader,
      },
      body: JSON.stringify({
        keyword: chest.keyword,
        sort: 'PRICE_ASC',
        realmCode: 'NEW_REALM'
      })
    });

    const data = await res.json();
    const items = data.content || [];

    const cheapest = items.find(i =>
      i.item?.name === chest.keyword && !i.isOrderInProgress
    ) ?? null;

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        type: 'UPDATE',
        data: cheapest ? {
          [tier.toUpperCase()]: {
            pieces: chest.pieces,
            price: cheapest.cryptoPriceInfo.price,
            pricePhp: cheapest.fiatPriceInfo.price,
            lastUpdated: Date.now()
          }
        } : null
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};