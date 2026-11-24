'use client';

import { useEffect, useState } from 'react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { JourneyStaff } from '@/app/lib/stuck-orders/types';

export type ViolationTarget = { staff: JourneyStaff; orderNumber: string };
export type ViolationInput = { userId: string; title: string; description: string; points: number };

const ROLE_LABEL: Record<JourneyStaff['role'], string> = { packer: 'المجهز', printer: 'الشاحن' };
const DEFAULT_POINTS = '-5';

/** Log a violation (UserRecognition, kind PENALTY) against the packer or shipper of an order. */
export function ViolationDialog({
  target,
  busy,
  onCancel,
  onSubmit,
}: {
  target: ViolationTarget | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: ViolationInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [points, setPoints] = useState(DEFAULT_POINTS);
  const [description, setDescription] = useState('');

  // A fresh form for each person / order.
  useEffect(() => {
    if (!target) return;
    setTitle('');
    setPoints(DEFAULT_POINTS);
    setDescription(`الطلب #${target.orderNumber}`);
  }, [target]);

  const submit = () => {
    if (!target || !title.trim()) return;
    const numeric = Math.round(Number(points));
    onSubmit({
      userId: target.staff.userId,
      title: title.trim(),
      description: description.trim(),
      points: Number.isFinite(numeric) ? numeric : Number(DEFAULT_POINTS),
    });
  };

  return (
    <ConfirmationDialog
      open={Boolean(target)}
      title="تسجيل مخالفة"
      message={target ? `مخالفة على ${ROLE_LABEL[target.staff.role]} ${target.staff.name}` : ''}
      onCancel={onCancel}
      onConfirm={submit}
      confirmVariant="danger"
      confirmLabel={busy ? 'جاري الحفظ...' : 'حفظ المخالفة'}
      confirmDisabled={busy || !title.trim()}
      content={
        <div className="mt-4 space-y-3">
          <Field>
            <FieldLabel htmlFor="violation-title">عنوان المخالفة</FieldLabel>
            <Input
              id="violation-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="مثال: قطعة خاطئة في الطلب"
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="violation-points">النقاط</FieldLabel>
            <Input id="violation-points" type="number" inputMode="numeric" value={points} onChange={(event) => setPoints(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="violation-description">تفاصيل إضافية</FieldLabel>
            <Textarea id="violation-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
        </div>
      }
    />
  );
}
