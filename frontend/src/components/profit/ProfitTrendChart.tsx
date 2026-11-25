'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

export interface ProfitPoint {
  period: string;
  netSales: number;
  cost: number;
  profit: number;
}

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { top: 16, right: 12, bottom: 28, left: 12 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

export function ProfitTrendChart({ series, labelFor }: { series: ProfitPoint[]; labelFor: (period: string) => string }) {
  const t = useTranslations('profit');
  const fmt = useFormatCurrency();
  const [hovered, setHovered] = useState<number | null>(null);

  const max = niceMax(Math.max(0, ...series.flatMap((p) => [p.netSales, p.cost, p.profit])));
  const min = Math.min(0, ...series.map((p) => p.profit));
  const lowest = min < 0 ? -niceMax(-min) : 0;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const y = (value: number) => PAD.top + innerH - ((value - lowest) / (max - lowest)) * innerH;
  const slot = innerW / Math.max(series.length, 1);
  const barW = Math.max(2, Math.min(24, slot * 0.34));
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  const zeroY = y(0);

  const linePoints = series.map((p, i) => `${cx(i)},${y(p.profit)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(series.length / 8));
  const active = hovered != null ? series[hovered] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={t('trendTitle')}
        onMouseLeave={() => setHovered(null)}
      >
        {[0.25, 0.5, 0.75, 1].map((fraction) => {
          const value = lowest + (max - lowest) * fraction;
          return <line key={fraction} x1={PAD.left} x2={WIDTH - PAD.right} y1={y(value)} y2={y(value)} className="stroke-border" strokeDasharray="3 4" />;
        })}
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={zeroY} y2={zeroY} className="stroke-muted-foreground/50" />
        {series.map((p, i) => (
          <g key={p.period}>
            <rect x={cx(i) - barW - 1} y={Math.min(y(p.netSales), zeroY)} width={barW} height={Math.abs(zeroY - y(p.netSales))} rx={2} className="fill-sky-500/80" />
            <rect x={cx(i) + 1} y={Math.min(y(p.cost), zeroY)} width={barW} height={Math.abs(zeroY - y(p.cost))} rx={2} className="fill-orange-400/80" />
            {i % labelEvery === 0 && (
              <text x={cx(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">{labelFor(p.period)}</text>
            )}
            <rect
              x={PAD.left + slot * i}
              y={PAD.top}
              width={slot}
              height={innerH}
              className={hovered === i ? 'fill-foreground/5' : 'fill-transparent'}
              onMouseEnter={() => setHovered(i)}
            />
          </g>
        ))}
        {series.length > 1 && <polyline points={linePoints} fill="none" strokeWidth={2.5} strokeLinejoin="round" className="stroke-emerald-600 dark:stroke-emerald-400" />}
        {series.map((p, i) => (
          <circle key={p.period} cx={cx(i)} cy={y(p.profit)} r={hovered === i ? 5 : 3} className={p.profit < 0 ? 'fill-red-500' : 'fill-emerald-600 dark:fill-emerald-400'} />
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-sky-500/80" />{t('netSales')}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-orange-400/80" />{t('cost')}</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-emerald-600 dark:bg-emerald-400" />{t('profit')}</span>
      </div>

      {active && (
        <div className="pointer-events-none absolute end-2 top-2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
          <p className="mb-1 font-semibold text-foreground">{labelFor(active.period)}</p>
          <p className="text-muted-foreground">{t('netSales')}: <span className="font-medium text-foreground">{fmt(active.netSales)}</span></p>
          <p className="text-muted-foreground">{t('cost')}: <span className="font-medium text-foreground">{fmt(active.cost)}</span></p>
          <p className="text-muted-foreground">{t('profit')}: <span className={`font-semibold ${active.profit < 0 ? 'text-red-600' : 'text-emerald-600 dark:text-emerald-400'}`}>{fmt(active.profit)}</span></p>
        </div>
      )}
    </div>
  );
}
