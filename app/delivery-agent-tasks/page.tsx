'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

type DeliveryAgent = {
  id: string;
  name: string;
  username: string;
  isActive?: boolean;
  phone?: string;
  stats?: {
    total: number;
    assigned: number;
    inTransit: number;
    delivered: number;
    failed: number;
  };
};

type DeliveryAgentTask = {
  id: string;
  title: string;
  requestType: string;
  requestedItem?: string | null;
  quantity?: number | null;
  details?: string | null;
  status: 'pending' | 'in_progress' | 'agent_completed' | 'completed' | 'cancelled';
  priority?: string | null;
  dueDate?: string | null;
  completionNotes?: string | null;
  createdAt: string;
  deliveryAgent: {
    id: string;
    name: string;
    username: string;
    phone?: string | null;
  };
  createdBy?: {
    id: string;
    name: string;
    username: string;
  } | null;
  createdByName?: string | null;
  createdByUsername?: string | null;
};

const getStatusVariant = (status: DeliveryAgentTask['status']) => {
  if (status === 'cancelled') return 'destructive';
  if (status === 'completed') return 'default';
  if (status === 'agent_completed') return 'outline';
  return 'secondary';
};

const getPriorityVariant = (priority?: string | null) => {
  if (priority === 'high') return 'destructive';
  if (priority === 'normal') return 'outline';
  return 'secondary';
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
};

