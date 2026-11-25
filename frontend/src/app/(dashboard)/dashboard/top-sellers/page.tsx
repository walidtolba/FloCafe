'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Tags, TrendingUp } from 'lucide-react';
import { useTranslations } from 'use-intl';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { tenantCan } from '@/lib/permissions';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { businessDateForInstant } from '@shared/business-date';

type View = 'products' | 'categories';
type Mode = 'day' | 'month';

interface TopProduct {
  product_id: number;
  product_name: string;
  total_quantity: number;
  total_revenue: number;
  order_count: number;
}

interface TopCategory {
  category_id: string | null;
  name: string;
  quantity: number;
  revenue: number;
}

const FULL_LIST_LIMIT = 100;

function getMonthRange(month: string): { startDate: string; endDate: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { startDate: `${month}-01`, endDate: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function TopSellersContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentTenant } = useAuthStore();
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const fmt = useFormatCurrency();

  const canView = tenantCan(currentTenant, 'dashboard.view');
  const timeZone = currentTenant?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayLocal = businessDateForInstant({
    instant: new Date(),
    timezone: timeZone,
    startTime: currentTenant?.business_day_start_time || '00:00',
  });

  const view: View = searchParams.get('view') === 'categories' ? 'categories' : 'products';
  const initialMode: Mode = searchParams.get('mode') === 'month' ? 'month' : 'day';
  const requestedDate = searchParams.get('date') ?? '';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [date, setDate] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : todayLocal,
  );
  const [month, setMonth] = useState(
    /^\d{4}-\d{2}$/.test(requestedDate) ? requestedDate : todayLocal.slice(0, 7),
  );
  const [products, setProducts] = useState<TopProduct[]>([]);
  const [categories, setCategories] = useState<TopCategory[]>([]);
  const [loadedKey, setLoadedKey] = useState('');
  const queryKey = `${view}:${mode}:${mode === 'month' ? month : date}`;
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    if (currentTenant && !canView) router.replace('/pos');
  }, [currentTenant, canView, router]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    const range = mode === 'month' ? getMonthRange(month) : { startDate: date, endDate: date };
    const endpoint = view === 'products' ? '/reports/topProducts' : '/reports/topCategories';
    api.get(endpoint, {
      params: { start_date: range.startDate, end_date: range.endDate, limit: FULL_LIST_LIMIT },
      signal: controller.signal,
    })
      .then((res) => {
        if (view === 'products') setProducts(res.data.topProducts || []);
        else setCategories(res.data.topCategories || []);
        setLoadedKey(queryKey);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && (err.name === 'CanceledError' || err.name === 'AbortError')) return;
        toast.error(tCommon('somethingWrong'));
        setLoadedKey(queryKey);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, view, mode, date, month]);

  const isToday = mode === 'day' && date === todayLocal;
  const productsTitle = mode === 'month' ? t('topProductsMonth') : isToday ? t('topProductsToday') : t('topProducts');
  const title = view === 'products' ? productsTitle : t('topCategories');
  const Icon = view === 'products' ? TrendingUp : Tags;
  const rows = view === 'products'
    ? products.map((p) => ({
        key: String(p.product_id),
        name: p.product_name,
        detail: t('productSoldOrders', { quantity: p.total_quantity, orders: p.order_count }),
        revenue: Number(p.total_revenue),
      }))
    : categories.map((c) => ({
        key: c.category_id ?? c.name,
        name: c.name,
        detail: t('categoryQuantitySold', { quantity: c.quantity }),
        revenue: Number(c.revenue),
      }));

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            aria-label={tCommon('back')}
            className="flex size-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} className="rtl-flip" />
          </Link>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value === 'month' ? 'month' : 'day')}
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
          >
            <option value="day">{t('selectDate')}</option>
            <option value="month">{t('selectMonth')}</option>
          </select>
          {mode === 'month' ? (
            <input
              type="month"
              value={month}
              max={todayLocal.slice(0, 7)}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
            />
          ) : (
            <input
              type="date"
              value={date}
              max={todayLocal}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
            />
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {!loading && rows.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
            <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Icon size={23} />
            </span>
            <p className="text-sm font-medium text-foreground">{t('noSalesYet')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row, index) => (
              <div key={row.key} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-6 shrink-0 text-sm font-semibold text-muted-foreground">{index + 1}</span>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground">{row.name}</span>
                    <p className="text-xs text-muted-foreground">{row.detail}</p>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-foreground">{fmt(row.revenue)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TopSellersPage() {
  return (
    <Suspense fallback={null}>
      <TopSellersContent />
    </Suspense>
  );
}
