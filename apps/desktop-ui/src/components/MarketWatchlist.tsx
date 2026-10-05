import { useI18n } from '../i18n';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import type { MarketsState } from '../seris';
import type { Instrument, MarketQuote } from '../../../core/src/markets/types';
import { price, venue, openMarketLink } from './marketUi';
interface Props {
  state?: MarketsState;
  quotes: Record<string, { quote?: MarketQuote; error?: string }>;
  selected?: string;
  onSelect: (i: Instrument) => void;
  onRemove: (i: Instrument) => Promise<void>;
  onConnect: () => Promise<void>;
  onError: (error: string) => void;
}
export function MarketWatchlist({
  state,
  quotes,
  selected,
  onSelect,
  onRemove,
  onConnect,
  onError,
}: Props) {
  const { t, language, locale } = useI18n();
  const [list] = useAutoAnimate<HTMLDivElement>({
    duration: 180,
    easing: 'ease-out',
  });
  return (
    <aside className="market-watchlist" aria-label={t('Watchlist')}>
      <div className="watchlist-title">
        <span>{t('Watchlist')}</span>
        <span>{state?.watchlist.length ?? 0}</span>
      </div>
      {!state?.watchlist.length && (
        <p className="muted watchlist-empty">
          {t('No watched instruments yet. Search and use the star to add one.')}
        </p>
      )}
      <div className="watchlist-rows" ref={list}>
        {state?.watchlist.map((i) => {
          const row = quotes[i.id];
          return (
            <div
              key={i.id}
              className={`watchlist-row ${selected === i.id ? 'selected' : ''}`}
            >
              <button className="watchlist-select" onClick={() => onSelect(i)}>
                <div>
                  <strong>{i.symbol}</strong>
                  <span className="tabular">
                    {row?.quote ? price(row.quote.price, locale) : '—'}
                  </span>
                </div>
                <div>
                  <small>{venue(i, language)}</small>
                  <small
                    className={
                      row?.quote?.changePct != null && row.quote.changePct < 0
                        ? 'down'
                        : 'up'
                    }
                  >
                    {row?.quote?.changePct == null
                      ? ''
                      : `${row.quote.changePct > 0 ? '+' : ''}${row.quote.changePct.toFixed(2)}%`}
                  </small>
                </div>
                {row?.error && (
                  <small className="watchlist-error" title={row.error}>
                    {t('Data disconnected / unavailable')}
                  </small>
                )}
              </button>
              <button
                className="watchlist-remove"
                aria-label={t('Remove {symbol}', { symbol: i.symbol })}
                onClick={() => void onRemove(i)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {!state?.provider.connected && (
        <div className="market-connection">
          <p>
            {t(
              'Connect Longbridge for US stocks, ETF quotes, news and company information.',
            )}
          </p>
          <button
            disabled={state?.provider.connecting}
            onClick={() => void onConnect()}
          >
            {state?.provider.connecting
              ? t('Waiting for authorization…')
              : t('Connect US market data')}
          </button>
          {state?.provider.authorizationUrl && (
            <button
              onClick={() =>
                void openMarketLink(state.provider.authorizationUrl!).catch(
                  (e) => onError(String(e)),
                )
              }
            >
              {t('Open authorization page ↗')}
            </button>
          )}
          {state?.provider.error && (
            <p role="alert">{t('Data connection failed. Please retry.')}</p>
          )}
        </div>
      )}
    </aside>
  );
}
