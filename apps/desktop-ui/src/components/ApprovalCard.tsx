/**
 * ApprovalCard — the per-tool "may I?" bubble shown in chat when a gated
 * tool (terminal, file write, strategy save, ...) needs user confirmation.
 *
 * Renders the tool's arguments in the most readable form available for that
 * tool. For `strategy_save_draft`, the `source` and `skillDoc` strings are
 * shown as syntax-highlighted code blocks; other tools fall back to a
 * compact JSON view. The Reject/Allow buttons mirror the existing behaviour.
 */

import { useState, type JSX } from 'react';
import { CodeBlock } from './CodeBlock';
import { useI18n } from '../i18n';
import type { ApprovalRequest } from '../seris';

interface DraftArgs {
  name?: string;
  description?: string;
  source?: string;
  skillDoc?: string;
}

function isDraftArgs(args: unknown): args is DraftArgs {
  const a = args as DraftArgs;
  return !!a && typeof a === 'object' && (typeof a.source === 'string' || typeof a.skillDoc === 'string');
}

export function ApprovalCard(props: {
  approval: ApprovalRequest;
  onApprove: (p: ApprovalRequest, allowed: boolean) => void;
}): JSX.Element {
  const { approval: a, onApprove } = props;
  const { t } = useI18n();
  const [tab, setTab] = useState<'code' | 'doc' | 'args'>('code');
  const draft = isDraftArgs(a.args) ? (a.args as DraftArgs) : null;
  const isDraft = a.toolName === 'strategy_save_draft' && draft !== null;

  return (
    <div className="chat-approval">
      <strong>{t('Approve {tool}', { tool: a.toolName })}</strong>

      {isDraft && (
        <>
          <div className="chat-approval-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>
              strategy.ts
            </button>
            <button role="tab" aria-selected={tab === 'doc'} onClick={() => setTab('doc')}>
              SKILL.md
            </button>
            <button role="tab" aria-selected={tab === 'args'} onClick={() => setTab('args')}>
              {t('Arguments')}
            </button>
          </div>
          {tab === 'code' && draft.source !== undefined && (
            <CodeBlock code={draft.source} language="typescript" maxHeight={420} />
          )}
          {tab === 'doc' && draft.skillDoc !== undefined && (
            <CodeBlock code={draft.skillDoc} language="markdown" maxHeight={300} />
          )}
          {tab === 'args' && <pre>{JSON.stringify(a.args, null, 2)}</pre>}
        </>
      )}

      {!isDraft && <pre>{JSON.stringify(a.args, null, 2)}</pre>}

      <div className="chat-approval-actions">
        <button onClick={() => onApprove(a, true)}>{t('Allow once')}</button>
        <button onClick={() => onApprove(a, false)}>{t('Reject')}</button>
      </div>
    </div>
  );
}
