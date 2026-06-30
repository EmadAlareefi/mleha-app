'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { useToast } from '@/components/ui/use-toast';
import type {
  OrderUser,
  PrinterLinkInfo,
  PrinterOption,
  PrinterProfileConfig,
  PrintNodeInventoryPrinter,
} from '../types';

interface PrinterLinkDialogProps {
  user: OrderUser | null;
  onClose: () => void;
  onLinkChange: (userId: string, link: PrinterLinkInfo | null) => void;
}

export function PrinterLinkDialog({ user, onClose, onLinkChange }: PrinterLinkDialogProps) {
  const { toast } = useToast();
  const [inventory, setInventory] = useState({
    printers: [] as PrintNodeInventoryPrinter[],
    profiles: [] as PrinterProfileConfig[],
    loading: false,
    loaded: false,
    error: null as string | null,
  });
  const [selectedPrinterId, setSelectedPrinterId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadedRef = useRef(false);
  const loadingRef = useRef(false);

  const loadInventory = useCallback(
    async (force = false) => {
      if (!force && (loadedRef.current || loadingRef.current)) {
        return;
      }
      loadingRef.current = true;
      setInventory((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const response = await fetch('/api/printers');
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'تعذر تحميل بيانات الطابعات');
        }
        loadedRef.current = true;
        setInventory({
          printers: Array.isArray(data.printers) ? data.printers : [],
          profiles: Array.isArray(data.profiles) ? data.profiles : [],
          loading: false,
          loaded: true,
          error: null,
        });
      } catch (err) {
        setInventory((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل بيانات الطابعات',
        }));
      } finally {
        loadingRef.current = false;
      }
    },
    []
  );

  useEffect(() => {
    if (user) {
      setSelectedPrinterId(user.printerLink?.printerId ?? null);
      setError(null);
      setSaving(false);
      setUnlinking(false);
      loadInventory(false);
    }
  }, [user, loadInventory]);

  const printerOptions = useMemo(() => {
    const options: PrinterOption[] = [];
    const mapped = new Set<number>();
    const printersById = new Map(inventory.printers.map((printer) => [printer.id, printer]));

    inventory.profiles.forEach((profile) => {
      const printer = printersById.get(profile.printerId);
      options.push({
        id: profile.printerId,
        label: profile.label,
        description:
          profile.location || printer?.computer?.name || printer?.computer?.hostname || undefined,
        paperName: profile.paperName || printer?.default?.paperName || printer?.default?.paper,
        location: profile.location,
        notes: profile.notes || undefined,
        source: 'profile',
        state: printer?.state,
        computerId: printer?.computer?.id,
        computerName: printer?.computer?.name || printer?.computer?.hostname,
        printerName: profile.label || printer?.name,
      });
      mapped.add(profile.printerId);
    });

    inventory.printers.forEach((printer) => {
      if (mapped.has(printer.id)) return;
      options.push({
        id: printer.id,
        label: printer.name,
        description: printer.description || printer.computer?.name || printer.computer?.hostname,
        paperName: printer.default?.paperName || printer.default?.paper,
        source: 'printnode',
        state: printer.state,
        computerId: printer.computer?.id,
        computerName: printer.computer?.name || printer.computer?.hostname,
        printerName: printer.name,
      });
    });

    return options.sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [inventory]);

  const getPrinterMeta = useCallback(
    (printerId: number) => {
      const option = printerOptions.find((printer) => printer.id === printerId);
      if (!option) return null;
      return {
        printerName: option.printerName || option.label,
        paperName: option.paperName,
        computerId: option.computerId,
        computerName: option.computerName,
      };
    },
    [printerOptions]
  );

  const handleSave = async () => {
    if (!user || selectedPrinterId === null) {
      setError('يرجى اختيار طابعة قبل الحفظ');
      return;
    }

    const meta = getPrinterMeta(selectedPrinterId);
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/order-prep/printer-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          printerId: selectedPrinterId,
          printerName: meta?.printerName,
          paperName: meta?.paperName,
          computerId: meta?.computerId,
          computerName: meta?.computerName,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'فشل حفظ ربط الطابعة');
      }

      onLinkChange(user.id, {
        printerId: data.link?.printerId ?? selectedPrinterId,
        printerName: data.link?.printerName ?? meta?.printerName ?? null,
        computerId: data.link?.computerId ?? meta?.computerId ?? null,
        computerName: data.link?.computerName ?? meta?.computerName ?? null,
        paperName: data.link?.paperName ?? meta?.paperName ?? null,
      });

      toast({ title: 'تم تحديث الطابعة', description: 'تم ربط الطابعة بالمستخدم بنجاح' });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل حفظ ربط الطابعة');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async () => {
    if (!user) return;
    setUnlinking(true);
    setError(null);

    try {
      const response = await fetch(`/api/order-prep/printer-links?userId=${user.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'فشل إزالة الربط');
      }

      onLinkChange(user.id, null);
      toast({ title: 'تم إزالة الربط', description: 'تم إلغاء ربط الطابعة' });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إزالة الربط');
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => !open && onClose()}>
      {user && (
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>ربط الطابعة للمستخدم</DialogTitle>
            <DialogDescription>
              {user.name} - @{user.username}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => loadInventory(true)}
              disabled={inventory.loading}
              className="w-fit"
            >
              <RefreshCcw className="h-4 w-4" />
              تحديث القائمة
            </Button>

            {inventory.error && (
              <Alert variant="destructive">
                <AlertTitle>تعذر تحميل بيانات الطابعات</AlertTitle>
                <AlertDescription>{inventory.error}</AlertDescription>
              </Alert>
            )}

            {inventory.loading ? (
              <LoadingState label="جاري تحميل قائمة الطابعات..." />
            ) : (
              <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                {printerOptions.length === 0 && (
                  <EmptyState
                    title="لا توجد طابعات متاحة"
                    description="تأكد من اتصال PrintNode ثم حاول مرة أخرى."
                  />
                )}
                {printerOptions.map((option) => {
                  const isSelected = selectedPrinterId === option.id;
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setSelectedPrinterId(option.id);
                        setError(null);
                      }}
                      variant={isSelected ? 'default' : 'outline'}
                      className="h-auto w-full justify-start px-4 py-3 text-right"
                    >
                      <div className="flex w-full flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold">{option.label}</p>
                          {option.description && (
                            <p className="text-xs opacity-70">{option.description}</p>
                          )}
                          {option.paperName && (
                            <p className="text-xs opacity-70">الورق: {option.paperName}</p>
                          )}
                          {option.notes && (
                            <p className="text-xs opacity-70">ملاحظات: {option.notes}</p>
                          )}
                        </div>
                        <div className="text-left">
                          <Badge variant={option.source === 'profile' ? 'secondary' : 'outline'}>
                            {option.source === 'profile' ? 'تكوين مخصص' : 'PrintNode'}
                          </Badge>
                          {option.state && (
                            <p
                              className={`mt-1 text-xs font-semibold ${
                                option.state === 'online'
                                  ? 'text-emerald-600'
                                  : option.state === 'disconnected'
                                    ? 'text-rose-600'
                                    : 'text-slate-500'
                              }`}
                            >
                              الحالة: {option.state}
                            </p>
                          )}
                        </div>
                      </div>
                    </Button>
                  );
                })}
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="flex-wrap">
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || selectedPrinterId === null}
              >
                {saving ? 'جاري الحفظ...' : 'حفظ ربط الطابعة'}
              </Button>
              {user.printerLink && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleUnlink}
                  disabled={unlinking}
                  className="border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  {unlinking ? 'جاري الإزالة...' : 'إزالة الربط الحالي'}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={saving || unlinking}
              >
                إلغاء
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
