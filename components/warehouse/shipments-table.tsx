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
import { Trash2, Package } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface Shipment {
  id: string;
  trackingNumber: string;
  company: string;
  type: string;
  scannedAt: string;
  notes?: string | null;
  warehouse?: {
    id: string;
    name: string;
    code?: string | null;
  } | null;
}

interface ShipmentsTableProps {
  shipments: Shipment[];
  onDelete: (id: string) => Promise<void>;
}

export function ShipmentsTable({ shipments, onDelete }: ShipmentsTableProps) {
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
                  <TableHead>ملاحظات</TableHead>
                  <TableHead className="w-[100px]">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipments.map((shipment) => {
                  const company = getCompanyInfo(shipment.company);
                  return (
                    <TableRow key={shipment.id}>
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
