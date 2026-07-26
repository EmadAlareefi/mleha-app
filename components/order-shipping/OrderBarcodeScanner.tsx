'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';

type BarcodeDetection = { rawValue?: string };
type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetection[]>;
};
type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorInstance;

interface OrderBarcodeScannerProps {
  disabled?: boolean;
  onDetected: (orderNumber: string) => void | Promise<void>;
}

const DETECTION_INTERVAL_MS = 150;

export function OrderBarcodeScanner({
  disabled = false,
  onDetected,
}: OrderBarcodeScannerProps) {
  const [scannerSupported, setScannerSupported] = useState<boolean | null>(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const lastDetectionAtRef = useRef(0);
  const processingRef = useRef(false);

  const stopScanner = useCallback(() => {
    setScannerActive(false);
    if (scanFrameRef.current !== null) {
      cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    detectorRef.current = null;
  }, []);

  const waitForVideoElement = useCallback(async (): Promise<HTMLVideoElement> => {
    if (videoRef.current) return videoRef.current;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (videoRef.current) return videoRef.current;
    }

    throw new Error('video_not_ready');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setScannerSupported(
      'BarcodeDetector' in window && typeof (window as any).BarcodeDetector === 'function'
    );

    return stopScanner;
  }, [stopScanner]);

  const processDetectedValue = useCallback(
    async (value: string) => {
      const normalized = value.trim();
      if (!normalized || processingRef.current) return;

      processingRef.current = true;
      stopScanner();
      await onDetected(normalized);
    },
    [onDetected, stopScanner]
  );

  const startScanner = useCallback(async () => {
    if (disabled) return;
    if (!scannerSupported) {
      setScannerError('كاميرا قراءة الباركود غير مدعومة في هذا المتصفح.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerError('الكاميرا غير متاحة على هذا الجهاز.');
      return;
    }

    try {
      setScannerError(null);
      processingRef.current = false;

      const BarcodeDetectorClass = (window as any)
        .BarcodeDetector as BarcodeDetectorConstructor;
      detectorRef.current = new BarcodeDetectorClass({
        formats: ['code_128'],
      });

      setScannerActive(true);
      const videoElement = await waitForVideoElement();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      videoElement.srcObject = stream;
      videoElement.muted = true;
      videoElement.playsInline = true;
      await videoElement.play();

      const scanLoop = async () => {
        if (!detectorRef.current || videoElement.readyState < 2) {
          scanFrameRef.current = requestAnimationFrame(scanLoop);
          return;
        }

        const now = performance.now();
        if (now - lastDetectionAtRef.current < DETECTION_INTERVAL_MS) {
          scanFrameRef.current = requestAnimationFrame(scanLoop);
          return;
        }
        lastDetectionAtRef.current = now;

        try {
          const detections = await detectorRef.current.detect(videoElement);
          const value = detections[0]?.rawValue;
          if (value) {
            await processDetectedValue(value);
            return;
          }
          scanFrameRef.current = requestAnimationFrame(scanLoop);
        } catch (error) {
          console.error('Order barcode detection failed', error);
          setScannerError('تعذرت قراءة الباركود. حاول مرة أخرى.');
          stopScanner();
        }
      };

      scanFrameRef.current = requestAnimationFrame(scanLoop);
    } catch (error) {
      console.error('Order barcode camera access failed', error);
      setScannerError('تعذر تشغيل الكاميرا. تحقق من إذن الكاميرا وحاول مرة أخرى.');
      stopScanner();
    }
  }, [
    disabled,
    processDetectedValue,
    scannerSupported,
    stopScanner,
    waitForVideoElement,
  ]);

  return (
    <>
      <div className="md:hidden">
        {scannerSupported ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={scannerActive ? stopScanner : startScanner}
            disabled={disabled}
          >
            <Camera className="ml-2 h-4 w-4" />
            {scannerActive ? 'إيقاف الكاميرا' : 'مسح باركود الطلب بالكاميرا'}
          </Button>
        ) : scannerSupported === false ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Smartphone className="h-4 w-4" />
            كاميرا قراءة الباركود غير مدعومة في هذا المتصفح. يمكنك إدخال الرقم يدوياً.
          </div>
        ) : null}

        {scannerError && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {scannerError}
          </div>
        )}
      </div>

      {scannerActive && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-8"
          role="dialog"
          aria-modal="true"
          aria-label="ماسح باركود الطلب"
        >
          <div className="w-full max-w-sm rounded-2xl bg-gray-900/95 p-4 text-white shadow-lg">
            <p className="mb-3 text-center text-sm font-medium">
              ضع باركود رقم الطلب داخل الإطار
            </p>
            <div className="relative aspect-video overflow-hidden rounded-xl border border-white/20 bg-black">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                autoPlay
                muted
                playsInline
              />
              <div className="pointer-events-none absolute inset-x-5 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80" />
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
