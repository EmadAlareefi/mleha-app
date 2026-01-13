'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import AppNavbar from '@/components/AppNavbar';

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
  { value: 'pending', label: 'قيد المراجعة', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'approved', label: 'معتمد', color: 'bg-green-100 text-green-800' },
  { value: 'rejected', label: 'مرفوض', color: 'bg-red-100 text-red-800' },
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

  const fetchExpenses = async () => {
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
  };

  useEffect(() => {
    fetchExpenses();
  }, [selectedCategory, selectedStatus, startDate, endDate]);

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
      fetchExpenses();
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
      fetchExpenses();
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
      fetchExpenses();
    } catch (error) {
      console.error('Error updating status:', error);
      alert('فشل في تحديث الحالة');
    }
  };

  const getCategoryLabel = (value: string) => {
    return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label || value;
  };

  const getStatusColor = (status: string) => {
    return STATUS_OPTIONS.find((s) => s.value === status)?.color || 'bg-gray-100 text-gray-800';
  };

  const getStatusLabel = (status: string) => {
    return STATUS_OPTIONS.find((s) => s.value === status)?.label || status;
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <AppNavbar />

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            إدارة المصروفات
          </h1>
          <p className="text-gray-600">تتبع وإدارة جميع مصروفات المتجر</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="p-6 bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <div className="text-sm opacity-90 mb-2">إجمالي المصروفات</div>
            <div className="text-3xl font-bold">
              {totalAmount.toFixed(2)} ر.س
            </div>
          </Card>
          <Card className="p-6 bg-gradient-to-br from-green-500 to-green-600 text-white">
            <div className="text-sm opacity-90 mb-2">عدد المصروفات</div>
            <div className="text-3xl font-bold">{total}</div>
          </Card>
          <Card className="p-6 bg-gradient-to-br from-purple-500 to-purple-600 text-white">
            <div className="text-sm opacity-90 mb-2">متوسط المصروف</div>
            <div className="text-3xl font-bold">
              {total > 0 ? (totalAmount / total).toFixed(2) : '0.00'} ر.س
            </div>
          </Card>
        </div>

        {/* Filters and Add Button */}
        <Card className="p-6 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                الفئة
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full p-2 border rounded-lg"
              >
                <option value="">جميع الفئات</option>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                الحالة
              </label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full p-2 border rounded-lg"
              >
                <option value="">جميع الحالات</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                من تاريخ
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full p-2 border rounded-lg"
              />
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                إلى تاريخ
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full p-2 border rounded-lg"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleExport}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                📥 تصدير إلى Excel
              </Button>
              <Button
                type="button"
                onClick={toggleFormVisibility}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {editingExpense
                  ? 'إلغاء التعديل'
                  : showAddForm
                  ? 'إغلاق النموذج'
                  : '➕ إضافة مصروف'}
              </Button>
            </div>
          </div>
        </Card>

        {/* Add Expense Form */}
        {showAddForm && (
          <Card className="p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">
              {editingExpense ? 'تعديل المصروف' : 'إضافة مصروف جديد'}
            </h2>
            {editingExpense && (
              <p className="text-sm text-gray-500 mb-4">
                يتم تعديل المصروف: {editingExpense.title}
              </p>
            )}
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  العنوان *
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                  className="w-full p-2 border rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  المبلغ (ر.س) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) =>
                    setFormData({ ...formData, amount: e.target.value })
                  }
                  className="w-full p-2 border rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  الفئة *
                </label>
                <select
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value })
                  }
                  className="w-full p-2 border rounded-lg"
                  required
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  التاريخ *
                </label>
                <input
                  type="date"
                  value={formData.expenseDate}
                  onChange={(e) =>
                    setFormData({ ...formData, expenseDate: e.target.value })
                  }
                  className="w-full p-2 border rounded-lg"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  الوصف
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  className="w-full p-2 border rounded-lg"
                  rows={2}
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ملاحظات
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  className="w-full p-2 border rounded-lg"
                  rows={2}
                />
              </div>

              <div className="md:col-span-2 flex gap-2">
                <Button
                  type="submit"
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {editingExpense ? 'تحديث المصروف' : 'حفظ المصروف'}
                </Button>
                <Button
                  type="button"
                  onClick={handleFormCancel}
                  className="bg-gray-500 hover:bg-gray-600 text-white"
                >
                  إلغاء
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Expenses List */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-8 text-center text-gray-500">جاري التحميل...</div>
            ) : expenses.length === 0 ? (
              <div className="p-8 text-center text-gray-500">لا توجد مصروفات</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      التاريخ
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      العنوان
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      الفئة
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      المبلغ
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      الحالة
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      بواسطة
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      إجراءات
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {expenses.map((expense) => (
                    <tr key={expense.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(expense.expenseDate).toLocaleDateString('ar-SA')}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div className="font-medium">{expense.title}</div>
                        {expense.description && (
                          <div className="text-gray-500 text-xs">
                            {expense.description}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {getCategoryLabel(expense.category)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {Number(expense.amount).toFixed(2)} {expense.currency}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs rounded-full ${getStatusColor(
                            expense.status
                          )}`}
                        >
                          {getStatusLabel(expense.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {expense.createdBy}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex gap-2">
                          {(isAdmin || expense.status === 'pending') && (
                            <button
                              onClick={() => handleEditClick(expense)}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              ✎ تعديل
                            </button>
                          )}
                          {expense.status === 'pending' && (
                            <>
                              <button
                                onClick={() =>
                                  handleStatusChange(expense.id, 'approved')
                                }
                                className="text-green-600 hover:text-green-900"
                              >
                                ✓ اعتماد
                              </button>
                              <button
                                onClick={() =>
                                  handleStatusChange(expense.id, 'rejected')
                                }
                                className="text-red-600 hover:text-red-900"
                              >
                                ✗ رفض
                              </button>
                            </>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => handleDelete(expense.id)}
                              className="text-red-600 hover:text-red-900"
                            >
                              🗑️ حذف
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Summary by Category */}
        {summary.length > 0 && (
          <Card className="p-6 mt-6">
            <h2 className="text-xl font-bold mb-4">ملخص المصروفات حسب الفئة</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {summary.map((item) => (
                <div
                  key={item.category}
                  className="p-4 bg-gray-50 rounded-lg border"
                >
                  <div className="text-sm text-gray-600">
                    {getCategoryLabel(item.category)}
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">
                    {Number(item._sum.amount).toFixed(2)} ر.س
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {item._count} مصروف
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
