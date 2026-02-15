'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Scan, CheckCircle, AlertCircle, ArrowUpFromLine, ArrowDownToLine, Camera } from 'lucide-react';

type BarcodeDetection = { rawValue?: string };
type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetection[]>;
};
type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorInstance;

interface ScannerInputProps {
  onScan: (trackingNumber: string, type: 'incoming' | 'outgoing') => Promise<void>;
  selectedWarehouseName?: string;
  disabled?: boolean;
  disabledMessage?: string;
}

export function ScannerInput({
  onScan,
  selectedWarehouseName,
  disabled = false,
  disabledMessage,
}: ScannerInputProps) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [type, setType] = useState<'incoming' | 'outgoing'>('outgoing');
  const [isScanning, setIsScanning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scannerSupported, setScannerSupported] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeDetectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const scanFrameRef = useRef<number | null>(null);

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

  const waitForVideoElement = async (): Promise<HTMLVideoElement> => {
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
  };

  useEffect(() => {
    inputRef.current?.focus();
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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (disabled || !trackingNumber.trim() || isScanning) return;

    setIsScanning(true);
    setMessage(null);

    try {
      await onScan(trackingNumber.trim(), type);
      setMessage({ type: 'success', text: 'تم تسجيل الشحنة بنجاح' });
      setTrackingNumber('');

      // Clear success message after 2 seconds
      setTimeout(() => setMessage(null), 2000);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'حدث خطأ أثناء تسجيل الشحنة' });
    } finally {
      setIsScanning(false);
      // Immediately refocus on input for next scan
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Auto-submit when Enter is pressed (barcode scanners send Enter)
    if (e.key === 'Enter' && trackingNumber.trim() && !isScanning && !disabled) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const startScanner = useCallback(async () => {
    if (!scannerSupported) {
      setScannerError('جهازك لا يدعم قراءة الباركود عبر الكاميرا في هذا المتصفح');
      return;
    }
    if (disabled) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerError('الكاميرا غير متاحة في هذا الجهاز أو المتصفح');
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
      const videoElement = await waitForVideoElement();
      videoElement.srcObject = stream;
      videoElement.playsInline = true;
      videoElement.muted = true;
      await videoElement.play();
      setScannerActive(true);

      const scanLoop = async () => {
        if (!barcodeDetectorRef.current || !videoElement || videoElement.readyState < 2) {
          scanFrameRef.current = requestAnimationFrame(scanLoop);
          return;
        }
        try {
          const barcodes = await barcodeDetectorRef.current.detect(videoElement);
          if (barcodes.length > 0) {
            const value = barcodes[0]?.rawValue || '';
            if (value) {
              setTrackingNumber(value);
              stopScanner();
              setTimeout(() => inputRef.current?.focus(), 100);
              return;
            }
          }
          scanFrameRef.current = requestAnimationFrame(scanLoop);
        } catch (error) {
          console.error('Barcode detection error', error);
          setScannerError('تعذر قراءة الرقم. حاول مرة أخرى');
          stopScanner();
        }
      };

      scanFrameRef.current = requestAnimationFrame(scanLoop);
    } catch (error) {
      console.error('Camera access failed', error);
      setScannerError('تعذر تشغيل الكاميرا. تحقق من الأذونات وحاول مرة أخرى');
      stopScanner();
    }
  }, [disabled, scannerSupported, stopScanner]);

  return (
    <>
      <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Scan className="w-6 h-6" />
          مسح رقم الشحنة
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div>
            المستودع الحالي:{' '}
            <span className="font-semibold text-gray-900">
              {selectedWarehouseName || '—'}
            </span>
          </div>
        </div>
        {disabled && disabledMessage && (
          <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            {disabledMessage}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Type Selection Tabs */}
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setType('outgoing')}
              disabled={isScanning || disabled}
              className={`relative p-6 rounded-lg border-2 transition-all ${
                type === 'outgoing'
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-gray-300 bg-white hover:border-blue-300'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <ArrowUpFromLine className={`w-10 h-10 ${type === 'outgoing' ? 'text-blue-600' : 'text-gray-400'}`} />
                <div className={`text-xl font-bold ${type === 'outgoing' ? 'text-blue-900' : 'text-gray-700'}`}>
                  صادر
                </div>
                <div className={`text-sm text-center ${type === 'outgoing' ? 'text-blue-700' : 'text-gray-500'}`}>
                  طلبات المبيعات الصادرة
                </div>
              </div>
              {type === 'outgoing' && (
                <div className="absolute top-3 left-3">
                  <CheckCircle className="w-6 h-6 text-blue-600" />
                </div>
              )}
            </button>

            <button
              type="button"
              onClick={() => setType('incoming')}
              disabled={isScanning || disabled}
              className={`relative p-6 rounded-lg border-2 transition-all ${
                type === 'incoming'
                  ? 'border-green-500 bg-green-50 shadow-md'
                  : 'border-gray-300 bg-white hover:border-green-300'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <ArrowDownToLine className={`w-10 h-10 ${type === 'incoming' ? 'text-green-600' : 'text-gray-400'}`} />
                <div className={`text-xl font-bold ${type === 'incoming' ? 'text-green-900' : 'text-gray-700'}`}>
                  وارد
                </div>
                <div className={`text-sm text-center ${type === 'incoming' ? 'text-green-700' : 'text-gray-500'}`}>
                  المرتجعات والاستردادات
                </div>
              </div>
              {type === 'incoming' && (
                <div className="absolute top-3 left-3">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                </div>
              )}
            </button>
          </div>

          {/* Tracking Input */}
          <div>
            <label htmlFor="tracking" className="block text-sm font-medium mb-2">
              رقم التتبع
            </label>
            <Input
              id="tracking"
              ref={inputRef}
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="امسح أو أدخل رقم الشحنة"
              disabled={isScanning}
              className="text-lg h-14"
              autoComplete="off"
              autoFocus
            />
          </div>

          <Button
            type="submit"
            disabled={!trackingNumber.trim() || isScanning || disabled}
            className="w-full"
            size="lg"
          >
            {isScanning ? 'جاري التسجيل...' : 'تسجيل الشحنة'}
          </Button>

          {message && (
            <div
              className={`flex items-center gap-2 p-4 rounded-md ${
                message.type === 'success'
                  ? 'bg-green-100 text-green-800 border border-green-200'
                  : 'bg-red-100 text-red-800 border border-red-200'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
              <span className="font-medium">{message.text}</span>
            </div>
          )}
        </form>
        <div className="md:hidden space-y-2">
          {scannerSupported ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={scannerActive ? stopScanner : startScanner}
              disabled={disabled}
            >
              <Camera className="w-4 h-4 ml-2" />
              {scannerActive ? 'إيقاف الكاميرا' : 'استخدام كاميرا الجوال لمسح الباركود'}
            </Button>
          ) : (
            <p className="text-xs text-slate-500">
              الكاميرا غير مدعومة في هذا المتصفح. استخدم قارئ الباركود التقليدي.
            </p>
          )}
          {scannerError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {scannerError}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
      {scannerActive && (
        <div className="md:hidden fixed inset-0 z-40 flex items-center justify-center bg-black/80 px-4 py-8">
          <div className="w-full max-w-sm rounded-2xl bg-gray-900/90 p-4 text-white shadow-lg">
            <p className="mb-3 text-center text-sm font-medium">
              ضع الباركود داخل الإطار ليتم قراءة الرقم تلقائياً
            </p>
            <div className="relative aspect-video overflow-hidden rounded-xl border border-white/20 bg-black">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                autoPlay
                muted
                playsInline
              />
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
