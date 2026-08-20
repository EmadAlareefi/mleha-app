'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Award, Loader2, Scale, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

type RecognitionKind = 'REWARD' | 'PENALTY';

function getRiyadhDateInput() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function RecognitionQuickAction({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<RecognitionKind>('REWARD');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [points, setPoints] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(getRiyadhDateInput);

  const resetForm = () => {
    setKind('REWARD');
    setTitle('');
    setDescription('');
    setPoints('');
    setEffectiveDate(getRiyadhDateInput());
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('اكتب عنوان السجل أولاً.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const response = await fetch('/api/user-recognition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          kind,
          title: title.trim(),
          description: description.trim() || undefined,
          points: points ? Number(points) : 0,
          effectiveDate,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر حفظ السجل.');
      }

      setOpen(false);
      resetForm();
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'تعذر حفظ السجل.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && !submitting) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="xs" aria-label={`إضافة سجل لـ ${userName}`}>
          <Scale />
          إضافة سجل
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="sm:max-w-xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2">
            {kind === 'REWARD' ? (
              <Award className="size-5 text-emerald-600" />
            ) : (
              <ShieldAlert className="size-5 text-rose-600" />
            )}
            إضافة مكافأة أو مخالفة
          </DialogTitle>
          <DialogDescription>سيضاف السجل مباشرة إلى تقرير {userName} وسجله التحفيزي.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>نوع السجل</FieldLabel>
                <NativeSelect
                  className="w-full"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as RecognitionKind)}
                >
                  <NativeSelectOption value="REWARD">مكافأة</NativeSelectOption>
                  <NativeSelectOption value="PENALTY">مخالفة</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>التاريخ</FieldLabel>
                <Input
                  type="date"
                  value={effectiveDate}
                  onChange={(event) => setEffectiveDate(event.target.value)}
                  required
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr,8rem]">
              <Field>
                <FieldLabel>العنوان</FieldLabel>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={kind === 'REWARD' ? 'مثال: دقة وسرعة الإنجاز' : 'مثال: عدم اتباع إجراءات المسح'}
                  required
                />
              </Field>
              <Field>
                <FieldLabel>النقاط</FieldLabel>
                <Input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={points}
                  onChange={(event) => setPoints(event.target.value)}
                  placeholder="0"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>ملاحظات</FieldLabel>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="تفاصيل تساعد على توثيق سبب السجل"
                rows={3}
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="flex-row justify-start sm:justify-start">
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Scale />}
              حفظ السجل
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
