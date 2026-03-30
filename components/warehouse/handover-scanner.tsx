'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Camera, CheckCircle, Scan, Smartphone, XCircle } from 'lucide-react';
import { SHIPMENT_COMPANIES } from '@/lib/shipment-detector';

type BarcodeDetection = { rawValue?: string };
type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetection[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

type HandoverOutcome = 'confirmed' | 'already_confirmed' | 'missing_first_scan';

interface HandoverScannerProps {
  warehouseId?: string;
  warehouseName?: string;
  disabled?: boolean;
  disabledMessage?: string;
  onSuccess?: () => void | Promise<void>;
  handoverCount?: number;
  companyFilter?: string;
  availableCompanies?: string[];
  onCompanyFilterChange?: (company: string) => void;
}

interface ScanResult {
  outcome: HandoverOutcome;
  message: string;
  trackingNumber?: string;
  confirmedAt?: string | null;
}

export function HandoverScanner({
  warehouseId,
  warehouseName,
  disabled = false,
  disabledMessage,
  onSuccess,
  handoverCount,
  companyFilter,
  availableCompanies = [],
  onCompanyFilterChange,
}: HandoverScannerProps) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scannerSupported, setScannerSupported] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeDetectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const stopScanner = useCallback(() => {
    setScannerActive(false);
    if (scanFrameRef.current) {
      cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    barcodeDetectorRef.current = null;
  }, []);

  const waitForVideoElement = useCallback(async (): Promise<HTMLVideoElement> => {
    if (videoRef.current) {
      return videoRef.current;
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (videoRef.current) {
        return videoRef.current;
      }
    }
    throw new Error('video_not_ready');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    setScannerSupported(
      'BarcodeDetector' in window && typeof (window as any).BarcodeDetector === 'function'
    );
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const playSuccessBeep = useCallback(() => {
    try {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(900, context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.25);
    } catch (err) {
      console.warn('Unable to play confirmation beep', err);
    }
  }, []);

  const confirmTracking = useCallback(
    async (value?: string) => {
      if (disabled || submitting) return;

      const normalized = (value ?? trackingNumber).trim();
      if (!normalized) {
        setError('يرجى إدخال رقم التتبع أولاً');
        return;
      }
      if (!warehouseId) {
        setError('يرجى اختيار المستودع قبل التأكيد');
        return;
      }

      setSubmitting(true);
      setError(null);
      setResult(null);
      try {
        const response = await fetch('/api/shipments/handover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackingNumber: normalized, warehouseId }),
        });
        const data = await response.json();
        if (!response.ok) {
          if (data?.outcome === 'missing_first_scan') {
            setResult({
              outcome: 'missing_first_scan',
              message: data.message || 'لم يتم العثور على الشحنة',
              trackingNumber: normalized,
            });
            return;
          }
          throw new Error(data?.error || 'فشل تأكيد تسليم الشحنة');
        }

        const outcome: HandoverOutcome = data.outcome;
        const confirmedAt = data?.shipment?.handoverScannedAt || null;
        setResult({
          outcome,
          message: data.message || 'تمت المعالجة بنجاح',
          trackingNumber: normalized,
          confirmedAt,
        });
        if (outcome === 'confirmed') {
          playSuccessBeep();
          onSuccess?.();
        }
      } catch (err) {
        console.error('Failed to confirm handover', err);
        setError(err instanceof Error ? err.message : 'تعذر تأكيد التسليم');
      } finally {
        setSubmitting(false);
        setTrackingNumber('');
        inputRef.current?.focus();
      }
    },
    [disabled, onSuccess, playSuccessBeep, submitting, trackingNumber, warehouseId]
  );

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    confirmTracking();
  };

  const processScannedValue = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      stopScanner();
      setTrackingNumber(trimmed);
      await confirmTracking(trimmed);
    },
    [confirmTracking, stopScanner]
  );

  const startScanner = useCallback(async () => {
    if (!scannerSupported) {
      setScannerError('القارئ غير مدعوم في هذا المتصفح');
      return;
    }
    if (disabled) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerError('الكاميرا غير متاحة في هذا الجهاز');
      return;
    }
    try {
      setScannerError(null);
      const BarcodeDetectorClass = (window as any).BarcodeDetector as BarcodeDetectorConstructor;
      barcodeDetectorRef.current = new BarcodeDetectorClass({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code'],
      });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setScannerActive(true);
      const videoElement = await waitForVideoElement();
      videoElement.srcObject = stream;
      videoElement.playsInline = true;
      videoElement.muted = true;
      await videoElement.play();

      const scanLoop = async () => {
        if (!barcodeDetectorRef.current || !videoRef.current || videoRef.current.readyState < 2) {
          scanFrameRef.current = requestAnimationFrame(scanLoop);
          return;
        }
        try {
          const barcodes = await barcodeDetectorRef.current.detect(videoRef.current);
          if (barcodes.length > 0) {
            const value = barcodes[0]?.rawValue || '';
            if (value) {
              await processScannedValue(value);
              return;
            }
          }
          scanFrameRef.current = requestAnimationFrame(scanLoop);
        } catch (err) {
          console.error('Barcode detection failed', err);
          setScannerError('تعذر قراءة الرقم. حاول مجدداً');
          stopScanner();
        }
      };

      scanFrameRef.current = requestAnimationFrame(scanLoop);
    } catch (err) {
      console.error('Camera access failed', err);
      setScannerError('تعذر تشغيل الكاميرا. تحقق من الأذونات');
      stopScanner();
    }
  }, [disabled, processScannedValue, scannerSupported, stopScanner, waitForVideoElement]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-col gap-1 text-lg">
            <span className="flex items-center gap-2">
              <Scan className="w-6 h-6" />
              تسليم شركة الشحن
            </span>
            <span className="text-sm font-normal text-slate-500">
              تأكيد خروج الشحنات المسجلة اليوم عبر مسح ثانٍ
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <strong>المستودع:</strong> {warehouseName || '—'} | <strong>اليوم:</strong>{' '}
            يتم قبول الشحنات التي تم تسجيلها اليوم فقط
          </div>
          {typeof handoverCount === 'number' && (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-center shadow-sm">
              <p className="text-sm font-medium text-emerald-800">الشحنات المسلمة اليوم</p>
              <p className="mt-1 text-4xl font-bold text-emerald-900">{handoverCount}</p>
              <p className="text-xs text-emerald-700">يتم التحديث تلقائياً بعد كل مسح ناجح</p>
            </div>
          )}
          {onCompanyFilterChange && availableCompanies.length > 0 && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <label htmlFor="handover-company-filter" className="font-medium text-slate-700">
                تصفية العد حسب شركة الشحن
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  id="handover-company-filter"
                  value={companyFilter || 'all'}
                  onChange={(e) => onCompanyFilterChange(e.target.value)}
                  className="rounded-xl"
                >
                  <option value="all">جميع الشركات</option>
                  {availableCompanies.map((companyId) => (
                    <option key={companyId} value={companyId}>
                      {SHIPMENT_COMPANIES[companyId]?.nameAr || companyId}
                    </option>
                  ))}
                </Select>
                {companyFilter && companyFilter !== 'all' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onCompanyFilterChange('all')}
                    className="rounded-xl"
                  >
                    إعادة التعيين
                  </Button>
                )}
              </div>
              <p className="text-xs text-slate-500">
                يعرض العداد الشحنات المسلمة لليوم حسب الشركة المحددة.
              </p>
            </div>
          )}
          {disabled && disabledMessage && (
            <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              {disabledMessage}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-3">
            <label htmlFor="handover-tracking" className="text-sm font-medium text-slate-600">
              رقم التتبع للتسليم
            </label>
            <Input
              id="handover-tracking"
              ref={inputRef}
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="امسح أو أدخل رقم الشحنة لتأكيد التسليم"
              disabled={disabled || submitting}
              className="text-lg h-14"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <Button
              type="submit"
              disabled={disabled || submitting || !trackingNumber.trim()}
              className="w-full rounded-xl bg-green-600 text-white hover:bg-green-700"
              size="lg"
            >
              {submitting ? 'جارٍ التأكيد...' : 'تأكيد التسليم'}
            </Button>
          </form>
          <div className="space-y-2">
            {scannerSupported ? (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl"
                onClick={scannerActive ? stopScanner : startScanner}
                disabled={disabled}
              >
                <Camera className="w-4 h-4 ml-2" />
                {scannerActive ? 'إيقاف الكاميرا' : 'تشغيل كاميرا الجوال للمسح'}
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Smartphone className="w-4 h-4" />
                كاميرا الجوال غير مدعومة في هذا المتصفح. استخدم الماسح التقليدي.
              </div>
            )}
            {scannerError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {scannerError}
              </div>
            )}
          </div>

          {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

          {result && (
            <div
              className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 p-6 text-center ${
                result.outcome === 'missing_first_scan'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-green-200 bg-green-50 text-green-700'
              }`}
            >
              {result.outcome === 'missing_first_scan' ? (
                <XCircle className="w-16 h-16 text-red-500" />
              ) : (
                <CheckCircle className="w-16 h-16 text-green-500" />
              )}
              <div className="text-2xl font-bold">{result.trackingNumber || '—'}</div>
              <p className="text-base font-medium">{result.message}</p>
              {result.confirmedAt && (
                <p className="text-sm opacity-80">
                  وقت التأكيد: {new Date(result.confirmedAt).toLocaleTimeString('ar-SA')}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {scannerActive && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 px-4 py-8">
          <div className="w-full max-w-sm rounded-2xl bg-gray-900/90 p-4 text-white shadow-lg">
            <p className="mb-3 text-center text-sm font-medium">
              قم بتوجيه كاميرا الجوال إلى الباركود لتأكيد التسليم
            </p>
            <div className="relative aspect-video overflow-hidden rounded-xl border border-white/20 bg-black">
              <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
              <div className="pointer-events-none absolute inset-4 rounded-xl border-2 border-white/70" />
            </div>
            <Button
              type="button"
              variant="ghost"
              className="mt-4 w-full border border-white/50 text-white hover:bg-white/10"
              onClick={stopScanner}
            >
              إغلاق
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
