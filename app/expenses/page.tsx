'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Expense = {
  id: string;
  title: string;
  description?: string;
  amount: number;
  currency: string;
  category: string;
  expenseDate: string;
  status: string;
  createdBy: string;
  createdAt: string;
  notes?: string;
};

type ExpenseSummary = {
  category: string;
  _sum: { amount: number };
  _count: number;
};

type ExpenseFormData = {
  title: string;
  description: string;
  amount: string;
  category: string;
  expenseDate: string;
  notes: string;
};

const EXPENSE_CATEGORIES = [
  { value: 'shipping', label: 'شحن' },
  { value: 'packaging', label: 'تغليف' },
  { value: 'marketing', label: 'تسويق' },
  { value: 'operations', label: 'عمليات' },
  { value: 'partner-current', label: 'جاري الشريك' },
  { value: 'salaries', label: 'رواتب' },
  { value: 'utilities', label: 'مرافق' },
  { value: 'rent', label: 'إيجار' },
  { value: 'maintenance', label: 'صيانة' },
  { value: 'other', label: 'أخرى' },
];

const STATUS_OPTIONS = [
  { value: 'pending', label: 'قيد المراجعة' },
  { value: 'approved', label: 'معتمد' },
  { value: 'rejected', label: 'مرفوض' },
];

