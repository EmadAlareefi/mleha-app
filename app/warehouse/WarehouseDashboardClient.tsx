'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { ScannerInput } from '@/components/warehouse/scanner-input';
import { StatsCards } from '@/components/warehouse/stats-cards';
import { ShipmentsTable } from '@/components/warehouse/shipments-table';
import { DailyReport } from '@/components/warehouse/daily-report';
import { useWarehouseSelection } from '@/components/warehouse/useWarehouseSelection';
import type { Shipment, WarehouseInfo } from '@/components/warehouse/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AppNavbar from '@/components/AppNavbar';
import { CalendarDays, Loader2, MapPin, RefreshCcw, Search, X } from 'lucide-react';
import { ShipmentDetailsDialog } from '@/components/warehouse/shipment-details-dialog';

interface Stats {
  total: number;
  incoming: number;
  outgoing: number;
  byCompany: Array<{ company: string; count: number }>;
}

interface WarehouseDashboardClientProps {
  isAdmin: boolean;
  hasWarehouseRole: boolean;
  sessionWarehouses?: WarehouseInfo[];
  initialAdminWarehouses?: WarehouseInfo[];
  defaultWarehouseId: string | null;
  initialShipments?: Shipment[];
  initialStats?: Stats;
  initialDateIso: string;
  initialWarehouseError?: string | null;
}

const EMPTY_STATS: Stats = {
  total: 0,
  incoming: 0,
  outgoing: 0,
  byCompany: [],
};

