import { create } from 'zustand';
import type { Customer, Product, Addon, CartItem, ProductVariant } from '@/lib/types';
import { generateCartItemId, normalizeCartItems } from '@/lib/cart-identity';
import { computeCartSubtotal } from '@/lib/cart-price';

export { generateCartItemId, normalizeCartItems } from '@/lib/cart-identity';

export type CartOrderType = 'dine_in' | 'takeaway' | 'delivery' | 'online';

/** Everything a cart tab needs to park and later restore itself exactly. */
interface CartTabSnapshot {
  items: CartItem[];
  orderType: CartOrderType;
  tableId: string | null;
  heldOrderId: string | null;
  customerId: number | string | null;
  customer: Customer | null;
  customerSource: 'explicit' | 'reservation' | null;
  guestCount: number;
  deliveryAddress: string;
  deliveryPhone: string;
  expectedPaymentMethod: string;
  expectedPaymentMethodId: number | null;
  deliveryNote: string;
  onlinePlatform: string;
  externalOrderId: string;
  orderNotes: string;
  waivedChargeIds: Set<string>;
  optedInChargeIds: Set<string>;
}

export interface CartTabSummary {
  id: string;
  number: number;
  isActive: boolean;
  itemCount: number;
  subtotal: number;
}

function createBlankCartTabSnapshot(): CartTabSnapshot {
  return {
    items: [], tableId: null, heldOrderId: null, customerId: null, customer: null,
    customerSource: null, guestCount: 1, orderType: 'dine_in', deliveryAddress: '',
    deliveryPhone: '', expectedPaymentMethod: '', expectedPaymentMethodId: null,
    deliveryNote: '', onlinePlatform: '', externalOrderId: '', orderNotes: '',
    waivedChargeIds: new Set<string>(), optedInChargeIds: new Set<string>(),
  };
}

function isBlankCartTabSnapshot(snapshot: CartTabSnapshot): boolean {
  return snapshot.items.length === 0
    && snapshot.tableId === null
    && snapshot.customerId == null
    && snapshot.orderNotes === ''
    && snapshot.orderType === 'dine_in'
    && snapshot.deliveryAddress === ''
    && snapshot.deliveryPhone === ''
    && snapshot.onlinePlatform === ''
    && snapshot.externalOrderId === '';
}

