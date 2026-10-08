import { contextLabel, time } from './marketUi';
import { instrumentIcon } from './instrumentIcons';
import { BrandIcon } from './BrandIcon';
import { useI18n } from '../i18n';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Markdown } from './Markdown';
import { ApprovalCard } from './ApprovalCard';
import { ApprovalModePicker } from './ApprovalModePicker';
import { TextOutput } from './TextDetails';
import { ModelPicker, connectionModelChoices } from './ModelPicker';
import type {
  HistoryEntry,
  ApprovalMode,
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
  approvalMode: ApprovalMode;
  approvalModePending: boolean;
  onApprovalMode: (mode: ApprovalMode) => void;
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
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const contextIcon = p.context ? instrumentIcon(p.context.instrument.symbol) : null;
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [p.messages]);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = 'auto';
    input.current.style.height = `${Math.min(input.current.scrollHeight, 200)}px`;
  }, [p.draft, p.compact]);
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
          if (!composing.current) p.onSend();
        }}
      >
        {p.context && (
          <div
            className="composer-context"
            title={`${contextLabel(p.context, language)} · ${time(p.context.fetchedAt, locale)}`}
          >
            {contextIcon ? (
              <img src={contextIcon} alt="" className="composer-context-icon" width={18} height={18} />
            ) : (
              <BrandIcon symbol={p.context.instrument.symbol} />
            )}
            <span className="composer-context-symbol">
              {p.context.instrument.symbol}
            </span>
          </div>
        )}
        {p.compact && !p.context && (
          <p className="composer-context">
            {t('No chart attached: data is loading or unavailable')}
          </p>
        )}
        <div className="seris-composer">
          <textarea
            ref={input}
            rows={2}
            aria-label={t('Message')}
            title={t('Enter to send · Shift+Enter for a new line')}
            value={p.draft}
            onChange={(e) => p.onDraft(e.target.value)}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onBlur={() => { composing.current = false; }}
            onKeyDown={(e) => {
              // WebKit can end composition before this keydown and report
              // isComposing=false. keyCode 229 still identifies the IME key.
              if (e.key !== 'Enter' || e.shiftKey) return;
              e.preventDefault();
              if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
              p.onSend();
            }}
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
            <ApprovalModePicker value={p.approvalMode} onChange={p.onApprovalMode} disabled={p.approvalModePending} />
            <div className="composer-actions">
              <div className="composer-model" title={p.busy && p.runningModel ? p.runningModel.modelId : undefined}>
                <ModelPicker
                  choices={p.modelConfig ? connectionModelChoices(p.modelConfig) : []}
                  value={p.modelConfig?.selected ?? null}
                  onChange={s => p.onSelectModel?.(s)}
                  onSettings={p.onModelSettings}
                  compact favorites
                />
              </div>
              {p.busy ? (
                <button type="button" className="composer-submit stop-button" aria-label={t('Stop')} title={t('Stop')} onClick={p.onStop}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                </button>
              ) : (
                <button
                  type="submit"
                  className="composer-submit send-button"
                  aria-label={t('Send ↑')}
                  title={t('Send ↑')}
                  disabled={!p.ready || p.approvalModePending || !p.draft.trim()}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7" /></svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
