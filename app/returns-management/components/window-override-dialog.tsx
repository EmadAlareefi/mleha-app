'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

interface ReturnWindowOverride {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  createdBy: string;
}

/** Lets staff allow one order past the 24h / 3-day return window. */
export function WindowOverrideDialog() {
  const [overrides, setOverrides] = useState<ReturnWindowOverride[]>([]);
  const [orderNumber, setOrderNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/returns/window-overrides');
    const data = await response.json().catch(() => ({}));
    if (response.ok) setOverrides(data.overrides || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (method: 'POST' | 'DELETE', body: unknown, success: (data: any) => string) => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/returns/window-overrides', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر تنفيذ الإجراء');
      setMessage(success(data));
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          استثناء مدة الإرجاع
          {overrides.length > 0 && <Badge variant="secondary">{overrides.length}</Badge>}
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-6 text-right sm:text-right">
          <DialogTitle>استثناء مدة الإرجاع</DialogTitle>
          <DialogDescription>اسمح لطلب محدد بتجاوز حد 24 ساعة أو 3 أيام. تبقى بقية شروط الإرجاع مطبقة.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="رقم الطلب في سلة"
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value)}
              placeholder="رقم الطلب في سلة"
              disabled={loading}
            />
            <Button
              disabled={loading || !orderNumber.trim()}
              onClick={() =>
                send(
                  'POST',
                  { merchantId: process.env.NEXT_PUBLIC_MERCHANT_ID || '1234509876', orderNumber: orderNumber.trim() },
                  (data) => {
                    setOrderNumber('');
                    return `تم السماح للطلب #${data.override?.orderNumber || orderNumber} بتجاوز مدة الإرجاع.`;
                  },
                )
              }
            >
              {loading ? 'جارٍ الحفظ...' : 'السماح بالإرجاع المتأخر'}
            </Button>
          </div>
          {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
          {overrides.length > 0 && (
            <div className="space-y-2">
              <FieldLabel>الاستثناءات النشطة</FieldLabel>
              {overrides.map((override) => (
                <div key={override.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <strong>طلب #{override.orderNumber || override.orderId}</strong>
                    <span className="mr-2 text-muted-foreground">بواسطة {override.createdBy}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => send('DELETE', { id: override.id }, () => 'تم إلغاء الاستثناء.')}
                  >
                    إلغاء الاستثناء
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
