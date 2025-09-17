const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };

const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const fallbackBySource = {
  Bloomberg: [
    {
      title: 'Tech Shares Lift Major Indexes to Fresh Highs',
      url: 'https://www.bloomberg.com/markets',
      source: 'Bloomberg',
      publishedAt: hoursAgo(1),
      description: 'US equities extend gains as megacap tech stocks lead another leg higher.',
    },
    {
      title: 'Energy Executives See Oil Demand Holding Firm Into 2025',
      url: 'https://www.bloomberg.com/energy',
      source: 'Bloomberg',
      publishedAt: hoursAgo(4),
      description: 'Producers say refinery runs and aviation demand remain resilient despite slowing growth.',
    },
  ],
  Reuters: [
    {
      title: 'Dollar Eases as Traders Brace for Key Inflation Data',
      url: 'https://www.reuters.com/markets',
      source: 'Reuters',
      publishedAt: hoursAgo(2),
      description: 'The greenback slips ahead of the latest US inflation report while Treasury yields steady.',
    },
    {
      title: 'Global Automakers Map Out Next Wave of EV Investments',
      url: 'https://www.reuters.com/business/autos-transportation',
      source: 'Reuters',
      publishedAt: hoursAgo(6),
      description: 'Manufacturers detail spending plans on new battery platforms and software upgrades.',
    },
  ],
  Yahoo: [
    {
      title: 'Analysts Highlight AI Winners Going Into Earnings Season',
      url: 'https://finance.yahoo.com/',
      source: 'Yahoo Finance',
      publishedAt: hoursAgo(3),
      description: 'Strategists flag semiconductor and cloud companies as beneficiaries of accelerating AI demand.',
    },
    {
      title: 'How Retail Investors Are Positioning Around Fed Decisions',
      url: 'https://finance.yahoo.com/topic/markets/',
      source: 'Yahoo Finance',
      publishedAt: hoursAgo(8),
      description: 'Flows into sector ETFs show investors leaning defensive while watching policy clues.',
    },
  ],
};

const cloneArticles = (arr = []) => arr.map((item) => ({ ...item }));

let cachedArticles = {
  Bloomberg: cloneArticles(fallbackBySource.Bloomberg),
  Reuters: cloneArticles(fallbackBySource.Reuters),
  Yahoo: cloneArticles(fallbackBySource.Yahoo),
  All: cloneArticles([
    ...fallbackBySource.Bloomberg,
    ...fallbackBySource.Reuters,
    ...fallbackBySource.Yahoo,
  ]),
};

const SOURCE_CONFIG = {
  All: { domains: 'bloomberg.com,reuters.com,finance.yahoo.com', query: 'stocks OR markets' },
  Bloomberg: { domains: 'bloomberg.com', query: 'stocks OR markets' },
  Reuters: { domains: 'reuters.com', query: 'stocks OR markets' },
  Yahoo: { domains: 'finance.yahoo.com', query: 'stocks OR markets' },
};

const buildResponse = (source, articles, extra = {}) =>
  Response.json(
    { source, articles, ...extra },
    { headers: { ...corsHeaders, 'cache-control': 'no-store' } }
  );

const fallbackResponse = (source, extra = {}) =>
  buildResponse(source, cachedArticles[source] || cachedArticles.All || [], {
    fromCache: true,
    ...extra,
  });

export default async (request) => {
  if (request.method && request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const rawSource = url.searchParams.get('source') || 'All';
  const source = SOURCE_CONFIG[rawSource] ? rawSource : 'All';

  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return fallbackResponse(source, { warning: 'NEWS_API_KEY not configured' });
  }

  try {
    const apiUrl = new URL('https://newsapi.org/v2/everything');
    const { domains, query } = SOURCE_CONFIG[source];
    apiUrl.searchParams.set('language', 'en');
    apiUrl.searchParams.set('sortBy', 'publishedAt');
    apiUrl.searchParams.set('pageSize', '10');
    apiUrl.searchParams.set('q', query || 'markets');
    if (domains) apiUrl.searchParams.set('domains', domains);

    const response = await fetch(apiUrl, {
      headers: { 'X-Api-Key': apiKey },
    });

    if (!response.ok) {
      throw new Error(`Upstream error ${response.status}`);
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.articles)) {
      throw new Error('Malformed news payload');
    }

    const articles = payload.articles
      .filter((article) => article && article.title && article.url)
      .map((article) => ({
        title: article.title,
        url: article.url,
        source: article.source?.name || source,
        publishedAt: article.publishedAt || new Date().toISOString(),
        description: article.description || '',
      }));

    if (!articles.length) {
      throw new Error('No articles returned');
    }

    cachedArticles[source] = articles;
    if (source === 'All') {
      cachedArticles.All = articles;
    }

    return buildResponse(source, articles, { fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('news function error', error);
    return fallbackResponse(source, { error: 'news fetch failed', detail: String(error) });
  }
};
