/**
 * Fetches live Temporal Piece Chest prices from the LORDNINE l9asia marketplace.
 *
 * The marketplace is powered by NextMarket. To reproduce exactly what the
 * marketplace site shows, we POST to the same C2C search endpoint the site uses:
 *
 *   { "keyword": "Temporal Piece Chest", "realmCode": "OLD_REALM" }
 *
 * We deliberately do NOT send `sort`, `fiatCurrency` or `country` — those extra
 * parameters make the endpoint fall back to returning the cheapest arbitrary
 * marketplace items instead of the keyword results, which is why the prices
 * previously did not match the l9marketplace.
 *
 * The endpoint returns ~20 results per page and they are not price-sorted, so we
 * paginate until every tier (T1–T5) has been found, then dedupe and sort by price.
 */

const CHESTS = {
  t1: { keyword: 'T1 Temporal Piece Chest x1,000',    pieces: 1000   },
  t2: { keyword: 'T2 Temporal Piece Chest x5,000',    pieces: 5000   },
  t3: { keyword: 'T3 Temporal Piece Chest x10,000',   pieces: 10000  },
  t4: { keyword: 'T4 Temporal Piece Chest x50,000',   pieces: 50000  },
  t5: { keyword: 'T5 Temporal Piece Chest x100,000',  pieces: 100000 },
};
const TIER_BY_NAME = Object.fromEntries(
  Object.entries(CHESTS).map(([tier, chest]) => [chest.keyword, tier])
);

const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const REALM_CODE = 'OLD_REALM';
const MARKET_ORIGIN = 'https://l9asia.nextmarket.games';
const MARKETPLACE_URL = `${MARKET_ORIGIN}/marketplace?viewType=fiat&realmCode=${REALM_CODE}`;
const MARKET_API_URL = 'https://api.nextmarket.games/l9asia/v1/sale/c2c';
const SEARCH_KEYWORD = 'Temporal Piece Chest';
const PAGE_SIZE = 20;
const MIN_SCAN_PAGES = 16;                    // reliably surfaces all 5 tiers
const MAX_PAGES = 24;                         // hard cap
const MAX_CONSECUTIVE_EMPTY_PAGES = 8;        // stop once chests stop appearing
const round2 = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
const round6 = (value) => Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : 0;

// Used only when a listing's fiat price is not reported in PHP.
const FALLBACK_USDT_TO_PHP = 61.75;
const EXCHANGE_RATE_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=USDT';

async function getUsdtToPhpRate() {
  try {
    const res = await fetch(EXCHANGE_RATE_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`Exchange rate API returned ${res.status}`);
    const data = await res.json();
    const rate = Number(data?.data?.rates?.PHP);
    if (Number.isFinite(rate) && rate > 0) return rate;
  } catch (err) {
    console.warn('USDT/PHP rate fetch failed:', err?.message);
  }
  return FALLBACK_USDT_TO_PHP;
}

