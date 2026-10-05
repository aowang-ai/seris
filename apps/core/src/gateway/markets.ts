import { getMarketService, type MarketService } from '../markets/service.js';
import { PublicMarketProvider } from '../markets/providers.js';
import { parseInstrument, parseInterval } from '../markets/types.js';

/** One route family uses the same business service as Agent tools. */
export async function marketRoute(
  path: string,
  method: string,
  url: URL,
  body: () => Promise<any>,
  service: MarketService = getMarketService(),
): Promise<unknown | undefined> {
  if (!path.startsWith('/api/markets/')) return undefined;
  if (path === '/api/markets/state' && method === 'GET')
    return {
      watchlist: service.watchlist(),
      alerts: service.alerts(),
      notifications: service.notifications(),
      provider:
        service.provider instanceof PublicMarketProvider
          ? service.provider.longbridge.status()
          : { connected: true, connecting: false },
    };
  if (path === '/api/markets/connect' && method === 'POST') {
    if (!(service.provider instanceof PublicMarketProvider))
      throw new Error('Provider has no authorization flow');
    return service.provider.longbridge.connect();
  }
  if (path === '/api/markets/search' && method === 'GET')
    return {
      instruments: await service.provider.search(
        (url.searchParams.get('q') ?? '').slice(0, 80),
      ),
    };
  if (path === '/api/markets/watchlist' && method === 'POST')
    return { watchlist: service.add((await body()).instrument) };
  if (path === '/api/markets/watchlist/remove' && method === 'POST')
    return { watchlist: service.remove(String((await body()).id)) };
  if (path === '/api/markets/quotes' && method === 'GET')
    return { quotes: await service.quotes() };
  if (path === '/api/markets/chart' && method === 'POST') {
    const value = await body();
    return service.chart(
      parseInstrument(value.instrument),
      parseInterval(value.interval),
    );
  }
  if (path === '/api/markets/snapshot' && method === 'GET')
    return service.snapshot(url.searchParams.get('id') ?? '');
  if (path === '/api/markets/news' && method === 'POST')
    return {
      news: await service.news(parseInstrument((await body()).instrument)),
    };
  if (path === '/api/markets/alerts' && method === 'POST') {
    const value = await body();
    return { alert: service.createAlert(value.rule, value.requestId) };
  }
  if (path === '/api/markets/alerts/status' && method === 'POST') {
    const value = await body();
    return { alert: service.setAlert(value.id, value.status) };
  }
  throw new Error('Unknown Markets route');
}
