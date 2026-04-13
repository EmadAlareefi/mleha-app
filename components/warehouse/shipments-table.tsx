'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { SHIPMENT_COMPANIES } from '@/lib/shipment-detector';
import { resolveMajorSmsaStatus } from '@/lib/smsa-status';
import { Trash2, Package, CheckCircle, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import type { Shipment } from '@/components/warehouse/types';

const statusTimestampFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const formatStatusTimestamp = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return statusTimestampFormatter.format(date);
};

interface ShipmentsTableProps {
  shipments: Shipment[];
  onDelete: (id: string) => Promise<void>;
  highlightedId?: string | null;
}

export function ShipmentsTable({ shipments, onDelete, highlightedId }: ShipmentsTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const showWarehouseColumn = shipments.some((shipment) => !!shipment.warehouse);

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه الشحنة؟')) return;

    setDeletingId(id);
    try {
      await onDelete(id);
    } catch {
      alert('فشل في حذف الشحنة');
    } finally {
      setDeletingId(null);
    }
  };

  const getCompanyInfo = (companyId: string) => {
    return SHIPMENT_COMPANIES[companyId] || SHIPMENT_COMPANIES.unknown;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="w-6 h-6" />
          الشحنات الأخيرة
        </CardTitle>
      </CardHeader>
      <CardContent>
        {shipments.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            لا توجد شحنات مسجلة اليوم
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم التتبع</TableHead>
                  <TableHead>شركة الشحن</TableHead>
                  {showWarehouseColumn && <TableHead>المستودع</TableHead>}
                  <TableHead>النوع</TableHead>
                  <TableHead>وقت المسح</TableHead>
                  <TableHead>تسليم شركة الشحن</TableHead>
                  <TableHead>حالة سمسا</TableHead>
                  <TableHead>ملاحظات</TableHead>
                  <TableHead className="w-[100px]">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipments.map((shipment) => {
                  const company = getCompanyInfo(shipment.company);
                  const isHighlighted = highlightedId === shipment.id;
                  const smsaStatus = shipment.smsaLiveStatus || null;
                  const statusLabel = resolveMajorSmsaStatus(smsaStatus);
                  const statusTimestamp = formatStatusTimestamp(smsaStatus?.timestamp);
                  return (
                    <TableRow
                      key={shipment.id}
                      className={isHighlighted ? 'bg-yellow-50 border-r-4 border-yellow-500' : ''}
                    >
                      <TableCell className="font-mono font-medium">
                        {shipment.trackingNumber}
                      </TableCell>
                      <TableCell>
                        <span
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                          style={{
                            backgroundColor: `${company.color}20`,
                            color: company.color,
                          }}
                        >
                          {company.nameAr}
                        </span>
                      </TableCell>
                      {showWarehouseColumn && (
                        <TableCell className="text-sm text-gray-600">
                          {shipment.warehouse?.name || '-'}
                        </TableCell>
                      )}
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            shipment.type === 'incoming'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {shipment.type === 'incoming' ? 'وارد' : 'صادر'}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(shipment.scannedAt), 'HH:mm:ss', { locale: ar })}
                      </TableCell>
                      <TableCell className="text-sm">
                        {shipment.handoverScannedAt ? (
                          <div className="flex items-center gap-2 text-green-700 font-medium">
                            <CheckCircle className="w-4 h-4" />
                            {format(new Date(shipment.handoverScannedAt), 'HH:mm:ss', { locale: ar })}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-red-600 font-medium">
                            <XCircle className="w-4 h-4" />
                            لم يتم
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {smsaStatus ? (
                          <div className="space-y-0.5">
                            <div className="font-medium text-slate-900">
                              {statusLabel || smsaStatus.description || smsaStatus.code || '—'}
                            </div>
                            {(smsaStatus.city || statusTimestamp) && (
                              <div className="text-[11px] text-slate-500">
                                {smsaStatus.city || ''}
                                {smsaStatus.city && statusTimestamp ? ' • ' : ''}
                                {statusTimestamp || ''}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {shipment.notes || '-'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(shipment.id)}
                          disabled={deletingId === shipment.id}
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
