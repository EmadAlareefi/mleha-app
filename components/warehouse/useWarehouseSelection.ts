'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface WarehouseInfo {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
}

const STORAGE_KEY = 'mleha:selectedWarehouse';

export function useWarehouseSelection(warehouses: WarehouseInfo[] = []) {
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

    setSelectedId(null);
  }, [warehouses]);

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
