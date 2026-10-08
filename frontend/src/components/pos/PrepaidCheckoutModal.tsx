'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Sparkles, ArrowLeftRight, CheckCircle2, Wallet, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { useCartStore } from '@/store/cart';
import { chargesForOrderType, useChargesStore } from '@/store/charges';
import { useAuthStore } from '@/store/auth';
import { useTaxPreview } from '@/hooks/use-tax-preview';
import { useTranslations, type AppConfig } from 'use-intl';
import TaxBreakdown from '@/components/pos/TaxBreakdown';
import toast from 'react-hot-toast';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useFormatNumber } from '@/hooks/useFormatNumber';
import { useCurrencyUnitAdapter } from '@/hooks/useCurrencyUnitAdapter';
import { getCountryByCode, getCurrencyMinorUnitFactor } from '@/lib/countries';
import { CurrencyTouchNumberPad } from '@/components/pos/TouchNumberPad';
import type { DiscountType } from '@/lib/discount-settings';

interface LoyaltySettings {
  loyalty_enabled: boolean;
}

export interface PrepaidPayment {
  method: string;
  payment_method_id?: number;
  amount: number;
}

export interface PrepaidDiscount {
  type: DiscountType;
  value: number;
  reason?: string;
  override_pin?: string;
}

interface Props {
  currency: string;
  onClose: () => void;
  onConfirm: (payments: PrepaidPayment[], walletAmount: number, discount: PrepaidDiscount | null) => void;
}

// Loyalty points are 1:1 with currency units. Must match LOYALTY_REDEMPTION_RATE in main/routes/bills.ts.
const LOYALTY_REDEMPTION_RATE = 1;

type PosKey = keyof AppConfig['Messages']['pos'];

type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'online';

// Exhaustively typed lookup for the order-type suffix (no template-literal keys).
const ORDER_TYPE_SUFFIX_KEYS = {
  dine_in: 'orderTypeSuffix_dine_in',
  takeaway: 'orderTypeSuffix_takeaway',
  delivery: 'orderTypeSuffix_delivery',
  online: 'orderTypeSuffix_online',
} as const satisfies Record<OrderType, PosKey>;

type AmountTarget = { kind: 'payment' } | { kind: 'wallet' } | null;

