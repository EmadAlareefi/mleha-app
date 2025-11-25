'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, ArrowDownToLine, ArrowUpFromLine, Building2 } from 'lucide-react';

interface StatsCardsProps {
  stats: {
    total: number;
    incoming: number;
    outgoing: number;
    byCompany: Array<{ company: string; count: number }>;
  };
  warehouseName?: string | null;
}

export function StatsCards({ stats, warehouseName }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">إجمالي الشحنات</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.total}</div>
          <p className="text-xs text-muted-foreground">
            {warehouseName ? `اليوم • ${warehouseName}` : 'اليوم'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">الشحنات الواردة</CardTitle>
          <ArrowDownToLine className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600">{stats.incoming}</div>
          <p className="text-xs text-muted-foreground">اليوم</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">الشحنات الصادرة</CardTitle>
          <ArrowUpFromLine className="h-4 w-4 text-blue-600" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-blue-600">{stats.outgoing}</div>
          <p className="text-xs text-muted-foreground">اليوم</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">شركات الشحن</CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.byCompany.length}</div>
          <p className="text-xs text-muted-foreground">اليوم</p>
        </CardContent>
      </Card>
    </div>
  );
}