export default function DeliveryAgentTasksPage() {
  const { toast } = useToast();
  const [deliveryAgents, setDeliveryAgents] = useState<DeliveryAgent[]>([]);
  const [tasks, setTasks] = useState<DeliveryAgentTask[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    pending: 0,
    inProgress: 0,
    awaitingConfirmation: 0,
    completed: 0,
    cancelled: 0,
  });
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [formError, setFormError] = useState('');
  const [taskError, setTaskError] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'completed' | 'all'>('active');
  const [agentFilter, setAgentFilter] = useState('all');
  const [formData, setFormData] = useState({
    deliveryAgentId: '',
    title: '',
    requestType: 'purchase',
    requestedItem: '',
    quantity: '',
    priority: 'normal',
    dueDate: '',
    details: '',
  });

  const fetchAgents = useCallback(async () => {
    try {
      const response = await fetch('/api/delivery-agents?includeStats=true');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'فشل تحميل المناديب');
      }
      const agents = Array.isArray(data.deliveryAgents) ? data.deliveryAgents : [];
      setDeliveryAgents(agents.filter((agent: DeliveryAgent) => agent?.isActive !== false));
    } catch (error) {
      console.error(error);
      toast({
        title: 'خطأ في جلب المناديب',
        description: error instanceof Error ? error.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const fetchTasks = useCallback(async () => {
    try {
      setTasksLoading(true);
      setTaskError('');
      const params = new URLSearchParams();
      if (agentFilter !== 'all') {
        params.set('deliveryAgentId', agentFilter);
      }

      if (statusFilter === 'active') {
        params.set('status', 'pending,in_progress,agent_completed');
      } else if (statusFilter === 'completed') {
        params.set('status', 'completed');
      } else {
        params.set('includeCompleted', 'true');
      }

      const response = await fetch(`/api/delivery-agent-tasks?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل تحميل المهام');
      }

      setTasks(data.tasks || []);
      setSummary(
        data.summary || {
          total: 0,
          pending: 0,
          inProgress: 0,
          awaitingConfirmation: 0,
          completed: 0,
          cancelled: 0,
        }
      );
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'حدث خطأ غير متوقع');
    } finally {
      setTasksLoading(false);
    }
  }, [agentFilter, statusFilter]);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        setLoading(true);
        await fetchAgents();
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, [fetchAgents]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleFormChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateTask = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');

    if (!formData.deliveryAgentId) {
      setFormError('يرجى اختيار المندوب');
      return;
    }

    if (!formData.title.trim()) {
      setFormError('يرجى كتابة وصف مختصر للطلب');
      return;
    }

    try {
      setCreatingTask(true);
      const response = await fetch('/api/delivery-agent-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          quantity: formData.quantity ? Number(formData.quantity) : undefined,
          dueDate: formData.dueDate || undefined,
          requestedItem: formData.requestedItem || undefined,
          details: formData.details || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'تعذر إنشاء المهمة');
      }

      setFormData({
        deliveryAgentId: '',
        title: '',
        requestType: 'purchase',
        requestedItem: '',
        quantity: '',
        priority: 'normal',
        dueDate: '',
        details: '',
      });

      toast({
        title: 'تم إرسال الطلب',
        description: 'تم إشعار المندوب بالمهمة الجديدة',
      });
      await fetchTasks();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'حدث خطأ غير متوقع');
    } finally {
      setCreatingTask(false);
    }
  };

  const handleTaskStatusChange = async (taskId: string, status: DeliveryAgentTask['status']) => {
    try {
      setUpdatingTaskId(taskId);
      const response = await fetch(`/api/delivery-agent-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل تحديث الحالة');
      }

      toast({
        title: 'تم تحديث الحالة',
        description: 'تم تحديث حالة الطلب',
      });
      await fetchTasks();
    } catch (error) {
      toast({
        title: 'خطأ في تحديث الحالة',
        description: error instanceof Error ? error.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      });
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const selectedAgent = useMemo(
    () => deliveryAgents.find((agent) => agent.id === formData.deliveryAgentId),
    [deliveryAgents, formData.deliveryAgentId]
  );

  const renderStatusBadge = (status: DeliveryAgentTask['status']) => (
    <Badge variant={getStatusVariant(status)}>
      {status === 'pending' && 'بانتظار التنفيذ'}
      {status === 'in_progress' && 'قيد التنفيذ'}
      {status === 'agent_completed' && 'بانتظار تأكيد الإدارة'}
      {status === 'completed' && 'منجز'}
      {status === 'cancelled' && 'ملغي'}
    </Badge>
  );

  if (loading) {
    return (
      <AppPageShell title="طلبات المناديب" subtitle="إدارة المهام الخاصة والمشتريات العاجلة">
        <LoadingState label="جاري تحميل بيانات المناديب والمهام..." />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell
      title="طلبات المناديب"
      subtitle="أرسل طلبات شراء أو مهام خاصة، وتابع تقدمها بجانب الشحنات المحلية المعيّنة للمناديب"
    >
      <div className="space-y-8">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>إنشاء طلب جديد للمندوب</CardTitle>
              <CardDescription>اختر المندوب ووضح ما الذي تريده أن يشتريه أو ينفذه</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateTask}>
                <FieldGroup>
                  <Field>
                    <FieldLabel>المندوب</FieldLabel>
                    <NativeSelect name="deliveryAgentId" value={formData.deliveryAgentId} onChange={handleFormChange}>
                      <NativeSelectOption value="">اختر المندوب</NativeSelectOption>
                      {deliveryAgents.map((agent) => (
                        <NativeSelectOption key={agent.id} value={agent.id}>
                          {agent.name} ({agent.username})
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>

                  <Field>
                    <FieldLabel>عنوان الطلب</FieldLabel>
                    <Input
                      name="title"
                      placeholder="مثال: شراء صناديق تعبئة متوسطة"
                      value={formData.title}
                      onChange={handleFormChange}
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>نوع الطلب</FieldLabel>
                      <NativeSelect name="requestType" value={formData.requestType} onChange={handleFormChange}>
                        <NativeSelectOption value="purchase">شراء عاجل</NativeSelectOption>
                        <NativeSelectOption value="pickup">استلام شحنة</NativeSelectOption>
                        <NativeSelectOption value="support">مساندة فريق آخر</NativeSelectOption>
                        <NativeSelectOption value="other">مهمة متنوعة</NativeSelectOption>
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel>الأولوية</FieldLabel>
                      <NativeSelect name="priority" value={formData.priority} onChange={handleFormChange}>
                        <NativeSelectOption value="high">عالية</NativeSelectOption>
                        <NativeSelectOption value="normal">متوسطة</NativeSelectOption>
                        <NativeSelectOption value="low">منخفضة</NativeSelectOption>
                      </NativeSelect>
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>ما المطلوب شراؤه؟</FieldLabel>
                      <Input
                        name="requestedItem"
                        placeholder="اكتب اسم المنتج أو ما يحتاجه فريقك"
                        value={formData.requestedItem}
                        onChange={handleFormChange}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>الكمية</FieldLabel>
                      <Input
                        name="quantity"
                        type="number"
                        min="1"
                        value={formData.quantity}
                        onChange={handleFormChange}
                      />
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel>تاريخ الاستحقاق</FieldLabel>
                    <Input
                      name="dueDate"
                      type="datetime-local"
                      value={formData.dueDate}
                      onChange={handleFormChange}
                    />
                  </Field>

                  <Field>
                    <FieldLabel>تفاصيل إضافية</FieldLabel>
                    <Textarea
                      name="details"
                      value={formData.details}
                      onChange={handleFormChange}
                      rows={4}
                      placeholder="اكتب تفاصيل المهمة، نقاط التسليم، أو تعليمات الدفع"
                    />
                  </Field>

                  {formError && (
                    <Alert variant="destructive">
                      <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                  )}

                  <Button type="submit" className="w-full" disabled={creatingTask}>
                    {creatingTask ? 'جاري إرسال الطلب...' : 'إرسال الطلب للمندوب'}
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          <Card className="bg-white/60">
            <CardHeader>
              <CardTitle>نظرة سريعة على حالة الطلبات</CardTitle>
              <CardDescription>
                تابع عدد الطلبات النشطة والمكتملة، واستعرض ضغط العمل قبل إنشاء مهمة جديدة
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-center md:grid-cols-3 lg:grid-cols-5">
                <div className="rounded-lg border bg-white/70 p-4">
                  <dt className="text-sm text-gray-500">الطلبات النشطة</dt>
                  <dd className="text-2xl font-bold text-gray-900">{summary.pending + summary.inProgress}</dd>
                </div>
                <div className="rounded-lg border bg-white/70 p-4">
                  <dt className="text-sm text-gray-500">بانتظار تأكيد الإدارة</dt>
                  <dd className="text-2xl font-bold text-blue-600">{summary.awaitingConfirmation}</dd>
                </div>
                <div className="rounded-lg border bg-white/70 p-4">
                  <dt className="text-sm text-gray-500">طلبات مكتملة</dt>
                  <dd className="text-2xl font-bold text-emerald-600">{summary.completed}</dd>
                </div>
                <div className="rounded-lg border bg-white/70 p-4">
                  <dt className="text-sm text-gray-500">طلبات ملغاة</dt>
                  <dd className="text-2xl font-bold text-rose-500">{summary.cancelled}</dd>
                </div>
                <div className="rounded-lg border bg-white/70 p-4">
                  <dt className="text-sm text-gray-500">إجمالي الطلبات</dt>
                  <dd className="text-2xl font-bold text-gray-900">{summary.total}</dd>
                </div>
              </dl>

              <div className="mt-6">
                <p className="text-sm font-medium text-gray-700 mb-2">مستوى ضغط المناديب</p>
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {deliveryAgents.map((agent) => (
                    <div key={agent.id} className="flex items-center justify-between rounded-md border bg-background p-3">
                      <div>
                        <p className="font-medium text-gray-900">{agent.name}</p>
                        <p className="text-sm text-gray-500">{agent.username}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">شحنات نشطة</p>
                        <p className="text-lg font-semibold text-gray-900">
                          {(agent.stats?.assigned ?? 0) + (agent.stats?.inTransit ?? 0)}
                        </p>
                      </div>
                    </div>
                  ))}
                  {!deliveryAgents.length && (
                    <EmptyState title="لا يوجد مناديب نشطون حالياً" />
                  )}
                </div>
              </div>

              {selectedAgent && (
                <div className="mt-6 rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
                  <p className="font-semibold text-slate-900">المندوب المختار</p>
                  <p>{selectedAgent.name}</p>
                  <p>
                    شحنات نشطة:{' '}
                    <span className="font-medium">
                      {(selectedAgent.stats?.assigned ?? 0) + (selectedAgent.stats?.inTransit ?? 0)}
                    </span>
                  </p>
                  {selectedAgent.phone && <p>هاتفه: {selectedAgent.phone}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>قائمة الطلبات الخاصة بالمناديب</CardTitle>
              <CardDescription>تابع الحالة وحدثها حسب تقدم المندوب</CardDescription>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <NativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <NativeSelectOption value="active">الطلبات النشطة</NativeSelectOption>
                <NativeSelectOption value="completed">الطلبات المكتملة</NativeSelectOption>
                <NativeSelectOption value="all">كل الطلبات</NativeSelectOption>
              </NativeSelect>
              <NativeSelect value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
                <NativeSelectOption value="all">كل المناديب</NativeSelectOption>
                {deliveryAgents.map((agent) => (
                  <NativeSelectOption key={agent.id} value={agent.id}>
                    {agent.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button variant="outline" onClick={fetchTasks} disabled={tasksLoading}>
                تحديث القائمة
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {taskError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{taskError}</AlertDescription>
              </Alert>
            )}

            {tasksLoading ? (
              <LoadingState label="جاري تحميل الطلبات..." />
            ) : tasks.length === 0 ? (
              <EmptyState
                title="لا توجد طلبات في هذه القائمة"
                description="جرّب تغيير المرشحات أو إنشاء طلب جديد."
              />
            ) : (
              <div className="space-y-4">
                {tasks.map((task) => (
                  <div key={task.id} className="rounded-xl border bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{task.title}</h3>
                        <p className="text-sm text-gray-500">
                          مندوب: <span className="font-medium">{task.deliveryAgent.name}</span> · تم
                          الإرسال بواسطة{' '}
                          <span className="font-medium">
                            {task.createdBy?.name || task.createdByName || task.createdByUsername || 'مستخدم النظام'}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderStatusBadge(task.status)}
                        {task.priority && (
                          <Badge variant={getPriorityVariant(task.priority)}>
                            {task.priority === 'high' && 'أولوية عالية'}
                            {task.priority === 'normal' && 'أولوية متوسطة'}
                            {task.priority === 'low' && 'أولوية منخفضة'}
                            {!['high', 'normal', 'low'].includes(task.priority) && task.priority}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 text-sm text-gray-600 md:grid-cols-2">
                      {task.requestedItem && (
                        <p>
                          <span className="font-medium text-gray-800">المطلوب:</span> {task.requestedItem}
                          {task.quantity ? ` (العدد: ${task.quantity})` : ''}
                        </p>
                      )}
                      {task.details && (
                        <p className="md:col-span-2">
                          <span className="font-medium text-gray-800">تفاصيل:</span> {task.details}
                        </p>
                      )}
                      <p>
                        <span className="font-medium text-gray-800">تاريخ الإنشاء:</span>{' '}
                        {formatDateTime(task.createdAt)}
                      </p>
                      <p>
                        <span className="font-medium text-gray-800">تاريخ الاستحقاق:</span>{' '}
                        {formatDateTime(task.dueDate)}
                      </p>
                    </div>

                    {task.status !== 'completed' && task.status !== 'cancelled' && (
                      <div className="mt-4 space-y-3">
                        {task.status === 'agent_completed' && (
                          <p className="text-sm text-blue-700">
                            أعلن المندوب أنهى المهمة وينتظر التأكيد. راجع الملاحظات ثم أقر التنفيذ أو أعد فتح المهمة.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-3">
                          {task.status === 'pending' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleTaskStatusChange(task.id, 'in_progress')}
                              disabled={updatingTaskId === task.id}
                            >
                              بدء التنفيذ
                            </Button>
                          )}
                          {task.status === 'agent_completed' ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleTaskStatusChange(task.id, 'completed')}
                                disabled={updatingTaskId === task.id}
                              >
                                تأكيد إنهاء المندوب
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleTaskStatusChange(task.id, 'in_progress')}
                                disabled={updatingTaskId === task.id}
                              >
                                إعادة المهمة للمندوب
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleTaskStatusChange(task.id, 'completed')}
                              disabled={updatingTaskId === task.id}
                            >
                              تم التنفيذ
                            </Button>
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleTaskStatusChange(task.id, 'cancelled')}
                            disabled={updatingTaskId === task.id}
                          >
                            إلغاء الطلب
                          </Button>
                        </div>
                      </div>
                    )}

                    {task.status === 'agent_completed' && task.completionNotes && (
                      <p className="mt-3 text-sm text-blue-700">
                        ملاحظات المندوب: {task.completionNotes}
                      </p>
                    )}

                    {task.status === 'completed' && task.completionNotes && (
                      <p className="mt-3 text-sm text-emerald-600">
                        ملاحظات الإكمال: {task.completionNotes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppPageShell>
  );
}
