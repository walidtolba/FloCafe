'use client';

import { useFormatCurrency } from '@/hooks/useFormatCurrency';

export interface ProductProfitRow {
  productId: string;
  name: string;
  profit: number;
}

export function ProductProfitBars({ rows }: { rows: ProductProfitRow[] }) {
  const fmt = useFormatCurrency();
  const max = Math.max(...rows.map((row) => Math.abs(row.profit)), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.productId}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium text-foreground">{row.name}</span>
            <span className={`shrink-0 font-semibold ${row.profit < 0 ? 'text-red-600' : 'text-foreground'}`}>{fmt(row.profit)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${row.profit < 0 ? 'bg-red-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.max(2, (Math.abs(row.profit) / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
