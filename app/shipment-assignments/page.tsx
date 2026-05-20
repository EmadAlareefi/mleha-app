'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useToast } from '@/components/ui/use-toast';

interface LocalShipment {
  id: string;
  orderNumber: string;
  trackingNumber: string;
  customerName: string;
  customerPhone: string;
  shippingCity: string;
  shippingAddress: string;
  orderTotal: number;
  isCOD: boolean;
  status: string;
  createdAt: string;
}

interface DeliveryAgent {
  id: string;
  name: string;
  username: string;
  phone?: string;
  stats?: {
    total: number;
    assigned: number;
    inTransit: number;
    delivered: number;
    failed: number;
  };
}

interface Assignment {
  id: string;
  status: string;
  assignedAt: string;
  shipment: LocalShipment;
  deliveryAgent: DeliveryAgent;
}

export default function ShipmentAssignmentsPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [pendingShipments, setPendingShipments] = useState<LocalShipment[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [deliveryAgents, setDeliveryAgents] = useState<DeliveryAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedShipment, setSelectedShipment] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [assignmentNotes, setAssignmentNotes] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [transferSourceAgentId, setTransferSourceAgentId] = useState('');
  const [transferTargetAgentId, setTransferTargetAgentId] = useState('');
  const [selectedTransferAssignments, setSelectedTransferAssignments] = useState<string[]>([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const primaryRole = (session?.user as any)?.role as string | undefined;
  const userRoles: string[] = (session?.user as any)?.roles || (primaryRole ? [primaryRole] : []);
  const isAdmin = primaryRole === 'admin';
  const canAccessCodTracker = isAdmin || userRoles.includes('accountant');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      const [shipmentsRes, assignmentsRes, agentsRes] = await Promise.all([
        fetch('/api/local-shipping/list?status=pending'),
        fetch('/api/shipment-assignments'),
        fetch('/api/delivery-agents?includeStats=true'),
      ]);

      if (!shipmentsRes.ok || !assignmentsRes.ok || !agentsRes.ok) {
        throw new Error('فشل في تحميل البيانات');
      }

      const shipmentsData = await shipmentsRes.json();
      const assignmentsData = await assignmentsRes.json();
      const agentsData = await agentsRes.json();

      setPendingShipments(shipmentsData.shipments || []);
      setAssignments(assignmentsData.assignments || []);
      setDeliveryAgents(agentsData.deliveryAgents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!transferSourceAgentId) {
      if (selectedTransferAssignments.length > 0) {
        setSelectedTransferAssignments([]);
      }
      return;
    }

    const validIdSet = new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.deliveryAgent.id === transferSourceAgentId && assignment.status === 'assigned'
        )
        .map((assignment) => assignment.id)
    );

    setSelectedTransferAssignments((prev) => {
      const filtered = prev.filter((id) => validIdSet.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [assignments, transferSourceAgentId, selectedTransferAssignments.length]);

  const handleAssign = async () => {
    if (!selectedShipment || !selectedAgent) {
      setError('يرجى اختيار الشحنة والمندوب');
      return;
    }

    try {
      setAssigning(true);
      setError('');

      const response = await fetch('/api/shipment-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipmentId: selectedShipment,
          deliveryAgentId: selectedAgent,
          notes: assignmentNotes || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في تعيين الشحنة');
      }

      // Reset form
      setSelectedShipment(null);
      setSelectedAgent('');
      setAssignmentNotes('');

      // Refresh data
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تعيين الشحنة');
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = async (assignmentId: string) => {
    if (!confirm('هل أنت متأكد من إلغاء تعيين هذه الشحنة؟')) return;

    try {
      const response = await fetch(`/api/shipment-assignments/${assignmentId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في إلغاء التعيين');
      }

      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء إلغاء التعيين');
    }
  };

  const selectableAssignmentsForSource = useMemo(
    () =>
      assignments.filter((assignment) =>
        Boolean(
          transferSourceAgentId &&
            assignment.deliveryAgent.id === transferSourceAgentId &&
            assignment.status === 'assigned'
        )
      ),
    [assignments, transferSourceAgentId]
  );

  const canSelectAssignment = (assignment: Assignment) =>
    Boolean(
      transferSourceAgentId &&
        assignment.deliveryAgent.id === transferSourceAgentId &&
        assignment.status === 'assigned'
    );

  const getSelectionDisabledReason = (assignment: Assignment) => {
    if (!transferSourceAgentId) {
      return 'اختر المندوب الحالي أولاً';
    }
    if (assignment.status !== 'assigned') {
      return 'لا يمكن نقل الشحنات التي تم استلامها أو إغلاقها';
    }
    if (assignment.deliveryAgent.id !== transferSourceAgentId) {
      return 'هذه الشحنة لا تخص المندوب المحدد';
    }
    return undefined;
  };

  const toggleAssignmentSelection = (assignment: Assignment) => {
    if (!canSelectAssignment(assignment)) {
      return;
    }

    setSelectedTransferAssignments((prev) =>
      prev.includes(assignment.id)
        ? prev.filter((id) => id !== assignment.id)
        : [...prev, assignment.id]
    );
  };

  const handleSelectAllForSource = () => {
    if (!transferSourceAgentId) {
      toast({
        title: 'اختر المندوب الحالي',
        description: 'حدد المندوب الذي ترغب بنقل شحناته أولاً.',
        variant: 'destructive',
      });
      return;
    }

    setSelectedTransferAssignments(selectableAssignmentsForSource.map((assignment) => assignment.id));
  };

  const handleToggleSelectAllCheckbox = () => {
    if (!transferSourceAgentId) {
      toast({
        title: 'اختر المندوب الحالي',
        description: 'حدد المندوب الذي ترغب بنقل شحناته.',
        variant: 'destructive',
      });
      return;
    }

    if (bulkSelectableCount === 0) {
      return;
    }

    if (allSelectableChosen) {
      setSelectedTransferAssignments([]);
      return;
    }

    setSelectedTransferAssignments(selectableAssignmentsForSource.map((assignment) => assignment.id));
  };

  const handleBulkTransfer = async () => {
    if (!transferSourceAgentId) {
      toast({
        title: 'اختر المندوب الحالي',
        description: 'حدد المندوب الذي ترغب بنقل شحناته.',
        variant: 'destructive',
      });
      return;
    }

    if (!transferTargetAgentId) {
      toast({
        title: 'اختر المندوب الجديد',
        description: 'حدد المندوب الذي ستُنقل إليه الشحنات.',
        variant: 'destructive',
      });
      return;
    }

    if (transferSourceAgentId === transferTargetAgentId) {
      toast({
        title: 'لا يمكن النقل لنفس المندوب',
        description: 'اختر مندوبًا مختلفًا لنقل الشحنات إليه.',
        variant: 'destructive',
      });
      return;
    }

    if (selectedTransferAssignments.length === 0) {
      toast({
        title: 'لم يتم اختيار شحنات',
        description: 'حدد شحنات هذا المندوب قبل تنفيذ النقل.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setTransferLoading(true);
      const response = await fetch('/api/shipment-assignments/bulk-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentIds: selectedTransferAssignments,
          targetAgentId: transferTargetAgentId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل نقل الشحنات');
      }

      const targetAgent = deliveryAgents.find((agent) => agent.id === transferTargetAgentId);

      toast({
        title: 'تم نقل الشحنات',
        description: `تم نقل ${data.transferredCount} شحنة إلى ${targetAgent?.name || 'المندوب الجديد'}.`,
      });

      setSelectedTransferAssignments([]);
      setTransferTargetAgentId('');
      await fetchData();
    } catch (err) {
      toast({
        title: 'فشل نقل الشحنات',
        description: err instanceof Error ? err.message : 'حدث خطأ أثناء نقل الشحنات',
        variant: 'destructive',
      });
    } finally {
      setTransferLoading(false);
    }
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'SAR' }).format(value);

  const formatDate = (value: string) =>
    new Date(value).toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      pending: { label: 'قيد الانتظار', variant: 'secondary' },
      assigned: { label: 'مُعيّن', variant: 'outline' },
      picked_up: { label: 'تم الاستلام', variant: 'secondary' },
      in_transit: { label: 'قيد التوصيل', variant: 'secondary' },
      delivered: { label: 'تم التوصيل', variant: 'default' },
      failed: { label: 'فشل', variant: 'destructive' },
      cancelled: { label: 'ملغي', variant: 'secondary' },
    };

    const statusInfo = statusMap[status] || { label: status, variant: 'secondary' as const };

    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
  };

  const selectedSourceAgent = transferSourceAgentId
    ? deliveryAgents.find((agent) => agent.id === transferSourceAgentId)
    : null;
  const bulkSelectionCount = selectedTransferAssignments.length;
  const bulkSelectableCount = selectableAssignmentsForSource.length;
  const allSelectableChosen = bulkSelectableCount > 0 && bulkSelectionCount === bulkSelectableCount;
  const hasPartialSelection =
    bulkSelectionCount > 0 && bulkSelectionCount < bulkSelectableCount;

  if (loading) {
    return (
      <AppPageShell title="تعيين الشحنات للمناديب" subtitle="قم بتعيين الشحنات المحلية لمناديب التوصيل">
        <LoadingState />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell title="تعيين الشحنات للمناديب" subtitle="قم بتعيين الشحنات المحلية لمناديب التوصيل">
      <div className="space-y-6">
        <nav className="flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <Link href="/warehouse" prefetch={false}>المستودع</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/local-shipping" prefetch={false}>شحن محلي</Link>
          </Button>
          <Button asChild>
            <Link href="/shipment-assignments" prefetch={false}>تعيين الشحنات</Link>
          </Button>
          {canAccessCodTracker && (
            <Button variant="outline" asChild>
              <Link href="/cod-tracker" prefetch={false}>تتبع التحصيل</Link>
            </Button>
          )}
        </nav>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>مناديب التوصيل</CardTitle>
          </CardHeader>
          <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {deliveryAgents.map((agent) => (
              <div key={agent.id} className="border rounded-lg p-4">
                <div className="font-semibold text-lg mb-1">{agent.name}</div>
                <div className="text-sm text-gray-600 mb-3">
                  {agent.username} {agent.phone && `• ${agent.phone}`}
                </div>
                {agent.stats && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>المعين: {agent.stats.assigned}</div>
                    <div>قيد التوصيل: {agent.stats.inTransit}</div>
                    <div className="text-green-600">تم التوصيل: {agent.stats.delivered}</div>
                    <div className="text-red-600">فشل: {agent.stats.failed}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>تعيين شحنة جديدة</CardTitle>
          </CardHeader>
          <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field>
              <FieldLabel>الشحنة</FieldLabel>
              <NativeSelect
                value={selectedShipment || ''}
                onChange={(e) => setSelectedShipment(e.target.value)}
              >
                <NativeSelectOption value="">اختر شحنة</NativeSelectOption>
                {pendingShipments.map((shipment) => (
                  <NativeSelectOption key={shipment.id} value={shipment.id}>
                    {shipment.orderNumber} - {shipment.customerName} ({shipment.shippingCity})
                    {shipment.isCOD && ' - COD'}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>

            <Field>
              <FieldLabel>المندوب</FieldLabel>
              <NativeSelect
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
              >
                <NativeSelectOption value="">اختر مندوب</NativeSelectOption>
                {deliveryAgents.map((agent) => (
                  <NativeSelectOption key={agent.id} value={agent.id}>
                    {agent.name} (المعين: {agent.stats?.assigned || 0})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>

            <Field>
              <FieldLabel>ملاحظات (اختياري)</FieldLabel>
              <Input
                value={assignmentNotes}
                onChange={(e) => setAssignmentNotes(e.target.value)}
                placeholder="ملاحظات للمندوب"
              />
            </Field>
          </div>

          <div className="mt-4">
            <Button
              onClick={handleAssign}
              disabled={assigning || !selectedShipment || !selectedAgent}
              className="w-full md:w-auto"
            >
              {assigning ? 'جاري التعيين...' : 'تعيين الشحنة'}
            </Button>
          </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الشحنات المُعيّنة</CardTitle>
          </CardHeader>
          <CardContent>

          <div className="mb-6 rounded-lg border bg-muted/40 p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>المندوب الحالي</FieldLabel>
                <NativeSelect
                  value={transferSourceAgentId}
                  onChange={(e) => setTransferSourceAgentId(e.target.value)}
                >
                  <NativeSelectOption value="">اختر المندوب الحالي</NativeSelectOption>
                  {deliveryAgents.map((agent) => (
                    <NativeSelectOption key={agent.id} value={agent.id}>
                      {agent.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>المندوب الجديد</FieldLabel>
                <NativeSelect
                  value={transferTargetAgentId}
                  onChange={(e) => setTransferTargetAgentId(e.target.value)}
                >
                  <NativeSelectOption value="">اختر المندوب الجديد</NativeSelectOption>
                  {deliveryAgents.map((agent) => (
                    <NativeSelectOption key={agent.id} value={agent.id}>
                      {agent.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>
                {transferSourceAgentId
                  ? `شحنات ${selectedSourceAgent?.name || 'المندوب'} القابلة للنقل: ${bulkSelectableCount}`
                  : 'اختر المندوب الحالي لإظهار الشحنات القابلة للنقل'}
              </span>
              <Badge variant="secondary">محدد حالياً: {bulkSelectionCount}</Badge>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAllForSource}
                  disabled={!transferSourceAgentId || bulkSelectableCount === 0}
                >
                  تحديد كل الشحنات
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedTransferAssignments([])}
                  disabled={bulkSelectionCount === 0}
                >
                  مسح التحديد
                </Button>
              </div>
              <div className="ml-auto">
                <Button
                  onClick={handleBulkTransfer}
                  disabled={
                    transferLoading ||
                    !transferSourceAgentId ||
                    !transferTargetAgentId ||
                    bulkSelectionCount === 0
                  }
                >
                  {transferLoading ? 'جاري النقل...' : 'نقل الشحنات المحددة'}
                </Button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      <Checkbox
                        aria-label="تحديد كل الشحنات القابلة للنقل"
                        checked={hasPartialSelection ? 'indeterminate' : bulkSelectableCount > 0 && allSelectableChosen}
                        onCheckedChange={handleToggleSelectAllCheckbox}
                      />
                      <span className="text-xs font-semibold text-gray-600">تحديد</span>
                    </div>
                  </TableHead>
                  <TableHead>رقم الطلب</TableHead>
                  <TableHead>رقم التتبع</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>المدينة</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>المندوب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ التعيين</TableHead>
                  <TableHead>إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10}>
                      <EmptyState title="لا توجد شحنات مُعيّنة" />
                    </TableCell>
                  </TableRow>
                ) : (
                  assignments.map((assignment) => {
                    const isSelected = selectedTransferAssignments.includes(assignment.id);
                    const selectable = canSelectAssignment(assignment);
                    const disabledReason = selectable ? undefined : getSelectionDisabledReason(assignment);

                    return (
                      <TableRow key={assignment.id} className={isSelected ? 'bg-muted/60' : undefined}>
                        <TableCell className="text-center">
                          <Checkbox
                            aria-label="تحديد الشحنة للنقل"
                            checked={isSelected}
                            disabled={!selectable}
                            title={disabledReason}
                            onCheckedChange={() => toggleAssignmentSelection(assignment)}
                          />
                        </TableCell>
                        <TableCell className="font-mono">{assignment.shipment.orderNumber}</TableCell>
                        <TableCell className="font-mono text-xs">{assignment.shipment.trackingNumber}</TableCell>
                        <TableCell>{assignment.shipment.customerName}</TableCell>
                        <TableCell>{assignment.shipment.shippingCity}</TableCell>
                        <TableCell className="font-semibold">
                          {formatCurrency(assignment.shipment.orderTotal)}
                          {assignment.shipment.isCOD && (
                            <span className="text-xs text-orange-600 ml-1">(COD)</span>
                          )}
                        </TableCell>
                        <TableCell>{assignment.deliveryAgent.name}</TableCell>
                        <TableCell>{getStatusBadge(assignment.status)}</TableCell>
                        <TableCell className="text-xs">{formatDate(assignment.assignedAt)}</TableCell>
                        <TableCell>
                          {assignment.status === 'assigned' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleUnassign(assignment.id)}
                            >
                              إلغاء
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          </CardContent>
        </Card>
      </div>
    </AppPageShell>
  );
}
