'use client';

import type { FormEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';

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
    <div className="min-h-screen bg-[#f7f3ec] py-10 px-4">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-3">
          <p className="text-sm uppercase tracking-[0.3em] text-gray-500">barcode studio</p>
          <h1 className="text-4xl font-bold text-gray-900">مولد ملصقات الباركود</h1>
          <p className="text-gray-600">
            أدخل رقم الصنف، المقاس واللون (اختياري) ثم اختر عدد الملصقات المطلوبة بحجم ٧ سم × ٤ سم
          </p>
        </div>

        <form
          onSubmit={handleGenerateLabels}
          className="no-print grid gap-6 rounded-3xl bg-white/90 p-6 shadow-lg shadow-gray-200 md:grid-cols-2"
        >
          <div className="space-y-2">
            <label htmlFor="barcode" className="text-sm font-medium text-gray-700">
              رقم الباركود / رقم الصنف *
            </label>
            <input
              id="barcode"
              type="text"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="7023"
              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="size" className="text-sm font-medium text-gray-700">
              المقاس (اختياري)
            </label>
            <input
              id="size"
              type="text"
              value={size}
              onChange={(event) => setSize(event.target.value)}
              placeholder="50 - XL"
              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="color" className="text-sm font-medium text-gray-700">
              اللون (اختياري)
            </label>
            <input
              id="color"
              type="text"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              placeholder="أزرق"
              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="quantity" className="text-sm font-medium text-gray-700">
              عدد الملصقات
            </label>
            <input
              id="quantity"
              type="number"
              min={1}
              max={200}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>

          <div className="md:col-span-2 flex flex-col gap-3 md:flex-row">
            <button
              type="submit"
              className="flex-1 rounded-2xl bg-gray-900 py-3 text-base font-semibold text-white transition hover:bg-black"
            >
              إنشاء الملصقات
            </button>
            <button
              type="button"
              onClick={handlePrintClick}
              className="flex-1 rounded-2xl border border-gray-900 py-3 text-base font-semibold text-gray-900 transition hover:bg-gray-100"
            >
              طباعة الملصقات
            </button>
          </div>

          {error && (
            <p className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {error}
            </p>
          )}
        </form>

        <section className="rounded-3xl bg-white p-6 shadow-lg shadow-gray-200">
          <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">معاينة الملصقات</h2>
              <p className="text-sm text-gray-500">
                كل بطاقة أدناه تطابق المقاس المطلوب ٧ سم × ٤ سم وجاهزة للطباعة المباشرة
              </p>
            </div>
            {labelRequest && (
              <div className="rounded-2xl bg-gray-100 px-4 py-2 text-sm text-gray-600">
                {labelRequest.quantity} ملصق لـ {labelRequest.barcode}
              </div>
            )}
          </div>

          <div
            ref={labelSheetRef}
            className="grid justify-center gap-4 md:grid-cols-2 lg:grid-cols-3"
          >
            {labels.length === 0 ? (
              <div className="col-span-full rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-10 text-center text-gray-500">
                قم بملء الحقول في الأعلى واضغط &quot;إنشاء الملصقات&quot; لعرض الملصقات القابلة للطباعة.
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
                  <div className="text-[10px] uppercase tracking-[0.35em] text-gray-400">
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
        </section>
      </div>
    </div>
  );
}
