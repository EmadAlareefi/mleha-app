'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

type DeliveryAgent = {
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

const statusBadgeClasses: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-800',
  in_progress: 'bg-amber-100 text-amber-800',
  agent_completed: 'bg-blue-100 text-blue-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-rose-100 text-rose-800',
};

const priorityClasses: Record<string, string> = {
  high: 'bg-red-100 text-red-800',
  normal: 'bg-blue-100 text-blue-800',
  low: 'bg-slate-100 text-slate-700',
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

  useEffect(() => {
    const bootstrap = async () => {
      try {
        setLoading(true);
        await Promise.all([fetchAgents(), fetchTasks()]);
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, agentFilter]);

  const fetchAgents = async () => {
    try {
      const response = await fetch('/api/delivery-agents?includeStats=true');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'فشل تحميل المناديب');
      }
      setDeliveryAgents(data.deliveryAgents || []);
    } catch (error) {
      console.error(error);
      toast({
        title: 'خطأ في جلب المناديب',
        description: error instanceof Error ? error.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      });
    }
  };

  const fetchTasks = async () => {
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
  };

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
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClasses[status]}`}
    >
      {status === 'pending' && 'بانتظار التنفيذ'}
      {status === 'in_progress' && 'قيد التنفيذ'}
      {status === 'agent_completed' && 'بانتظار تأكيد الإدارة'}
      {status === 'completed' && 'منجز'}
      {status === 'cancelled' && 'ملغي'}
    </span>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <p>جاري تحميل بيانات المناديب والمهام...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-3">
          <p className="text-sm text-gray-500">إدارة طلبات المناديب</p>
          <h1 className="text-3xl font-bold text-gray-900">اطلب من المندوب تنفيذ مشترياتك</h1>
          <p className="text-gray-600 max-w-3xl mx-auto">
            أرسل طلبات سريعة للمناديب سواء لشراء مستلزمات مستعجلة أو تنفيذ مهام خاصة، وتابع حالة كل طلب
            بسهولة بجانب الشحنات المحلية المعيّنة لهم.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>إنشاء طلب جديد للمندوب</CardTitle>
              <CardDescription>اختر المندوب ووضح ما الذي تريده أن يشتريه أو ينفذه</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateTask}>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">المندوب</label>
                  <Select
                    name="deliveryAgentId"
                    value={formData.deliveryAgentId}
                    onChange={handleFormChange}
                  >
                    <option value="">اختر المندوب</option>
                    {deliveryAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name} ({agent.username})
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">عنوان الطلب</label>
                  <Input
                    name="title"
                    placeholder="مثال: شراء صناديق تعبئة متوسطة"
                    value={formData.title}
                    onChange={handleFormChange}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">نوع الطلب</label>
                    <Select name="requestType" value={formData.requestType} onChange={handleFormChange}>
                      <option value="purchase">شراء عاجل</option>
                      <option value="pickup">استلام شحنة</option>
                      <option value="support">مساندة فريق آخر</option>
                      <option value="other">مهمة متنوعة</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">الأولوية</label>
                    <Select name="priority" value={formData.priority} onChange={handleFormChange}>
                      <option value="high">عالية</option>
                      <option value="normal">متوسطة</option>
                      <option value="low">منخفضة</option>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">ما المطلوب شراؤه؟</label>
                    <Input
                      name="requestedItem"
                      placeholder="اكتب اسم المنتج أو ما يحتاجه فريقك"
                      value={formData.requestedItem}
                      onChange={handleFormChange}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">الكمية</label>
                    <Input
                      name="quantity"
                      type="number"
                      min="1"
                      value={formData.quantity}
                      onChange={handleFormChange}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">تاريخ الاستحقاق</label>
                  <Input
                    name="dueDate"
                    type="datetime-local"
                    value={formData.dueDate}
                    onChange={handleFormChange}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">تفاصيل إضافية</label>
                  <textarea
                    name="details"
                    value={formData.details}
                    onChange={handleFormChange}
                    rows={4}
                    className="w-full rounded-md border border-input px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="اكتب تفاصيل المهمة، نقاط التسليم، أو تعليمات الدفع"
                  />
                </div>

                {formError && <p className="text-sm text-red-600">{formError}</p>}

                <Button type="submit" className="w-full" disabled={creatingTask}>
                  {creatingTask ? 'جاري إرسال الطلب...' : 'إرسال الطلب للمندوب'}
                </Button>
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
                    <div key={agent.id} className="rounded-lg border p-3 flex items-center justify-between">
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
                    <p className="text-sm text-gray-500">لا يوجد مناديب نشطون حالياً</p>
                  )}
                </div>
              </div>

              {selectedAgent && (
                <div className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
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
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as any)}>
                <option value="active">الطلبات النشطة</option>
                <option value="completed">الطلبات المكتملة</option>
                <option value="all">كل الطلبات</option>
              </Select>
              <Select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
                <option value="all">كل المناديب</option>
                {deliveryAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
              <Button variant="outline" onClick={fetchTasks} disabled={tasksLoading}>
                تحديث القائمة
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {taskError && <p className="text-sm text-red-600 mb-4">{taskError}</p>}

            {tasksLoading ? (
              <p className="text-center text-gray-500">جاري تحميل الطلبات...</p>
            ) : tasks.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                لا توجد طلبات في هذه القائمة. جرّب تغيير المرشحات أو إنشاء طلب جديد.
              </div>
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
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                              priorityClasses[task.priority] || 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {task.priority === 'high' && 'أولوية عالية'}
                            {task.priority === 'normal' && 'أولوية متوسطة'}
                            {task.priority === 'low' && 'أولوية منخفضة'}
                            {!['high', 'normal', 'low'].includes(task.priority) && task.priority}
                          </span>
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
    </div>
  );
}
