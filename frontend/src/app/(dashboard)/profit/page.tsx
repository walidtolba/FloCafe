'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, PiggyBank, Percent, Receipt, ShoppingBag, Wallet, type LucideIcon } from 'lucide-react';
import { useTranslations, useLocale } from 'use-intl';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { tenantCan } from '@/lib/permissions';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { businessDateForInstant } from '@shared/business-date';
import { ProfitTrendChart, type ProfitPoint } from '@/components/profit/ProfitTrendChart';
import { ProductProfitBars } from '@/components/profit/ProductProfitBars';

type Preset = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth' | 'custom';
type SortKey = 'profit' | 'marginPct' | 'quantity' | 'netSales';

interface Totals {
  netSales: number;
  cost: number;
  profit: number;
  marginPct: number | null;
  orders: number;
  itemsSold: number;
}

interface ProductRow {
  productId: string;
  name: string;
  quantity: number;
  netSales: number;
  cost: number;
  profit: number;
  marginPct: number | null;
  missingCost: boolean;
}

interface ProfitReport {
  startDate: string;
  endDate: string;
  groupBy: 'day' | 'month';
  totals: Totals;
  previous: { startDate: string; endDate: string; totals: Totals } | null;
  series: ProfitPoint[];
  bestPeriod: ProfitPoint | null;
  worstPeriod: ProfitPoint | null;
  products: ProductRow[];
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthBounds(date: string, offset: number): { start: string; end: string } {
  const [year, month] = date.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(year, month + offset, 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

function Delta({ current, previous, invert = false }: { current: number; previous: number | undefined; invert?: boolean }) {
  const t = useTranslations('profit');
  if (previous === undefined) return null;
  if (previous === 0) {
    return <span className="text-xs text-muted-foreground">{current === 0 ? '—' : t('newVsPrevious')}</span>;
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const good = invert ? pct <= 0 : pct >= 0;
  const Icon = Math.abs(pct) < 0.05 ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      <Icon size={13} />{Math.abs(pct).toFixed(1)}% {t('vsPrevious')}
    </span>
  );
}

function Tile({ label, value, icon: Icon, tone, children }: { label: string; value: string; icon: LucideIcon; tone: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon size={17} /></span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <div className="mt-1 min-h-4">{children}</div>
    </div>
  );
}

export default function ProfitPage() {
  const router = useRouter();
  const { currentTenant } = useAuthStore();
  const t = useTranslations('profit');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const fmt = useFormatCurrency();

  const canView = tenantCan(currentTenant, 'reports.financial.view');
  const timeZone = currentTenant?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayLocal = businessDateForInstant({
    instant: new Date(),
    timezone: timeZone,
    startTime: currentTenant?.business_day_start_time || '00:00',
  });

  const [preset, setPreset] = useState<Preset>('last7');
  const [customStart, setCustomStart] = useState(shiftDate(todayLocal, -6));
  const [customEnd, setCustomEnd] = useState(todayLocal);
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day');
  const [compare, setCompare] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('profit');
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [loadedKey, setLoadedKey] = useState('');

  const range = useMemo(() => {
    switch (preset) {
      case 'today': return { start: todayLocal, end: todayLocal };
      case 'yesterday': { const d = shiftDate(todayLocal, -1); return { start: d, end: d }; }
      case 'last7': return { start: shiftDate(todayLocal, -6), end: todayLocal };
      case 'thisMonth': return { start: monthBounds(todayLocal, 0).start, end: todayLocal };
      case 'lastMonth': { const m = monthBounds(todayLocal, -1); return { start: m.start, end: m.end }; }
      default: return customStart <= customEnd ? { start: customStart, end: customEnd } : { start: customEnd, end: customStart };
    }
  }, [preset, todayLocal, customStart, customEnd]);

  const queryKey = `${range.start}:${range.end}:${groupBy}:${compare}`;
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    if (currentTenant && !canView) router.replace('/pos');
  }, [currentTenant, canView, router]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    api.get('/reports/profit', {
      params: { start_date: range.start, end_date: range.end, group_by: groupBy, compare: compare ? 'previous' : undefined },
      signal: controller.signal,
    })
      .then((res) => {
        setReport(res.data.profit);
        setLoadedKey(queryKey);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && (err.name === 'CanceledError' || err.name === 'AbortError')) return;
        toast.error(err && typeof err === 'object' && 'response' in err ? t('loadFailed') : tCommon('somethingWrong'));
        setLoadedKey(queryKey);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, queryKey]);

  const periodLabel = (period: string) => {
    const date = new Date(period.length === 7 ? `${period}-01T00:00:00Z` : `${period}T00:00:00Z`);
    return new Intl.DateTimeFormat(locale, period.length === 7
      ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
  };

  const products = useMemo(() => {
    const list = [...(report?.products ?? [])];
    return list.sort((a, b) => (b[sortKey] ?? -Infinity) - (a[sortKey] ?? -Infinity));
  }, [report, sortKey]);
  const previous = report?.previous?.totals;
  const totals = report?.totals;
  const missingCostCount = report?.products.filter((p) => p.missingCost).length ?? 0;
  const presets: Preset[] = ['today', 'yesterday', 'last7', 'thisMonth', 'lastMonth', 'custom'];
  const pct = (value: number | null | undefined) => (value == null ? '—' : `${value.toFixed(1)}%`);

  if (!canView) return null;

  return (
    <div className="min-h-full bg-background p-4 sm:p-6 lg:p-7">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
          {presets.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPreset(key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${preset === key ? 'bg-brand text-white' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {t(`preset.${key}` as 'preset.today' | 'preset.yesterday' | 'preset.last7' | 'preset.thisMonth' | 'preset.lastMonth' | 'preset.custom')}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} max={todayLocal} onChange={(e) => e.target.value && setCustomStart(e.target.value)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm" aria-label={t('from')} />
            <span className="text-muted-foreground">–</span>
            <input type="date" value={customEnd} max={todayLocal} onChange={(e) => e.target.value && setCustomEnd(e.target.value)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm" aria-label={t('to')} />
          </div>
        )}
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value === 'month' ? 'month' : 'day')} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
          <option value="day">{t('groupDay')}</option>
          <option value="month">{t('groupMonth')}</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="size-4 accent-[var(--brand)]" />
          {t('compare')}
        </label>
      </div>

      {report && report.previous && compare && (
        <p className="mb-3 text-xs text-muted-foreground">{t('previousPeriod', { start: report.previous.startDate, end: report.previous.endDate })}</p>
      )}

      <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label={t('netSales')} value={fmt(totals?.netSales ?? 0)} icon={Wallet} tone="bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">
            {compare && totals && <Delta current={totals.netSales} previous={previous?.netSales} />}
          </Tile>
          <Tile label={t('cost')} value={fmt(totals?.cost ?? 0)} icon={ShoppingBag} tone="bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300">
            {compare && totals && <Delta current={totals.cost} previous={previous?.cost} invert />}
          </Tile>
          <Tile label={t('profit')} value={fmt(totals?.profit ?? 0)} icon={PiggyBank} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            {compare && totals && <Delta current={totals.profit} previous={previous?.profit} />}
          </Tile>
          <Tile label={t('margin')} value={pct(totals?.marginPct)} icon={Percent} tone="bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
            {compare && totals && previous && totals.marginPct != null && previous.marginPct != null && (
              <span className="text-xs text-muted-foreground">{t('marginPrevious', { value: pct(previous.marginPct) })}</span>
            )}
          </Tile>
        </div>

        {missingCostCount > 0 && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>
              {t('missingCostBanner', { count: missingCostCount })}{' '}
              <Link href="/products" className="font-medium underline">{t('setCosts')}</Link>
            </p>
          </div>
        )}

        <div className="mt-5 grid gap-5 xl:grid-cols-3">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm xl:col-span-2">
            <h2 className="mb-3 font-semibold text-foreground">{t('trendTitle')}</h2>
            {report && report.series.some((p) => p.netSales !== 0 || p.cost !== 0) ? (
              <ProfitTrendChart series={report.series} labelFor={periodLabel} />
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">{t('noData')}</p>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-foreground">{t('highlights')}</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t('bestPeriod')}</dt>
                <dd className="text-end font-medium text-foreground">{report?.bestPeriod ? `${periodLabel(report.bestPeriod.period)} · ${fmt(report.bestPeriod.profit)}` : '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t('worstPeriod')}</dt>
                <dd className="text-end font-medium text-foreground">{report?.worstPeriod ? `${periodLabel(report.worstPeriod.period)} · ${fmt(report.worstPeriod.profit)}` : '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t('orders')}</dt>
                <dd className="font-medium text-foreground">{totals?.orders ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t('itemsSold')}</dt>
                <dd className="font-medium text-foreground">{totals?.itemsSold ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t('profitPerOrder')}</dt>
                <dd className="font-medium text-foreground">{totals && totals.orders > 0 ? fmt(totals.profit / totals.orders) : '—'}</dd>
              </div>
            </dl>
            {products.length > 0 && (
              <>
                <h3 className="mb-3 mt-6 text-sm font-semibold text-foreground">{t('topByProfit')}</h3>
                <ProductProfitBars rows={products.slice().sort((a, b) => b.profit - a.profit).slice(0, 5)} />
              </>
            )}
          </section>
        </div>

        <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 className="flex items-center gap-2 font-semibold text-foreground"><Receipt size={16} />{t('productsTitle')}</h2>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="h-8 rounded-lg border border-border bg-card px-2 text-sm" aria-label={t('sortBy')}>
              <option value="profit">{t('profit')}</option>
              <option value="marginPct">{t('margin')}</option>
              <option value="netSales">{t('netSales')}</option>
              <option value="quantity">{t('colQty')}</option>
            </select>
          </div>
          {products.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">{t('noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                    <th className="px-5 py-2.5 text-start font-medium">{t('colProduct')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('colQty')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('netSales')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('cost')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('profit')}</th>
                    <th className="px-5 py-2.5 text-end font-medium">{t('margin')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {products.map((row) => (
                    <tr key={row.productId}>
                      <td className="px-5 py-2.5 font-medium text-foreground">
                        {row.name}
                        {row.missingCost && (
                          <span title={t('missingCostHint')} className="ms-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                            <AlertTriangle size={10} />{t('missingCost')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{row.quantity}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{fmt(row.netSales)}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{fmt(row.cost)}</td>
                      <td className={`px-3 py-2.5 text-end font-semibold tabular-nums ${row.profit < 0 ? 'text-red-600' : 'text-foreground'}`}>{fmt(row.profit)}</td>
                      <td className="px-5 py-2.5 text-end tabular-nums">{pct(row.marginPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