let nextCartTabId = 1;
function generateCartTabId(): string {
  return `tab-${nextCartTabId++}`;
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

interface CartState {
  items: CartItem[];
  orderType: CartOrderType;
  tableId: string | null;
  heldOrderId: string | null;
  customerId: number | string | null;
  customer: Customer | null;
  customerSource: 'explicit' | 'reservation' | null;
  guestCount: number;
  deliveryAddress: string;
  deliveryPhone: string;
  /** '' is unknown; 'pending', 'cash', 'card', or a custom method name otherwise. */
  expectedPaymentMethod: string;
  /** Configured-method identity for a custom choice; built-ins and sentinels keep it null. */
  expectedPaymentMethodId: number | null;
  deliveryNote: string;
  onlinePlatform: string;
  externalOrderId: string;
  orderNotes: string;

  /** The in-progress cart currently "parked" (not loaded into the live fields above). */
  activeCartTabId: string;
  cartTabOrder: string[];
  parkedCartTabs: Record<string, CartTabSnapshot>;
  /** Park the live cart, start a fresh blank one, and make it active. No-op if the live cart is already blank, unless allowBlank is set. */
  addCartTab: (opts?: { allowBlank?: boolean }) => void;
  /** Park the live cart and load a different (parked) tab as the live one. */
  switchCartTab: (tabId: string) => void;
  /** Discard a tab. If it's the active one, promotes the next remaining tab (or resets to blank if it's the last). */
  closeCartTab: (tabId: string) => void;
  /** Reset the active tab's content to blank in place, keeping its slot/position/number in the strip. */
  resetActiveCartTab: () => void;
  /** All tabs (active + parked) in display order, for rendering a tab strip. */
  cartTabs: () => CartTabSummary[];

  addItem: (product: Product, quantity?: number, addons?: Addon[], specialInstructions?: string, variant?: ProductVariant | null) => void;
  updateItemDetails: (cartItemId: string, quantity: number, addons: Addon[], specialInstructions: string, variant?: ProductVariant | null) => void;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  clearCart: () => void;
  loadItems: (
    items: CartItem[],
    tableId: string | null,
    customerId: number | string | null,
    guestCount: number,
    orderNotes?: string,
    heldOrderId?: string,
    waivedChargeIds?: string[],
    optedInChargeIds?: string[],
  ) => void;
  setOrderType: (type: CartState['orderType']) => void;
  setTableId: (id: string | null) => void;
  setCustomerId: (id: number | string | null) => void;
  setCustomer: (customer: Customer | null) => void;
  setReservationCustomer: (customer: Customer | null) => void;
  setGuestCount: (count: number) => void;
  setDeliveryAddress: (address: string) => void;
  setDeliveryPhone: (phone: string) => void;
  setExpectedPaymentMethod: (method: string, methodId?: number | null) => void;
  setDeliveryNote: (note: string) => void;
  setOnlinePlatform: (platform: string) => void;
  setExternalOrderId: (id: string) => void;
  setOrderNotes: (notes: string) => void;
  /** Charge ids the cashier has waived in this cart. */
  waivedChargeIds: Set<string>;
  /** Opt-in (not default-active) charges the cashier has added to this cart. */
  optedInChargeIds: Set<string>;
  toggleWaiveCharge: (chargeId: string) => void;
  toggleOptedInCharge: (chargeId: string) => void;
  resetCharges: () => void;

  subtotal: () => number;
  itemCount: () => number;
}

function snapshotActiveCart(state: CartTabSnapshot): CartTabSnapshot {
  return {
    items: state.items,
    orderType: state.orderType,
    tableId: state.tableId,
    heldOrderId: state.heldOrderId,
    customerId: state.customerId,
    customer: state.customer,
    customerSource: state.customerSource,
    guestCount: state.guestCount,
    deliveryAddress: state.deliveryAddress,
    deliveryPhone: state.deliveryPhone,
    expectedPaymentMethod: state.expectedPaymentMethod,
    expectedPaymentMethodId: state.expectedPaymentMethodId,
    deliveryNote: state.deliveryNote,
    onlinePlatform: state.onlinePlatform,
    externalOrderId: state.externalOrderId,
    orderNotes: state.orderNotes,
    // Independent Sets: the live cart must not keep mutating a parked snapshot.
    waivedChargeIds: new Set(state.waivedChargeIds),
    optedInChargeIds: new Set(state.optedInChargeIds),
  };
}

function applyCartTabSnapshot(snapshot: CartTabSnapshot): CartTabSnapshot {
  return {
    ...snapshot,
    waivedChargeIds: new Set(snapshot.waivedChargeIds),
    optedInChargeIds: new Set(snapshot.optedInChargeIds),
  };
}

const initialCartTabId = generateCartTabId();

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  orderType: 'dine_in',
  tableId: null,
  heldOrderId: null,
  customerId: null,
  customer: null,
  customerSource: null,
  guestCount: 1,
  deliveryAddress: '',
  deliveryPhone: '',
  expectedPaymentMethod: '',
  expectedPaymentMethodId: null,
  deliveryNote: '',
  onlinePlatform: '',
  externalOrderId: '',
  orderNotes: '',
  waivedChargeIds: new Set<string>(),
  optedInChargeIds: new Set<string>(),

  activeCartTabId: initialCartTabId,
  cartTabOrder: [initialCartTabId],
  parkedCartTabs: {},
  addCartTab: (opts) => {
    const state = get();
    const liveSnapshot = snapshotActiveCart(state);
    if (!opts?.allowBlank && isBlankCartTabSnapshot(liveSnapshot)) return;

    const newId = generateCartTabId();
    set({
      ...createBlankCartTabSnapshot(),
      parkedCartTabs: { ...state.parkedCartTabs, [state.activeCartTabId]: liveSnapshot },
      cartTabOrder: [...state.cartTabOrder, newId],
      activeCartTabId: newId,
    });
  },

  switchCartTab: (tabId) => {
    const state = get();
    if (tabId === state.activeCartTabId) return;
    const target = state.parkedCartTabs[tabId];
    if (!target) return;

    const liveSnapshot = snapshotActiveCart(state);
    set({
      ...applyCartTabSnapshot(target),
      parkedCartTabs: { ...omitKey(state.parkedCartTabs, tabId), [state.activeCartTabId]: liveSnapshot },
      activeCartTabId: tabId,
    });
  },

  closeCartTab: (tabId) => {
    const state = get();

    if (tabId !== state.activeCartTabId) {
      if (!(tabId in state.parkedCartTabs)) return;
      set({
        parkedCartTabs: omitKey(state.parkedCartTabs, tabId),
        cartTabOrder: state.cartTabOrder.filter((id) => id !== tabId),
      });
      return;
    }

    const remainingOrder = state.cartTabOrder.filter((id) => id !== tabId);

    if (remainingOrder.length === 0) {
      set({ ...createBlankCartTabSnapshot(), cartTabOrder: [tabId] });
      return;
    }

    const nextActiveId = remainingOrder[0];
    const nextActiveSnapshot = state.parkedCartTabs[nextActiveId] ?? createBlankCartTabSnapshot();
    const remainingParked = omitKey(state.parkedCartTabs, nextActiveId);
    set({
      ...applyCartTabSnapshot(nextActiveSnapshot),
      parkedCartTabs: remainingParked,
      cartTabOrder: remainingOrder,
      activeCartTabId: nextActiveId,
    });
  },

  resetActiveCartTab: () => set(createBlankCartTabSnapshot()),

  cartTabs: () => {
    const state = get();
    // Numbered by position, not a persistent id→number map: closing tabs
    // always renumbers the rest back down, so numbering never drifts upward.
    return state.cartTabOrder.map((id, index) => {
      if (id === state.activeCartTabId) {
        return {
          id,
          number: index + 1,
          isActive: true,
          itemCount: state.items.reduce((sum, item) => sum + item.quantity, 0),
          subtotal: computeCartSubtotal(state.items, state.orderType, state.onlinePlatform),
        };
      }
      const snapshot = state.parkedCartTabs[id] ?? createBlankCartTabSnapshot();
      return {
        id,
        number: index + 1,
        isActive: false,
        itemCount: snapshot.items.reduce((sum, item) => sum + item.quantity, 0),
        subtotal: computeCartSubtotal(snapshot.items, snapshot.orderType, snapshot.onlinePlatform),
      };
    });
  },

  // Waivers are explicit state, never inferred from a zero amount: a waived
  // charge and a fee configured at 0 must stay distinguishable.
  toggleWaiveCharge: (chargeId) => set((state) => {
    const waivedChargeIds = new Set(state.waivedChargeIds);
    if (waivedChargeIds.has(chargeId)) waivedChargeIds.delete(chargeId);
    else waivedChargeIds.add(chargeId);
    return { waivedChargeIds };
  }),

  toggleOptedInCharge: (chargeId) => set((state) => {
    const optedInChargeIds = new Set(state.optedInChargeIds);
    if (optedInChargeIds.has(chargeId)) optedInChargeIds.delete(chargeId);
    else optedInChargeIds.add(chargeId);
    return { optedInChargeIds };
  }),

  resetCharges: () => set({ waivedChargeIds: new Set<string>(), optedInChargeIds: new Set<string>() }),

  addItem: (product, quantity = 1, addons = [], specialInstructions = '', variant = null) => {
    const items = get().items;
    const itemId = generateCartItemId(product.id, variant?.id ?? null, addons, specialInstructions);
    const existing = items.find((i) => i.id === itemId);

    if (existing) {
      set({
        items: items.map((i) =>
          i.id === itemId ? { ...i, quantity: i.quantity + quantity } : i
        ),
      });
    } else {
      set({
        items: [...items, { id: itemId, product, quantity, addons, special_instructions: specialInstructions, variant }],
      });
    }
  },

  updateItemDetails: (cartItemId, quantity, addons, specialInstructions, variant) => {
    const items = get().items;
    const target = items.find((i) => i.id === cartItemId);
    if (!target) return;

    // Omitting the variant keeps the one already chosen on the line.
    const nextVariant = variant === undefined ? target.variant ?? null : variant;
    const newId = generateCartItemId(target.product.id, nextVariant?.id ?? null, addons, specialInstructions);
    if (newId === cartItemId) {
      set({
        items: items.map((i) =>
          i.id === cartItemId ? { ...i, quantity, addons, special_instructions: specialInstructions, variant: nextVariant } : i
        ),
      });
      return;
    }

    // The edit produced a config that matches another existing line — merge into it.
    const collision = items.find((i) => i.id === newId && i.id !== cartItemId);
    if (collision) {
      set({
        items: items
          .filter((i) => i.id !== cartItemId)
          .map((i) => (i.id === newId ? { ...i, quantity: i.quantity + quantity } : i)),
      });
    } else {
      set({
        items: items.map((i) =>
          i.id === cartItemId ? { ...i, id: newId, quantity, addons, special_instructions: specialInstructions, variant: nextVariant } : i
        ),
      });
    }
  },

  removeItem: (cartItemId) => {
    set({ items: get().items.filter((i) => i.id !== cartItemId) });
  },

  updateQuantity: (cartItemId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(cartItemId);
      return;
    }
    set({
      items: get().items.map((i) =>
        i.id === cartItemId ? { ...i, quantity } : i
      ),
    });
  },

  // Clearing the cart only ever means "I just consumed the active tab's
  // content" (placed/paid/held/appended) — closeCartTab already does exactly
  // that, promoting the next tab or resetting in place if it's the only one.
  clearCart: () => get().closeCartTab(get().activeCartTabId),

  loadItems: (items, tableId, customerId, guestCount, orderNotes, heldOrderId, waivedChargeIds, optedInChargeIds) => {
    set({
      items: normalizeCartItems(items),
      tableId,
      heldOrderId: heldOrderId || null,
      customerId,
      customerSource: customerId == null ? null : 'explicit',
      guestCount,
      orderNotes: orderNotes || '',
      // Independent Sets: a resumed cart must not alias the arrays it came from.
      waivedChargeIds: new Set(waivedChargeIds ?? []),
      optedInChargeIds: new Set(optedInChargeIds ?? []),
    });
  },

  setOrderType: (type) => set((state) => ({
    orderType: type,
    deliveryAddress: type !== 'delivery' ? '' : state.deliveryAddress,
    deliveryPhone: type !== 'delivery' ? '' : state.deliveryPhone,
    expectedPaymentMethod: type !== 'delivery' ? '' : state.expectedPaymentMethod,
    expectedPaymentMethodId: type !== 'delivery' ? null : state.expectedPaymentMethodId,
    deliveryNote: type !== 'delivery' ? '' : state.deliveryNote,
    onlinePlatform: type !== 'online' ? '' : state.onlinePlatform,
    externalOrderId: type !== 'online' ? '' : state.externalOrderId,
    // Only a real change of order type resets charges: re-selecting the type the
    // cart already has must not silently un-waive a fee the cashier removed.
    ...(state.orderType === type
      ? {}
      : { waivedChargeIds: new Set<string>(), optedInChargeIds: new Set<string>() }),
  })),
  setTableId: (id) => set({ tableId: id, heldOrderId: null }),
  setCustomerId: (id) => set({ customerId: id, customerSource: id == null ? null : 'explicit' }),
  setCustomer: (customer) => set({ customer, customerId: customer?.id ?? null, customerSource: customer ? 'explicit' : null }),
  setReservationCustomer: (customer) => set({ customer, customerId: customer?.id ?? null, customerSource: customer ? 'reservation' : null }),
  setGuestCount: (count) => set({ guestCount: count }),
  setDeliveryAddress: (address) => set({ deliveryAddress: address }),
  setDeliveryPhone: (phone) => set({ deliveryPhone: phone }),
  setExpectedPaymentMethod: (method, methodId) => set({ expectedPaymentMethod: method, expectedPaymentMethodId: methodId ?? null }),
  setDeliveryNote: (note) => set({ deliveryNote: note }),
  setOnlinePlatform: (platform) => set({ onlinePlatform: platform }),
  setExternalOrderId: (id) => set({ externalOrderId: id }),
  setOrderNotes: (notes) => set({ orderNotes: notes }),

  subtotal: () => {
    const state = get();
    return computeCartSubtotal(state.items, state.orderType, state.onlinePlatform);
  },

  itemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));
