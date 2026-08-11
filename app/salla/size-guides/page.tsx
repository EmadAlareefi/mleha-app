'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  EyeOff,
  FileSpreadsheet,
  LayoutList,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useToast } from '@/components/ui/use-toast';
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
  validationIssues?: SizeGuideIssue[] | null;
  hasIssues: boolean;
  publishedAt?: string | null;
  updatedAt: string;
};

type Pagination = { page: number; perPage: number; total: number; totalPages: number };
type Summary = { total: number; linked: number; published: number; drafts: number; review: number; missingFit: number };
type ImportPreview = {
  summary: {
    populatedRows: number;
    guides: number;
    publishable: number;
    blocked: number;
    warnings: number;
    skippedRows: number;
    importable?: number;
    sallaBlocked?: number;
  };
  skippedRows: Array<{ row: number; message: string }>;
  issueGuides: Array<{ sku: string; canPublish: boolean; rows: number; sallaBlocked?: boolean; issues: SizeGuideIssue[] }>;
  imported?: number;
  published?: number;
};
type ProductSearchResult = { id: number; sku?: string; name: string; imageUrl?: string | null };
type SizeOption = { id: string; name: string; values: Array<{ id: string; label: string; isOutOfStock: boolean }> };
type SallaEditorProduct = { id: string; sku: string; name: string; imageUrl: string | null; sizeOption: SizeOption };
type ProductDetailsResponse = {
  product: { id: string; sku: string; name: string; imageUrl: string | null };
  sizeOptions: SizeOption[];
  sizeOption: SizeOption | null;
  requiresOptionSelection: boolean;
  sizeOptionError: string | null;
};

function blankRow(size: string): SizeGuideRow {
  return {
    size, CHEST: '', WAIST: '', HIP: '', SHOULDER: '',
    LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '',
  };
}

function emptyDocument(): SizeGuideDocument {
  return { unit: 'in', twoPiece: false, rows: [] };
}

function sizeKey(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
}

function reconcileRows(rows: SizeGuideRow[], labels: string[]) {
  const bySize = new Map(rows.map((row) => [sizeKey(row.size), row]));
  const nextKeys = new Set(labels.map(sizeKey));
  return {
    rows: labels.map((label) => bySize.has(sizeKey(label)) ? { ...bySize.get(sizeKey(label))!, size: label } : blankRow(label)),
    added: labels.filter((label) => !bySize.has(sizeKey(label))),
    removed: rows.filter((row) => !nextKeys.has(sizeKey(row.size))),
  };
}

async function responseData(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || fallback) as Error & { data?: unknown };
    error.data = data;
    throw error;
  }
  return data;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium' }).format(new Date(value));
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

