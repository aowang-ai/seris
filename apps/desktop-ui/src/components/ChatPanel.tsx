import { contextLabel, time } from './marketUi';
import { useI18n } from '../i18n';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Markdown } from './Markdown';
import { ApprovalCard } from './ApprovalCard';
import { TextOutput } from './TextDetails';
import { ModelPicker, connectionModelChoices } from './ModelPicker';
import type {
  HistoryEntry,
  ApprovalRequest,
  ModelConfig,
  ModelSelection,
  RunRecord,
} from '../seris';
import {
  type MarketContext,
  type MarketAction,
} from '../../../core/src/markets/types';

export interface ChatPanelProps {
  modelConfig?: ModelConfig | null;
  onSelectModel?: (selection: ModelSelection) => void;
  onModelSettings?: () => void;
  runningModel?: RunRecord['model'];
  messages: HistoryEntry[];
  draft: string;
  onDraft: (text: string) => void;
  busy: boolean;
  ready: boolean;
  onSend: () => void;
  onStop: () => void;
  approvals: ApprovalRequest[];
  onApprove: (p: ApprovalRequest, allowed: boolean) => void;
  context?: MarketContext;
  onMarketAction: (action: MarketAction) => void;
  compact?: boolean;
  header?: ReactNode;
}

function ToolResult({ message: m }: { message: HistoryEntry }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const outputId = useId();
  const label = t(m.pending ? 'Using {tool}…' : m.isError ? '{tool} failed' : 'Used {tool}', { tool: m.toolName ?? '' });
  return (
    <div className="chat-tool">
      <button
        type="button"
        className={`chat-tool-trigger ${m.pending ? 'pending' : m.isError ? 'failed' : ''}`}
        disabled={!m.text}
        aria-expanded={m.text ? open : undefined}
        aria-controls={m.text ? outputId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className="chat-tool-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="3.5" />
          <circle cx="17.5" cy="17.5" r="3.5" />
          <path d="M15 4.5a3.5 3.5 0 0 1 5 5l-2 2a3.5 3.5 0 0 1-5-5Zm-8 8a3.5 3.5 0 0 1 5 5l-2 2a3.5 3.5 0 0 1-5-5Z" />
        </svg>
        <span>{label}</span>
        {m.text && (
          <svg className="chat-tool-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        )}
      </button>
      {m.text && (
        <div id={outputId} className="chat-tool-output" hidden={!open}>
          {open && <TextOutput text={m.text} formatJson />}
        </div>
      )}
    </div>
  );
}

export function ChatPanel(p: ChatPanelProps) {
  const { t, language, locale } = useI18n();
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [p.messages]);
  return (
    <section
      className={`chat-panel ${p.compact ? 'chat-compact' : ''}`}
      aria-label={p.compact ? t('Markets Chat') : t('Chat conversation')}
    >
      {p.header}
      <div ref={log} className="chat-transcript">
        <div className="chat-messages">
          {!p.messages.length && (
            <div className="chat-empty">
              <img
                src="/brand/logos/mark-on-light.svg"
                alt=""
                className="dark:hidden"
              />
              <img
                src="/brand/logos/mark-on-dark.svg"
                alt=""
                className="hidden dark:block"
              />
              <h1>
                {p.compact
                  ? t('Let’s discuss this market')
                  : t('What’s your desk doing?')}
              </h1>
              <p>
                {p.compact
                  ? t(
                      'Ask about trends, news or company fundamentals, or let Seris set an alert. Your current chart is attached when you send.',
                    )
                  : t(
                      'Ask about markets, understand what changed, or give Seris a mandate.',
                    )}
              </p>
              {!p.compact &&
                [
                  t('What is BTC funding on Hyperliquid vs Binance?'),
                  t(
                    'Analyze NVDA’s recent performance and company fundamentals',
                  ),
                ].map((q) => (
                  <button
                    key={q}
                    className="chat-suggestion"
                    onClick={() => p.onDraft(q)}
                  >
                    {q}
                  </button>
                ))}
            </div>
          )}
          {p.messages.map((m) => (
            <div key={m.id} className={`msg-enter chat-message chat-${m.role}`}>
              {m.role === 'user' ? (
                <div className="chat-bubble">
                  {m.marketContext && (
                    <button
                      className="context-chip"
                      onClick={() =>
                        p.onMarketAction({
                          id: m.marketContext!.viewId,
                          kind: 'view',
                          originViewId: m.marketContext!.viewId,
                          context: m.marketContext!,
                          label: contextLabel(m.marketContext!, language),
                        })
                      }
                      title={`${m.marketContext.source} · ${time(m.marketContext.fetchedAt, locale)}`}
                    >
                      {contextLabel(m.marketContext, language)} ·{' '}
                      {t('View snapshot ↗')}
                    </button>
                  )}
                  {m.text}
                </div>
              ) : m.role === 'tool' ? (
                <ToolResult message={m} />
              ) : (
                <div className="chat-answer">
                  <Markdown text={m.text} />
                  {m.pending && <span className="caret-blink">▏</span>}
                </div>
              )}
              {m.marketAction && (
                <button
                  className="market-action"
                  onClick={() => p.onMarketAction(m.marketAction!)}
                >
                  {m.marketAction.kind === 'view'
                    ? t('View {context}', {
                        context: contextLabel(m.marketAction.context, language),
                      })
                    : m.marketAction.label}{' '}
                  ↗
                </button>
              )}
            </div>
          ))}
          {p.busy && p.messages.at(-1)?.role === 'user' && (
            <p className="muted">{t('Thinking…')}</p>
          )}
          {p.approvals.map((a) => (
            <ApprovalCard key={a.id} approval={a} onApprove={p.onApprove} />
          ))}
        </div>
      </div>
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          p.onSend();
        }}
      >
        {p.context && (
          <div
            className="composer-context"
            title={`${p.context.source} · ${time(p.context.fetchedAt, locale)}`}
          >
            <span>{contextLabel(p.context, language)}</span>
            <span>
              {p.context.selectedRange
                ? t('Selected range')
                : p.context.visibleRange
                  ? t('Visible range')
                  : t('Chart snapshot')}
            </span>
          </div>
        )}
        {p.compact && !p.context && (
          <p className="composer-context">
            {t('No chart attached: data is loading or unavailable')}
          </p>
        )}
        <div className="seris-composer">
          <input
            aria-label={t('Message')}
            value={p.draft}
            onChange={(e) => p.onDraft(e.target.value)}
            placeholder={
              !p.ready
                ? t('Configure the model to begin…')
                : p.compact
                  ? t('Ask about this instrument…')
                  : t('Give Seris a mandate…')
            }
            disabled={!p.ready}
          />
          <div className="composer-controls">
            <div className="flex min-w-0 items-center gap-2">
              {!!p.modelConfig?.selected && (
                <ModelPicker
                  choices={connectionModelChoices(p.modelConfig!)}
                  value={p.modelConfig!.selected}
                  onChange={s => p.onSelectModel?.(s)}
                  compact favorites
                />
              )}
              <button
                type="button"
                aria-label={t('Model settings')}
                onClick={p.onModelSettings}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 3-.5 2a8 8 0 0 0-2 1L4.5 5.5 2 10l1.5 1.5a8 8 0 0 0 0 2L2 15l2.5 4.5 2-.5a8 8 0 0 0 2 1l.5 2h6l.5-2a8 8 0 0 0 2-1l2 .5L22 15l-1.5-1.5a8 8 0 0 0 0-2L22 10l-2.5-4.5-2 .5a8 8 0 0 0-2-1L15 3Z" />
                  <circle cx="12" cy="12.5" r="3" />
                </svg>
              </button>
              {p.runningModel && (
                <span
                  className="max-w-[120px] truncate"
                  title={p.runningModel.modelId}
                >
                  {p.runningModel.modelId}
                </span>
              )}
            </div>
            <div>
              {p.busy && (
                <button type="button" onClick={p.onStop}>
                  {t('Stop')}
                </button>
              )}
              <button
                type="submit"
                className="send-button"
                disabled={!p.ready || p.busy || !p.draft.trim()}
              >
                {t('Send ↑')}
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