export default function WarehouseDashboardClient({
  isAdmin,
  hasWarehouseRole,
  sessionWarehouses = [],
  initialAdminWarehouses = [],
  defaultWarehouseId,
  initialShipments = [],
  initialStats = EMPTY_STATS,
  initialDateIso,
  initialWarehouseError = null,
}: WarehouseDashboardClientProps) {
  const [adminWarehouses, setAdminWarehouses] = useState<WarehouseInfo[]>(initialAdminWarehouses);
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const [warehouseError, setWarehouseError] = useState<string | null>(initialWarehouseError);
  const [shipments, setShipments] = useState<Shipment[]>(initialShipments);
  const [stats, setStats] = useState<Stats>(initialStats);
  const [selectedDate, setSelectedDate] = useState(() => {
    const parsed = initialDateIso ? new Date(initialDateIso) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlightedShipmentId, setHighlightedShipmentId] = useState<string | null>(null);
  const [searchedShipment, setSearchedShipment] = useState<Shipment | null>(null);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);

  const sessionWarehouseList = useMemo(
    () => (Array.isArray(sessionWarehouses) ? sessionWarehouses : []),
    [sessionWarehouses]
  );

  const availableWarehouses: WarehouseInfo[] = useMemo(() => {
    if (isAdmin || hasWarehouseRole) {
      if (adminWarehouses.length > 0) {
        return adminWarehouses;
      }
      if (sessionWarehouseList.length > 0) {
        return sessionWarehouseList;
      }
      return [];
    }
    return adminWarehouses;
  }, [adminWarehouses, hasWarehouseRole, isAdmin, sessionWarehouseList]);

  const { selectedWarehouse, selectWarehouse } = useWarehouseSelection(
    availableWarehouses,
    defaultWarehouseId || undefined
  );

  useEffect(() => {
    if (selectedWarehouse || !defaultWarehouseId) {
      return;
    }
    if (availableWarehouses.some((warehouse) => warehouse.id === defaultWarehouseId)) {
      selectWarehouse(defaultWarehouseId);
    }
  }, [availableWarehouses, defaultWarehouseId, selectWarehouse, selectedWarehouse]);

  const formattedDate = useMemo(() => format(selectedDate, 'yyyy-MM-dd'), [selectedDate]);
  const selectedWarehouseId = selectedWarehouse?.id || '';

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchError('يرجى إدخال رقم التتبع للبحث');
      return;
    }

    if (!selectedWarehouseId) {
      setSearchError('يرجى اختيار المستودع أولاً');
      return;
    }

    setSearching(true);
    setSearchError(null);
    setHighlightedShipmentId(null);
    setSearchedShipment(null);
    setSearchMatchCount(0);
    setIsDetailsDialogOpen(false);

    try {
      const params = new URLSearchParams({
        trackingNumber: searchQuery.trim(),
        warehouseId: selectedWarehouseId,
      });

      const response = await fetch(`/api/shipments/search?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        setSearchError(data.error || 'فشل في البحث عن الشحنة');
        return;
      }

      if (data.length === 0) {
        setSearchError('لم يتم العثور على شحنات بهذا الرقم');
        return;
      }

      const foundShipment = data[0];
      const shipmentDate = new Date(foundShipment.scannedAt);

      setHighlightedShipmentId(foundShipment.id);
      setSelectedDate(shipmentDate);
      setSearchQuery('');
      setSearchedShipment(foundShipment);
      setSearchMatchCount(data.length);
      setIsDetailsDialogOpen(true);
    } catch (error) {
      console.error('Error searching for shipment:', error);
      setSearchError('حدث خطأ أثناء البحث عن الشحنة');
    } finally {
      setSearching(false);
    }
  }, [searchQuery, selectedWarehouseId]);

  const fetchData = useCallback(async () => {
    if (!selectedWarehouseId) {
      setShipments([]);
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const params = new URLSearchParams({
        date: formattedDate,
        limit: '100',
        warehouseId: selectedWarehouseId,
      });

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
          setStats(EMPTY_STATS);
        }
      } else {
        console.error('Failed to load stats', await statsRes.text());
        setStats(EMPTY_STATS);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setShipments([]);
      setStats(EMPTY_STATS);
    } finally {
      setLoading(false);
    }
  }, [formattedDate, selectedWarehouseId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (!highlightedShipmentId) {
      return;
    }

    const timer = setTimeout(() => {
      setHighlightedShipmentId(null);
    }, 5000);

    return () => clearTimeout(timer);
  }, [highlightedShipmentId]);

  const handleDateChange = (newDate: Date) => {
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

    await fetchData();
  };

  const handleDelete = async (id: string) => {
    const response = await fetch(`/api/shipments/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('فشل في حذف الشحنة');
    }

    await fetchData();
  };

  useEffect(() => {
    if (!isAdmin) {
      setAdminWarehouses([]);
      setWarehousesLoading(false);
      setWarehouseError(null);
      return;
    }

    if (initialAdminWarehouses.length > 0) {
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
  }, [initialAdminWarehouses.length, isAdmin]);

  const refreshAdminWarehouses = useCallback(() => {
    if (!isAdmin) return;
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
  }, [isAdmin]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <AppNavbar
        title="لوحة المستودع"
        subtitle={
          selectedWarehouse?.name
            ? `المستودع الحالي: ${selectedWarehouse.name}`
            : 'اختر مستودعاً للبدء'
        }
      />

      <main className="max-w-7xl mx-auto px-4 py-10 sm:px-6 lg:px-8 space-y-8">
        {loading && (
          <div className="flex items-center gap-3 rounded-3xl border border-dashed border-indigo-200 bg-white/80 px-4 py-3 text-sm text-indigo-800 shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>جاري تحديث بيانات {selectedWarehouse?.name || 'المستودع'}...</span>
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-[1.8fr,1.2fr]">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-900 to-indigo-700 p-8 text-white shadow-2xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.15),transparent_60%)]" />
            <div className="relative z-10 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-white/60">المستودع</p>
                  <h1 className="text-3xl font-semibold">سجل عمليات اليوم</h1>
                  <p className="text-white/70">
                    {selectedWarehouse?.name
                      ? `المستودع الحالي: ${selectedWarehouse.name}`
                      : 'اختر مستودعاً لمتابعة الشحنات'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handlePreviousDay();
                    }}
                    className="rounded-2xl bg-white/10 px-5 text-sm text-white shadow hover:bg-white/20"
                  >
                    اليوم السابق
                  </Button>
                  <Button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleNextDay();
                    }}
                    className="rounded-2xl bg-white px-5 text-sm font-semibold text-slate-900 shadow"
                  >
                    اليوم التالي
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/20 bg-white/10 px-5 py-4">
                  <p className="text-sm text-indigo-100">تاريخ العرض</p>
                  <div className="mt-2 flex items-center gap-2 text-xl font-semibold">
                    <CalendarDays className="h-5 w-5 text-white/80" />
                    {format(selectedDate, 'EEEE، d MMMM yyyy', { locale: ar })}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/10 px-5 py-4">
                  <p className="text-sm text-indigo-100">إجمالي اليوم</p>
                  <p className="mt-2 text-3xl font-bold">{stats.total}</p>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/10 px-5 py-4">
                  <p className="text-sm text-indigo-100">وارد / صادر</p>
                  <p className="mt-2 text-3xl font-bold">
                    {stats.incoming} / {stats.outgoing}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[200px]">
                  <label htmlFor="date-picker" className="mb-2 block text-sm text-white/80">
                    عرض يوم محدد
                  </label>
                  <Input
                    id="date-picker"
                    type="date"
                    value={formattedDate}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value) handleDateChange(new Date(value));
                    }}
                    className="rounded-2xl border-white/40 bg-white/20 text-white placeholder:text-white/70 focus-visible:ring-white"
                  />
                </div>
              </div>
            </div>
          </div>

          <Card className="rounded-3xl border border-slate-100 bg-white/95 shadow-xl shadow-indigo-100/50">
            <CardHeader className="space-y-2">
              <p className="text-xs font-semibold uppercase text-indigo-600">المستودعات</p>
              <CardTitle className="text-2xl">اختر المستودع</CardTitle>
              <CardDescription>
                {selectedWarehouse?.name
                  ? `تم اختيار ${selectedWarehouse.name}`
                  : 'اختر مستودعاً لتفعيل المسح والبحث'}
              </CardDescription>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refreshAdminWarehouses}
                  disabled={warehousesLoading}
                  className="mt-2 inline-flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 text-indigo-700 hover:bg-indigo-100"
                >
                  <RefreshCcw className={`h-4 w-4 ${warehousesLoading ? 'animate-spin' : ''}`} />
                  تحديث القائمة
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {warehousesLoading && (
                <div className="flex items-center gap-2 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-800">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري تحميل قائمة المستودعات...
                </div>
              )}
              {!warehousesLoading && availableWarehouses.length === 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {isAdmin
                    ? 'لا يوجد مستودعات متاحة بعد. استخدم صفحة إدارة المستودعات لإنشاء مستودع جديد.'
                    : 'لم يتم ربط أي مستودع بحسابك. يرجى التواصل مع المسؤول.'}
                </div>
              )}
              {availableWarehouses.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {availableWarehouses.map((warehouse) => {
                    const isSelected = warehouse.id === selectedWarehouseId;
                    return (
                      <button
                        key={warehouse.id}
                        type="button"
                        onClick={() => selectWarehouse(warehouse.id)}
                        className={`flex min-w-[140px] flex-col rounded-2xl border px-4 py-3 text-right transition-all ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-900 shadow'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200'
                        }`}
                      >
                        <span className="text-sm font-semibold">{warehouse.name}</span>
                        {warehouse.code && (
                          <span className="text-xs text-slate-500">رمز: {warehouse.code}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {warehouseError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {warehouseError}
                </div>
              )}
              {selectedWarehouse && (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
                  <div className="flex items-center gap-2 font-medium text-slate-800">
                    <MapPin className="h-4 w-4 text-indigo-500" />
                    {selectedWarehouse.name}
                  </div>
                  {selectedWarehouse.code && (
                    <p className="mt-1 text-xs text-slate-500">الكود الداخلي: {selectedWarehouse.code}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <ScannerInput
            onScan={handleScan}
            selectedWarehouseName={selectedWarehouse?.name}
            disabled={!selectedWarehouse}
            disabledMessage={
              availableWarehouses.length === 0
                ? isAdmin
                  ? 'لا يوجد مستودعات متاحة. قم بإنشائها أولاً.'
                  : 'لم يتم ربط أي مستودع بحسابك.'
                : !selectedWarehouse
                  ? 'يرجى اختيار مستودع من القائمة أعلاه قبل تسجيل الشحنات.'
                  : undefined
            }
          />

          <Card className="rounded-3xl border border-slate-100 bg-white/95 shadow-sm">
            <CardHeader className="space-y-1">
              <p className="text-xs font-semibold uppercase text-indigo-600">بحث وتتبع</p>
              <CardTitle className="text-2xl">ابحث عن شحنة</CardTitle>
              <CardDescription>
                ادخل رقم التتبع للتحقق من حالة الشحنة أو تغيير التاريخ تلقائياً إلى يوم مسحها.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-slate-400" />
                  <Input
                    type="text"
                    placeholder="ابحث عن شحنة برقم التتبع..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSearchError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearch();
                      }
                    }}
                    className="pr-10 text-right"
                    disabled={searching || !selectedWarehouse}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSearchError(null);
                      }}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
                      disabled={searching}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Button
                  onClick={handleSearch}
                  disabled={searching || !selectedWarehouse || !searchQuery.trim()}
                  className="min-w-[120px] rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  {searching ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري البحث...
                    </span>
                  ) : (
                    'بحث'
                  )}
                </Button>
              </div>
              {searchError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {searchError}
                </div>
              )}
              {!selectedWarehouse && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  يرجى اختيار مستودع لتفعيل البحث.
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <StatsCards stats={stats} warehouseName={selectedWarehouse?.name} />

        <ShipmentsTable
          shipments={shipments}
          onDelete={handleDelete}
          highlightedId={highlightedShipmentId}
        />

        <DailyReport
          shipments={shipments}
          stats={stats}
          date={selectedDate}
          warehouseName={selectedWarehouse?.name}
        />
      </main>

      <ShipmentDetailsDialog
        open={isDetailsDialogOpen && !!searchedShipment}
        shipment={searchedShipment}
        matchCount={searchMatchCount}
        onClose={() => setIsDetailsDialogOpen(false)}
      />
    </div>
  );
}
