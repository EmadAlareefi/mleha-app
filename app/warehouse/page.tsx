'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ScannerInput } from '@/components/warehouse/scanner-input';
import { StatsCards } from '@/components/warehouse/stats-cards';
import { ShipmentsTable } from '@/components/warehouse/shipments-table';
import { DailyReport } from '@/components/warehouse/daily-report';
import { addDays, format } from 'date-fns';
import { ar } from 'date-fns/locale';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { useWarehouseSelection, WarehouseInfo } from '@/components/warehouse/useWarehouseSelection';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Shipment {
  id: string;
  trackingNumber: string;
  company: string;
  type: string;
  scannedAt: string;
  notes?: string | null;
}

interface Stats {
  total: number;
  incoming: number;
  outgoing: number;
  byCompany: Array<{ company: string; count: number }>;
}

export default function WarehousePage() {
  const { data: session } = useSession();
  const userRole = ((session?.user as any)?.role || 'admin') as 'admin' | 'warehouse' | string;
  const sessionWarehouses: WarehouseInfo[] = useMemo(() => {
    if (userRole !== 'warehouse') {
      return [];
    }
    const warehouses = (session?.user as any)?.warehouseData?.warehouses ?? [];
    return Array.isArray(warehouses) ? warehouses : [];
  }, [session, userRole]);
  const [adminWarehouses, setAdminWarehouses] = useState<WarehouseInfo[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(userRole === 'admin');
  const [warehouseError, setWarehouseError] = useState<string | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    incoming: 0,
    outgoing: 0,
    byCompany: [],
  });
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const availableWarehouses: WarehouseInfo[] =
    userRole === 'warehouse' ? sessionWarehouses : adminWarehouses;

  const {
    selectedWarehouse,
    selectWarehouse,
  } = useWarehouseSelection(availableWarehouses);

  const formattedDate = useMemo(
    () => format(selectedDate, 'yyyy-MM-dd'),
    [selectedDate]
  );

  const selectedWarehouseId = selectedWarehouse?.id || '';

  const fetchData = useCallback(async () => {
    try {
      if (availableWarehouses.length === 0) {
        setShipments([]);
        setStats({ total: 0, incoming: 0, outgoing: 0, byCompany: [] });
        setLoading(false);
        return;
      }

      if (!selectedWarehouseId) {
        setShipments([]);
        setStats({ total: 0, incoming: 0, outgoing: 0, byCompany: [] });
        setLoading(false);
        return;
      }

      const params = new URLSearchParams({
        date: formattedDate,
        limit: '100',
      });
      if (selectedWarehouseId) {
        params.set('warehouseId', selectedWarehouseId);
      }

      const queryString = params.toString();
      const [shipmentsRes, statsRes] = await Promise.all([
        fetch(`/api/shipments?${queryString}`),
        fetch(`/api/shipments/stats?${queryString}`),
      ]);

      if (shipmentsRes.ok) {
        const contentType = shipmentsRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const shipmentsData = await shipmentsRes.json();
          setShipments(shipmentsData);
        } else {
          console.warn('Shipments response is not JSON, resetting list');
          setShipments([]);
        }
      } else {
        console.error('Failed to load shipments', await shipmentsRes.text());
        setShipments([]);
      }

      if (statsRes.ok) {
        const contentType = statsRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const statsData = await statsRes.json();
          setStats(statsData);
        } else {
          console.warn('Stats response is not JSON, resetting stats');
          setStats({ total: 0, incoming: 0, outgoing: 0, byCompany: [] });
        }
      } else {
        console.error('Failed to load stats', await statsRes.text());
        setStats({ total: 0, incoming: 0, outgoing: 0, byCompany: [] });
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setShipments([]);
      setStats({ total: 0, incoming: 0, outgoing: 0, byCompany: [] });
    } finally {
      setLoading(false);
    }
  }, [formattedDate, selectedWarehouseId, availableWarehouses.length]);

  useEffect(() => {
    setLoading(true);
    fetchData();

    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleDateChange = (newDate: Date) => {
    setLoading(true);
    setSelectedDate(newDate);
  };

  const handleNextDay = () => handleDateChange(addDays(selectedDate, 1));
  const handlePreviousDay = () => handleDateChange(addDays(selectedDate, -1));

  const handleScan = async (trackingNumber: string, type: 'incoming' | 'outgoing') => {
    if (!selectedWarehouse) {
      throw new Error('يرجى اختيار المستودع أولاً');
    }
    const response = await fetch('/api/shipments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackingNumber, type, warehouseId: selectedWarehouse.id }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'فشل في تسجيل الشحنة');
    }

    // Refresh data after successful scan
    await fetchData();
  };

  const handleDelete = async (id: string) => {
    const response = await fetch(`/api/shipments/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('فشل في حذف الشحنة');
    }

    // Refresh data after successful deletion
    await fetchData();
  };

  useEffect(() => {
    if (userRole !== 'admin') {
      setAdminWarehouses([]);
      setWarehousesLoading(false);
      setWarehouseError(null);
      return;
    }

    let active = true;
    const loadWarehouses = async () => {
      setWarehousesLoading(true);
      setWarehouseError(null);
      try {
        const response = await fetch('/api/warehouses?all=true');
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'تعذر تحميل المستودعات');
        }
        if (active) {
          setAdminWarehouses(data.warehouses || []);
        }
      } catch (error) {
        if (active) {
          setWarehouseError(error instanceof Error ? error.message : 'تعذر تحميل المستودعات');
          setAdminWarehouses([]);
        }
      } finally {
        if (active) {
          setWarehousesLoading(false);
        }
      }
    };

    loadWarehouses();
    return () => {
      active = false;
    };
  }, [userRole]);

  const refreshAdminWarehouses = useCallback(() => {
    if (userRole !== 'admin') return;
    setWarehousesLoading(true);
    setWarehouseError(null);
    fetch('/api/warehouses?all=true')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'تعذر تحميل المستودعات');
        }
        setAdminWarehouses(data.warehouses || []);
      })
      .catch((error) => {
        setWarehouseError(error instanceof Error ? error.message : 'تعذر تحميل المستودعات');
        setAdminWarehouses([]);
      })
      .finally(() => setWarehousesLoading(false));
  }, [userRole]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="inline-flex">
                <Image
                  src="/logo.png"
                  alt="شعار مليحة"
                  width={60}
                  height={60}
                  className="object-contain"
                  unoptimized
                />
              </Link>
              <div>
                <h1 className="text-2xl font-bold">نظام إدارة الشحنات</h1>
                <p className="text-sm text-muted-foreground">
                  {format(selectedDate, 'EEEE، d MMMM yyyy', { locale: ar })}
                </p>
              </div>
            </div>
            <nav className="flex gap-3">
              <Link
                href="/warehouse"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
              >
                المستودع
              </Link>
              <Link
                href="/local-shipping"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                شحن محلي
              </Link>
            </nav>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              <button
                onClick={handlePreviousDay}
                className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50"
              >
                اليوم السابق
              </button>
              <button
                onClick={handleNextDay}
                className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50"
              >
                اليوم التالي
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <label htmlFor="date-picker">عرض يوم:</label>
              <input
                id="date-picker"
                type="date"
                value={formattedDate}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value) handleDateChange(new Date(value));
                }}
                className="px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          <Card className="p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-gray-500">المستودع الحالي</p>
                  <p className="text-lg font-semibold">
                    {selectedWarehouse?.name || (warehousesLoading ? 'جاري التحميل...' : 'لم يتم الاختيار')}
                  </p>
                </div>
                {userRole === 'admin' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshAdminWarehouses}
                    disabled={warehousesLoading}
                  >
                    {warehousesLoading ? '...جاري التحديث' : 'تحديث القائمة'}
                  </Button>
                )}
              </div>
              {warehousesLoading ? (
                <p className="text-sm text-gray-500">جاري تحميل قائمة المستودعات...</p>
              ) : availableWarehouses.length === 0 ? (
                <p className="text-sm text-red-600">
                  {userRole === 'admin'
                    ? 'لا يوجد مستودعات متاحة. استخدم صفحة إدارة المستودعات لإنشاء مستودع جديد.'
                    : 'لم يتم ربط أي مستودع بحسابك. يرجى التواصل مع المسؤول.'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableWarehouses.map((warehouse) => {
                    const isSelected = warehouse.id === selectedWarehouseId;
                    return (
                      <button
                        key={warehouse.id}
                        type="button"
                        onClick={() => selectWarehouse(warehouse.id)}
                        className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                            : 'border-gray-300 bg-white hover:border-blue-400'
                        }`}
                      >
                        <div className="font-semibold">{warehouse.name}</div>
                        {warehouse.code && (
                          <div className="text-xs text-gray-500">رمز: {warehouse.code}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {warehouseError && (
                <p className="text-sm text-red-600">{warehouseError}</p>
              )}
            </div>
          </Card>

          {/* Scanner Input */}
          <ScannerInput
            onScan={handleScan}
            selectedWarehouseName={selectedWarehouse?.name}
            disabled={!selectedWarehouse}
            disabledMessage={
              availableWarehouses.length === 0
                ? userRole === 'admin'
                  ? 'لا يوجد مستودعات متاحة. قم بإنشائها أولاً.'
                  : 'لم يتم ربط أي مستودع بحسابك.'
                : !selectedWarehouse
                  ? 'يرجى اختيار مستودع من القائمة أعلاه قبل تسجيل الشحنات.'
                  : undefined
            }
          />

          {/* Stats Cards */}
          <StatsCards stats={stats} warehouseName={selectedWarehouse?.name} />

          {/* Shipments Table */}
          <ShipmentsTable shipments={shipments} onDelete={handleDelete} />

          {/* Daily Report */}
          <DailyReport
            shipments={shipments}
            stats={stats}
            date={selectedDate}
            warehouseName={selectedWarehouse?.name}
          />
        </div>
      </main>
    </div>
  );
}
