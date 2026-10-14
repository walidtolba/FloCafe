'use client';

import { Plus, X } from 'lucide-react';
import type { CartTabSummary } from '@/store/cart';
import { useTranslations } from 'use-intl';

interface Props {
  tabs: CartTabSummary[];
  disabled: boolean;
  onNew: () => void;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

export default function CartTabStrip({ tabs, disabled, onNew, onSwitch, onClose }: Props) {
  const t = useTranslations('pos');

  const showChips = tabs.length > 1;

  return (
    <div className="flex gap-1 overflow-x-auto px-4 py-2 border-b border-border dark:border-border">
      {showChips && tabs.map((tab) => (
        <div
          key={tab.id}
          className={`shrink-0 flex items-center gap-1 rounded-lg ps-3 pe-1 py-1.5 text-xs font-medium transition-colors ${
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
            className="touch-target rounded-full p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
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
