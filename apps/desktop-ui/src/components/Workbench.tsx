import { useI18n } from '../i18n';
/**
 * Workbench.tsx — placeholder panels for the remaining workspaces.
 * Strategies / Automation / Portfolio each become a real panel
 * once they have a surface in the gateway. The frame here (empty state,
 * copy tone, spacing) is the one every workbench panel should reuse.
 */

export function PlaceholderPanel({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="pane-enter flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center p-1.5">
          <img
            src="/brand/logos/mark-on-light.svg"
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 dark:hidden"
          />
          <img
            src="/brand/logos/mark-on-dark.svg"
            alt=""
            width={24}
            height={24}
            className="hidden h-6 w-6 dark:block"
          />
        </div>
        <h2 className="text-[17px] font-medium tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {blurb}
        </p>
      </div>
    </div>
  );
}

export function AutomationPanel() {
  const { t } = useI18n();
  return (
    <PlaceholderPanel
      title={t('Automation')}
      blurb={t(
        'Manage what Seris watches for you, trigger conditions and execution history. This page is under development.',
      )}
    />
  );
}
export function PortfolioPanel() {
  const { t } = useI18n();
  return (
    <PlaceholderPanel
      title={t('Portfolio')}
      blurb={t(
        'View accounts, positions, returns and risk. This page is under development.',
      )}
    />
  );
}
