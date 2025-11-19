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
  const availableWarehouses: WarehouseInfo[] =
    userRole === 'warehouse'
      ? ((session?.user as any)?.warehouseData?.warehouses ?? [])
      : [];
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    incoming: 0,
    outgoing: 0,
    byCompany: [],
  });
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const {
    selectedWarehouse,
    selectWarehouse,
    needsSelection,
  } = useWarehouseSelection(availableWarehouses);

  const formattedDate = useMemo(
    () => format(selectedDate, 'yyyy-MM-dd'),
    [selectedDate]
  );

  const fetchData = useCallback(async () => {
    try {
      const [shipmentsRes, statsRes] = await Promise.all([
        fetch(`/api/shipments?date=${formattedDate}&limit=100`),
        fetch(`/api/shipments/stats?date=${formattedDate}`),
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
  }, [formattedDate]);

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
    const response = await fetch('/api/shipments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackingNumber, type }),
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
          {/* Scanner Input */}
          <ScannerInput onScan={handleScan} />

          {/* Stats Cards */}
          <StatsCards stats={stats} />

          {/* Shipments Table */}
          <ShipmentsTable shipments={shipments} onDelete={handleDelete} />

          {/* Daily Report */}
          <DailyReport shipments={shipments} stats={stats} date={selectedDate} />
        </div>
      </main>
    </div>
  );
}
