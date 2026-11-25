'use client';

import { useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import api from '@/lib/api';
import { isNavLayoutValue, useNavLayoutStore, type NavLayout } from '@/store/nav-layout';

// Several screens read the preference; hydrate it from the DB once per renderer.
let hydrationStarted = false;
let saveGeneration = 0;
let pendingRequest: Promise<unknown> = Promise.resolve();
let confirmedLayout: NavLayout = 'sidebar';

/** Reads the persisted navigation layout into the store and saves it optimistically,
 * rolling back and surfacing an error when the write fails. */
export function useNavLayoutPreference() {
  const t = useTranslations('settings');
  const layout = useNavLayoutStore((s) => s.layout);
  const setLayout = useNavLayoutStore((s) => s.setLayout);
  const markUserSelected = useNavLayoutStore((s) => s.markUserSelected);

  useEffect(() => {
    if (hydrationStarted) return;
    hydrationStarted = true;
    pendingRequest = pendingRequest.then(async () => {
      try {
        const { data } = await api.get('/settings/nav_layout');
        const raw = data?.setting?.value;
        // A choice made while the fetch was in flight wins over the stored row.
        if (isNavLayoutValue(raw)) {
          confirmedLayout = raw;
          if (!useNavLayoutStore.getState().userSelected) setLayout(raw);
        }
      } catch {
        hydrationStarted = false;
      }
    });
  }, [setLayout]);

  const save = useCallback(
    async (next: NavLayout) => {
      const previous = useNavLayoutStore.getState().layout;
      if (next === previous) return;
      const generation = ++saveGeneration;
      markUserSelected();
      setLayout(next);
      const write = pendingRequest.then(() => api.put('/settings/nav_layout', { value: next }));
      pendingRequest = write.catch(() => {});
      try {
        await write;
        confirmedLayout = next;
      } catch {
        if (generation !== saveGeneration) return;
        setLayout(confirmedLayout);
        toast.error(t('saveFailed'));
      }
    },
    [markUserSelected, setLayout, t],
  );

  return { layout, save };
}