import { useI18n } from '../i18n';
import type { MessageKey } from '../locales';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { seris } from '../seris';
import type { Instrument } from '../../../core/src/markets/types';
import { venue, instrumentName } from './marketUi';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  watchlist: Instrument[];
  onSelect: (instrument: Instrument) => void;
  onToggle: (instrument: Instrument) => Promise<void>;
  onClose: () => void;
}
export function MarketSearch(p: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Modal
      open={p.open}
      title={t('Search markets')}
      className="market-search-modal"
      onClose={p.onClose}
      initialFocus={input}
    >
      <SearchContent
        watchlist={p.watchlist}
        onSelect={p.onSelect}
        onToggle={p.onToggle}
        onClose={p.onClose}
        inputRef={input}
      />
    </Modal>
  );
}

// Base UI mounts a fresh search with the popup, and retains it through closing.
function SearchContent({
  watchlist,
  onSelect,
  onToggle,
  onClose,
  inputRef,
}: Omit<Props, 'open'> & { inputRef: RefObject<HTMLInputElement> }) {
  const { t, language } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Instrument[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const [retry, setRetry] = useState(0);
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState<string>();
  const toggling = useRef(false);
  const composing = useRef(false);
  useEffect(() => {
    let alive = true;
    const text = query.trim();
    setResults([]);
    setError('');
    setIndex(0);
    setSearching(!!text);
    if (!text) return;
    const timer = window.setTimeout(() => {
      void seris
        .searchMarkets(text)
        .then((r) => {
          if (alive) setResults(r.instruments);
        })
        .catch(() => {
          if (alive) setError('Search unavailable. Please retry.');
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, retry]);
  useEffect(() => {
    document
      .getElementById(`market-result-${index}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const select = (instrument: Instrument) => {
    onSelect(instrument);
    onClose();
  };
  const toggle = async (instrument: Instrument) => {
    if (toggling.current) return;
    toggling.current = true;
    setPending(instrument.id);
    try {
      await onToggle(instrument);
    } catch {
      setError('Watchlist update failed. Please retry.');
    } finally {
      toggling.current = false;
      setPending(undefined);
    }
  };
  return (
    <>
      <input
        ref={inputRef}
        aria-label={t('Search markets')}
        role="combobox"
        aria-expanded={!!query.trim()}
        aria-controls="market-search-list"
        aria-autocomplete="list"
        aria-activedescendant={
          results[index] ? `market-result-${index}` : undefined
        }
        placeholder={t('Search symbol or name, e.g. BTC, NVDA, SPY')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onBlur={() => { composing.current = false; }}
        onKeyDown={(e) => {
          if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
            e.preventDefault();
            setIndex((v) =>
              Math.max(
                0,
                Math.min(
                  results.length - 1,
                  v + (e.key === 'ArrowDown' ? 1 : -1),
                ),
              ),
            );
          } else if (e.key === 'Enter' && results[index]) {
            e.preventDefault();
            select(results[index]);
          }
        }}
      />
      <div className="market-search-status" role="status">
        {(error && t(error)) ||
          (searching
            ? t('Searching…')
            : !query.trim()
              ? t(
                  'Enter a symbol or name to view results; use the star to follow.',
                )
              : !results.length
                ? t('No matches. Try another symbol or name.')
                : results.length === 1
                  ? t('1 result')
                  : t('{count} results', { count: results.length }))}
      </div>
      {error && (
        <button
          className="market-search-retry"
          onClick={() => setRetry((v) => v + 1)}
        >
          {t('Retry search')}
        </button>
      )}
      <div className="market-search-results">
        <div
          id="market-search-list"
          role="listbox"
          aria-label={t('Search results')}
        >
          {results.map((i, n) => (
            <button
              key={i.id}
              id={`market-result-${n}`}
              role="option"
              tabIndex={-1}
              aria-selected={n === index}
              className="market-search-row market-search-select"
              onClick={() => select(i)}
              onFocus={() => setIndex(n)}
            >
              <strong>{i.symbol}</strong>
              <span title={instrumentName(i, language)}>{instrumentName(i, language)}</span>
              <small>{venue(i, language)}</small>
            </button>
          ))}
        </div>
        <div className="market-search-stars">
          {results.map((i) => {
            const watched = watchlist.some((w) => w.id === i.id);
            return (
              <button
                key={i.id}
                disabled={!!pending}
                aria-label={t(
                  watched
                    ? 'Unwatch {symbol} · {venue}'
                    : 'Watch {symbol} · {venue}',
                  { symbol: i.symbol, venue: venue(i, language) },
                )}
                aria-pressed={watched}
                onClick={() => void toggle(i)}
              >
                {pending === i.id ? '…' : watched ? '★' : '☆'}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
