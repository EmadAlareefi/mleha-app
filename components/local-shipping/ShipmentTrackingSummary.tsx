import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { LOCAL_SHIPMENT_STATUSES, localShipmentLocation, returnPickupStatusLabel } from '@/app/lib/local-shipping/tracking';
import type { LocalTrackingShipment } from '@/app/lib/local-shipping/tracking-query';

const date = (value: string) => new Date(value).toLocaleString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh' });

export default function ShipmentTrackingSummary({ shipment, detailed = false }: {
  shipment: LocalTrackingShipment; detailed?: boolean;
}) {
  const assignment = shipment.assignment;
  const status = assignment?.status || shipment.status;
  const milestones = [
    ['تم إنشاء الشحنة', shipment.createdAt],
    ['تم إسناد الشحنة للمندوب', assignment?.assignedAt],
    ['استلم المندوب الشحنة من المستودع', assignment?.pickedUpAt],
    ['تم تسليم الشحنة للعميل', assignment?.deliveredAt || shipment.deliveredAt],
    ['تعذر تسليم الشحنة للعميل', assignment?.failedAt],
    ['تم إلغاء الشحنة', assignment?.cancelledAt || shipment.cancelledAt],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))
    .sort((a, b) => new Date(a[1]).getTime() - new Date(b[1]).getTime());
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{detailed ? 'الشحنة المحلية' : 'الشحنة المحلية الأصلية'}</strong>
        <Badge variant="secondary">{LOCAL_SHIPMENT_STATUSES[status] || status}</Badge>
        <Link className="text-blue-700 underline" href={`/local-shipping/tracking?id=${encodeURIComponent(shipment.id)}`}>
          {shipment.trackingNumber}
        </Link>
      </div>
      <p><span className="text-muted-foreground">مكان الشحنة الآن:</span> {localShipmentLocation(status, shipment.warehouse?.name)}</p>
      {assignment?.deliveryAgent && <p>المندوب: {assignment.deliveryAgent.name} {assignment.deliveryAgent.phone && <span dir="ltr">({assignment.deliveryAgent.phone})</span>}</p>}
      <p className="text-muted-foreground">آخر تحديث: {date(assignment?.updatedAt || shipment.updatedAt)}</p>
      {status === 'failed' && assignment?.failureReason && <p>سبب تعذر التسليم: {assignment.failureReason}</p>}
      {status === 'cancelled' && (assignment?.cancellationReason || shipment.cancellationReason) && <p>سبب الإلغاء: {assignment?.cancellationReason || shipment.cancellationReason}</p>}
      {shipment.tasks.map(task => (
        <div key={task.id} className="border-t pt-2">
          <p><strong>استلام المرتجع:</strong> {returnPickupStatusLabel(task.status, task.completionNotes)}</p>
          <p>مندوب الاستلام: {task.deliveryAgent.name}</p>
          <p className="text-muted-foreground">
            تم طلب الاستلام: {date(task.createdAt)}
            {task.completedAt ? ` · تم التسليم للمستودع: ${date(task.completedAt)}` : ` · آخر تحديث: ${date(task.updatedAt)}`}
          </p>
          {task.completionNotes && <p>ملاحظات المندوب: {task.completionNotes}</p>}
        </div>
      ))}
      {detailed && <>
        <p>وجهة التسليم: {shipment.shippingCity} — {shipment.shippingAddress}</p>
        {shipment.deliveryNotes && <p>ملاحظات التوصيل: {shipment.deliveryNotes}</p>}
        {assignment?.recipientName && <p>المستلم: {assignment.recipientName}</p>}
        <ol className="space-y-1 border-t pt-2">
          {milestones.map(([label, timestamp]) => <li key={label}>{label} — {date(timestamp)}</li>)}
        </ol>
      </>}
    </div>
  );
}
