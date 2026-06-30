'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import type { WarehouseOption } from '../types';

interface WarehouseSelectorProps {
  options: WarehouseOption[];
  value: string[];
  loading: boolean;
  error: string | null;
  onChange: (next: string[]) => void;
  onRetry: () => void;
}

export function WarehouseSelector({
  options,
  value,
  loading,
  error,
  onChange,
  onRetry,
}: WarehouseSelectorProps) {
  const toggle = (warehouseId: string) => {
    onChange(
      value.includes(warehouseId)
        ? value.filter((id) => id !== warehouseId)
        : [...value, warehouseId]
    );
  };

  if (loading) {
    return <LoadingState label="جاري تحميل المستودعات..." />;
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button type="button" variant="outline" onClick={onRetry}>
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <EmptyState
        title="لا توجد مستودعات نشطة"
        description="يرجى إنشاء مستودعات من صفحة المستودع أولاً."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="max-h-60 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">
        {options.map((warehouse) => {
          const isSelected = value.includes(warehouse.id);
          return (
            <label
              key={warehouse.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${
                isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:border-border'
              }`}
            >
              <Checkbox checked={isSelected} onCheckedChange={() => toggle(warehouse.id)} />
              <div>
                <p className="text-sm font-medium">{warehouse.name}</p>
                {(warehouse.code || warehouse.location) && (
                  <p className="text-xs text-muted-foreground">
                    {warehouse.code && `رمز: ${warehouse.code}`}
                    {warehouse.code && warehouse.location ? ' • ' : ''}
                    {warehouse.location}
                  </p>
                )}
              </div>
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        يمكن ربط مستخدم المستودع بأكثر من مستودع واحد.
      </p>
    </div>
  );
}
