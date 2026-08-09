'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SizeGuideDocument, SizeGuideField, SizeGuideIssue, SizeGuideRow } from '@/app/lib/salla-size-guides';

const FIELDS: Array<{ key: SizeGuideField; label: string }> = [
  { key: 'CHEST', label: 'الصدر' },
  { key: 'WAIST', label: 'الخصر' },
  { key: 'HIP', label: 'الورك' },
  { key: 'SHOULDER', label: 'الكتف' },
  { key: 'LENGTH', label: 'الطول' },
  { key: 'SLEEVE', label: 'الكم' },
  { key: 'BLOUSE_LEN', label: 'البلوزة' },
  { key: 'SKIRT_LEN', label: 'التنورة' },
];

type ManagedGuide = {
  id: string;
  sku: string;
  productId?: string | null;
  productName?: string | null;
  productImageUrl?: string | null;
  draftData: SizeGuideDocument;
  publishedData?: SizeGuideDocument | null;
  validationIssues?: SizeGuideIssue[] | null;
  hasIssues: boolean;
  publishedAt?: string | null;
  updatedAt: string;
};

type Pagination = { page: number; perPage: number; total: number; totalPages: number };
type Feedback = { type: 'success' | 'error'; message: string } | null;
type ImportPreview = {
  summary: {
    populatedRows: number;
    guides: number;
    publishable: number;
    blocked: number;
    warnings: number;
    skippedRows: number;
  };
  skippedRows: Array<{ row: number; message: string }>;
  issueGuides: Array<{ sku: string; canPublish: boolean; rows: number; issues: SizeGuideIssue[] }>;
};

function newRow(): SizeGuideRow {
  return {
    size: '', CHEST: '', WAIST: '', HIP: '', SHOULDER: '',
    LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '',
  };
}

function newDocument(): SizeGuideDocument {
  return { unit: 'in', twoPiece: false, rows: [newRow()] };
}

