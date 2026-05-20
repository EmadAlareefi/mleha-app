'use client';

import type { FormEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type LabelRequest = {
  barcode: string;
  size?: string;
  color?: string;
  quantity: number;
};

export default function BarcodeLabelsPage() {
  const [barcode, setBarcode] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [labelRequest, setLabelRequest] = useState<LabelRequest | null>(null);
  const [error, setError] = useState('');
  const labelSheetRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: labelSheetRef,
    documentTitle: labelRequest ? `labels-${labelRequest.barcode}` : 'barcode-labels',
  });

  const labels = useMemo(() => {
    if (!labelRequest) return [];
    return Array.from({ length: labelRequest.quantity }, () => ({
      barcode: labelRequest.barcode,
      size: labelRequest.size,
      color: labelRequest.color,
    }));
  }, [labelRequest]);

  const handleGenerateLabels = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const trimmedBarcode = barcode.trim();
    const parsedQuantity = Number(quantity);

    if (!trimmedBarcode) {
      setError('يرجى إدخال رقم الباركود أو رقم الصنف');
      return;
    }

    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) {
      setError('الكمية يجب أن تكون رقماً صحيحاً أكبر من صفر');
      return;
    }

    const normalizedQuantity = Math.min(Math.floor(parsedQuantity), 200);
    const warning =
      Math.floor(parsedQuantity) > 200
        ? 'سيتم إنشاء ٢٠٠ ملصق كحد أقصى في كل مرة لتجنب مشاكل الطباعة.'
        : '';

    setLabelRequest({
      barcode: trimmedBarcode,
      size: size.trim(),
      color: color.trim(),
      quantity: normalizedQuantity,
    });

    if (warning) {
      setError(warning);
    }
  };

  const handlePrintClick = () => {
    if (!labelRequest || labels.length === 0) {
      setError('أنشئ الملصقات أولاً، ثم اضغط على زر الطباعة.');
      return;
    }

    setError('');
    handlePrint?.();
  };

  return (
    <AppPageShell
      title="مولد ملصقات الباركود"
      subtitle="أدخل رقم الصنف، المقاس واللون ثم اختر عدد الملصقات المطلوبة"
    >
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <form
          onSubmit={handleGenerateLabels}
          className="no-print"
        >
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>بيانات الملصقات</CardTitle>
              <CardDescription>حجم الملصق النهائي ٧ سم × ٤ سم.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid gap-6 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="barcode">رقم الباركود / رقم الصنف *</FieldLabel>
            <Input
              id="barcode"
              type="text"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="7023"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="size">المقاس (اختياري)</FieldLabel>
            <Input
              id="size"
              type="text"
              value={size}
              onChange={(event) => setSize(event.target.value)}
              placeholder="50 - XL"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="color">اللون (اختياري)</FieldLabel>
            <Input
              id="color"
              type="text"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              placeholder="أزرق"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="quantity">عدد الملصقات</FieldLabel>
            <Input
              id="quantity"
              type="number"
              min={1}
              max={200}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>

          <div className="md:col-span-2 flex flex-col gap-3 md:flex-row">
            <Button type="submit" className="flex-1">
              إنشاء الملصقات
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handlePrintClick}
              className="flex-1"
            >
              طباعة الملصقات
            </Button>
          </div>

          {error && (
            <Alert className="md:col-span-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
              </FieldGroup>
            </CardContent>
          </Card>
        </form>

        <Card className="rounded-lg">
          <CardHeader className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>معاينة الملصقات</CardTitle>
              <CardDescription>
                كل بطاقة أدناه تطابق المقاس المطلوب ٧ سم × ٤ سم وجاهزة للطباعة المباشرة
              </CardDescription>
            </div>
            {labelRequest && (
              <Badge variant="secondary">
                {labelRequest.quantity} ملصق لـ {labelRequest.barcode}
              </Badge>
            )}
          </CardHeader>
          <CardContent>
          <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
          </div>

          <div
            ref={labelSheetRef}
            className="grid justify-center gap-4 md:grid-cols-2 lg:grid-cols-3"
          >
            {labels.length === 0 ? (
              <div className="col-span-full">
                <EmptyState
                  title="لا توجد ملصقات للمعاينة"
                  description='قم بملء الحقول في الأعلى واضغط "إنشاء الملصقات" لعرض الملصقات القابلة للطباعة.'
                />
              </div>
            ) : (
              labels.map((label, index) => (
                <div
                  key={`${label.barcode}-${index}`}
                  className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white px-4 py-3"
                  style={{
                    width: '7cm',
                    height: '4cm',
                  }}
                >
                  <div className="text-[12px] uppercase font-bold tracking-[0.35em] text-black">
                    MLEHA
                  </div>

                  <div className="space-y-1">
                    <p className="text-xl font-bold text-gray-900 tracking-wide">
                      #{label.barcode}
                    </p>
                    {label.size && (
                      <p className="text-sm font-semibold text-gray-700">المقاس: {label.size}</p>
                    )}
                    {label.color && (
                      <p className="text-sm text-gray-600">اللون: {label.color}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          </CardContent>
        </Card>
      </div>
    </AppPageShell>
  );
}
