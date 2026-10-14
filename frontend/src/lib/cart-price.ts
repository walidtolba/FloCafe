/**
 * The one rule for the unit price a cart line shows.
 *
 * An online order with a selected platform quotes the variant's platform price,
 * exactly as the backend prices the order it becomes; a blank platform is a
 * counter order. Kept dependency-free so the cart store stays loadable in tests.
 */

import type { CartItem, ProductVariant } from '@/lib/types';

export function cartVariantUnitPrice(
  item: { variant?: ProductVariant | null; product: { price: number | string } },
  onlinePlatformSelected: boolean,
): number {
  const platformPrice = onlinePlatformSelected ? item.variant?.online_price : null;
  return Number(platformPrice ?? item.variant?.price ?? item.product.price) || 0;
}

/**
 * Shared by the live cart and any parked tab snapshot, so a tab chip's total
 * always uses the exact same math as the active cart's own subtotal.
 */
export function computeCartSubtotal(items: CartItem[], orderType: string, onlinePlatform: string): number {
  const onlinePlatformSelected = orderType === 'online' && onlinePlatform.trim().length > 0;
  return items.reduce((sum, item) => {
    const itemPrice = cartVariantUnitPrice(item, onlinePlatformSelected);
    const itemQty = Number(item.quantity) || 1;
    const addonTotal = (item.addons || []).reduce((a, addon) => a + (Number(addon.price) || 0) * (Number(addon.quantity) || 1), 0);
    return sum + (itemPrice + addonTotal) * itemQty;
  }, 0);
}
