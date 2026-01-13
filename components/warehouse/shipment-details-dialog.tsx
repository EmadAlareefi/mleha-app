'use client';

import type { ReactNode } from 'react';
import type { Shipment } from '@/components/warehouse/types';
import { Button } from '@/components/ui/button';
import { SHIPMENT_COMPANIES } from '@/lib/shipment-detector';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import {
  CalendarDays,
  Clock,
  Hash,
  MapPin,
  NotebookText,
  PackageSearch,
  User,
  X,
} from 'lucide-react';

interface ShipmentDetailsDialogProps {
  open: boolean;
  shipment: Shipment | null;
  onClose: () => void;
  matchCount?: number;
}

export function ShipmentDetailsDialog({
  open,
  shipment,
  onClose,
  matchCount = 1,
}: ShipmentDetailsDialogProps) {
  if (!open || !shipment) {
    return null;
  }

  const scannedAt = new Date(shipment.scannedAt);
  const hasValidDate = !Number.isNaN(scannedAt.getTime());
  const formattedDate = hasValidDate ? format(scannedAt, 'EEEE، d MMMM yyyy', { locale: ar }) : '—';
  const formattedTime = hasValidDate ? format(scannedAt, 'HH:mm:ss', { locale: ar }) : '—';
  const company = SHIPMENT_COMPANIES[shipment.company] || SHIPMENT_COMPANIES.unknown;
  const typeLabel = shipment.type === 'incoming' ? 'وارد' : 'صادر';
  const typeClasses =
    shipment.type === 'incoming'
      ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
      : 'bg-blue-100 text-blue-700 border border-blue-200';
  const warehouseLabel = shipment.warehouse
    ? `${shipment.warehouse.name}${shipment.warehouse.code ? ` (${shipment.warehouse.code})` : ''}`
    : 'غير مرتبط بمستودع';
  const hasMultipleMatches = matchCount > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label="تفاصيل الشحنة"
    >
      <div className="fixed inset-0 bg-slate-900/60" onClick={onClose} aria-hidden="true" />
      <div className="relative z-50 w-full max-w-2xl">
        <div className="overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className="relative bg-gradient-to-br from-slate-900 via-indigo-900 to-indigo-700 px-6 py-6 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-white/60">تفاصيل الشحنة</p>
                <h2 className="mt-2 text-3xl font-semibold">{shipment.trackingNumber}</h2>
                <p className="mt-2 text-sm text-white/80">
                  {hasMultipleMatches
                    ? `تم العثور على ${matchCount} شحنات مطابقة. عرضت أحدث شحنة.`
                    : 'تم العثور على الشحنة المطلوبة.'}
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={onClose}
                className="text-white/80 hover:bg-white/20 hover:text-white rounded-full"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="mt-4 inline-flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-2 text-sm">
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium"
                style={{
                  backgroundColor: `${company.color}33`,
                  color: company.color,
                }}
              >
                {company.nameAr}
              </span>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${typeClasses}`}>
                {typeLabel}
              </span>
            </div>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className="grid gap-4 md:grid-cols-2">
              <DetailCard
                icon={<CalendarDays className="h-5 w-5 text-indigo-500" />}
                label="تاريخ المسح"
                value={formattedDate}
              />
              <DetailCard
                icon={<Clock className="h-5 w-5 text-indigo-500" />}
                label="وقت المسح"
                value={formattedTime}
              />
              <DetailCard
                icon={<MapPin className="h-5 w-5 text-indigo-500" />}
                label="المستودع"
                value={warehouseLabel}
              />
              <DetailCard
                icon={<User className="h-5 w-5 text-indigo-500" />}
                label="تم المسح بواسطة"
                value={shipment.scannedBy || 'غير معروف'}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <DetailCard
                icon={<PackageSearch className="h-5 w-5 text-indigo-500" />}
                label="معرف الشحنة"
                value={shipment.id}
              />
              <DetailCard
                icon={<Hash className="h-5 w-5 text-indigo-500" />}
                label="رقم التتبع"
                value={shipment.trackingNumber}
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <NotebookText className="h-5 w-5 text-indigo-500" />
                الملاحظات
              </div>
              <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                {shipment.notes?.trim() || 'لا يوجد ملاحظات مضافة لهذه الشحنة.'}
              </p>
            </div>
          </div>

          <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-6 py-4">
            <Button onClick={onClose} className="rounded-2xl px-6">
              إغلاق
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface DetailCardProps {
  icon: ReactNode;
  label: string;
  value: string;
}

function DetailCard({ icon, label, value }: DetailCardProps) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-base font-medium text-slate-900 break-words">{value}</p>
    </div>
  );
}