export default function SizeGuidesPage() {
  const router = useRouter();
  const { status } = useSession();
  const { toast } = useToast();
  const [guides, setGuides] = useState<ManagedGuide[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [summary, setSummary] = useState<Summary>({ total: 0, linked: 0, published: 0, drafts: 0, review: 0, missingFit: 0 });
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [linkFilter, setLinkFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionId, setActionId] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [publishValid, setPublishValid] = useState(true);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editingGuide, setEditingGuide] = useState<ManagedGuide | null>(null);
  const [editorProduct, setEditorProduct] = useState<SallaEditorProduct | null>(null);
  const [draft, setDraft] = useState<SizeGuideDocument>(emptyDocument());
  const [editorIssues, setEditorIssues] = useState<SizeGuideIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<ProductDetailsResponse | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [router, status]);

  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setQuery(queryInput.trim()); }, 300);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const fetchGuides = useCallback(async () => {
    if (status !== 'authenticated') return;
    setLoading(true);
    setPageError(null);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: '40' });
      if (query) params.set('q', query);
      if (filter !== 'all') params.set('status', filter);
      if (linkFilter !== 'all') params.set('link', linkFilter);
      const data = await responseData(await fetch(`/api/salla/size-guides?${params}`, { cache: 'no-store' }), 'تعذر تحميل الأدلة');
      setGuides(Array.isArray(data.guides) ? data.guides : []);
      setPagination(data.pagination || null);
      if (data.summary) setSummary(data.summary);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'تعذر تحميل الأدلة');
    } finally {
      setLoading(false);
    }
  }, [filter, linkFilter, page, query, status]);

  useEffect(() => { void fetchGuides(); }, [fetchGuides]);

  const notify = (description: string, destructive = false) => toast({ description, variant: destructive ? 'destructive' : 'default' });

  const chooseStatus = (value: string) => {
    setPage(1);
    setFilter((current) => current === value && value !== 'all' ? 'all' : value);
  };

  const openNew = () => {
    setEditingGuide(null);
    setEditorProduct(null);
    setDraft(emptyDocument());
    setEditorIssues([]);
    setProductQuery('');
    setProductResults([]);
    setPendingProduct(null);
    setEditorOpen(true);
  };

  const applyProduct = (details: ProductDetailsResponse, option: SizeOption) => {
    const nextProduct: SallaEditorProduct = { ...details.product, sizeOption: option };
    const next = reconcileRows(draft.rows, option.values.map((value) => value.label));
    if (editorProduct && editorProduct.id !== nextProduct.id && !window.confirm('تغيير المنتج سيعيد مزامنة المقاسات. هل تريد المتابعة؟')) return;
    if (next.removed.length && !window.confirm(`ستُحذف قياسات: ${next.removed.map((row) => row.size).join('، ')}. هل تريد المتابعة؟`)) return;
    setEditorProduct(nextProduct);
    setDraft({ unit: 'in', twoPiece: draft.twoPiece, sallaSizeOptionId: option.id, rows: next.rows });
    setPendingProduct(null);
    setEditorIssues([]);
  };

  const loadProduct = async (identifier: { productId?: string; sku?: string }, optionId?: string, baseRows?: SizeGuideRow[]) => {
    const params = new URLSearchParams();
    if (identifier.productId) params.set('productId', identifier.productId);
    if (identifier.sku) params.set('sku', identifier.sku);
    if (optionId) params.set('optionId', optionId);
    const data = await responseData(
      await fetch(`/api/salla/size-guides/salla-product?${params}`, { cache: 'no-store' }),
      'تعذر تحميل مقاسات المنتج من سلة'
    ) as ProductDetailsResponse;
    if (baseRows) setDraft((current) => ({ ...current, rows: baseRows }));
    if (data.sizeOptionError) throw new Error(data.sizeOptionError);
    if (data.requiresOptionSelection || !data.sizeOption) {
      setPendingProduct(data);
      setSelectedOptionId(data.sizeOptions[0]?.id || '');
      return null;
    }
    return data;
  };

  const openEdit = async (guide: ManagedGuide) => {
    setEditingGuide(guide);
    setEditorProduct(null);
    setDraft(guide.draftData || emptyDocument());
    setEditorIssues(Array.isArray(guide.validationIssues) ? guide.validationIssues : []);
    setProductResults([]);
    setProductQuery('');
    setPendingProduct(null);
    setEditorOpen(true);
    setEditorLoading(true);
    try {
      const details = await loadProduct(
        guide.productId ? { productId: guide.productId } : { sku: guide.sku },
        guide.draftData?.sallaSizeOptionId,
        guide.draftData?.rows || []
      );
      if (details?.sizeOption) {
        const sync = reconcileRows(guide.draftData?.rows || [], details.sizeOption.values.map((value) => value.label));
        if (sync.removed.length && !window.confirm(`حُذفت من سلة المقاسات: ${sync.removed.map((row) => row.size).join('، ')}. حذف بياناتها وفتح الدليل؟`)) {
          setEditorOpen(false);
          return;
        }
        setEditorProduct({ ...details.product, sizeOption: details.sizeOption });
        setDraft({ unit: 'in', twoPiece: guide.draftData?.twoPiece || false, sallaSizeOptionId: details.sizeOption.id, rows: sync.rows });
        if (!guide.productId) notify('تم العثور على المنتج المطابق في سلة؛ احفظ الدليل لإتمام الربط');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذر تحميل منتج سلة', true);
    } finally {
      setEditorLoading(false);
    }
  };

  const searchProducts = async () => {
    if (!productQuery.trim()) return;
    setProductSearching(true);
    try {
      const params = new URLSearchParams({ keyword: productQuery.trim(), perPage: '20', page: '1' });
      const data = await responseData(await fetch(`/api/salla/products?${params}`, { cache: 'no-store' }), 'تعذر البحث في منتجات سلة');
      setProductResults(Array.isArray(data.products) ? data.products : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذر البحث في المنتجات', true);
    } finally {
      setProductSearching(false);
    }
  };

  const selectSearchProduct = async (product: ProductSearchResult) => {
    setEditorLoading(true);
    try {
      const details = await loadProduct({ productId: String(product.id) });
      if (details?.sizeOption) applyProduct(details, details.sizeOption);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذر قراءة مقاسات المنتج', true);
    } finally {
      setEditorLoading(false);
    }
  };

  const updateCell = (rowIndex: number, field: SizeGuideField, value: string) => {
    setDraft((current) => ({ ...current, rows: current.rows.map((row, index) => index === rowIndex ? { ...row, [field]: value } : row) }));
  };

  const fillMeasure = (field: SizeGuideField) => {
    const values = draft.rows.map((row) => {
      const parsed = Number.parseFloat(row[field]);
      return Number.isFinite(parsed) ? parsed : null;
    });
    const first = values.findIndex((value) => value != null);
    if (first < 0) return notify('أدخل قيمة في أول مقاس ثم اضغط زر التعبئة', true);
    const second = values.findIndex((value, index) => index > first && value != null);
    const step = second > first ? (values[second]! - values[first]!) / (second - first) : 2;
    let filled = 0;
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row, index) => {
        if (index <= first || row[field].trim()) return row;
        filled += 1;
        return { ...row, [field]: String(Number((values[first]! + step * (index - first)).toFixed(1))) };
      }),
    }));
    notify(filled ? `تمت تعبئة ${filled} مقاس` : 'كل المقاسات معبأة');
  };

  const handleCellKey = (event: React.KeyboardEvent<HTMLInputElement>, row: number, column: number) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'Enter'].includes(event.key)) return;
    let nextRow = row;
    let nextColumn = column;
    if (event.key === 'ArrowUp') nextRow -= 1;
    if (event.key === 'ArrowDown' || event.key === 'Enter') nextRow += 1;
    if (event.key === 'ArrowRight') nextColumn -= 1;
    if (event.key === 'ArrowLeft') nextColumn += 1;
    const next = document.querySelector<HTMLInputElement>(`[data-size-cell="${nextRow}-${nextColumn}"]`);
    if (next) { event.preventDefault(); next.focus(); next.select(); }
  };

  const saveGuide = async (publish: boolean) => {
    if (!editorProduct) return notify('اختر منتجاً من سلة أولاً', true);
    setSaving(true);
    try {
      const endpoint = editingGuide ? `/api/salla/size-guides/${editingGuide.id}` : '/api/salla/size-guides';
      const data = await responseData(await fetch(endpoint, {
        method: editingGuide ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: editorProduct.id, data: draft }),
      }), 'تعذر حفظ دليل المقاسات');
      const saved = data.guide as ManagedGuide;
      setEditorIssues(Array.isArray(saved.validationIssues) ? saved.validationIssues : []);
      if (publish) {
        if (!data.canPublish) return notify('تم حفظ المسودة، لكن يجب تصحيح الأخطاء قبل النشر', true);
        await responseData(await fetch(`/api/salla/size-guides/${saved.id}/publish`, { method: 'POST' }), 'تعذر نشر الدليل');
      }
      notify(publish ? 'تم حفظ الدليل ونشره' : 'تم حفظ المسودة');
      setEditorOpen(false);
      await fetchGuides();
    } catch (error) {
      const details = (error as Error & { data?: { issues?: SizeGuideIssue[] } }).data;
      if (Array.isArray(details?.issues)) setEditorIssues(details.issues);
      notify(error instanceof Error ? error.message : 'تعذر حفظ الدليل', true);
    } finally {
      setSaving(false);
    }
  };

  const guideAction = async (guide: ManagedGuide, action: 'publish' | 'unpublish' | 'delete') => {
    if (action === 'delete' && !window.confirm(`حذف دليل المقاسات للمنتج ${guide.sku} بالكامل؟`)) return;
    setActionId(guide.id);
    try {
      const endpoint = action === 'delete' ? `/api/salla/size-guides/${guide.id}` : `/api/salla/size-guides/${guide.id}/${action}`;
      await responseData(await fetch(endpoint, { method: action === 'delete' ? 'DELETE' : 'POST' }), 'تعذر تنفيذ الإجراء');
      setSelected((current) => { const next = new Set(current); next.delete(guide.id); return next; });
      notify(action === 'publish' ? 'تم نشر الدليل' : action === 'unpublish' ? 'تم إلغاء النشر' : 'تم حذف الدليل');
      await fetchGuides();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء', true);
    } finally {
      setActionId(null);
    }
  };

  const publishSelected = async () => {
    if (!selected.size) return notify('حدد دليلاً واحداً على الأقل', true);
    setActionId('bulk');
    try {
      const data = await responseData(await fetch('/api/salla/size-guides/publish-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: Array.from(selected) }),
      }), 'تعذر نشر الأدلة المحددة');
      const published = Array.isArray(data.published) ? data.published.length : 0;
      const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
      notify(skipped ? `تم نشر ${published} وتجاوز ${skipped} دليل` : `تم نشر ${published} دليل`);
      setSelected(new Set());
      await fetchGuides();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذر النشر الجماعي', true);
    } finally {
      setActionId(null);
    }
  };

  const runImport = async (mode: 'preview' | 'commit') => {
    if (!importFile) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.set('file', importFile);
      form.set('mode', mode);
      form.set('publishValid', String(publishValid));
      const data = await responseData(await fetch('/api/salla/size-guides/import', { method: 'POST', body: form }), 'تعذر استيراد الملف');
      setImportPreview(data);
      if (mode === 'commit') {
        notify(`تم استيراد ${data.imported} دليل ونشر ${data.published} دليل`);
        await fetchGuides();
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذر استيراد الملف', true);
    } finally {
      setImporting(false);
    }
  };

  const allVisibleSelected = guides.length > 0 && guides.every((guide) => selected.has(guide.id));
  const hasFitMeasurement = draft.rows.some((row) => [row.CHEST, row.WAIST].some((value) => {
    const parsed = Number(value);
    return value.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;
  }));
  const blockingIssues = useMemo(() => editorIssues.filter((issue) => issue.severity === 'error'), [editorIssues]);

  return (
    <AppPageShell
      title="أدلة المقاسات"
      subtitle="جدول موحّد بأدلة قياسات المنتجات وربطها بمتجر سلة ثم نشرها"
      contentClassName="flex flex-1 flex-col bg-[#FAF7F1] p-4 md:p-6"
    >
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 text-[#2E2A22]">
        {pageError && <Alert variant="destructive"><AlertDescription>{pageError}</AlertDescription></Alert>}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="إجمالي الأدلة" value={summary.total} subtitle={`${summary.linked} منها مربوط بسلة`} icon={<LayoutList />} active={filter === 'all'} color="accent" onClick={() => chooseStatus('all')} />
          <StatCard title="منشورة" value={summary.published} subtitle={`${percent(summary.published, summary.total)}%`} progress={percent(summary.published, summary.total)} icon={<Check />} active={filter === 'published'} color="green" onClick={() => chooseStatus('published')} />
          <StatCard title="مسودات" value={summary.drafts} subtitle={`${percent(summary.drafts, summary.total)}%`} progress={percent(summary.drafts, summary.total)} icon={<Pencil />} active={filter === 'draft'} color="amber" onClick={() => chooseStatus('draft')} />
          <StatCard title="تحتاج مراجعة" value={summary.review} subtitle={`${summary.missingFit} دليل ناقص القياسات`} icon={<AlertTriangle />} active={filter === 'issues'} color="red" onClick={() => chooseStatus('issues')} />
        </section>

        <section className="grid overflow-hidden rounded-[14px] border border-[#EADFCB] bg-white shadow-[0_1px_2px_rgba(46,42,34,.06),0_6px_20px_rgba(46,42,34,.05)] lg:grid-cols-[1.3fr_1fr]">
          <div className="p-4 md:p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-[#E7EFFA] text-[#3E6DB0]"><Upload className="size-5" /></span>
              <div><h2 className="font-extrabold">استيراد الأدلة</h2><p className="text-xs text-[#8C8474]">ارفع CSV أو Excel؛ تتم معاينته والتحقق منه مع سلة أولاً</p></div>
            </div>
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition ${dragging ? 'border-[#7A6A4C] bg-[#EFE7D7]' : 'border-[#EADFCB] bg-[#FDFBF7] hover:border-[#7A6A4C]'}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) { setImportFile(file); setImportPreview(null); } }}
            >
              <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => { setImportFile(event.target.files?.[0] || null); setImportPreview(null); }} />
              <FileSpreadsheet className="size-8 text-[#7A6A4C]" />
              <span className="font-semibold">{importFile ? importFile.name : 'اسحب الملف هنا أو اختر ملفاً'}</span>
              <span className="text-xs text-[#8C8474]">CSV / XLSX / XLS حتى 5 MB و100 منتج</span>
            </label>
            <details className="mt-3 text-xs text-[#8C8474]">
              <summary className="cursor-pointer font-semibold">الصيغة المتوقعة للأعمدة</summary>
              <div className="mt-2 flex flex-wrap gap-1.5" dir="ltr">{['sku','salla_product_id','name','size','chest','waist','hip','shoulder','length','sleeve','blouse','skirt'].map((column) => <code key={column} className="rounded bg-[#EFE7D7] px-2 py-1 text-[#63563C]">{column}</code>)}</div>
            </details>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={!importFile || importing} onClick={() => void runImport('preview')}>{importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} معاينة</Button>
              {importPreview && <Button disabled={importing} className="bg-[#7A6A4C] hover:bg-[#63563C]" onClick={() => void runImport('commit')}>تنفيذ الاستيراد</Button>}
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={publishValid} onCheckedChange={(checked) => setPublishValid(checked === true)} /> نشر الصالح تلقائياً</label>
            </div>
          </div>
          <div className="border-t border-[#F0E8D8] bg-[#FDFBF7] p-4 md:p-5 lg:border-r lg:border-t-0">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-[#E4F3EA] text-[#2F9E6B]"><Download className="size-5" /></span>
              <div><h2 className="font-extrabold">تصدير الأدلة</h2><p className="text-xs text-[#8C8474]">نزّل كل الأدلة كملف CSV للأرشفة أو المشاركة</p></div>
            </div>
            <p className="mb-4 text-sm"><strong className="text-2xl text-[#63563C]">{summary.total}</strong> دليل جاهز للتصدير</p>
            <Button asChild className="bg-[#7A6A4C] hover:bg-[#63563C]"><Link href="/api/salla/size-guides/export"><Download className="size-4" /> تنزيل ملف CSV</Link></Button>
            {importPreview && <ImportSummary preview={importPreview} />}
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[#EADFCB] bg-white p-3 shadow-sm md:p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#8C8474]" />
            <Input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="ابحث برمز المنتج أو الاسم…" className="border-[#EADFCB] bg-[#FDFBF7] pr-9" />
          </div>
          <NativeSelect value={filter} onChange={(event) => { setPage(1); setFilter(event.target.value); }} className="border-[#EADFCB] bg-[#FDFBF7]">
            <NativeSelectOption value="all">كل الحالات</NativeSelectOption><NativeSelectOption value="published">منشور</NativeSelectOption><NativeSelectOption value="draft">مسودة</NativeSelectOption><NativeSelectOption value="issues">مراجعة</NativeSelectOption>
          </NativeSelect>
          <NativeSelect value={linkFilter} onChange={(event) => { setPage(1); setLinkFilter(event.target.value); }} className="border-[#EADFCB] bg-[#FDFBF7]">
            <NativeSelectOption value="all">الكل (الربط بسلة)</NativeSelectOption><NativeSelectOption value="linked">مربوط بسلة</NativeSelectOption><NativeSelectOption value="unlinked">غير مربوط</NativeSelectOption>
          </NativeSelect>
          <Button variant="outline" disabled={!selected.size || actionId === 'bulk'} onClick={() => void publishSelected()}>{actionId === 'bulk' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} نشر المحدد</Button>
          <Button className="bg-[#7A6A4C] hover:bg-[#63563C]" onClick={openNew}><Plus className="size-4" /> منتج جديد</Button>
        </section>

        <section className="overflow-hidden rounded-[14px] border border-[#EADFCB] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#F0E8D8] px-4 py-3"><h2 className="font-bold">الأدلة المحفوظة</h2><span className="text-xs text-[#8C8474]">{pagination?.total || 0} دليل</span></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm md:min-w-0">
              <thead className="bg-[#FCFAF5] text-xs text-[#8C8474]"><tr>
                <th className="w-10 px-3 py-3 text-center max-md:hidden"><Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); guides.forEach((guide) => checked === true ? next.add(guide.id) : next.delete(guide.id)); return next; })} /></th>
                <th className="px-3 py-3 text-right">رمز المنتج</th><th className="px-3 py-3 text-center">عدد المقاسات</th><th className="px-3 py-3 text-center">الحالة</th><th className="px-3 py-3 text-right max-md:hidden">آخر تحديث</th><th className="px-3 py-3 text-left">الإجراءات</th>
              </tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={6} className="py-14 text-center"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr> : guides.length === 0 ? <tr><td colSpan={6} className="py-14 text-center text-[#8C8474]">لا توجد نتائج مطابقة.</td></tr> : guides.map((guide) => (
                  <tr key={guide.id} className="border-t border-[#F0E8D8] hover:bg-[#FDFBF6]">
                    <td className="px-3 py-3 text-center max-md:hidden"><Checkbox checked={selected.has(guide.id)} onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); if (checked === true) next.add(guide.id); else next.delete(guide.id); return next; })} /></td>
                    <td className="px-3 py-3"><div className="flex flex-wrap items-center gap-1.5 font-bold" dir="ltr"><span>{guide.sku}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${guide.productId ? 'bg-[#E7EFFA] text-[#3E6DB0]' : 'bg-[#F0EEE9] text-[#8C8474]'}`}>{guide.productId ? 'مربوط بسلة' : 'غير مربوط'}</span>{guide.hasIssues && <span className="text-[10px] text-[#D14B4B]">⚠ يحتاج مراجعة</span>}</div><div className="mt-1 text-xs text-[#8C8474]">{guide.productName || 'بدون اسم'}{guide.productId ? ` · سلة #${guide.productId}` : ''}</div></td>
                    <td className="px-3 py-3 text-center"><span className="inline-block min-w-9 rounded-full bg-[#EFE7D7] px-2 py-1 font-bold text-[#63563C]">{guide.draftData?.rows?.length || 0}</span></td>
                    <td className="px-3 py-3 text-center"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${guide.publishedAt ? 'bg-[#E4F3EA] text-[#2F9E6B]' : guide.hasIssues ? 'bg-[#FBE7E7] text-[#D14B4B]' : 'bg-[#F6ECD6] text-[#A9812F]'}`}>{guide.publishedAt ? 'منشور' : guide.hasIssues ? 'مراجعة' : 'مسودة'}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-[#8C8474] max-md:hidden">{dateLabel(guide.updatedAt)}</td>
                    <td className="px-3 py-3"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" title="تعديل" disabled={actionId === guide.id} onClick={() => void openEdit(guide)}><Pencil className="size-4" /><span className="max-sm:hidden">تعديل</span></Button>{guide.publishedAt ? <Button size="sm" variant="outline" title="إلغاء النشر" disabled={actionId === guide.id} onClick={() => void guideAction(guide, 'unpublish')}><EyeOff className="size-4" /></Button> : <Button size="sm" className="bg-[#2F9E6B] hover:bg-[#277f58]" disabled={actionId === guide.id || Boolean(guide.validationIssues?.some((issue) => issue.severity === 'error')) || !guide.productId} onClick={() => void guideAction(guide, 'publish')}><Send className="size-4" /><span className="max-sm:hidden">نشر</span></Button>}<Button size="sm" variant="ghost" title="حذف" disabled={actionId === guide.id} onClick={() => void guideAction(guide, 'delete')}><Trash2 className="size-4 text-[#D14B4B]" /></Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.totalPages > 1 && <div className="flex items-center justify-between border-t border-[#F0E8D8] px-4 py-3"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronRight className="size-4" /> السابق</Button><span className="text-xs text-[#8C8474]">{page} / {pagination.totalPages}</span><Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>التالي <ChevronLeft className="size-4" /></Button></div>}
        </section>
      </div>

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent side="left" className="w-full gap-0 border-[#EADFCB] bg-white p-0 sm:max-w-[680px]" dir="rtl">
          <SheetHeader className="border-b border-[#F0E8D8] px-5 py-4 text-right">
            <SheetTitle>{editingGuide ? `تعديل الدليل — ${editingGuide.sku}` : 'منتج جديد'}</SheetTitle>
            <SheetDescription>{editorProduct ? `${editorProduct.name} · سلة #${editorProduct.id}` : 'ابحث عن منتج سلة لاستخراج مقاساته'}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 md:p-5">
            {editorLoading && <div className="grid min-h-40 place-items-center"><Loader2 className="size-6 animate-spin text-[#7A6A4C]" /></div>}
            {!editorLoading && (!editorProduct || pendingProduct) && <div className="space-y-4">
              {pendingProduct && <div className="rounded-xl border border-[#EADFCB] bg-[#FCFAF5] p-4"><p className="mb-3 font-bold">اختر خيار المقاس للمنتج {pendingProduct.product.name}</p><NativeSelect value={selectedOptionId} onChange={(event) => setSelectedOptionId(event.target.value)}>{pendingProduct.sizeOptions.map((option) => <NativeSelectOption key={option.id} value={option.id}>{option.name} ({option.values.length})</NativeSelectOption>)}</NativeSelect><Button className="mt-3 bg-[#7A6A4C] hover:bg-[#63563C]" disabled={!selectedOptionId} onClick={() => { const option = pendingProduct.sizeOptions.find((entry) => entry.id === selectedOptionId); if (option) applyProduct(pendingProduct, option); }}>اعتماد الخيار</Button></div>}
              <div><h3 className="mb-2 font-extrabold text-[#63563C]">اختيار منتج سلة</h3><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void searchProducts(); }}><Input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="اسم المنتج أو SKU" /><Button type="submit" disabled={productSearching}>{productSearching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} بحث</Button></form></div>
              <div className="space-y-2">{productResults.map((product) => <button key={product.id} type="button" className="flex w-full items-center justify-between rounded-xl border border-[#EADFCB] bg-[#FDFBF7] p-3 text-right transition hover:border-[#7A6A4C]" onClick={() => void selectSearchProduct(product)}><span><strong>{product.name}</strong><small className="mt-1 block text-[#8C8474]" dir="ltr">{product.sku || 'بدون SKU'} · #{product.id}</small></span><ChevronLeft className="size-4" /></button>)}</div>
            </div>}
            {!editorLoading && editorProduct && !pendingProduct && <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EADFCB] bg-[#FCFAF5] p-3"><div><strong>{editorProduct.name}</strong><div className="text-xs text-[#8C8474]" dir="ltr">SKU {editorProduct.sku} · #{editorProduct.id}</div></div><Button variant="outline" size="sm" onClick={() => { if (!window.confirm('تغيير المنتج سيعيد مزامنة قائمة المقاسات وقد يحذف قياسات غير موجودة في المنتج الجديد. هل تريد المتابعة؟')) return; setProductResults([]); setProductQuery(''); setEditorProduct(null); }}>تغيير المنتج</Button></div>
              {!hasFitMeasurement && <Alert variant="destructive" className="mb-3"><AlertDescription>يجب إدخال قياس رقمي واحد على الأقل للصدر أو الخصر قبل النشر.</AlertDescription></Alert>}
              {editorIssues.length > 0 && <Alert variant={blockingIssues.length ? 'destructive' : 'default'} className="mb-3"><AlertDescription><ul className="list-disc space-y-1 pr-5">{editorIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></AlertDescription></Alert>}
              <h3 className="mb-2 font-extrabold text-[#63563C]">القياسات (بالإنش)</h3>
              <div className="overflow-x-auto rounded-xl border border-[#EADFCB]">
                <table className="w-full table-fixed border-collapse" style={{ minWidth: Math.max(540, 115 + draft.rows.length * 82) }}>
                  <thead><tr className="bg-[#FCFAF5] text-xs text-[#8C8474]"><th className="w-28 px-2 py-2 text-right">القياس</th>{draft.rows.map((row) => <th key={row.size} className="px-1 py-2 text-center" dir="ltr">{row.size}</th>)}</tr></thead>
                  <tbody>{FIELDS.map((field, fieldIndex) => <tr key={field.key} className="border-t border-[#F0E8D8] hover:bg-[#FDFBF6]"><td className="whitespace-nowrap px-2 py-2 text-sm font-bold">{field.label}<button type="button" className="mr-1 inline-grid size-6 place-items-center rounded border border-[#EADFCB] text-xs text-[#7A6A4C] hover:bg-[#EFE7D7]" title="تعبئة باقي المقاسات" onClick={() => fillMeasure(field.key)}>⇢</button></td>{draft.rows.map((row, rowIndex) => <td key={`${row.size}-${field.key}`} className="p-1"><Input dir="ltr" inputMode="decimal" data-size-cell={`${fieldIndex}-${rowIndex}`} value={row[field.key]} onChange={(event) => updateCell(rowIndex, field.key, event.target.value)} onKeyDown={(event) => handleCellKey(event, fieldIndex, rowIndex)} className="h-9 min-w-16 border-[#F0E8D8] px-1 text-center focus-visible:border-[#7A6A4C]" /></td>)}</tr>)}</tbody>
                </table>
              </div>
              <p className="mt-3 text-xs leading-6 text-[#8C8474]">اترك أي قياس فارغاً إن لم ينطبق. اكتب قيمة أصغر مقاس ثم اضغط ⇢ لتعبئة الباقي، وتنقّل بالأسهم أو Enter.</p>
            </div>}
          </div>
          <SheetFooter className="flex-row flex-wrap border-t border-[#F0E8D8] bg-white px-5 py-4">
            <Button disabled={saving || !editorProduct} className="bg-[#7A6A4C] hover:bg-[#63563C]" onClick={() => void saveGuide(false)}>{saving ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />} حفظ كمسودة</Button>
            <Button disabled={saving || !editorProduct || !hasFitMeasurement} variant="outline" className="border-[#B8DCC7] text-[#2F9E6B] hover:bg-[#E4F3EA]" onClick={() => void saveGuide(true)}><Send className="size-4" /> حفظ ونشر</Button>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>إلغاء</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </AppPageShell>
  );
}

