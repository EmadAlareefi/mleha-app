'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface CODCollection {
  id: string;
  collectionAmount: number;
  collectedAmount?: number;
  currency: string;
  status: string;
  collectedAt?: string;
  depositedAt?: string;
  reconciledAt?: string;
  collectedBy?: string;
  depositedBy?: string;
  reconciledBy?: string;
  depositMethod?: string;
  depositReference?: string;
  discrepancyAmount?: number;
  notes?: string;
  createdAt: string;
  shipment: {
    id: string;
    orderNumber: string;
    trackingNumber: string;
    customerName: string;
    shippingCity: string;
    assignment?: {
      deliveryAgent: {
        id: string;
        name: string;
        username: string;
        phone?: string;
      };
    };
  };
}

export default function CODTrackerPage() {
  const { data: session } = useSession();
  const [collections, setCollections] = useState<CODCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCollection, setSelectedCollection] = useState<CODCollection | null>(null);
  const [updating, setUpdating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Form fields
  const [newStatus, setNewStatus] = useState('');
  const [depositMethod, setDepositMethod] = useState('');
  const [depositReference, setDepositReference] = useState('');
  const [depositNotes, setDepositNotes] = useState('');
  const [reconciliationNotes, setReconciliationNotes] = useState('');
  const [discrepancyAmount, setDiscrepancyAmount] = useState('');
  const [discrepancyReason, setDiscrepancyReason] = useState('');

  const fetchCollections = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);

      const response = await fetch(`/api/cod-collections?${params.toString()}`);

      if (!response.ok) {
        throw new Error('فشل في تحميل بيانات التحصيل');
      }

      const data = await response.json();
      setCollections(data.collections || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  const handleUpdateStatus = async () => {
    if (!selectedCollection || !newStatus) {
      setError('يرجى اختيار الحالة الجديدة');
      return;
    }

    try {
      setUpdating(true);
      setError('');

      const body: any = { status: newStatus };

      if (newStatus === 'deposited') {
        body.depositMethod = depositMethod;
        body.depositReference = depositReference;
        body.depositNotes = depositNotes;
      } else if (newStatus === 'reconciled') {
        body.reconciliationNotes = reconciliationNotes;
        if (discrepancyAmount) {
          body.discrepancyAmount = parseFloat(discrepancyAmount);
          body.discrepancyReason = discrepancyReason;
        }
      }

      const response = await fetch(`/api/cod-collections/${selectedCollection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في تحديث الحالة');
      }

      // Reset form
      setSelectedCollection(null);
      resetForm();

      // Refresh data
      await fetchCollections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث الحالة');
    } finally {
      setUpdating(false);
    }
  };

  const resetForm = () => {
    setNewStatus('');
    setDepositMethod('');
    setDepositReference('');
    setDepositNotes('');
    setReconciliationNotes('');
    setDiscrepancyAmount('');
    setDiscrepancyReason('');
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(value);

  const formatDate = (value: string) =>
    new Date(value).toLocaleString('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const getStatusBadge = (status: string) => {
    const statusMap: Record<
      string,
      { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
    > = {
      pending: { label: 'قيد الانتظار', variant: 'secondary' },
      collected: { label: 'تم التحصيل', variant: 'default' },
      deposited: { label: 'تم الإيداع', variant: 'outline' },
      reconciled: { label: 'تمت التسوية', variant: 'default' },
      failed: { label: 'فشل', variant: 'destructive' },
    };

    const statusInfo = statusMap[status] || { label: status, variant: 'secondary' as const };

    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
  };

  // Calculate totals
  const totals = {
    total: collections.reduce((sum, c) => sum + Number(c.collectionAmount), 0),
    collected: collections
      .filter((c) => c.status === 'collected' || c.status === 'deposited' || c.status === 'reconciled')
      .reduce((sum, c) => sum + Number(c.collectedAmount || c.collectionAmount), 0),
    deposited: collections
      .filter((c) => c.status === 'deposited' || c.status === 'reconciled')
      .reduce((sum, c) => sum + Number(c.collectedAmount || c.collectionAmount), 0),
    reconciled: collections
      .filter((c) => c.status === 'reconciled')
      .reduce((sum, c) => sum + Number(c.collectedAmount || c.collectionAmount), 0),
    pending: collections
      .filter((c) => c.status === 'pending')
      .reduce((sum, c) => sum + Number(c.collectionAmount), 0),
  };

  const user = session?.user as any;
  const isWarehouse = user?.roles?.includes('warehouse') || user?.role === 'admin';
  const isAccountant = user?.roles?.includes('accountant') || user?.role === 'admin';

  if (loading) {
    return (
      <AppPageShell title="متابعة تحصيل المبالغ" subtitle="تتبع وإدارة مبالغ الدفع عند الاستلام">
        <LoadingState label="جاري تحميل سجل التحصيل..." />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell
      title="متابعة تحصيل المبالغ"
      subtitle="تتبع وإدارة مبالغ الدفع عند الاستلام"
      contentClassName="flex flex-1 flex-col gap-6 p-4 md:p-6"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {/* Navigation */}
        <nav className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline">
            <Link href="/warehouse" prefetch={false}>
              المستودع
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/local-shipping" prefetch={false}>
              شحن محلي
            </Link>
          </Button>
          {isWarehouse && (
            <Button asChild variant="outline">
              <Link href="/shipment-assignments" prefetch={false}>
                تعيين الشحنات
              </Link>
            </Button>
          )}
          <Button asChild>
            <Link href="/cod-tracker" prefetch={false}>
              تتبع التحصيل
            </Link>
          </Button>
        </nav>

        {/* Header */}
        <div className="text-center">
          <h1 className="mb-2 text-3xl font-bold">متابعة تحصيل المبالغ (COD)</h1>
          <p className="text-muted-foreground">تتبع وإدارة مبالغ الدفع عند الاستلام</p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Totals */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Card className="p-4 text-center">
            <div className="text-xl font-bold">{formatCurrency(totals.total)}</div>
            <div className="text-sm text-muted-foreground">الإجمالي</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-xl font-bold text-orange-600">{formatCurrency(totals.pending)}</div>
            <div className="text-sm text-muted-foreground">قيد الانتظار</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-xl font-bold text-green-600">{formatCurrency(totals.collected)}</div>
            <div className="text-sm text-muted-foreground">تم التحصيل</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-xl font-bold text-blue-600">{formatCurrency(totals.deposited)}</div>
            <div className="text-sm text-muted-foreground">تم الإيداع</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-xl font-bold text-purple-600">{formatCurrency(totals.reconciled)}</div>
            <div className="text-sm text-muted-foreground">تمت التسوية</div>
          </Card>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <Field className="max-w-xs gap-2">
            <FieldLabel>تصفية حسب الحالة</FieldLabel>
            <NativeSelect
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full"
            >
              <NativeSelectOption value="">الكل</NativeSelectOption>
              <NativeSelectOption value="pending">قيد الانتظار</NativeSelectOption>
              <NativeSelectOption value="collected">تم التحصيل</NativeSelectOption>
              <NativeSelectOption value="deposited">تم الإيداع</NativeSelectOption>
              <NativeSelectOption value="reconciled">تمت التسوية</NativeSelectOption>
              <NativeSelectOption value="failed">فشل</NativeSelectOption>
            </NativeSelect>
          </Field>
        </Card>

        {/* Collections Table */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">سجل التحصيل</h2>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الطلب</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>المندوب</TableHead>
                  <TableHead>المبلغ المطلوب</TableHead>
                  <TableHead>المبلغ المحصّل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ التحصيل</TableHead>
                  <TableHead>إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <EmptyState title="لا توجد مبالغ للتحصيل" />
                    </TableCell>
                  </TableRow>
                ) : (
                  collections.map((collection) => (
                    <TableRow key={collection.id}>
                      <TableCell className="font-mono">{collection.shipment.orderNumber}</TableCell>
                      <TableCell>{collection.shipment.customerName}</TableCell>
                      <TableCell>
                        {collection.shipment.assignment?.deliveryAgent.name || '-'}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {formatCurrency(collection.collectionAmount)}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {collection.collectedAmount
                          ? formatCurrency(collection.collectedAmount)
                          : '-'}
                      </TableCell>
                      <TableCell>{getStatusBadge(collection.status)}</TableCell>
                      <TableCell className="text-xs">
                        {collection.collectedAt ? formatDate(collection.collectedAt) : '-'}
                      </TableCell>
                      <TableCell>
                        {collection.status === 'collected' && isWarehouse && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedCollection(collection);
                              setNewStatus('deposited');
                            }}
                          >
                            تسجيل إيداع
                          </Button>
                        )}
                        {collection.status === 'deposited' && isAccountant && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedCollection(collection);
                              setNewStatus('reconciled');
                            }}
                          >
                            تسوية
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* Update Status Modal */}
        <Dialog
          open={Boolean(selectedCollection)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedCollection(null);
              resetForm();
            }
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            {selectedCollection && (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {newStatus === 'deposited' ? 'تسجيل الإيداع' : 'تسوية المبلغ'}
                  </DialogTitle>
                  <DialogDescription>
                    حدّث حالة تحصيل الطلب وسجّل بيانات الإيداع أو التسوية.
                  </DialogDescription>
                </DialogHeader>

                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="mb-1 text-sm text-muted-foreground">
                    الطلب:{' '}
                    <span className="font-mono font-semibold text-foreground">
                      {selectedCollection.shipment.orderNumber}
                    </span>
                  </div>
                  <div className="mb-1 text-sm text-muted-foreground">
                    المبلغ:{' '}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(selectedCollection.collectionAmount)}
                    </span>
                  </div>
                  {selectedCollection.collectedAmount && (
                    <div className="text-sm text-muted-foreground">
                      المحصّل:{' '}
                      <span className="font-semibold text-foreground">
                        {formatCurrency(selectedCollection.collectedAmount)}
                      </span>
                    </div>
                  )}
              </div>

              {newStatus === 'deposited' && (
                <>
                  <Field className="gap-2">
                    <FieldLabel>طريقة الإيداع *</FieldLabel>
                    <NativeSelect
                      value={depositMethod}
                      onChange={(e) => setDepositMethod(e.target.value)}
                      className="w-full"
                      required
                    >
                      <NativeSelectOption value="">اختر طريقة الإيداع</NativeSelectOption>
                      <NativeSelectOption value="cash">نقدي</NativeSelectOption>
                      <NativeSelectOption value="bank_transfer">تحويل بنكي</NativeSelectOption>
                      <NativeSelectOption value="mobile_wallet">محفظة إلكترونية</NativeSelectOption>
                    </NativeSelect>
                  </Field>

                  <Field className="gap-2">
                    <FieldLabel>رقم المرجع</FieldLabel>
                    <Input
                      type="text"
                      value={depositReference}
                      onChange={(e) => setDepositReference(e.target.value)}
                      placeholder="رقم المرجع أو رقم العملية"
                    />
                  </Field>

                  <Field className="gap-2">
                    <FieldLabel>ملاحظات</FieldLabel>
                    <Textarea
                      value={depositNotes}
                      onChange={(e) => setDepositNotes(e.target.value)}
                      placeholder="ملاحظات الإيداع"
                      rows={2}
                    />
                  </Field>
                </>
              )}

              {newStatus === 'reconciled' && (
                <>
                  <Field className="gap-2">
                    <FieldLabel>ملاحظات التسوية</FieldLabel>
                    <Textarea
                      value={reconciliationNotes}
                      onChange={(e) => setReconciliationNotes(e.target.value)}
                      placeholder="ملاحظات التسوية"
                      rows={2}
                    />
                  </Field>

                  <Field className="gap-2">
                    <FieldLabel>فرق المبلغ</FieldLabel>
                    <Input
                      type="number"
                      step="0.01"
                      value={discrepancyAmount}
                      onChange={(e) => setDiscrepancyAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </Field>

                  {discrepancyAmount && (
                    <Field className="gap-2">
                      <FieldLabel>سبب الفرق</FieldLabel>
                      <Textarea
                        value={discrepancyReason}
                        onChange={(e) => setDiscrepancyReason(e.target.value)}
                        placeholder="سبب فرق المبلغ"
                        rows={2}
                      />
                    </Field>
                  )}
                </>
              )}

              <DialogFooter>
                <Button
                  onClick={handleUpdateStatus}
                  disabled={updating || (newStatus === 'deposited' && !depositMethod)}
                >
                  {updating ? 'جاري التحديث...' : 'تأكيد'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedCollection(null);
                    resetForm();
                  }}
                  disabled={updating}
                >
                  إلغاء
                </Button>
              </DialogFooter>
            </>
          )}
          </DialogContent>
        </Dialog>
      </div>
    </AppPageShell>
  );
}
