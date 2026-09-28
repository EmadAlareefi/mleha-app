'use client';

import { useState } from 'react';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { type DeliveryAgentTask, formatDate } from './delivery-helpers';
import { parseJsonResponse } from './StatusDialogs';

const TASK_STATUS: Record<DeliveryAgentTask['status'], { label: string; className: string }> = {
  pending: { label: 'جديدة', className: 'bg-slate-100 text-slate-800' },
  in_progress: { label: 'قيد التنفيذ', className: 'bg-amber-100 text-amber-800' },
  agent_completed: { label: 'بانتظار تأكيد الإدارة', className: 'bg-blue-100 text-blue-800' },
  completed: { label: 'تم التنفيذ', className: 'bg-green-100 text-green-800' },
  cancelled: { label: 'ملغية', className: 'bg-gray-100 text-gray-700' },
};

const REQUEST_TYPES: Record<string, string> = {
  purchase: 'شراء عاجل',
  pickup: 'استلام شحنة',
  support: 'مساندة',
  return_pickup: 'استلام مرتجع',
};

export const isOpenTask = (task: DeliveryAgentTask) =>
  task.status === 'pending' || task.status === 'in_progress';

interface TasksPanelProps {
  tasks: DeliveryAgentTask[];
  loading: boolean;
  error: string;
  onChanged: () => Promise<void>;
}

export function TasksPanel({ tasks, loading, error, onChanged }: TasksPanelProps) {
  const { toast } = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const openTasks = tasks.filter(isOpenTask);
  const doneTasks = tasks.filter((task) => !isOpenTask(task));
  const visible = showDone ? doneTasks : openTasks;

  const updateTask = async (taskId: string, status: DeliveryAgentTask['status']) => {
    try {
      setUpdatingId(taskId);
      const response = await fetch(`/api/delivery-agent-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          completionNotes: status === 'agent_completed' ? notes[taskId]?.trim() || undefined : undefined,
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.error || 'فشل في تحديث المهمة');
      }
      setNotes((prev) => ({ ...prev, [taskId]: '' }));
      await onChanged();
    } catch (err) {
      toast({
        title: 'تعذر تحديث المهمة',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      });
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return <LoadingState label="جاري تحميل المهام..." />;
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title={showDone ? 'لا توجد مهام منتهية' : 'لا توجد مهام حالياً'}
          description={showDone ? undefined : 'ستظهر هنا المهام التي يرسلها لك الفريق.'}
        />
      ) : (
        visible.map((task) => {
          const status = TASK_STATUS[task.status];
          const requester = task.createdBy?.name || task.createdByName || task.createdByUsername;
          return (
            <article key={task.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-bold text-gray-900">{task.title}</p>
                  <p className="text-xs text-gray-500">
                    {REQUEST_TYPES[task.requestType] || 'مهمة'}
                    {requester ? ` · من ${requester}` : ''}
                    {task.dueDate ? ` · قبل ${formatDate(task.dueDate)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant="outline" className={status.className}>{status.label}</Badge>
                  {task.priority === 'high' && (
                    <Badge variant="outline" className="bg-red-100 text-red-700">عاجلة</Badge>
                  )}
                </div>
              </header>

              {task.requestedItem && (
                <p className="mt-2 text-sm text-gray-700">
                  المطلوب: <span className="font-semibold">{task.requestedItem}</span>
                  {task.quantity ? ` × ${task.quantity}` : ''}
                </p>
              )}
              {task.details && <p className="mt-1 text-sm text-gray-600">{task.details}</p>}
              {task.completionNotes && (
                <p className="mt-2 text-sm text-blue-800">ملاحظات التنفيذ: {task.completionNotes}</p>
              )}

              {task.status === 'pending' && (
                <div className="mt-3 flex gap-2">
                  <Button
                    className="h-11 flex-[2]"
                    onClick={() => updateTask(task.id, 'in_progress')}
                    disabled={updatingId === task.id}
                  >
                    بدء المهمة
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 flex-1"
                    onClick={() => updateTask(task.id, 'cancelled')}
                    disabled={updatingId === task.id}
                  >
                    إلغاء
                  </Button>
                </div>
              )}
              {task.status === 'in_progress' && (
                <div className="mt-3 space-y-2">
                  <Textarea
                    rows={2}
                    placeholder="ملاحظات (اختياري)"
                    value={notes[task.id] ?? ''}
                    onChange={(event) => setNotes((prev) => ({ ...prev, [task.id]: event.target.value }))}
                  />
                  <Button
                    className="h-11 w-full bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => updateTask(task.id, 'agent_completed')}
                    disabled={updatingId === task.id}
                  >
                    تم التنفيذ
                  </Button>
                </div>
              )}
            </article>
          );
        })
      )}

      <Button variant="link" size="sm" className="w-full" onClick={() => setShowDone((prev) => !prev)}>
        {showDone ? `عرض المهام الحالية (${openTasks.length})` : `عرض المهام المنتهية (${doneTasks.length})`}
      </Button>
    </div>
  );
}