async function getSessionCookie() {
  // Best-effort: mirror the cookie set by a normal browser visit to the
  // marketplace so the API call behaves exactly like the site does.
  try {
    const sessionRes = await fetch(MARKETPLACE_URL, {
      headers: {
        'User-Agent':      UA,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-PH,en;q=0.9',
        'Cookie':          'lng=en-US; country=PH; currency=PHP',
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
    return cookies ? `lng=en-US; country=PH; currency=PHP; ${cookies}` : 'lng=en-US; country=PH; currency=PHP';
  } catch (err) {
    console.warn('Cookie fetch failed:', err?.message);
    return 'lng=en-US; country=PH; currency=PHP';
  }
}

/**
 * Paginates the marketplace search and returns every Temporal Piece Chest
 * listing found, grouped by tier:  { t1: Map<id, item>, t2: Map<id, item>, ... }
 */
async function fetchChestListings(cookieHeader, limit) {
  const byTier = {};
  let consecutiveEmptyPages = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${MARKET_API_URL}?page=${page}`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'en-PH,en;q=0.9',
        'Origin':          MARKET_ORIGIN,
        'Referer':         MARKETPLACE_URL,
        'User-Agent':      UA,
        'Cookie':          cookieHeader,
      },
      body: JSON.stringify({ keyword: SEARCH_KEYWORD, realmCode: REALM_CODE }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Market API returned ${res.status}`);

    const data = await res.json();
    const items = Array.isArray(data.content) ? data.content : [];

    let addedThisPage = 0;
    for (const item of items) {
      const name = item?.item?.name;
      const tier = TIER_BY_NAME[name];
      if (!tier || item?.isOrderInProgress) continue;
      const id = item?.id;
      const bucket = byTier[tier] || (byTier[tier] = new Map());
      if (id != null && !bucket.has(id)) {
        bucket.set(id, item);
        addedThisPage++;
      }
    }

    // End of the result set.
    if (items.length < PAGE_SIZE) break;

    const enoughForEveryTier = Object.keys(CHESTS).every(
      (tier) => (byTier[tier]?.size || 0) >= limit
    );

    // Always scan at least MIN_SCAN_PAGES before allowing an early exit, so a
    // sparse tier (e.g. T3) still has time to show up.
    if (page + 1 >= MIN_SCAN_PAGES) {
      if (enoughForEveryTier) break;
      consecutiveEmptyPages = addedThisPage > 0 ? 0 : consecutiveEmptyPages + 1;
      if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_PAGES) break;
    }
  }

  return byTier;
}

function mapListing(item, tier, rank, usdtToPhp) {
  const chest = CHESTS[tier];
  const usdt = Number(item?.cryptoPriceInfo?.price);
  const fiat = item?.fiatPriceInfo;
  const fiatPrice = Number(fiat?.price);

  const priceUsdt = round2(Number.isFinite(usdt) ? usdt : 0);
  const pricePhp = round2(
    fiat?.currencyType === 'PHP' && Number.isFinite(fiatPrice) && fiatPrice > 0
      ? fiatPrice
      : priceUsdt * usdtToPhp
  );
  const conversionRate = priceUsdt > 0 && pricePhp > 0 ? round6(pricePhp / priceUsdt) : usdtToPhp;

  return {
    rank,
    seller: item?.seller?.userName || 'Unknown',
    quantity: item?.quantity || item?.item?.amount || 1,
    itemName: item?.item?.name || chest.keyword,
    imageUrl: item?.item?.imageUrl || '',
    priceUsdt,
    pricePhp,
    unitPriceUsdt: round6(priceUsdt / chest.pieces),
    unitPricePhp: round6(pricePhp / chest.pieces),
    fiatCurrency: fiat?.currencyType ?? 'USD',
    conversionRate,
    tier,
  };
}

export const handler = async (event) => {
  console.log('Market Price function called');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const limit = Math.min(parseInt(event.queryStringParameters?.limit || '10', 10) || 10, 30);

  try {
    const [cookieHeader, usdtToPhp] = await Promise.all([
      getSessionCookie(),
      getUsdtToPhpRate(),
    ]);

    const byTier = await fetchChestListings(cookieHeader, limit);

    const data = {};
    let count = 0;
    for (const [tierKey, chest] of Object.entries(CHESTS)) {
      const raw = Array.from(byTier[tierKey]?.values() || []);
      const mapped = raw
        .map((item, idx) => mapListing(item, tierKey, idx + 1, usdtToPhp))
        .sort((a, b) => a.priceUsdt - b.priceUsdt || a.pricePhp - b.pricePhp);
      const listings = mapped.slice(0, limit);
      const cheapest = listings[0] || null;

      data[tierKey.toUpperCase()] = {
        pieces: chest.pieces,
        price: cheapest?.priceUsdt ?? null,
        pricePhp: cheapest?.pricePhp ?? null,
        fiatCurrency: cheapest?.fiatCurrency ?? 'USD',
        conversionRate: cheapest?.conversionRate ?? FALLBACK_USDT_TO_PHP,
        lastUpdated: Date.now(),
        listings,
      };
      count += mapped.length;
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        type: 'UPDATE',
        tier: 'ALL',
        limit,
        count,
        data,
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
