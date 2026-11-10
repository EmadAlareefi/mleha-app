'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Continuous camera barcode scanning with the browser's BarcodeDetector
 * (Chrome on Android), plus hardware "keyboard wedge" scanners that type the
 * code followed by Enter. Repeats of the same code within `repeatMs` are
 * ignored so one tag held in view counts once.
 */

type Detection = { rawValue?: string };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detection[]> };
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;

const FORMATS = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code'];
const DETECT_INTERVAL_MS = 120;

export function isCameraScanSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function useBarcodeScanner(options: {
  onScan: (value: string, source: 'camera' | 'keyboard') => void;
  /** Listen for keyboard-wedge scanners. */
  keyboard?: boolean;
  repeatMs?: number;
}) {
  const { onScan, keyboard = true, repeatMs = 1500 } = options;
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emit = useCallback(
    (raw: string, source: 'camera' | 'keyboard') => {
      const value = raw.trim();
      if (!value) return;
      const now = Date.now();
      if (lastRef.current.value === value && now - lastRef.current.at < repeatMs) return;
      lastRef.current = { value, at: now };
      onScanRef.current(value, source);
    },
    [repeatMs],
  );

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    if (!isCameraScanSupported()) {
      setError('قراءة الباركود بالكاميرا غير مدعومة في هذا المتصفح. استخدم Chrome على أندرويد.');
      return;
    }
    setError(null);
    setActive(true);
    try {
      const DetectorClass = (window as unknown as { BarcodeDetector: DetectorConstructor }).BarcodeDetector;
      const detector = new DetectorClass({ formats: FORMATS });
      // Wait for the <video> to mount.
      for (let attempt = 0; attempt < 20 && !videoRef.current; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const video = videoRef.current;
      if (!video) throw new Error('video_not_ready');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      let lastDetect = 0;
      const loop = async () => {
        if (!streamRef.current) return;
        const now = performance.now();
        if (video.readyState >= 2 && now - lastDetect >= DETECT_INTERVAL_MS) {
          lastDetect = now;
          try {
            const found = await detector.detect(video);
            const value = found.find((entry) => entry.rawValue)?.rawValue;
            if (value) emit(value, 'camera');
          } catch {
            // A failed frame is skipped.
          }
        }
        frameRef.current = requestAnimationFrame(() => void loop());
      };
      frameRef.current = requestAnimationFrame(() => void loop());
    } catch {
      setError('تعذر تشغيل الكاميرا. تحقق من إذن الكاميرا وحاول مرة أخرى.');
      stop();
    }
  }, [emit, stop]);

  useEffect(() => stop, [stop]);

  // Keyboard-wedge scanners type fast and end with Enter.
  useEffect(() => {
    if (!keyboard) return;
    let buffer = '';
    let lastKeyAt = 0;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const now = Date.now();
      if (now - lastKeyAt > 80) buffer = '';
      lastKeyAt = now;
      if (event.key === 'Enter') {
        if (buffer.length >= 3) {
          event.preventDefault();
          emit(buffer, 'keyboard');
        }
        buffer = '';
        return;
      }
      if (event.key.length === 1) buffer += event.key;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emit, keyboard]);

  return { videoRef, active, error, start, stop };
}
