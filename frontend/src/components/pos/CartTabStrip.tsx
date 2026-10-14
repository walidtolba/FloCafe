'use client';

import { Plus, X } from 'lucide-react';
import type { CartTabSummary } from '@/store/cart';
import { useTranslations } from 'use-intl';

interface Props {
  tabs: CartTabSummary[];
  disabled: boolean;
  /** true: an X on each chip (wider chip, easier to tap precisely). false: no X here — a single Cancel button elsewhere targets the active tab. */
  inlineClose: boolean;
  /** Chip min-width in px, user-configurable (Settings > POS Workflow) when inlineClose is on. */
  chipWidth: number;
  /** Chip height in px, user-configurable — fixed independently of closeButtonSize. */
  chipHeight: number;
  /** Diameter (px) of the circular close button, user-configurable, when inlineClose is on. */
  closeButtonSize: number;
  onNew: () => void;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

export default function CartTabStrip({ tabs, disabled, inlineClose, chipWidth, chipHeight, closeButtonSize, onNew, onSwitch, onClose }: Props) {
  const t = useTranslations('pos');

  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-2 border-b border-border dark:border-border">
      {tabs.map((tab) => (
        inlineClose ? (
          <div
            key={tab.id}
            style={{ minWidth: chipWidth, height: chipHeight, minHeight: chipHeight }}
            className={`shrink-0 flex items-center justify-between gap-5 rounded-lg ps-7 pe-3 font-medium transition-colors ${
              tab.isActive
                ? 'bg-card text-brand shadow-sm border border-border'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <button
              type="button"
              onClick={() => onSwitch(tab.id)}
              disabled={disabled}
              className="whitespace-nowrap text-base"
            >
              {t('orderTabLabel', { number: tab.number })}
              {tab.itemCount > 0 && <span className="ms-1 tabular-nums text-sm">· {tab.itemCount}</span>}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.id)}
              disabled={disabled}
              aria-label={t('closeOrderTabAria', { number: tab.number })}
              style={{ width: closeButtonSize, height: closeButtonSize, minWidth: closeButtonSize, minHeight: closeButtonSize }}
              className="touch-target shrink-0 ms-auto flex items-center justify-center rounded-full bg-red-500/15 text-red-600 hover:bg-red-500/25 hover:text-red-700 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30 dark:hover:text-red-300"
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
            style={{ height: chipHeight, minHeight: chipHeight }}
            className={`shrink-0 whitespace-nowrap rounded-lg px-4 text-base font-medium transition-colors ${
              tab.isActive
                ? 'bg-card text-brand shadow-sm border border-border'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('orderTabLabel', { number: tab.number })}
            {tab.itemCount > 0 && <span className="ms-1 tabular-nums text-sm">· {tab.itemCount}</span>}
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
