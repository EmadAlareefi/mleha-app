'use client';

import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Scan, CheckCircle, AlertCircle } from 'lucide-react';

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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scan className="w-6 h-6" />
          مسح رقم الشحنة
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
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
                className="text-lg"
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="w-48">
              <label htmlFor="type" className="block text-sm font-medium mb-2">
                نوع الشحنة
              </label>
              <Select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as 'incoming' | 'outgoing')}
                disabled={isScanning}
              >
                <option value="incoming">وارد</option>
                <option value="outgoing">صادر</option>
              </Select>
            </div>
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