export default function ExpensesPage() {
  const { data: session } = useSession();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Form state
  const getInitialFormData = (): ExpenseFormData => ({
    title: '',
    description: '',
    amount: '',
    category: 'other',
    expenseDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [formData, setFormData] = useState<ExpenseFormData>(getInitialFormData);
  const resetForm = () => setFormData(getInitialFormData());

  const handleFormCancel = () => {
    setShowAddForm(false);
    setEditingExpense(null);
    resetForm();
  };

  const toggleFormVisibility = () => {
    if (showAddForm) {
      handleFormCancel();
    } else {
      resetForm();
      setEditingExpense(null);
      setShowAddForm(true);
    }
  };

  const handleEditClick = (expense: Expense) => {
    setEditingExpense(expense);
    setShowAddForm(true);
    setFormData({
      title: expense.title || '',
      description: expense.description || '',
      amount: expense.amount?.toString() || '',
      category: expense.category,
      expenseDate: expense.expenseDate
        ? new Date(expense.expenseDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      notes: expense.notes || '',
    });
  };

  const fetchExpenses = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedCategory) params.append('category', selectedCategory);
      if (selectedStatus) params.append('status', selectedStatus);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(`/api/expenses?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch expenses');

      const data = await response.json();
      setExpenses(data.expenses || []);
      setSummary(data.summary || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Error fetching expenses:', error);
      alert('فشل في جلب المصروفات');
    } finally {
      setLoading(false);
    }
  }, [endDate, selectedCategory, selectedStatus, startDate]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title || !formData.amount || !formData.category) {
      alert('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    const parsedAmount = parseFloat(formData.amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      alert('يرجى إدخال مبلغ صالح أكبر من صفر');
      return;
    }

    const payload = {
      title: formData.title,
      description: formData.description || undefined,
      amount: parsedAmount,
      category: formData.category,
      expenseDate: formData.expenseDate,
      notes: formData.notes || undefined,
    };

    const endpoint = editingExpense
      ? `/api/expenses/${editingExpense.id}`
      : '/api/expenses';
    const method = editingExpense ? 'PATCH' : 'POST';

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          error.error ||
            (editingExpense
              ? 'Failed to update expense'
              : 'Failed to create expense')
        );
      }

      alert(
        editingExpense ? 'تم تحديث المصروف بنجاح' : 'تم إضافة المصروف بنجاح'
      );
      handleFormCancel();
      void fetchExpenses();
    } catch (error: any) {
      console.error('Error saving expense:', error);
      alert(error.message || 'فشل في حفظ المصروف');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا المصروف؟')) return;

    try {
      const response = await fetch(`/api/expenses/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete expense');

      alert('تم حذف المصروف بنجاح');
      if (editingExpense?.id === id) {
        handleFormCancel();
      }
      void fetchExpenses();
    } catch (error) {
      console.error('Error deleting expense:', error);
      alert('فشل في حذف المصروف');
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const response = await fetch(`/api/expenses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) throw new Error('Failed to update status');

      alert('تم تحديث الحالة بنجاح');
      void fetchExpenses();
    } catch (error) {
      console.error('Error updating status:', error);
      alert('فشل في تحديث الحالة');
    }
  };

  const getCategoryLabel = (value: string) => {
    return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label || value;
  };

  const getStatusLabel = (status: string) => {
    return STATUS_OPTIONS.find((s) => s.value === status)?.label || status;
  };

  const getStatusVariant = (status: string) => {
    if (status === 'approved') return 'default';
    if (status === 'rejected') return 'destructive';
    return 'secondary';
  };

  const handleExport = () => {
    if (!expenses.length) {
      alert('لا توجد مصروفات لتصديرها');
      return;
    }

    const rows = expenses.map((expense) => ({
      المعرف: expense.id,
      التاريخ: new Date(expense.expenseDate).toLocaleDateString('ar-SA'),
      العنوان: expense.title,
      الوصف: expense.description || '',
      الفئة: getCategoryLabel(expense.category),
      المبلغ: Number(expense.amount).toFixed(2),
      العملة: expense.currency,
      الحالة: getStatusLabel(expense.status),
      'تم الإنشاء بواسطة': expense.createdBy,
      'تاريخ الإنشاء': new Date(expense.createdAt).toLocaleString('ar-SA'),
      الملاحظات: expense.notes || '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Expenses');
    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `expenses-${timestamp}.xlsx`);
  };

  const totalAmount = expenses.reduce((sum, exp) => sum + Number(exp.amount), 0);
  const userRole = (session?.user as any)?.role;
  const isAdmin = userRole === 'admin';

  return (
    <AppPageShell title="إدارة المصروفات" subtitle="تتبع وإدارة جميع مصروفات المتجر">
      <div className="space-y-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card>
            <CardContent className="p-6">
              <div className="text-sm text-muted-foreground mb-2">إجمالي المصروفات</div>
              <div className="text-3xl font-bold text-foreground">
              {totalAmount.toFixed(2)} ر.س
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="text-sm text-muted-foreground mb-2">عدد المصروفات</div>
              <div className="text-3xl font-bold text-foreground">{total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="text-sm text-muted-foreground mb-2">متوسط المصروف</div>
              <div className="text-3xl font-bold text-foreground">
              {total > 0 ? (totalAmount / total).toFixed(2) : '0.00'} ر.س
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-6">
          <div className="flex flex-wrap gap-4 items-end">
            <Field className="flex-1 min-w-[200px]">
              <FieldLabel>الفئة</FieldLabel>
              <NativeSelect
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <NativeSelectOption value="">جميع الفئات</NativeSelectOption>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <NativeSelectOption key={cat.value} value={cat.value}>
                    {cat.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>

            <Field className="flex-1 min-w-[200px]">
              <FieldLabel>الحالة</FieldLabel>
              <NativeSelect
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                <NativeSelectOption value="">جميع الحالات</NativeSelectOption>
                {STATUS_OPTIONS.map((status) => (
                  <NativeSelectOption key={status.value} value={status.value}>
                    {status.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>

            <Field className="flex-1 min-w-[200px]">
              <FieldLabel>من تاريخ</FieldLabel>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>

            <Field className="flex-1 min-w-[200px]">
              <FieldLabel>إلى تاريخ</FieldLabel>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleExport}
              >
                تصدير إلى Excel
              </Button>
              <Button
                type="button"
                onClick={toggleFormVisibility}
                variant={showAddForm ? 'secondary' : 'default'}
              >
                {editingExpense
                  ? 'إلغاء التعديل'
                  : showAddForm
                  ? 'إغلاق النموذج'
                  : 'إضافة مصروف'}
              </Button>
            </div>
          </div>
          </CardContent>
        </Card>

        {showAddForm && (
          <Card>
            <CardHeader>
              <CardTitle>{editingExpense ? 'تعديل المصروف' : 'إضافة مصروف جديد'}</CardTitle>
            </CardHeader>
            <CardContent>
            {editingExpense && (
              <p className="text-sm text-muted-foreground mb-4">
                يتم تعديل المصروف: {editingExpense.title}
              </p>
            )}
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field>
                <FieldLabel>العنوان *</FieldLabel>
                <Input
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                  required
                />
              </Field>

              <Field>
                <FieldLabel>المبلغ (ر.س) *</FieldLabel>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) =>
                    setFormData({ ...formData, amount: e.target.value })
                  }
                  required
                />
              </Field>

              <Field>
                <FieldLabel>الفئة *</FieldLabel>
                <NativeSelect
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value })
                  }
                  required
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <NativeSelectOption key={cat.value} value={cat.value}>
                      {cat.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>

              <Field>
                <FieldLabel>التاريخ *</FieldLabel>
                <Input
                  type="date"
                  value={formData.expenseDate}
                  onChange={(e) =>
                    setFormData({ ...formData, expenseDate: e.target.value })
                  }
                  required
                />
              </Field>

              <Field className="md:col-span-2">
                <FieldLabel>الوصف</FieldLabel>
                <Textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={2}
                />
              </Field>

              <Field className="md:col-span-2">
                <FieldLabel>ملاحظات</FieldLabel>
                <Textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={2}
                />
              </Field>

              <div className="md:col-span-2 flex gap-2">
                <Button type="submit">
                  {editingExpense ? 'تحديث المصروف' : 'حفظ المصروف'}
                </Button>
                <Button
                  type="button"
                  onClick={handleFormCancel}
                  variant="outline"
                >
                  إلغاء
                </Button>
              </div>
            </form>
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardContent className="p-0">
          <div className="overflow-x-auto">
            {loading ? (
              <LoadingState label="جاري التحميل..." />
            ) : expenses.length === 0 ? (
              <EmptyState title="لا توجد مصروفات" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>العنوان</TableHead>
                    <TableHead>الفئة</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>بواسطة</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((expense) => (
                    <TableRow key={expense.id}>
                      <TableCell>
                        {new Date(expense.expenseDate).toLocaleDateString('ar-SA')}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{expense.title}</div>
                        {expense.description && (
                          <div className="text-muted-foreground text-xs">
                            {expense.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {getCategoryLabel(expense.category)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {Number(expense.amount).toFixed(2)} {expense.currency}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(expense.status)}>
                          {getStatusLabel(expense.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {expense.createdBy}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {(isAdmin || expense.status === 'pending') && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditClick(expense)}
                            >
                              تعديل
                            </Button>
                          )}
                          {expense.status === 'pending' && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  handleStatusChange(expense.id, 'approved')
                                }
                              >
                                اعتماد
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  handleStatusChange(expense.id, 'rejected')
                                }
                              >
                                رفض
                              </Button>
                            </>
                          )}
                          {isAdmin && (
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDelete(expense.id)}
                            >
                              حذف
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          </CardContent>
        </Card>

        {summary.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>ملخص المصروفات حسب الفئة</CardTitle>
            </CardHeader>
            <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {summary.map((item) => (
                <div
                  key={item.category}
                  className="p-4 bg-muted/40 rounded-md border"
                >
                  <div className="text-sm text-muted-foreground">
                    {getCategoryLabel(item.category)}
                  </div>
                  <div className="text-2xl font-bold text-foreground mt-1">
                    {Number(item._sum.amount).toFixed(2)} ر.س
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {item._count} مصروف
                  </div>
                </div>
              ))}
            </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppPageShell>
  );
}
