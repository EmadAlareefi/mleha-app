'use client';

import { MapPin, PackageCheck, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContactActions, DistanceBadge } from './AssignmentCard';
import { type DeliveryAgentTask, formatDate, getAddressDetails, getAreaLabel } from './delivery-helpers';

interface ReturnPickupCardProps {
  task: DeliveryAgentTask & { relatedShipment: NonNullable<DeliveryAgentTask['relatedShipment']> };
  distance?: number | null;
  onPickedUp: (task: DeliveryAgentTask) => void;
  onFail: (task: DeliveryAgentTask) => void;
}

export function ReturnPickupCard({ task, distance, onPickedUp, onFail }: ReturnPickupCardProps) {
  const shipment = task.relatedShipment;
  const meta = shipment.orderItems?.meta;
  const addressNote = meta?.shipToAddressNote?.trim();

  return (
    <article className="rounded-xl border border-teal-200 bg-white p-4 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm text-gray-500">#{shipment.orderNumber}</p>
          <p className="truncate text-lg font-bold text-gray-900">{meta?.shipToName || shipment.customerName}</p>
          <p className="flex items-center gap-1 text-sm text-gray-600">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />
            {getAreaLabel(shipment)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <DistanceBadge distance={distance} />
          <span className="flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            استلام مرتجع
          </span>
        </div>
      </header>

      {task.requestedItem && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-semibold">استلم{task.quantity ? ` ${task.quantity} قطع` : ''}:</span>{' '}
          {task.requestedItem}
        </div>
      )}

      {addressNote && (
        <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
          <span className="font-semibold">ملاحظة العنوان:</span> {addressNote}
        </p>
      )}

      {task.completionNotes && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{task.completionNotes}</p>
      )}

      <ContactActions shipment={shipment} purpose="pickup" />

      <div className="mt-2 flex gap-2">
        <Button
          className="h-12 flex-[2] bg-teal-600 text-base font-bold hover:bg-teal-700"
          onClick={() => onPickedUp(task)}
        >
          <PackageCheck className="h-5 w-5" aria-hidden />
          استلمت المرتجع
        </Button>
        <Button
          variant="outline"
          className="h-12 flex-1 border-red-200 text-red-700 hover:bg-red-50"
          onClick={() => onFail(task)}
        >
          <XCircle className="h-5 w-5" aria-hidden />
          تعذّر
        </Button>
      </div>

      <details className="mt-3 text-sm text-gray-600">
        <summary className="cursor-pointer select-none text-xs font-medium text-gray-500">التفاصيل</summary>
        <ul className="mt-2 space-y-1.5">
          {getAddressDetails(shipment).map((line) => (
            <li key={line}>{line}</li>
          ))}
          {task.details && <li>سبب الإرجاع: {task.details}</li>}
          <li>
            الهاتف: <span dir="ltr">{meta?.shipToPhone || shipment.customerPhone}</span>
          </li>
          <li>تاريخ الطلب: {formatDate(task.createdAt)}</li>
        </ul>
      </details>
    </article>
  );
}
