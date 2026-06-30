'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Printer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/dashboard/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getRolesFromServiceKeys,
  serviceDefinitions,
  type ServiceKey,
} from '@/app/lib/service-definitions';
import type { OrderUser } from '../types';
import type { UserFiltersState } from './user-filters';

const SERVICE_MAP = new Map(serviceDefinitions.map((service) => [service.key, service]));

function formatDateForDisplay(value?: string | null) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatSalaryDisplay(amount?: string | null, currency?: string | null) {
  if (!amount) return 'غير محدد';
  const numericAmount = Number(amount);
  const safeCurrency = currency || 'SAR';
  if (Number.isNaN(numericAmount)) {
    return `${amount} ${safeCurrency}`.trim();
  }
  const formatted = new Intl.NumberFormat('ar-SA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericAmount);
  return `${formatted} ${safeCurrency}`.trim();
}

type SortKey = 'name' | 'start' | 'assignments';
type SortDir = 'asc' | 'desc';

interface UsersTableProps {
  users: OrderUser[];
  filters: UserFiltersState;
  onEdit: (user: OrderUser) => void;
  onPrinter: (user: OrderUser) => void;
  onResetOrders: (user: OrderUser) => void;
  onDelete: (user: OrderUser) => void;
}

export function UsersTable({
  users,
  filters,
  onEdit,
  onPrinter,
  onResetOrders,
  onDelete,
}: UsersTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const visibleUsers = useMemo(() => {
    const query = filters.search.trim().toLowerCase();

    const filtered = users.filter((user) => {
      if (query) {
        const haystack = [user.name, user.username, user.email, user.phone]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (filters.status === 'active' && !user.isActive) return false;
      if (filters.status === 'inactive' && user.isActive) return false;
      if (filters.userType !== 'all') {
        const type = user.userType === 'manufacturer' ? 'manufacturer' : 'employee';
        if (type !== filters.userType) return false;
      }
      if (filters.role !== 'all') {
        const roles = getRolesFromServiceKeys((user.serviceKeys || []) as ServiceKey[]);
        if (!roles.includes(filters.role)) return false;
      }
      return true;
    });

    const direction = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'assignments') {
        return (a._count.assignments - b._count.assignments) * direction;
      }
      if (sortKey === 'start') {
        const aTime = a.employmentStartDate ? new Date(a.employmentStartDate).getTime() : 0;
        const bTime = b.employmentStartDate ? new Date(b.employmentStartDate).getTime() : 0;
        return (aTime - bTime) * direction;
      }
      return a.name.localeCompare(b.name, 'ar') * direction;
    });
  }, [users, filters, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="size-3 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />;
  };

  if (visibleUsers.length === 0) {
    return (
      <EmptyState
        title="لا يوجد مستخدمون مطابقون"
        description="جرّب تعديل عبارة البحث أو الفلاتر."
      />
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-9 w-[220px] px-3 text-right">
              <button
                type="button"
                onClick={() => toggleSort('name')}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                المستخدم
                <SortIcon column="name" />
              </button>
            </TableHead>
            <TableHead className="h-9 px-3 text-right">الصلاحيات</TableHead>
            <TableHead className="h-9 px-3 text-right">المستودعات</TableHead>
            <TableHead className="h-9 px-3 text-right">الطابعة</TableHead>
            <TableHead className="h-9 px-3 text-right">
              <button
                type="button"
                onClick={() => toggleSort('assignments')}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                الطلبات
                <SortIcon column="assignments" />
              </button>
            </TableHead>
            <TableHead className="h-9 px-3 text-right">
              <button
                type="button"
                onClick={() => toggleSort('start')}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                التوظيف
                <SortIcon column="start" />
              </button>
            </TableHead>
            <TableHead className="h-9 w-[180px] px-3 text-right">الإجراءات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleUsers.map((user) => {
            const serviceKeys = (user.serviceKeys || []) as ServiceKey[];
            const roles = getRolesFromServiceKeys(serviceKeys);
            const hasOrdersRole = roles.includes('orders');
            const hasWarehouseRole = roles.includes('warehouse');
            const endedEmployment = Boolean(user.employmentEndDate);
            const endDateLabel = endedEmployment
              ? formatDateForDisplay(user.employmentEndDate)
              : 'على رأس العمل';

            return (
              <TableRow key={user.id} className="align-middle">
                <TableCell className="px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{user.name}</p>
                      <Badge variant={user.isActive ? 'default' : 'secondary'}>
                        {user.isActive ? 'نشط' : 'متوقف'}
                      </Badge>
                      {user.userType === 'manufacturer' && <Badge variant="outline">مصنع</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email || user.phone || 'لا توجد بيانات اتصال'}
                    </p>
                    {user.affiliateName && (
                      <p className="truncate text-xs text-purple-700">
                        مسوق: {user.affiliateName} ({Number(user.affiliateCommission || 10)}%)
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2">
                  <div className="flex max-w-[260px] flex-wrap gap-1">
                    {serviceKeys.length > 0 ? (
                      serviceKeys.map((key) => (
                        <Badge key={key} variant="outline">
                          {SERVICE_MAP.get(key)?.title || key}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">لا توجد صلاحيات</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2">
                  {hasWarehouseRole ? (
                    user.warehouses && user.warehouses.length > 0 ? (
                      <div className="max-w-[220px] truncate text-xs">
                        {user.warehouses
                          .map((warehouse) => warehouse.code || warehouse.name)
                          .join('، ')}
                      </div>
                    ) : (
                      <Badge variant="destructive">لا توجد</Badge>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2">
                  <div className="flex max-w-[220px] items-center gap-2">
                    <Printer className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate text-xs">
                      {user.printerLink?.printerName || 'غير مرتبطة'}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2">
                  {hasOrdersRole ? (
                    <div className="flex items-center gap-2">
                      <Badge variant={user.autoAssign ? 'default' : 'secondary'}>
                        {user.autoAssign ? 'تلقائي' : 'يدوي'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {user._count.assignments} طلب
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2">
                  <div className="space-y-0.5 text-xs">
                    <div>{formatDateForDisplay(user.employmentStartDate)}</div>
                    <div className="text-muted-foreground">
                      {formatSalaryDisplay(user.salaryAmount, user.salaryCurrency)}
                    </div>
                    <Badge variant={endedEmployment ? 'destructive' : 'secondary'}>
                      {endedEmployment ? `انتهى: ${endDateLabel}` : 'على رأس العمل'}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => onEdit(user)}>
                      تعديل
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onPrinter(user)}>
                      طابعة
                    </Button>
                    {hasOrdersRole && user._count.assignments > 0 && (
                      <Button size="sm" variant="outline" onClick={() => onResetOrders(user)}>
                        تصفير
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => onDelete(user)}>
                      حذف
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
