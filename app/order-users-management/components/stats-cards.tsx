'use client';

import { useMemo } from 'react';
import { PackageCheck, ShieldCheck, Users as UsersIcon, Warehouse as WarehouseIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { OrderUser } from '../types';

interface StatsCardsProps {
  users: OrderUser[];
}

export function StatsCards({ users }: StatsCardsProps) {
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => user.isActive).length;
    const autoAssignEnabled = users.filter((user) => user.autoAssign).length;
    const uniqueWarehouses = new Set(
      users.flatMap((user) => (user.warehouses || []).map((warehouse) => warehouse.id))
    ).size;

    return [
      { label: 'إجمالي المستخدمين', value: total, icon: UsersIcon },
      { label: 'المستخدمون النشطون', value: active, icon: ShieldCheck },
      { label: 'التعيين التلقائي', value: autoAssignEnabled, icon: PackageCheck },
      { label: 'المستودعات المرتبطة', value: uniqueWarehouses, icon: WarehouseIcon },
    ];
  }, [users]);

  return (
    <Card className="p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-md border bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{stat.label}</span>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="mt-1 text-lg font-semibold">{stat.value}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