export default function PrepaidCheckoutModal({ onClose, onConfirm }: Props) {
  const cart = useCartStore();
  const customer = cart.customer;
  const t = useTranslations('pos');
  const currencyFmt = useFormatCurrency();
  const fmtNum = useFormatNumber();
  const unitAdapter = useCurrencyUnitAdapter();
  const { toDisplay: toDisplayUnit, toStored: toStoredUnit, label: inputCurrencyLabel, step: inputCurrencyStep, formatInput } = unitAdapter;
  const { currentTenant } = useAuthStore();
  const charges = useChargesStore((s) => s.charges);
  const loadCharges = useChargesStore((s) => s.load);
  const currencyCode =
    currentTenant?.currency ||
    (currentTenant?.country ? getCountryByCode(currentTenant.country)?.currency : undefined) ||
    'INR';
  const minorFactor = getCurrencyMinorUnitFactor(currencyCode);
  const toMinorUnits = (amount: number) => Math.round(amount * minorFactor);

  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletLoadFailed, setWalletLoadFailed] = useState(false);
  const [walletAmount, setWalletAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [amountTarget, setAmountTarget] = useState<AmountTarget>(null);

  const chargeContext = useMemo(() => ({
    orderType: cart.orderType,
    onlinePlatform: cart.onlinePlatform,
    waivedChargeIds: Array.from(cart.waivedChargeIds),
    optedInChargeIds: Array.from(cart.optedInChargeIds),
  }), [cart.orderType, cart.onlinePlatform, cart.waivedChargeIds, cart.optedInChargeIds]);
  const applicableCharges = chargesForOrderType(charges, cart.orderType);
  const addableCharges = applicableCharges.filter(
    (charge) => !charge.is_default_active && !cart.optedInChargeIds.has(charge.id),
  );
  const { tax, loading: taxLoading } = useTaxPreview(
    cart.items,
    cart.customerId,
    undefined,
    null,
    chargeContext,
  );

  useEffect(() => {
    void loadCharges();
  }, [loadCharges]);

  // Every order is paid in full, in cash — no payment-method choice, no partial/split
  // payments. Left blank by default (the total due is shown as a placeholder) so typing
  // a tendered amount never requires clearing a pre-filled value first; a blank field
  // means "pay the exact total", not zero, so it never blocks the Pay button. Entering
  // a larger amount (e.g. a round note) has change calculated; it can never go below
  // the total due.
  const [cashAmount, setCashAmount] = useState('');

  useEffect(() => {
    api.get('/settings/loyalty')
      .then((res) => setLoyaltySettings(res.data))
      .catch(() => {});
  }, []);

  // Reset stale wallet balance during render when customer changes
  // to avoid flashing previous customer balance.
  const [syncedCustomerId, setSyncedCustomerId] = useState(customer?.id ?? null);
  if ((customer?.id ?? null) !== syncedCustomerId) {
    setSyncedCustomerId(customer?.id ?? null);
    setWalletLoadFailed(false);
    setWalletBalance(null);
    setWalletAmount('');
    setAmountTarget(null);
  }

  useEffect(() => {
    if (customer?.id) {
      api.get(`/customers/${customer.id}/wallet`)
        .then((res) => {
          setWalletBalance(Number(res.data.balance) || 0);
        })
        .catch(() => setWalletLoadFailed(true));
    }
  }, [customer?.id]);

  // The backend preview is the settlement source of truth: it applies the same
  // tax rules and active-pack payable rounding used by bill generation.
  const preview = useMemo(() => {
    if (!tax) return null;
    return {
      subtotal: tax.subtotal,
      taxAmount: tax.tax_amount,
      taxBreakdown: tax.tax_breakdown,
      packagingCharge: tax.packaging_charge,
      charges: tax.charges_breakdown || [],
      roundOff: tax.round_off,
      total: tax.total,
    };
  }, [tax]);

  const remaining = preview?.total ?? 0;

  const walletAmt = toStoredUnit(parseFloat(walletAmount) || 0);
  const cashDue = Math.max(0, remaining - walletAmt);
  // A blank field means "pay the exact amount due" — never zero.
  const cashAmt = cashAmount.trim() === '' ? cashDue : toStoredUnit(parseFloat(cashAmount) || 0);
  const totalPaymentMinor = toMinorUnits(cashAmt) + toMinorUnits(walletAmt);
  const remainingMinor = toMinorUnits(remaining);

  const updateCashAmount = (value: string) => {
    setCashAmount(value);
  };

  const hasCash = cashAmt > 0;
  const change = hasCash && totalPaymentMinor > remainingMinor
    ? (totalPaymentMinor - remainingMinor) / minorFactor
    : 0;

  const activeAmountValue = amountTarget?.kind === 'payment'
    ? cashAmount
    : amountTarget?.kind === 'wallet'
      ? walletAmount
      : '';

  const updateActiveAmount = (value: string) => {
    if (!amountTarget) return;
    if (amountTarget.kind === 'payment') {
      updateCashAmount(value);
      return;
    }
    const maxWalletCurrencyStored = Math.floor((walletBalance || 0) / LOYALTY_REDEMPTION_RATE);
    const maxDisplay = toDisplayUnit(Math.min(maxWalletCurrencyStored, remaining));
    const clamped = parseFloat(value) > maxDisplay ? String(maxDisplay) : value;
    setWalletAmount(clamped);
  };

  const activeAmountMax = amountTarget?.kind === 'wallet'
    ? toDisplayUnit(Math.min(Math.floor((walletBalance || 0) / LOYALTY_REDEMPTION_RATE), remaining))
    : undefined;

  const activeAmountQuickValues = (() => {
    if (amountTarget?.kind === 'payment') {
      const dueDisplay = toDisplayUnit(Math.max(0, remaining - walletAmt));
      return dueDisplay > 0 ? [{ label: t('exactAmount'), value: String(dueDisplay) }] : [];
    }
    if (amountTarget?.kind === 'wallet') {
      const maxWalletStored = Math.floor((walletBalance || 0) / LOYALTY_REDEMPTION_RATE);
      const dueDisplay = toDisplayUnit(Math.min(maxWalletStored, remaining));
      return dueDisplay > 0 ? [{ label: t('exactAmount'), value: String(dueDisplay) }] : [];
    }
    return [];
  })();

  const handleConfirm = () => {
    if (!preview) return;
    const decimalPart = unitAdapter.maxDecimals > 0 ? `(?:\\.\\d{1,${unitAdapter.maxDecimals}})?` : '';
    const amountPattern = new RegExp(`^\\d+${decimalPart}$`);
    const amountIsValid = (value: string) => value.trim() === '' || amountPattern.test(value.trim());
    if (!amountIsValid(cashAmount) || (walletAmount.trim() && !amountPattern.test(walletAmount.trim()))) {
      toast.error(t('paymentFailed'));
      return;
    }
    if (totalPaymentMinor < remainingMinor) {
      toast.error(t('paymentBelowBalance'));
      return;
    }
    if (walletAmt > 0 && walletBalance === null) {
      toast.error(t('paymentFailed'));
      return;
    }
    if (walletAmt > 0 && walletBalance !== null) {
      const walletPointsRequired = walletAmt * LOYALTY_REDEMPTION_RATE;
      if (walletPointsRequired > walletBalance) {
        const maxCurrency = Math.floor(walletBalance / LOYALTY_REDEMPTION_RATE);
        toast.error(t('walletMaxAmount', { max: currencyFmt(maxCurrency) }));
        return;
      }
    }

    setProcessing(true);
    const splitLines: PrepaidPayment[] = cashAmt > 0 ? [{ method: 'cash', amount: cashAmt }] : [];
    onConfirm(splitLines, walletAmt, null);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-card flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:max-w-md sm:rounded-2xl">

        {/* Compact header and bill summary share one block to preserve vertical space. */}
        <div className="shrink-0 border-b border-border px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground">{t('checkout')}</h2>
              <p className="mt-0.5 truncate text-xs capitalize text-muted-foreground">
                {t(ORDER_TYPE_SUFFIX_KEYS[cart.orderType])}
                {customer ? ` · ${customer.name}` : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="touch-target rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
              aria-label={t('close')}
            >
              <X size={16} />
            </button>
          </div>

          {taxLoading || !preview ? (
            <div className="mt-3 h-24 animate-pulse rounded-xl bg-muted" />
          ) : (
            <div className="mt-3 space-y-1 text-sm tabular-nums" data-testid="prepaid-checkout-summary">
              <div className="flex justify-between text-foreground">
                <span>{t('itemCount', { count: cart.itemCount() })}</span>
                <span>{currencyFmt(preview.subtotal)}</span>
              </div>
              <TaxBreakdown taxAmount={preview.taxAmount} taxBreakdown={preview.taxBreakdown} theme="light" />
              {preview.charges.map((charge) => {
                const definition = applicableCharges.find((candidate) => candidate.id === charge.id);
                const optedIn = cart.optedInChargeIds.has(charge.id);
                return (
                  <div key={charge.id} data-testid={`prepaid-charge-${charge.id}`} className="flex justify-between items-center gap-2 text-muted-foreground">
                    <span className={charge.waived ? 'line-through' : undefined}>{charge.name}</span>
                    <span className="flex items-center gap-2">
                      <span className={charge.waived ? 'line-through' : undefined}>{currencyFmt(charge.amount)}</span>
                      {definition?.is_optional && (
                        <button
                          type="button"
                          onClick={() => cart.toggleWaiveCharge(charge.id)}
                          aria-pressed={charge.waived}
                          className="text-xs px-2 py-0.5 rounded border border-border hover:text-foreground"
                        >
                          {charge.waived ? t('applyCharge') : t('waiveCharge')}
                        </button>
                      )}
                      {definition && !definition.is_default_active && optedIn && (
                        <button
                          type="button"
                          onClick={() => cart.toggleOptedInCharge(charge.id)}
                          aria-pressed={optedIn}
                          className="text-xs px-2 py-0.5 rounded border border-border hover:text-foreground"
                        >
                          {t('removeCharge')}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
              {addableCharges.map((charge) => (
                <div key={charge.id} data-testid={`prepaid-charge-${charge.id}`} className="flex justify-between items-center gap-2 text-muted-foreground">
                  <span>{charge.name}</span>
                  <button
                    type="button"
                    onClick={() => cart.toggleOptedInCharge(charge.id)}
                    className="text-xs px-2 py-0.5 rounded border border-border hover:text-foreground"
                  >
                    {t('addCharge')}
                  </button>
                </div>
              ))}
              {preview.packagingCharge > 0 && !preview.charges.some((charge) => charge.id === 'packaging_charge') && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t('packaging')}</span>
                  <span>{currencyFmt(preview.packagingCharge)}</span>
                </div>
              )}
              {preview.roundOff !== 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t('roundOff')}</span>
                  <span>{preview.roundOff > 0 ? '+' : ''}{currencyFmt(preview.roundOff)}</span>
                </div>
              )}
              <div className="mt-2 flex items-end justify-between border-t border-border pt-2 font-bold text-foreground">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{t('total')}</span>
                <span className="text-xl leading-none">{currencyFmt(remaining)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto px-5 py-3">

          {/* Cash tendered — defaults to the exact total; raising it only changes the
              change calculated below. It can never be confirmed below the total due. */}
          <div className="flex min-h-12">
            <div className="touch-target w-36 shrink-0 justify-start rounded-s-xl border px-3 gap-2 text-sm font-semibold bg-brand text-white border-brand">
              <Banknote size={15} />
              <span className="truncate">{t('methodCash')}</span>
            </div>
            <div className="flex flex-1 items-center border border-s-0 border-border rounded-e-xl bg-card focus-within:ring-2 focus-within:ring-brand focus-within:border-transparent">
              <span className="ps-3 text-muted-foreground text-xs">{inputCurrencyLabel}</span>
              <input
                type="number"
                value={cashAmount}
                onFocus={() => setAmountTarget({ kind: 'payment' })}
                onChange={(e) => updateCashAmount(e.target.value)}
                placeholder={formatInput(toDisplayUnit(cashDue))}
                inputMode="decimal"
                className="min-w-0 flex-1 px-2 py-2 text-end text-base font-semibold outline-none rounded-e-xl"
                step={inputCurrencyStep}
                min="0"
              />
            </div>
          </div>

          {/* Loyalty Wallet Section */}
          {loyaltySettings?.loyalty_enabled && customer && walletBalance !== null && (
            <div className="space-y-1">
              <div className="flex min-h-12">
                <button type="button" disabled={walletBalance <= 0} onClick={() => {
                  const maxWalletStored = Math.floor(walletBalance / LOYALTY_REDEMPTION_RATE);
                  const dueStored = Math.min(maxWalletStored, remaining);
                  const dueDisplay = toDisplayUnit(dueStored);
                  setWalletAmount(dueDisplay > 0 ? String(dueDisplay) : '');
                  setAmountTarget({ kind: 'wallet' });
                }} className={`touch-target w-36 shrink-0 justify-start rounded-s-xl border px-3 gap-2 text-sm font-semibold ${walletAmt > 0 ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/40 disabled:bg-muted disabled:text-muted-foreground disabled:border-border'}`}>
                  <Wallet size={15} /><span className="truncate">{t('loyaltyWallet')}</span>
                </button>
                <div className="flex flex-1 items-center border border-s-0 border-purple-200 dark:border-purple-800/40 rounded-e-xl bg-card focus-within:ring-2 focus-within:ring-purple-400">
                  <span className="ps-3 text-muted-foreground text-xs">{inputCurrencyLabel}</span>
                  <input
                    type="number"
                    value={walletAmount}
                    onFocus={() => setAmountTarget({ kind: 'wallet' })}
                    onChange={(e) => {
                      const v = e.target.value;
                      const maxWalletCurrencyStored = Math.floor(walletBalance / (LOYALTY_REDEMPTION_RATE));
                      const maxDisplay = toDisplayUnit(Math.min(maxWalletCurrencyStored, remaining));
                      const clamped = parseFloat(v) > maxDisplay ? String(maxDisplay) : v;
                      setWalletAmount(clamped);
                    }}
                    placeholder="0.00"
                    disabled={walletBalance <= 0}
                    inputMode="decimal"
                    className="min-w-0 flex-1 px-2 py-2 text-end text-base font-semibold outline-none rounded-e-xl disabled:bg-muted"
                    step={inputCurrencyStep}
                    min="0"
                    max={toDisplayUnit(Math.min(Math.floor(walletBalance / (LOYALTY_REDEMPTION_RATE)), remaining))}
                  />
                </div>
              </div>
              <p className="px-1 text-[11px] text-muted-foreground text-end">{walletBalance > 0 ? t('pointsApproxValue', { count: fmtNum(walletBalance), value: currencyFmt(Math.floor(walletBalance / LOYALTY_REDEMPTION_RATE)) }) : t('noBalance')}</p>
            </div>
          )}

          {/* Loyalty Info Strip (staff reference) */}
          {loyaltySettings?.loyalty_enabled && customer && !walletLoadFailed && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-muted border border-border rounded-xl">
              <Sparkles size={13} className="text-muted-foreground shrink-0" />
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                <span className="text-foreground font-medium">{t('loyalty')}</span>
                <span className="font-semibold text-foreground">
                  {walletBalance !== null
                    ? t('pointsApproxValue', { count: fmtNum(walletBalance), value: currencyFmt(Math.floor(walletBalance / LOYALTY_REDEMPTION_RATE)) })
                    : '…'}
                </span>
              </div>
            </div>
          )}
          {amountTarget && (
            <CurrencyTouchNumberPad
              value={activeAmountValue}
              onChange={updateActiveAmount}
              ariaLabel={t('numericKeypad')}
              clearLabel={t('clearAmount')}
              backspaceLabel={t('backspaceAmount')}
              currencyMaxDecimals={unitAdapter.maxDecimals}
              amountTarget={amountTarget.kind}
              discountType="amount"
              max={activeAmountMax}
              quickValues={activeAmountQuickValues}
            />
          )}

          {/* Change stays at the bottom of all payment controls. */}
          {hasCash && (
            <div className={`rounded-xl px-4 py-2.5 flex items-center justify-between border transition-all duration-200 ${
              change > 0
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/40'
                : 'bg-muted border-border'
            }`}>
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                  change > 0 ? 'bg-emerald-100 dark:bg-emerald-950/60' : 'bg-gray-200 dark:bg-muted'
                }`}>
                  {change > 0
                    ? <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" />
                    : <ArrowLeftRight size={13} className="text-muted-foreground" />
                  }
                </div>
                <span className={`text-sm font-semibold ${
                  change > 0 ? 'text-emerald-800 dark:text-emerald-300' : 'text-muted-foreground'
                }`}>
                  {t('changeReturned')}
                </span>
              </div>
              <span className={`text-lg font-bold tabular-nums ${
                change > 0 ? 'text-emerald-600' : 'text-gray-300'
              }`}>
                {currencyFmt(change)}
              </span>
            </div>
          )}
        </div>

        {/* Pay Button */}
        <div className="shrink-0 border-t border-border px-5 pb-6 pt-3">
          <Button
            onClick={handleConfirm}
            disabled={processing || taxLoading || !preview || totalPaymentMinor < remainingMinor}
            className="w-full h-12 text-base font-semibold rounded-xl"
            size="lg"
          >
            {taxLoading ? t('calculatingTax') : processing ? t('processingPayment') : t('confirmPaymentAmount', { amount: currencyFmt(remaining) })}
          </Button>
        </div>
      </div>
    </div>
  );
}
