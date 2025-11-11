'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ScannerInput } from '@/components/warehouse/scanner-input';
import { StatsCards } from '@/components/warehouse/stats-cards';
import { ShipmentsTable } from '@/components/warehouse/shipments-table';
import { DailyReport } from '@/components/warehouse/daily-report';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import Image from 'next/image';

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
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    incoming: 0,
    outgoing: 0,
    byCompany: [],
  });
  const [loading, setLoading] = useState(true);
  const [currentDate] = useState(new Date());

  const fetchData = async () => {
    try {
      const today = format(new Date(), 'yyyy-MM-dd');

      const [shipmentsRes, statsRes] = await Promise.all([
        fetch(`/api/shipments?date=${today}&limit=100`),
        fetch(`/api/shipments/stats?date=${today}`),
      ]);

      if (shipmentsRes.ok) {
        const shipmentsData = await shipmentsRes.json();
        setShipments(shipmentsData);
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Refresh data every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

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
              <Image
                src="/logo.png"
                alt="Mleha Logo"
                width={60}
                height={60}
                className="object-contain"
              />
              <div>
                <h1 className="text-2xl font-bold">نظام إدارة الشحنات</h1>
                <p className="text-sm text-muted-foreground">
                  {format(currentDate, 'EEEE، d MMMM yyyy', { locale: ar })}
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
              <Link
                href="/returns"
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
              >
                الإرجاع
              </Link>
            </nav>
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
          <DailyReport shipments={shipments} stats={stats} date={currentDate} />
        </div>
      </main>
    </div>
  );
}
