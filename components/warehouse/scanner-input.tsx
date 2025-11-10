'use client';

import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Scan, CheckCircle, AlertCircle, ArrowUpFromLine, ArrowDownToLine } from 'lucide-react';

interface ScannerInputProps {
  onScan: (trackingNumber: string, type: 'incoming' | 'outgoing') => Promise<void>;
}

export function ScannerInput({ onScan }: ScannerInputProps) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [type, setType] = useState<'incoming' | 'outgoing'>('outgoing');
  const [isScanning, setIsScanning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus on input
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!trackingNumber.trim() || isScanning) return;

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
    if (e.key === 'Enter' && trackingNumber.trim() && !isScanning) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Scan className="w-6 h-6" />
          مسح رقم الشحنة
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Type Selection Tabs */}
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setType('outgoing')}
              disabled={isScanning}
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
              disabled={isScanning}
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
            disabled={!trackingNumber.trim() || isScanning}
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
      </CardContent>
    </Card>
  );
}
