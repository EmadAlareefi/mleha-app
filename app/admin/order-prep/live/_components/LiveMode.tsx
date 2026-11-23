'use client';

import { createContext, useContext } from 'react';

export type LiveScope = 'full' | 'shipping';

export type LiveMode = {
  /** TV mode: read-only, larger, lists scroll themselves. */
  kiosk: boolean;
  /**
   * full = admin-order-prep (everything). shipping = only the shipping-board
   * permission: shipping panels only, no prep data, no stuck orders, no search.
   */
  scope: LiveScope;
};

export const LiveModeContext = createContext<LiveMode>({ kiosk: false, scope: 'full' });

export const useLiveMode = () => useContext(LiveModeContext);
