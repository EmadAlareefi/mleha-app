'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SHIPMENT_COMPANIES, getAllCompanies } from '@/lib/shipment-detector';
import { Printer, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useReactToPrint } from 'react-to-print';
import Image from 'next/image';
import type { Shipment } from '@/components/warehouse/types';

interface DailyReportProps {
  shipments: Shipment[];
  stats: {
    total: number;
    incoming: number;
    outgoing: number;
    byCompany: Array<{ company: string; count: number }>;
  };
  date: Date;
  warehouseName?: string | null;
}

export function DailyReport({ shipments, stats, date, warehouseName }: DailyReportProps) {
  const componentRef = useRef<HTMLDivElement>(null);
  const [selectedCompany, setSelectedCompany] = useState<string>('all');

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
  });

  const getCompanyInfo = (companyId: string) => {
    return SHIPMENT_COMPANIES[companyId] || SHIPMENT_COMPANIES.unknown;
  };

  // Filter shipments by selected company
  const filteredShipments = selectedCompany === 'all'
    ? shipments
    : shipments.filter((s) => s.company === selectedCompany);

  const incomingShipments = filteredShipments.filter((s) => s.type === 'incoming');
  const outgoingShipments = filteredShipments.filter((s) => s.type === 'outgoing');

  // Calculate stats for filtered shipments
  const filteredStats = selectedCompany === 'all'
    ? stats
    : {
        total: filteredShipments.length,
        incoming: incomingShipments.length,
        outgoing: outgoingShipments.length,
        byCompany: stats.byCompany.filter(c => c.company === selectedCompany),
      };

  const selectedCompanyInfo = selectedCompany !== 'all'
    ? getCompanyInfo(selectedCompany)
    : null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FileText className="w-6 h-6" />
              التقرير اليومي
            </span>
            <div className="flex items-center gap-4 no-print">
              <div className="flex items-center gap-2">
                <label htmlFor="company-filter" className="text-sm font-medium">
                  تصفية حسب الشركة:
                </label>
                <Select
                  id="company-filter"
                  value={selectedCompany}
                  onChange={(e) => setSelectedCompany(e.target.value)}
                  className="w-48"
                >
                  <option value="all">جميع الشركات</option>
                  {getAllCompanies().map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.nameAr}
                    </option>
                  ))}
                </Select>
              </div>
              <Button onClick={() => handlePrint()}>
                <Printer className="w-4 h-4 ml-2" />
                طباعة التقرير
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      <div ref={componentRef} className="print:p-8">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between border-b pb-6">
            <div>
              <h1 className="text-3xl font-bold">
                {selectedCompanyInfo
                  ? `تقرير شحنات ${selectedCompanyInfo.nameAr}`
                  : warehouseName
                    ? `تقرير الشحنات - ${warehouseName}`
                    : 'تقرير الشحنات اليومي'}
              </h1>
              <p className="text-lg text-muted-foreground mt-2">
                {format(date, 'EEEE، d MMMM yyyy', { locale: ar })}
              </p>
            </div>
            <div className="text-left">
              <Image
                src="/logo.png"
                alt="Mleha Logo"
                width={120}
                height={120}
                className="object-contain"
                unoptimized
              />
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">إجمالي الشحنات</div>
              <div className="text-3xl font-bold mt-2">{filteredStats.total}</div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">الشحنات الواردة</div>
              <div className="text-3xl font-bold mt-2 text-green-600">{filteredStats.incoming}</div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">الشحنات الصادرة</div>
              <div className="text-3xl font-bold mt-2 text-blue-600">{filteredStats.outgoing}</div>
            </div>
          </div>

          {/* By Company - Only show when "all" is selected */}
          {selectedCompany === 'all' && (
            <div>
              <h2 className="text-xl font-bold mb-4">التوزيع حسب شركات الشحن</h2>
              <div className="grid grid-cols-2 gap-4">
                {stats.byCompany.map((item) => {
                  const company = getCompanyInfo(item.company);
                  return (
                    <div key={item.company} className="border rounded-lg p-4 flex justify-between items-center">
                      <span className="font-medium">{company.nameAr}</span>
                      <span className="text-2xl font-bold">{item.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Incoming Shipments */}
          <div className="mt-6">
            <h2 className="text-xl font-bold mb-4">الشحنات الواردة ({incomingShipments.length})</h2>
            {incomingShipments.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    <TableHead>رقم التتبع</TableHead>
                    <TableHead>شركة الشحن</TableHead>
                    <TableHead>وقت المسح</TableHead>
                    <TableHead>ملاحظات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incomingShipments.map((shipment, index) => {
                    const company = getCompanyInfo(shipment.company);
                    return (
                      <TableRow key={shipment.id} className="print-row-break">
                        <TableCell>{index + 1}</TableCell>
                        <TableCell className="font-mono">{shipment.trackingNumber}</TableCell>
                        <TableCell>{company.nameAr}</TableCell>
                        <TableCell>{format(new Date(shipment.scannedAt), 'HH:mm:ss')}</TableCell>
                        <TableCell>{shipment.notes || '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-8">لا توجد شحنات واردة</p>
            )}
          </div>

          {/* Outgoing Shipments */}
          <div className="mt-6">
            <h2 className="text-xl font-bold mb-4">الشحنات الصادرة ({outgoingShipments.length})</h2>
            {outgoingShipments.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    <TableHead>رقم التتبع</TableHead>
                    <TableHead>شركة الشحن</TableHead>
                    <TableHead>وقت المسح</TableHead>
                    <TableHead>ملاحظات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outgoingShipments.map((shipment, index) => {
                    const company = getCompanyInfo(shipment.company);
                    return (
                      <TableRow key={shipment.id} className="print-row-break">
                        <TableCell>{index + 1}</TableCell>
                        <TableCell className="font-mono">{shipment.trackingNumber}</TableCell>
                        <TableCell>{company.nameAr}</TableCell>
                        <TableCell>{format(new Date(shipment.scannedAt), 'HH:mm:ss')}</TableCell>
                        <TableCell>{shipment.notes || '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-8">لا توجد شحنات صادرة</p>
            )}
          </div>

          {/* Footer */}
          <div className="border-t pt-6 mt-8 text-center text-sm text-muted-foreground print-footer">
            <p>نظام إدارة الشحنات - ملحة</p>
            <p className="mt-2">تم الطباعة في: {format(new Date(), 'yyyy/MM/dd HH:mm:ss')}</p>
          </div>
        </div>

        <style jsx global>{`
          @media print {
            @page {
              size: A4;
              margin: 1.5cm;
            }

            body {
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
            }

            /* Prevent page breaks inside table rows */
            .print-row-break {
              page-break-inside: avoid;
              break-inside: avoid;
            }

            /* Ensure tables can span multiple pages */
            table {
              page-break-inside: auto;
            }

            thead {
              display: table-header-group;
            }

            tr {
              page-break-inside: avoid;
              page-break-after: auto;
            }

            /* Keep footer at the end */
            .print-footer {
              page-break-inside: avoid;
              break-inside: avoid;
            }

            /* Remove unnecessary spacing for print */
            .space-y-6 > * + * {
              margin-top: 1.5rem;
            }
          }
        `}</style>
      </div>
    </>
  );
}
