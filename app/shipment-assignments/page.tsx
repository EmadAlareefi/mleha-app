'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
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
    const statusMap: Record<string, { label: string; className: string }> = {
      pending: { label: 'قيد الانتظار', className: 'bg-gray-100 text-gray-800' },
      assigned: { label: 'مُعيّن', className: 'bg-blue-100 text-blue-800' },
      picked_up: { label: 'تم الاستلام', className: 'bg-purple-100 text-purple-800' },
      in_transit: { label: 'قيد التوصيل', className: 'bg-yellow-100 text-yellow-800' },
      delivered: { label: 'تم التوصيل', className: 'bg-green-100 text-green-800' },
      failed: { label: 'فشل', className: 'bg-red-100 text-red-800' },
      cancelled: { label: 'ملغي', className: 'bg-gray-100 text-gray-800' },
    };

    const statusInfo = statusMap[status] || { label: status, className: 'bg-gray-100 text-gray-800' };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.className}`}>
        {statusInfo.label}
      </span>
    );
  };

  const selectedSourceAgent = transferSourceAgentId
    ? deliveryAgents.find((agent) => agent.id === transferSourceAgentId)
    : null;
  const bulkSelectionCount = selectedTransferAssignments.length;
  const bulkSelectableCount = selectableAssignmentsForSource.length;
  const allSelectableChosen = bulkSelectableCount > 0 && bulkSelectionCount === bulkSelectableCount;
  const hasPartialSelection =
    bulkSelectionCount > 0 && bulkSelectionCount < bulkSelectableCount;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = hasPartialSelection;
    }
  }, [hasPartialSelection]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <p>جاري التحميل...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Navigation */}
        <nav className="flex justify-center gap-3 mb-8">
          <Link
            href="/warehouse"
            prefetch={false}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            المستودع
          </Link>
          <Link
            href="/local-shipping"
            prefetch={false}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            شحن محلي
          </Link>
          <Link
            href="/shipment-assignments"
            prefetch={false}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            تعيين الشحنات
          </Link>
          {canAccessCodTracker && (
            <Link
              href="/cod-tracker"
              prefetch={false}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
            >
              تتبع التحصيل
            </Link>
          )}
        </nav>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">تعيين الشحنات للمناديب</h1>
          <p className="text-gray-600">قم بتعيين الشحنات المحلية لمناديب التوصيل</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
            {error}
          </div>
        )}

        {/* Delivery Agents Stats */}
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">مناديب التوصيل</h2>
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
        </Card>

        {/* Assignment Form */}
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">تعيين شحنة جديدة</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                الشحنة
              </label>
              <select
                value={selectedShipment || ''}
                onChange={(e) => setSelectedShipment(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">اختر شحنة</option>
                {pendingShipments.map((shipment) => (
                  <option key={shipment.id} value={shipment.id}>
                    {shipment.orderNumber} - {shipment.customerName} ({shipment.shippingCity})
                    {shipment.isCOD && ' - COD'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                المندوب
              </label>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">اختر مندوب</option>
                {deliveryAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} (المعين: {agent.stats?.assigned || 0})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ملاحظات (اختياري)
              </label>
              <input
                type="text"
                value={assignmentNotes}
                onChange={(e) => setAssignmentNotes(e.target.value)}
                placeholder="ملاحظات للمندوب"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
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
        </Card>

        {/* Current Assignments */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">الشحنات المُعيّنة</h2>

          <div className="mb-6 rounded-lg border border-blue-100 bg-blue-50/60 p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-blue-900 mb-1">
                  المندوب الحالي
                </label>
                <select
                  value={transferSourceAgentId}
                  onChange={(e) => setTransferSourceAgentId(e.target.value)}
                  className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">اختر المندوب الحالي</option>
                  {deliveryAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-blue-900 mb-1">
                  المندوب الجديد
                </label>
                <select
                  value={transferTargetAgentId}
                  onChange={(e) => setTransferTargetAgentId(e.target.value)}
                  className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">اختر المندوب الجديد</option>
                  {deliveryAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-blue-900">
              <span>
                {transferSourceAgentId
                  ? `شحنات ${selectedSourceAgent?.name || 'المندوب'} القابلة للنقل: ${bulkSelectableCount}`
                  : 'اختر المندوب الحالي لإظهار الشحنات القابلة للنقل'}
              </span>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-900">
                محدد حالياً: {bulkSelectionCount}
              </span>
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
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-right bg-gray-100">
                  <th className="px-3 py-2 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <input
                        ref={selectAllCheckboxRef}
                        type="checkbox"
                        aria-label="تحديد كل الشحنات القابلة للنقل"
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                        checked={bulkSelectableCount > 0 && allSelectableChosen}
                        onChange={handleToggleSelectAllCheckbox}
                      />
                      <span className="text-xs font-semibold text-gray-600">تحديد</span>
                    </div>
                  </th>
                  <th className="px-3 py-2">رقم الطلب</th>
                  <th className="px-3 py-2">رقم التتبع</th>
                  <th className="px-3 py-2">العميل</th>
                  <th className="px-3 py-2">المدينة</th>
                  <th className="px-3 py-2">المبلغ</th>
                  <th className="px-3 py-2">المندوب</th>
                  <th className="px-3 py-2">الحالة</th>
                  <th className="px-3 py-2">تاريخ التعيين</th>
                  <th className="px-3 py-2">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {assignments.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center text-gray-500 py-6">
                      لا توجد شحنات مُعيّنة
                    </td>
                  </tr>
                ) : (
                  assignments.map((assignment) => {
                    const isSelected = selectedTransferAssignments.includes(assignment.id);
                    const selectable = canSelectAssignment(assignment);
                    const disabledReason = selectable ? undefined : getSelectionDisabledReason(assignment);

                    return (
                      <tr
                        key={assignment.id}
                        className={`border-b ${isSelected ? 'bg-blue-50' : ''}`}
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label="تحديد الشحنة للنقل"
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                            checked={isSelected}
                            disabled={!selectable}
                            title={disabledReason}
                            onChange={() => toggleAssignmentSelection(assignment)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono">{assignment.shipment.orderNumber}</td>
                        <td className="px-3 py-2 font-mono text-xs">{assignment.shipment.trackingNumber}</td>
                        <td className="px-3 py-2">{assignment.shipment.customerName}</td>
                        <td className="px-3 py-2">{assignment.shipment.shippingCity}</td>
                        <td className="px-3 py-2 font-semibold">
                          {formatCurrency(assignment.shipment.orderTotal)}
                          {assignment.shipment.isCOD && (
                            <span className="text-xs text-orange-600 ml-1">(COD)</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{assignment.deliveryAgent.name}</td>
                        <td className="px-3 py-2">{getStatusBadge(assignment.status)}</td>
                        <td className="px-3 py-2 text-xs">{formatDate(assignment.assignedAt)}</td>
                        <td className="px-3 py-2">
                          {assignment.status === 'assigned' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleUnassign(assignment.id)}
                            >
                              إلغاء
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
