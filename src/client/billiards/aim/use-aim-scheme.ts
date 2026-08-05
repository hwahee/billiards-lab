/**
 * The single setting that picks which aim scheme is live.
 *
 * Purely client-side (it is a presentation choice, not part of the
 * server-owned room) and persisted per browser, so a chosen scheme survives
 * a reload.
 */
import { useCallback, useEffect, useState } from 'react';

import { DEFAULT_AIM_SCHEME, isAimSchemeId, type AimSchemeId } from './index';

const STORAGE_KEY = 'billiards.aimScheme';

export function useAimScheme(): [AimSchemeId, (id: AimSchemeId) => void] {
  const [schemeId, setSchemeId] = useState<AimSchemeId>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isAimSchemeId(stored) ? stored : DEFAULT_AIM_SCHEME;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, schemeId);
  }, [schemeId]);

  return [schemeId, useCallback((id: AimSchemeId) => setSchemeId(id), [])];
}
