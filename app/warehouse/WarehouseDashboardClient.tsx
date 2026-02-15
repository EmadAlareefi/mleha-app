'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { ScannerInput } from '@/components/warehouse/scanner-input';
import { ShipmentsTable } from '@/components/warehouse/shipments-table';
import { DailyReport } from '@/components/warehouse/daily-report';
import { useWarehouseSelection } from '@/components/warehouse/useWarehouseSelection';
import type { Shipment, WarehouseInfo } from '@/components/warehouse/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AppNavbar from '@/components/AppNavbar';
import { ChevronRight, ChevronLeft, Loader2, RefreshCcw, Search, X } from 'lucide-react';
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
    <div className="min-h-screen bg-slate-50">
      <AppNavbar
        title="لوحة المستودع"
        subtitle={
          selectedWarehouse?.name
            ? `المستودع الحالي: ${selectedWarehouse.name}`
            : 'اختر مستودعاً للبدء'
        }
      />

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Warehouse Selection + Date Navigation */}
        <Card className="rounded-2xl">
          <CardContent className="py-4 space-y-4">
            {/* Warehouse selector */}
            <div className="flex flex-wrap items-center gap-3">
              {warehousesLoading && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري التحميل...
                </div>
              )}
              {!warehousesLoading && availableWarehouses.length === 0 && (
                <div className="text-sm text-amber-700">
                  {isAdmin
                    ? 'لا يوجد مستودعات. أنشئ واحداً من صفحة إدارة المستودعات.'
                    : 'لم يتم ربط أي مستودع بحسابك.'}
                </div>
              )}
              {availableWarehouses.map((warehouse) => {
                const isSelected = warehouse.id === selectedWarehouseId;
                return (
                  <button
                    key={warehouse.id}
                    type="button"
                    onClick={() => selectWarehouse(warehouse.id)}
                    className={`rounded-xl border px-4 py-2 text-sm font-medium transition-all ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-900 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200'
                    }`}
                  >
                    {warehouse.name}
                    {warehouse.code && (
                      <span className="mr-1 text-xs text-slate-400">({warehouse.code})</span>
                    )}
                  </button>
                );
              })}
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refreshAdminWarehouses}
                  disabled={warehousesLoading}
                  className="text-slate-500 hover:text-indigo-600"
                >
                  <RefreshCcw className={`h-4 w-4 ${warehousesLoading ? 'animate-spin' : ''}`} />
                </Button>
              )}
              {warehouseError && (
                <span className="text-sm text-red-600">{warehouseError}</span>
              )}
            </div>

            {/* Date navigation */}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => { e.preventDefault(); handlePreviousDay(); }}
                className="rounded-xl"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium text-slate-700">
                {format(selectedDate, 'EEEE، d MMMM yyyy', { locale: ar })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => { e.preventDefault(); handleNextDay(); }}
                className="rounded-xl"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                value={formattedDate}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value) handleDateChange(new Date(value));
                }}
                className="w-auto rounded-xl text-sm"
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
              <div className="mr-auto flex items-center gap-4 text-sm">
                <span className="text-slate-500">الإجمالي: <strong className="text-slate-900">{stats.total}</strong></span>
                <span className="text-green-600">وارد: <strong>{stats.incoming}</strong></span>
                <span className="text-blue-600">صادر: <strong>{stats.outgoing}</strong></span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scanner + Search */}
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

          <Card className="rounded-2xl">
            <CardContent className="py-5 space-y-4">
              <p className="text-sm font-medium text-slate-700">بحث عن شحنة</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-slate-400" />
                  <Input
                    type="text"
                    placeholder="رقم التتبع..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSearchError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearch();
                    }}
                    className="pr-10 text-right rounded-xl"
                    disabled={searching || !selectedWarehouse}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => { setSearchQuery(''); setSearchError(null); }}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      disabled={searching}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Button
                  onClick={handleSearch}
                  disabled={searching || !selectedWarehouse || !searchQuery.trim()}
                  className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'بحث'}
                </Button>
              </div>
              {searchError && (
                <p className="text-sm text-red-600">{searchError}</p>
              )}
              {!selectedWarehouse && (
                <p className="text-sm text-amber-700">يرجى اختيار مستودع لتفعيل البحث.</p>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Print Report (above shipments table) */}
        <DailyReport
          shipments={shipments}
          stats={stats}
          date={selectedDate}
          warehouseName={selectedWarehouse?.name}
        />

        {/* Shipments Table */}
        <ShipmentsTable
          shipments={shipments}
          onDelete={handleDelete}
          highlightedId={highlightedShipmentId}
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
