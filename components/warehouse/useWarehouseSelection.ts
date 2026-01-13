'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WarehouseInfo } from '@/components/warehouse/types';

const STORAGE_KEY = 'mleha:selectedWarehouse';

export function useWarehouseSelection(
  warehouses: WarehouseInfo[] = [],
  initialSelectedId?: string | null
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!Array.isArray(warehouses) || warehouses.length === 0) {
      setSelectedId(null);
      return;
    }

    if (warehouses.length === 1) {
      setSelectedId(warehouses[0].id);
      try {
        localStorage.setItem(STORAGE_KEY, warehouses[0].id);
      } catch {
        // ignore
      }
      return;
    }

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && warehouses.some((w) => w.id === saved)) {
        setSelectedId(saved);
        return;
      }
    } catch {
      // ignore
    }

    if (initialSelectedId && warehouses.some((w) => w.id === initialSelectedId)) {
      setSelectedId(initialSelectedId);
      try {
        localStorage.setItem(STORAGE_KEY, initialSelectedId);
      } catch {
        // ignore
      }
      return;
    }

    const fallbackWarehouse = warehouses[0];
    if (fallbackWarehouse) {
      setSelectedId(fallbackWarehouse.id);
      try {
        localStorage.setItem(STORAGE_KEY, fallbackWarehouse.id);
      } catch {
        // ignore
      }
    } else {
      setSelectedId(null);
    }
  }, [initialSelectedId, warehouses]);

  const selectedWarehouse = useMemo(
    () => warehouses.find((w) => w.id === selectedId) || null,
    [warehouses, selectedId]
  );

  const selectWarehouse = useCallback((warehouseId: string) => {
    setSelectedId(warehouseId);
    try {
      localStorage.setItem(STORAGE_KEY, warehouseId);
    } catch {
      // ignore
    }
  }, []);

  const clearWarehouse = useCallback(() => {
    setSelectedId(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const needsSelection =
    Array.isArray(warehouses) &&
    warehouses.length > 1 &&
    selectedWarehouse === null;

  return {
    warehouses,
    selectedWarehouse,
    selectWarehouse,
    clearWarehouse,
    needsSelection,
  };
}