async function readResponse(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || fallback);
  return data;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function SizeGuidesPage() {
  const router = useRouter();
  const { status } = useSession();
  const [guides, setGuides] = useState<ManagedGuide[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sku, setSku] = useState('');
  const [productId, setProductId] = useState('');
  const [productName, setProductName] = useState('');
  const [draft, setDraft] = useState<SizeGuideDocument>(newDocument());
  const [editorIssues, setEditorIssues] = useState<SizeGuideIssue[]>([]);
  const [saving, setSaving] = useState(false);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [publishValid, setPublishValid] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [router, status]);

  const fetchGuides = useCallback(async () => {
    if (status !== 'authenticated') return;
    setLoading(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: '40' });
      if (query) params.set('q', query);
      if (filter !== 'all') params.set('status', filter);
      const data = await readResponse(
        await fetch(`/api/salla/size-guides?${params}`, { cache: 'no-store' }),
        'تعذر تحميل أدلة المقاسات'
      );
      setGuides(Array.isArray(data.guides) ? data.guides : []);
      setPagination(data.pagination || null);
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'تعذر تحميل الأدلة' });
    } finally {
      setLoading(false);
    }
  }, [filter, page, query, status]);

  useEffect(() => { void fetchGuides(); }, [fetchGuides]);

  const openNew = () => {
    setEditingId(null);
    setSku(''); setProductId(''); setProductName('');
    setDraft(newDocument()); setEditorIssues([]); setEditorOpen(true);
  };

  const openEdit = (guide: ManagedGuide) => {
    setEditingId(guide.id);
    setSku(guide.sku);
    setProductId(guide.productId || '');
    setProductName(guide.productName || '');
    setDraft(guide.draftData || newDocument());
    setEditorIssues(Array.isArray(guide.validationIssues) ? guide.validationIssues : []);
    setEditorOpen(true);
  };

  const updateRow = (index: number, field: 'size' | SizeGuideField, value: string) => {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row),
    }));
  };

  const saveGuide = async () => {
    setSaving(true); setFeedback(null);
    try {
      const endpoint = editingId ? `/api/salla/size-guides/${editingId}` : '/api/salla/size-guides';
      const response = await fetch(endpoint, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, productId: productId || null, productName: productName || null, data: draft }),
      });
      const data = await readResponse(response, 'تعذر حفظ دليل المقاسات');
      setEditorIssues(Array.isArray(data.guide?.validationIssues) ? data.guide.validationIssues : []);
      setEditingId(data.guide?.id || editingId);
      setFeedback({ type: 'success', message: 'تم حفظ المسودة' });
      await fetchGuides();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'تعذر الحفظ' });
    } finally {
      setSaving(false);
    }
  };

  const guideAction = async (guide: ManagedGuide, action: 'publish' | 'unpublish' | 'delete') => {
    if (action === 'delete' && !window.confirm(`حذف دليل المقاسات للمنتج ${guide.sku}؟`)) return;
    setFeedback(null);
    try {
      const endpoint = action === 'delete'
        ? `/api/salla/size-guides/${guide.id}`
        : `/api/salla/size-guides/${guide.id}/${action}`;
      await readResponse(await fetch(endpoint, { method: action === 'delete' ? 'DELETE' : 'POST' }), 'تعذر تنفيذ الإجراء');
      setFeedback({ type: 'success', message: action === 'publish' ? 'تم النشر' : action === 'unpublish' ? 'تم إلغاء النشر' : 'تم الحذف' });
      await fetchGuides();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء' });
    }
  };

  const runImport = async (mode: 'preview' | 'commit') => {
    if (!importFile) return;
    setImporting(true); setFeedback(null);
    try {
      const form = new FormData();
      form.set('file', importFile);
      form.set('mode', mode);
      form.set('publishValid', String(publishValid));
      const data = await readResponse(
        await fetch('/api/salla/size-guides/import', { method: 'POST', body: form }),
        'تعذر استيراد الملف'
      );
      setImportPreview(data);
      if (mode === 'commit') {
        setFeedback({ type: 'success', message: `تم استيراد ${data.imported} دليلاً ونشر ${data.published} دليلاً صالحاً` });
        await fetchGuides();
      }
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'تعذر الاستيراد' });
    } finally {
      setImporting(false);
    }
  };

  const blockingIssues = useMemo(
    () => editorIssues.filter((issue) => issue.severity === 'error'),
    [editorIssues]
  );

  return (
    <AppPageShell title="أدلة المقاسات" subtitle="إدارة الجداول وحاسبة المقاس في متجر سلة">
      {feedback && (
        <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="size-5" /> استيراد XLSX أو CSV</CardTitle>
          <CardDescription>يقرأ Excel من ورقة data. المعاينة لا تغير قاعدة البيانات.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="max-w-md"
              onChange={(event) => { setImportFile(event.target.files?.[0] || null); setImportPreview(null); }}
            />
            <Button variant="outline" disabled={!importFile || importing} onClick={() => void runImport('preview')}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} معاينة
            </Button>
            {importPreview && (
              <Button disabled={importing} onClick={() => void runImport('commit')}>
                <Save className="size-4" /> تنفيذ الاستيراد
              </Button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={publishValid} onCheckedChange={(checked) => setPublishValid(checked === true)} />
            نشر الأدلة الصالحة أثناء الاستيراد
          </label>
          {importPreview && (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap gap-2">
                <Badge>الصفوف: {importPreview.summary.populatedRows}</Badge>
                <Badge variant="secondary">الأدلة: {importPreview.summary.guides}</Badge>
                <Badge className="bg-emerald-600">صالحة: {importPreview.summary.publishable}</Badge>
                <Badge variant="destructive">محجوبة: {importPreview.summary.blocked}</Badge>
                <Badge variant="outline">تحذيرات: {importPreview.summary.warnings}</Badge>
              </div>
              {importPreview.issueGuides.length > 0 && (
                <div className="max-h-56 overflow-auto text-sm">
                  {importPreview.issueGuides.slice(0, 100).map((guide) => (
                    <div key={guide.sku} className="border-b py-2">
                      <strong dir="ltr">{guide.sku}</strong> — {guide.issues.map((issue) => issue.message).join('؛ ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><CardTitle>الأدلة المحفوظة</CardTitle><CardDescription>{pagination?.total || 0} دليل</CardDescription></div>
            <Button onClick={openNew}><Plus className="size-4" /> دليل جديد</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(queryInput.trim()); }}>
              <Input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="SKU أو اسم المنتج" className="w-64" />
              <Button type="submit" variant="outline"><Search className="size-4" /> بحث</Button>
            </form>
            <NativeSelect value={filter} onChange={(event) => { setPage(1); setFilter(event.target.value); }}>
              <NativeSelectOption value="all">الكل</NativeSelectOption>
              <NativeSelectOption value="published">منشور</NativeSelectOption>
              <NativeSelectOption value="draft">غير منشور</NativeSelectOption>
              <NativeSelectOption value="issues">يحتاج مراجعة</NativeSelectOption>
            </NativeSelect>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>المنتج</TableHead><TableHead>المقاسات</TableHead><TableHead>الحالة</TableHead><TableHead>آخر تحديث</TableHead><TableHead>الإجراءات</TableHead></TableRow></TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto size-5 animate-spin" /></TableCell></TableRow>
                ) : guides.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">لا توجد أدلة</TableCell></TableRow>
                ) : guides.map((guide) => (
                  <TableRow key={guide.id}>
                    <TableCell className="font-mono" dir="ltr">{guide.sku}</TableCell>
                    <TableCell>{guide.productName || guide.productId || '—'}</TableCell>
                    <TableCell>{guide.draftData?.rows?.length || 0}</TableCell>
                    <TableCell><div className="flex flex-wrap gap-1">{guide.publishedAt ? <Badge className="bg-emerald-600"><CheckCircle2 /> منشور</Badge> : <Badge variant="secondary">مسودة</Badge>}{guide.hasIssues && <Badge variant="destructive"><AlertTriangle /> مراجعة</Badge>}</div></TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{dateLabel(guide.updatedAt)}</TableCell>
                    <TableCell><div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => openEdit(guide)}><Pencil className="size-4" /></Button>
                      {guide.publishedAt
                        ? <Button size="sm" variant="outline" onClick={() => void guideAction(guide, 'unpublish')}><EyeOff className="size-4" /></Button>
                        : <Button size="sm" disabled={Boolean(guide.validationIssues?.some((issue) => issue.severity === 'error'))} onClick={() => void guideAction(guide, 'publish')}>نشر</Button>}
                      <Button size="sm" variant="ghost" onClick={() => void guideAction(guide, 'delete')}><Trash2 className="size-4 text-destructive" /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pagination && pagination.totalPages > 1 && <div className="mt-4 flex items-center justify-between"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button><span className="text-sm">{page} / {pagination.totalPages}</span><Button variant="outline" disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>التالي</Button></div>}
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[95vw]">
          <DialogHeader><DialogTitle>{editingId ? `تعديل ${sku}` : 'دليل مقاسات جديد'}</DialogTitle><DialogDescription>القيم بالنظام الحالي (إنش). يمكن حفظ النصوص للعرض، لكن الحساب يستخدم الأرقام فقط.</DialogDescription></DialogHeader>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1"><Label>SKU</Label><Input dir="ltr" value={sku} onChange={(event) => setSku(event.target.value)} /></div>
            <div className="space-y-1"><Label>رقم منتج سلة (اختياري)</Label><Input dir="ltr" value={productId} onChange={(event) => setProductId(event.target.value)} /></div>
            <div className="space-y-1"><Label>اسم المنتج (اختياري)</Label><Input value={productName} onChange={(event) => setProductName(event.target.value)} /></div>
          </div>
          {editorIssues.length > 0 && <Alert variant={blockingIssues.length ? 'destructive' : 'default'}><AlertDescription><ul className="list-disc space-y-1 pr-5">{editorIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></AlertDescription></Alert>}
          <div className="overflow-x-auto rounded-md border">
            <Table><TableHeader><TableRow><TableHead className="min-w-24">المقاس</TableHead>{FIELDS.map((field) => <TableHead key={field.key} className="min-w-24">{field.label}</TableHead>)}<TableHead /></TableRow></TableHeader>
              <TableBody>{draft.rows.map((row, index) => <TableRow key={index}>
                <TableCell><Input dir="ltr" value={row.size} onChange={(event) => updateRow(index, 'size', event.target.value)} /></TableCell>
                {FIELDS.map((field) => <TableCell key={field.key}><Input dir="ltr" value={row[field.key]} onChange={(event) => updateRow(index, field.key, event.target.value)} /></TableCell>)}
                <TableCell><Button variant="ghost" size="sm" disabled={draft.rows.length === 1} onClick={() => setDraft((current) => ({ ...current, rows: current.rows.filter((_, rowIndex) => rowIndex !== index) }))}><Trash2 className="size-4 text-destructive" /></Button></TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </div>
          <Button variant="outline" onClick={() => setDraft((current) => ({ ...current, rows: [...current.rows, newRow()] }))}><Plus className="size-4" /> إضافة مقاس</Button>
          <DialogFooter><Button variant="outline" onClick={() => setEditorOpen(false)}>إغلاق</Button><Button disabled={saving || !sku.trim()} onClick={() => void saveGuide()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} حفظ المسودة</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppPageShell>
  );
}
