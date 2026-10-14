'use client';

import { Plus, X } from 'lucide-react';
import type { CartTabSummary } from '@/store/cart';
import { useTranslations } from 'use-intl';

interface Props {
  tabs: CartTabSummary[];
  disabled: boolean;
  /** true: an X on each chip (wider chip, easier to tap precisely). false: no X here — a single Cancel button elsewhere targets the active tab. */
  inlineClose: boolean;
  onNew: () => void;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

export default function CartTabStrip({ tabs, disabled, inlineClose, onNew, onSwitch, onClose }: Props) {
  const t = useTranslations('pos');

  const showChips = tabs.length > 1;

  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-2 border-b border-border dark:border-border">
      {showChips && tabs.map((tab) => (
        inlineClose ? (
          <div
            key={tab.id}
            className={`shrink-0 flex items-center gap-3 rounded-lg ps-5 pe-3 py-1.5 min-w-28 text-xs font-medium transition-colors ${
              tab.isActive
                ? 'bg-card text-brand shadow-sm border border-border'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <button
              type="button"
              onClick={() => onSwitch(tab.id)}
              disabled={disabled}
              className="whitespace-nowrap"
            >
              {t('orderTabLabel', { number: tab.number })}
              {tab.itemCount > 0 && <span className="ms-1 tabular-nums">· {tab.itemCount}</span>}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.id)}
              disabled={disabled}
              aria-label={t('closeOrderTabAria', { number: tab.number })}
              className="touch-target rounded-full p-1 -me-1 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSwitch(tab.id)}
            disabled={disabled}
            className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
              tab.isActive
                ? 'bg-card text-brand shadow-sm border border-border'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('orderTabLabel', { number: tab.number })}
            {tab.itemCount > 0 && <span className="ms-1 tabular-nums">· {tab.itemCount}</span>}
          </button>
        )
      ))}
      <button
        type="button"
        onClick={onNew}
        disabled={disabled}
        aria-label={t('newOrderTab')}
        title={t('newOrderTab')}
        className="shrink-0 touch-target rounded-lg border-2 border-dashed border-border px-3 text-muted-foreground hover:text-foreground hover:border-brand/40 transition-colors"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
