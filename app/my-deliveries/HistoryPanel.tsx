'use client';

import { EmptyState } from '@/components/dashboard/states';
import { Badge } from '@/components/ui/badge';
import {
  type Assignment,
  type DeliveryAgentWalletInfo,
  type WalletTransaction,
  formatCurrency,
  formatDate,
} from './delivery-helpers';

const RESULT_BADGE: Record<string, { label: string; className: string }> = {
  delivered: { label: 'تم التسليم', className: 'bg-green-100 text-green-800' },
  failed: { label: 'تعذّر', className: 'bg-red-100 text-red-800' },
  cancelled: { label: 'ملغي', className: 'bg-gray-100 text-gray-700' },
};

const TRANSACTION_LABELS: Record<WalletTransaction['type'], string> = {
  SHIPMENT_COMPLETED: 'شحنة مكتملة',
  TASK_COMPLETED: 'مهمة مكتملة',
  PAYOUT: 'دفعة من الإدارة',
  ADJUSTMENT: 'تعديل محفظة',
};

interface HistoryPanelProps {
  assignments: Assignment[];
  wallet: DeliveryAgentWalletInfo | null;
  walletError: string;
  cashInHand: number;
}

export function HistoryPanel({ assignments, wallet, walletError, cashInHand }: HistoryPanelProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border bg-white p-3">
          <p className="text-xs text-gray-500">رصيدي</p>
          <p className="text-xl font-bold text-emerald-600">{formatCurrency(wallet?.balance ?? 0)}</p>
        </div>
        <div className="rounded-xl border bg-white p-3">
          <p className="text-xs text-gray-500">نقد بحوزتي (COD)</p>
          <p className="text-xl font-bold text-orange-600">{formatCurrency(cashInHand)}</p>
        </div>
      </div>
      {walletError && <p className="text-sm text-red-600">{walletError}</p>}

      {wallet && wallet.recentTransactions.length > 0 && (
        <details className="rounded-xl border bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium text-gray-700">آخر حركات المحفظة</summary>
          <ul className="mt-2 divide-y">
            {wallet.recentTransactions.slice(0, 10).map((transaction) => (
              <li key={transaction.id} className="flex items-center justify-between py-2">
                <span>
                  {transaction.notes || TRANSACTION_LABELS[transaction.type]}
                  <span className="block text-xs text-gray-500">{formatDate(transaction.createdAt)}</span>
                </span>
                <span className={transaction.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                  {formatCurrency(transaction.amount)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {assignments.length === 0 ? (
        <EmptyState title="لا توجد شحنات منجزة" />
      ) : (
        <ul className="divide-y rounded-xl border bg-white">
          {assignments.map((assignment) => {
            const badge = RESULT_BADGE[assignment.status] ?? {
              label: assignment.status,
              className: 'bg-gray-100 text-gray-700',
            };
            return (
              <li key={assignment.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900">
                    {assignment.shipment.orderItems?.meta?.shipToName || assignment.shipment.customerName}
                  </p>
                  <p className="text-xs text-gray-500">
                    <span className="font-mono">#{assignment.shipment.orderNumber}</span> ·{' '}
                    {formatDate(assignment.deliveredAt || assignment.assignedAt)}
                  </p>
                  {assignment.status === 'failed' && assignment.failureReason && (
                    <p className="text-xs text-red-600">{assignment.failureReason}</p>
                  )}
                </div>
                <div className="shrink-0 text-left">
                  <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                  {assignment.shipment.isCOD && (
                    <p className="mt-1 text-xs text-orange-600">
                      COD {formatCurrency(Number(assignment.shipment.orderTotal) || 0)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