function StatCard({ title, value, subtitle, progress, icon, active, color, onClick }: { title: string; value: number; subtitle: string; progress?: number; icon: React.ReactNode; active: boolean; color: 'accent' | 'green' | 'amber' | 'red'; onClick: () => void }) {
  const colors = {
    accent: { icon: 'bg-[#EFE7D7] text-[#63563C]', text: 'text-[#2E2A22]', border: 'border-[#7A6A4C]', bar: 'bg-[#7A6A4C]' },
    green: { icon: 'bg-[#E4F3EA] text-[#2F9E6B]', text: 'text-[#2F9E6B]', border: 'border-[#2F9E6B]', bar: 'bg-[#2F9E6B]' },
    amber: { icon: 'bg-[#F6ECD6] text-[#A9812F]', text: 'text-[#A9812F]', border: 'border-[#A9812F]', bar: 'bg-[#A9812F]' },
    red: { icon: 'bg-[#FBE7E7] text-[#D14B4B]', text: 'text-[#D14B4B]', border: 'border-[#D14B4B]', bar: 'bg-[#D14B4B]' },
  }[color];
  return <button type="button" onClick={onClick} className={`rounded-[14px] bg-white p-4 text-right shadow-[0_1px_2px_rgba(46,42,34,.06),0_6px_20px_rgba(46,42,34,.05)] transition hover:-translate-y-0.5 hover:shadow-lg ${active ? `border-2 ${colors.border}` : 'border border-[#EADFCB]'}`}><div className="flex items-center gap-3"><span className={`grid size-11 place-items-center rounded-xl [&>svg]:size-5 ${colors.icon}`}>{icon}</span><div><span className="block text-xs text-[#8C8474]">{title}</span><strong className={`text-2xl leading-none ${colors.text}`}>{value}</strong></div></div><div className="mt-3 flex min-h-4 items-center gap-2 text-[11px] text-[#8C8474]">{progress != null && <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#ECE4D3]"><span className={`block h-full rounded-full ${colors.bar}`} style={{ width: `${progress}%` }} /></span>}<span>{subtitle}</span></div></button>;
}

function ImportSummary({ preview }: { preview: ImportPreview }) {
  return <div className="mt-5 space-y-2 border-t border-[#EADFCB] pt-4 text-xs"><div className="flex flex-wrap gap-1"><Badge variant="outline">الصفوف {preview.summary.populatedRows}</Badge><Badge variant="secondary">الأدلة {preview.summary.guides}</Badge><Badge className="bg-[#2F9E6B]">صالحة {preview.summary.publishable}</Badge><Badge variant="destructive">محجوبة {preview.summary.blocked}</Badge></div>{preview.issueGuides.length > 0 && <div className="max-h-40 overflow-y-auto rounded-lg border bg-white p-2">{preview.issueGuides.slice(0, 100).map((guide) => <div key={guide.sku} className="border-b py-1.5 last:border-0"><strong dir="ltr">{guide.sku}</strong> — {guide.issues.map((issue) => issue.message).join('؛ ')}</div>)}</div>}</div>;
}
