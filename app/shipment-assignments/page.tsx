'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
  const [pendingShipments, setPendingShipments] = useState<LocalShipment[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [deliveryAgents, setDeliveryAgents] = useState<DeliveryAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedShipment, setSelectedShipment] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [assignmentNotes, setAssignmentNotes] = useState('');
  const [assigning, setAssigning] = useState(false);

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
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            المستودع
          </Link>
          <Link
            href="/local-shipping"
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            شحن محلي
          </Link>
          <Link
            href="/shipment-assignments"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            تعيين الشحنات
          </Link>
          <Link
            href="/cod-tracker"
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            تتبع التحصيل
          </Link>
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
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-right bg-gray-100">
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
                    <td colSpan={9} className="text-center text-gray-500 py-6">
                      لا توجد شحنات مُعيّنة
                    </td>
                  </tr>
                ) : (
                  assignments.map((assignment) => (
                    <tr key={assignment.id} className="border-b">
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
