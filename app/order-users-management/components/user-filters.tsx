'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type { ServiceRole } from '@/app/lib/service-definitions';

export interface UserFiltersState {
  search: string;
  status: 'all' | 'active' | 'inactive';
  role: ServiceRole | 'all';
  userType: 'all' | 'employee' | 'manufacturer';
}

export const DEFAULT_FILTERS: UserFiltersState = {
  search: '',
  status: 'all',
  role: 'all',
  userType: 'all',
};

const ROLE_OPTIONS: { value: ServiceRole | 'all'; label: string }[] = [
  { value: 'all', label: 'كل الصلاحيات' },
  { value: 'orders', label: 'الطلبات' },
  { value: 'warehouse', label: 'المستودع' },
  { value: 'store_manager', label: 'إدارة المتجر' },
  { value: 'accountant', label: 'المحاسبة' },
  { value: 'delivery_agent', label: 'المناديب' },
];

interface UserFiltersProps {
  filters: UserFiltersState;
  onChange: (next: UserFiltersState) => void;
}

export function UserFilters({ filters, onChange }: UserFiltersProps) {
  const update = <K extends keyof UserFiltersState>(key: K, value: UserFiltersState[K]) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(event) => update('search', event.target.value)}
          placeholder="بحث بالاسم، اسم المستخدم، البريد، أو الهاتف..."
          className="pr-9"
        />
      </div>
      <NativeSelect
        className="w-full md:w-40"
        value={filters.status}
        onChange={(event) => update('status', event.target.value as UserFiltersState['status'])}
      >
        <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
        <NativeSelectOption value="active">نشط</NativeSelectOption>
        <NativeSelectOption value="inactive">متوقف</NativeSelectOption>
      </NativeSelect>
      <NativeSelect
        className="w-full md:w-44"
        value={filters.role}
        onChange={(event) => update('role', event.target.value as UserFiltersState['role'])}
      >
        {ROLE_OPTIONS.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect
        className="w-full md:w-36"
        value={filters.userType}
        onChange={(event) => update('userType', event.target.value as UserFiltersState['userType'])}
      >
        <NativeSelectOption value="all">الكل</NativeSelectOption>
        <NativeSelectOption value="employee">موظف</NativeSelectOption>
        <NativeSelectOption value="manufacturer">مصنع</NativeSelectOption>
      </NativeSelect>
    </div>
  );
}
