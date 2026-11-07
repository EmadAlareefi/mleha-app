'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { pieceLabel, type ReturnRequest } from './types';

interface InspectorNotesDialogProps {
  request: ReturnRequest | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Notes from customer service that the warehouse sees when inspecting. */
export function InspectorNotesDialog({ request, onClose, onSaved }: InspectorNotesDialogProps) {
  const pending = request?.items.filter((item) => !item.conditionStatus) ?? [];
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setNotes(Object.fromEntries((request?.items ?? []).map((item) => [item.id, item.preInspectionNotes || ''])));
    setError('');
  }, [request]);

  const save = async () => {
    if (!request) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/returns/pre-inspection-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: request.id,
          notes: pending.map((item) => ({ itemId: item.id, note: notes[item.id] ?? '' })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر حفظ الملاحظات');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>ملاحظات للمفتش</DialogTitle>
          <DialogDescription>
            طلب #{request?.orderNumber} — ما لاحظه العميل أو خدمة العملاء، يظهر لفريق الفحص عند وصول الشحنة.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-3">
          {pending.map((item) => (
            <div key={item.id} className="space-y-2 rounded-lg border bg-gray-50 p-3">
              <p className="text-sm font-medium">
                {item.productName}
                {item.variantName ? ` · ${item.variantName}` : ''}
                {request && pieceLabel(item, request.items) ? ` (${pieceLabel(item, request.items)})` : ''}
                <span className="mr-2 text-xs text-gray-500">{item.type === 'exchange' ? 'استبدال' : 'استرجاع'}</span>
              </p>
              <Textarea
                rows={2}
                placeholder="اشرح ما لاحظه العميل أو فريق خدمة العملاء"
                value={notes[item.id] ?? ''}
                onChange={(event) => setNotes((previous) => ({ ...previous, [item.id]: event.target.value }))}
              />
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={save} disabled={saving || pending.length === 0}>
            {saving ? 'جاري الحفظ...' : 'حفظ الملاحظات'}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
