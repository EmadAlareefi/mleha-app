'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  MutationResult,
  OrderUser,
  PrinterLinkInfo,
  WarehouseOption,
} from '../types';

export function useOrderUsers() {
  const [users, setUsers] = useState<OrderUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(true);
  const [warehousesError, setWarehousesError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setAccessDenied(false);
    try {
      const response = await fetch('/api/order-users');

      if (response.status === 403) {
        setAccessDenied(true);
        setUsers([]);
        return;
      }

      const data = await response.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWarehouses = useCallback(async () => {
    setWarehousesLoading(true);
    setWarehousesError(null);
    try {
      const response = await fetch('/api/warehouses');

      if (response.status === 403) {
        setWarehousesError('لا توجد صلاحية لعرض المستودعات');
        setWarehouseOptions([]);
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 503 && data?.missingWarehousesTable) {
          setWarehousesError(
            'ميزة المستودعات غير مفعّلة بعد. يرجى تشغيل prisma migrate deploy ثم إعادة المحاولة.'
          );
          setWarehouseOptions([]);
          return;
        }
        throw new Error(data?.error || 'فشل تحميل المستودعات');
      }

      if (data.success) {
        setWarehouseOptions(data.warehouses || []);
      } else {
        setWarehousesError('تعذر تحميل قائمة المستودعات');
      }
    } catch (error) {
      console.error('Error loading warehouses:', error);
      setWarehousesError('تعذر تحميل قائمة المستودعات');
      setWarehouseOptions([]);
    } finally {
      setWarehousesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadWarehouses();
  }, [loadUsers, loadWarehouses]);

  const saveUser = useCallback(
    async (
      payload: Record<string, unknown>,
      editingId: string | null
    ): Promise<MutationResult> => {
      try {
        const url = editingId ? `/api/order-users/${editingId}` : '/api/order-users';
        const method = editingId ? 'PUT' : 'POST';

        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (!response.ok) {
          return { ok: false, error: data.error || 'فشل حفظ المستخدم' };
        }

        await loadUsers();
        return { ok: true, user: data.user };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'حدث خطأ',
        };
      }
    },
    [loadUsers]
  );

  const deleteUser = useCallback(
    async (userId: string): Promise<MutationResult> => {
      try {
        const response = await fetch(`/api/order-users/${userId}`, { method: 'DELETE' });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          return { ok: false, error: data.error || 'فشل حذف المستخدم' };
        }
        setUsers((prev) => prev.filter((user) => user.id !== userId));
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'حدث خطأ',
        };
      }
    },
    []
  );

  const resetOrders = useCallback(
    async (userId: string): Promise<MutationResult & { message?: string }> => {
      try {
        const response = await fetch('/api/order-assignments/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const data = await response.json();
        if (!response.ok) {
          return { ok: false, error: data.error || 'فشل إعادة تعيين الطلبات' };
        }
        await loadUsers();
        return { ok: true, message: data.message };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'حدث خطأ',
        };
      }
    },
    [loadUsers]
  );

  const updateUserPrinterLink = useCallback(
    (userId: string, link: PrinterLinkInfo | null) => {
      setUsers((prev) =>
        prev.map((user) => (user.id === userId ? { ...user, printerLink: link } : user))
      );
    },
    []
  );

  // Ensure warehouses attached to a user (but absent from the active list) stay selectable.
  const mergeWarehouseOptions = useCallback((extra: WarehouseOption[]) => {
    if (!extra.length) return;
    setWarehouseOptions((prev) => {
      const existingIds = new Set(prev.map((warehouse) => warehouse.id));
      const additions = extra.filter((warehouse) => !existingIds.has(warehouse.id));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }, []);

  return {
    users,
    loading,
    accessDenied,
    warehouseOptions,
    warehousesLoading,
    warehousesError,
    loadUsers,
    loadWarehouses,
    saveUser,
    deleteUser,
    resetOrders,
    updateUserPrinterLink,
    mergeWarehouseOptions,
  };
}
