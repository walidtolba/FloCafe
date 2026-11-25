import { create } from 'zustand';

export type NavLayout = 'sidebar' | 'topbar';

export interface NavLayoutState {
  layout: NavLayout;
  /** Set by an explicit user choice this session; boot hydration must not override. */
  userSelected: boolean;
  setLayout: (layout: NavLayout) => void;
  markUserSelected: () => void;
}

export function isNavLayoutValue(v: unknown): v is NavLayout {
  return v === 'sidebar' || v === 'topbar';
}

/** Renderer-owned app navigation layout; persistence is handled by the hook. */
export const useNavLayoutStore = create<NavLayoutState>((set) => ({
  layout: 'sidebar',
  userSelected: false,
  setLayout: (layout) => set({ layout }),
  markUserSelected: () => set({ userSelected: true }),
}));
