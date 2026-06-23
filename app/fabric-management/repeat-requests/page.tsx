'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { LoadingState } from '@/components/dashboard/states';
import './repeat-requests.css';

const API = '/api/fabric-management/repeat-requests';

const STAGES = ['', 'مطلوب', 'تم الطلب', 'تم الصنع', 'تم الشحن', 'متوفر'];
const STAGE_ICONS = ['', '📋', '📝', '⚙️', '🚚', '📦'];

const RESET_OPTS = [
  { id: 'stage', label: 'مرحلة الطلب', sub: 'إعادة المرحلة إلى "لا شيء"' },
  { id: 'count', label: 'العداد', sub: 'تصفير العدد الكلي وعدادات المقاسات' },
  { id: 'dates', label: 'التواريخ', sub: 'حذف تاريخ التكرار وتاريخ الوصول' },
  { id: 'notes', label: 'الملاحظات', sub: 'مسح جميع ملاحظات الفريق' },
  { id: 'log', label: 'السجل', sub: 'مسح سجل التعديلات' },
];

type SizeRow = { id: string; label: string; count: number };
type NoteRow = {
  id: string;
  authorName: string;
  message: string;
  edited: boolean;
  createdAt: string;
  updatedAt: string;
};
type LogRow = { id: string; actor: string; action: string; detail: string | null; createdAt: string };
type RepeatRequest = {
  id: string;
  designModelId: string;
  sku: string;
  imageData: string | null;
  tailorId: string | null;
  tailorName: string | null;
  stage: number;
  modelCount: number;
  totalCount: number;
  repeatDate: string | null;
  arrivalDate: string | null;
  inStock: boolean;
  pinned: boolean;
  updatedAt: string;
  sizes: SizeRow[];
  notes: NoteRow[];
  logs: LogRow[];
};
type AvailableModel = { id: string; sku: string; size: string | null; imageData: string | null };
type Tailor = { id: string; name: string };
type ApiData = {
  requests: RepeatRequest[];
  availableModels: AvailableModel[];
  tailors: Tailor[];
  stats: { models: number; totalRequests: number; waiting: number; inStock: number };
};

/* ---------------- helpers ---------------- */
function statusOf(r: RepeatRequest) {
  if (r.stage >= 5) return 'green';
  if (r.stage >= 3) return 'blue';
  if (r.stage >= 1) return 'orange';
  return 'gray';
}
function fmtDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function fmtDateFull(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return [d.getDate(), d.getMonth() + 1, d.getFullYear()].map((x) => String(x).padStart(2, '0')).join('/');
}
function dateInputValue(iso: string | null) {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}
function daysLeft(iso: string | null) {
  if (!iso) return null;
  const t = new Date(iso);
  t.setHours(0, 0, 0, 0);
  const n = new Date();
  n.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - n.getTime()) / 86400000);
}
function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'منذ يوم';
  if (days < 30) return `منذ ${days} أيام`;
  return `منذ ${Math.floor(days / 30)} شهر`;
}

export default function RepeatRequestsPage() {
  const { data: session } = useSession();
  const user = session?.user as { username?: string; name?: string; role?: string; roles?: string[] } | undefined;
  const currentActor = user?.username || user?.name || 'admin';
  const roles = user?.roles || (user?.role ? [user.role] : []);
  const canManage = roles.includes('admin') || roles.includes('store_manager');

  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [activeFilter, setActiveFilter] = useState<'all' | 'has' | 'waiting' | 'stock'>('all');
  const [activeSort, setActiveSort] = useState<'sku' | 'requests' | 'arrival' | 'modified' | 'status'>('sku');
  const [search, setSearch] = useState('');

  const [activeId, setActiveId] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<'all' | 'counters' | 'dates' | 'availability' | 'notes'>('all');
  const [logUser, setLogUser] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [createModelId, setCreateModelId] = useState('');
  const [createTailorId, setCreateTailorId] = useState('');
  const [createSizes, setCreateSizes] = useState('S, M, L, XL');

  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [resetSections, setResetSections] = useState<Record<string, boolean>>({});
  const [pendCounterReset, setPendCounterReset] = useState<{ target: string; label: string } | null>(null);

  const [noteText, setNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2400);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(API);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل في جلب البيانات');
      setData(json as ApiData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل في جلب البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const act = useCallback(
    async (payload: Record<string, unknown>, okMsg?: string) => {
      setBusy(true);
      try {
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'فشل تنفيذ الإجراء');
        await fetchData();
        if (okMsg) toast(okMsg);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'فشل تنفيذ الإجراء');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [fetchData, toast]
  );

  const active = useMemo(
    () => data?.requests.find((r) => r.id === activeId) || null,
    [data, activeId]
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase().trim();
    const list = data.requests.filter((r) => {
      if (q && !r.sku.toLowerCase().includes(q)) return false;
      if (activeFilter === 'has') return r.totalCount > 0;
      if (activeFilter === 'waiting') return r.totalCount > 0 && !r.inStock;
      if (activeFilter === 'stock') return r.inStock;
      return true;
    });
    const statusOrder: Record<string, number> = { green: 0, blue: 1, orange: 2, gray: 3 };
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      switch (activeSort) {
        case 'requests':
          return b.totalCount - a.totalCount;
        case 'arrival':
          if (!a.arrivalDate && !b.arrivalDate) return 0;
          if (!a.arrivalDate) return 1;
          if (!b.arrivalDate) return -1;
          return a.arrivalDate.localeCompare(b.arrivalDate);
        case 'modified':
          return b.updatedAt.localeCompare(a.updatedAt);
        case 'status':
          return statusOrder[statusOf(a)] - statusOrder[statusOf(b)];
        default:
          return a.sku.localeCompare(b.sku);
      }
    });
  }, [data, search, activeFilter, activeSort]);

  /* ---- actions ---- */
  const openManage = (id: string) => {
    setActiveId(id);
    setLogFilter('all');
    setLogUser('all');
    setNoteText('');
    setEditingNoteId(null);
  };
  const closeDrawer = () => setActiveId(null);

  const togglePin = (e: React.MouseEvent, r: RepeatRequest) => {
    e.stopPropagation();
    act({ action: 'repeat-toggle-pin', id: r.id }, r.pinned ? 'تم إلغاء التثبيت' : '📌 تم تثبيت الفستان');
  };

  const submitCreate = async () => {
    if (!createModelId) {
      toast('اختر الموديل أولاً');
      return;
    }
    const sizes = createSizes
      .split(/[,،]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const ok = await act(
      { action: 'repeat-create', designModelId: createModelId, tailorId: createTailorId || null, sizes },
      '✓ تمت إضافة الموديل للتتبع'
    );
    if (ok) {
      setCreateOpen(false);
      setCreateModelId('');
      setCreateTailorId('');
      setCreateSizes('S, M, L, XL');
    }
  };

  const confirmCounterReset = async () => {
    if (!active || !pendCounterReset) return;
    await act({ action: 'repeat-reset-counter', id: active.id, target: pendCounterReset.target }, '↺ تم تصفير العدّاد');
    setPendCounterReset(null);
  };

  const confirmResetAll = async () => {
    if (!active) return;
    const sections = Object.keys(resetSections).filter((k) => resetSections[k]);
    if (!sections.length) {
      toast('اختر قسماً واحداً على الأقل');
      return;
    }
    await act({ action: 'repeat-reset-sections', id: active.id, sections }, '✓ تمت إعادة التهيئة');
    setResetAllOpen(false);
    setResetSections({});
  };

  const sendNote = async () => {
    if (!active || !noteText.trim()) return;
    const ok = await act({ action: 'repeat-add-note', id: active.id, message: noteText.trim() }, '💬 تم إرسال الملاحظة');
    if (ok) setNoteText('');
  };

  const saveNoteEdit = async (noteId: string) => {
    if (!editingNoteText.trim()) return;
    const ok = await act({ action: 'repeat-edit-note', noteId, message: editingNoteText.trim() }, '✓ تم تعديل الملاحظة');
    if (ok) setEditingNoteId(null);
  };

  /* ---- export ---- */
  const exportCsv = () => {
    if (!data) return;
    const rows = ['رقم الصنف,المستوى,الطلبات,تاريخ التكرار,تاريخ الوصول,التوفر,آخر تعديل'];
    data.requests.forEach((r) => {
      rows.push(
        [r.sku, 'الموديل', r.modelCount, fmtDateFull(r.repeatDate), fmtDateFull(r.arrivalDate), r.inStock ? 'متوفر' : '', fmtDateFull(r.updatedAt)].join(',')
      );
      r.sizes.forEach((s) => rows.push([r.sku, 'مقاس ' + s.label, s.count, '', '', '', ''].join(',')));
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'repeat-requests.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('✓ تم تصدير الملف');
  };

  /* ---- log filtering (within drawer) ---- */
  const logPasses = (l: LogRow) => {
    if (logUser !== 'all' && l.actor !== logUser) return false;
    if (logFilter === 'all') return true;
    if (logFilter === 'counters') return ['زيادة', 'تقليل', 'تصفير'].includes(l.action);
    if (logFilter === 'dates') return l.action.includes('تاريخ');
    if (logFilter === 'availability') return l.action.includes('توفر');
    if (logFilter === 'notes') return l.action.includes('ملاحظة');
    return true;
  };

  return (
    <AppPageShell
      title="طلبات التكرار"
      subtitle="تتبع طلبات إعادة إنتاج الفساتين — انقر على أي صف لفتح لوحة الإدارة"
      contentClassName="flex flex-1 flex-col p-4 md:p-6"
    >
      <div className="rr-page">
        {loading ? (
          <LoadingState label="جارٍ تحميل طلبات التكرار…" />
        ) : error ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--red)' }}>{error}</div>
        ) : data ? (
          <>
            {/* STATS */}
            <div className="stats">
              <div className="sc"><div className="k">عدد الموديلات</div><div className="v">{data.stats.models}</div></div>
              <div className="sc"><div className="k">إجمالي الطلبات</div><div className="v">{data.stats.totalRequests}</div></div>
              <div className="sc"><div className="k">بانتظار الوصول</div><div className="v">{data.stats.waiting}</div></div>
              <div className="sc"><div className="k">متوفر في المستودع</div><div className="v">{data.stats.inStock}</div></div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>فساتين المتجر</h2>
                <span className="sub">انقر على الصف لفتح لوحة الإدارة</span>
              </div>
              <div className="legend">
                <span className="li"><span className="dot gray" />بدون طلبات</span>
                <span className="li"><span className="dot orange" />عليه طلبات</span>
                <span className="li"><span className="dot blue" />في الطريق</span>
                <span className="li"><span className="dot green" />متوفر</span>
              </div>
              <div className="toolbar">
                <select className="t-sel" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}>
                  <option value="all">عرض: الكل</option>
                  <option value="has">لديه طلبات</option>
                  <option value="waiting">بانتظار الوصول</option>
                  <option value="stock">متوفر في المستودع</option>
                </select>
                <select className="t-sel" value={activeSort} onChange={(e) => setActiveSort(e.target.value as typeof activeSort)}>
                  <option value="sku">ترتيب: رقم الصنف</option>
                  <option value="requests">الأكثر طلباً</option>
                  <option value="arrival">الأقرب وصولاً</option>
                  <option value="modified">آخر تعديل</option>
                  <option value="status">الحالة</option>
                </select>
                <div className="search-wrap">
                  <input className="s-inp" type="text" placeholder="بحث برقم الصنف…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <span className="s-ico">🔍</span>
                </div>
                {canManage && (
                  <button className="add-btn" onClick={() => setCreateOpen(true)}>＋ تتبع موديل</button>
                )}
                <button className="exp-btn" onClick={exportCsv} title="تصدير CSV">⬇ CSV</button>
                <button className="exp-btn" onClick={() => window.print()} title="طباعة">🖨</button>
              </div>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>الفستان</th>
                      <th>الخياط</th>
                      <th>تاريخ التكرار</th>
                      <th>تاريخ الوصول</th>
                      <th>التوفر</th>
                      <th>آخر تعديل</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={7} className="no-res">لا توجد نتائج مطابقة</td></tr>
                    ) : (
                      filtered.map((r) => {
                        const dl = daysLeft(r.arrivalDate);
                        let daysTxt = '';
                        let daysCls = 'days-ok';
                        if (r.arrivalDate && !r.inStock && dl !== null) {
                          if (dl < 0) { daysTxt = `تأخر ${Math.abs(dl)} يوم`; daysCls = 'days-late'; }
                          else if (dl === 0) { daysTxt = 'اليوم'; daysCls = 'days-late'; }
                          else if (dl <= 7) { daysTxt = `بعد ${dl} يوم`; daysCls = 'days-soon'; }
                          else { daysTxt = `بعد ${dl} يوم`; }
                        }
                        return (
                          <tr key={r.id} onClick={() => openManage(r.id)}>
                            <td>
                              <div className="dcell">
                                <button className={`pin-btn${r.pinned ? ' on' : ''}`} onClick={(e) => togglePin(e, r)} title={r.pinned ? 'إلغاء التثبيت' : 'تثبيت'}>
                                  {r.pinned ? '📌' : '📍'}
                                </button>
                                <span className={`dot ${statusOf(r)}`} />
                                <div className="d-thumb">
                                  {r.imageData ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={r.imageData} alt="" />
                                  ) : (
                                    <span>👗</span>
                                  )}
                                </div>
                                <div className="dtext">
                                  <div className="sku">
                                    {r.sku}
                                    {r.totalCount > 0 ? (
                                      <span className="req-badge has">{r.totalCount} طلب</span>
                                    ) : (
                                      <span className="req-badge none">لا طلبات</span>
                                    )}
                                  </div>
                                  <div className="meta">{r.sizes.length} مقاسات{r.notes.length ? ` · ${r.notes.length} ملاحظة` : ''}</div>
                                </div>
                              </div>
                            </td>
                            <td data-label="الخياط"><span style={{ fontSize: 13 }}>{r.tailorName || '—'}</span></td>
                            <td data-label="تاريخ التكرار">{r.repeatDate ? <span className="date-cell">{fmtDate(r.repeatDate)}</span> : <span style={{ color: 'var(--muted-fg)' }}>—</span>}</td>
                            <td data-label="تاريخ الوصول">
                              {r.arrivalDate ? (
                                <div className="date-cell">
                                  {fmtDate(r.arrivalDate)}
                                  {daysTxt && <div className={`days-badge ${daysCls}`}>{daysTxt}</div>}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--muted-fg)' }}>—</span>
                              )}
                            </td>
                            <td data-label="التوفر">{r.inStock ? <span className="av-badge yes">✓ متوفر</span> : <span className="av-badge no">—</span>}</td>
                            <td data-label="آخر تعديل"><span className="mod-text">{relTime(r.updatedAt)}</span></td>
                            <td><span className="row-arr">‹</span></td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* OVERLAY + DRAWER */}
            <div className={`overlay${active ? ' open' : ''}`} onClick={closeDrawer} />
            <div className={`drawer${active ? ' open' : ''}`}>
              {active && (
                <>
                  <div className="dh">
                    <div>
                      <h3>إدارة الطلب</h3>
                      <div className="dsub">{active.sku}</div>
                    </div>
                    <button className="dclose" onClick={closeDrawer}>×</button>
                  </div>
                  <div className="dbody">
                    <div className="dr-img">
                      {active.imageData ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={active.imageData} alt={active.sku} />
                      ) : (
                        <div className="dr-img-ph"><span>👗</span><small>صورة الفستان</small></div>
                      )}
                    </div>

                    {/* STAGE */}
                    <div>
                      <div className="dsec-title">📍 مرحلة الطلب</div>
                      {canManage ? (
                        <div className="stage-btns">
                          {[1, 2, 3, 4, 5].map((n) => {
                            const cls = n < active.stage ? 'done' : n === active.stage ? 'active' : '';
                            return (
                              <button key={n} className={`stage-btn ${cls}`} disabled={busy} onClick={() => act({ action: 'repeat-set-stage', id: active.id, stage: n }, `✓ المرحلة: ${STAGES[n]}`)}>
                                <span className="stage-ico">{STAGE_ICONS[n]}</span>{STAGES[n]}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <>
                          <div className="stage-btns">
                            <button className={`stage-btn ${active.stage === 1 ? 'active' : ''}`} disabled={busy} onClick={() => act({ action: 'repeat-set-stage', id: active.id, stage: 1 }, `✓ المرحلة: ${STAGES[1]}`)}>
                              <span className="stage-ico">{STAGE_ICONS[1]}</span>{STAGES[1]}
                            </button>
                          </div>
                          <div className="stage-view-lbl">المرحلة الحالية</div>
                          <div className="stage-view">
                            {[1, 2, 3, 4, 5].map((n) => {
                              const cls = n < active.stage ? 'done' : n === active.stage ? 'active' : '';
                              return (
                                <div key={n} className={`stage-chip ${cls}`}><span className="stage-ico">{STAGE_ICONS[n]}</span>{STAGES[n]}</div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>

                    {/* COUNTERS */}
                    <div>
                      <div className="dsec-title">🔢 عدادات التكرار</div>
                      <div className="dsec-box">
                        <div className="cr">
                          <span className="cr-lbl model">الموديل<small>بدون مقاس</small></span>
                          <button className="cb minus" disabled={busy || active.modelCount === 0} onClick={() => act({ action: 'repeat-change-count', id: active.id, target: 'model', delta: -1 })}>−</button>
                          <span className={`cr-num${active.modelCount > 0 ? ' hot' : ''}`}>{active.modelCount}</span>
                          <button className="cb plus" disabled={busy} onClick={() => act({ action: 'repeat-change-count', id: active.id, target: 'model', delta: 1 }, '✓ تم تسجيل الزيادة')}>+</button>
                          <button className="cr-rst" disabled={busy || active.modelCount === 0} title="تصفير" onClick={() => setPendCounterReset({ target: 'model', label: 'الموديل' })}>↺</button>
                        </div>
                        {active.sizes.map((s) => (
                          <div className="cr" key={s.id}>
                            <span className="cr-lbl">مقاس {s.label}</span>
                            <button className="cb minus" disabled={busy || s.count === 0} onClick={() => act({ action: 'repeat-change-count', id: active.id, target: s.id, delta: -1 })}>−</button>
                            <span className={`cr-num${s.count > 0 ? ' hot' : ''}`}>{s.count}</span>
                            <button className="cb plus" disabled={busy} onClick={() => act({ action: 'repeat-change-count', id: active.id, target: s.id, delta: 1 }, '✓ تم تسجيل الزيادة')}>+</button>
                            <button className="cr-rst" disabled={busy || s.count === 0} title="تصفير" onClick={() => setPendCounterReset({ target: s.id, label: 'مقاس ' + s.label })}>↺</button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {canManage && (
                      <>
                        {/* TAILOR */}
                        <div>
                          <div className="dsec-title">🧵 الخياط</div>
                          <div className="dsec-box">
                            <div className="tailor-wrap">
                              <select className="tailor-sel" value={active.tailorId || ''} disabled={busy} onChange={(e) => act({ action: 'repeat-set-tailor', id: active.id, tailorId: e.target.value || null }, '✓ تم تعيين الخياط')}>
                                <option value="">— بدون خياط —</option>
                                {data.tailors.map((t) => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        {/* DATES */}
                        <div>
                          <div className="dsec-title">📅 التواريخ</div>
                          <div className="dsec-box">
                            <div className="df-wrap">
                              <div className="dfield">
                                <label>تاريخ التكرار</label>
                                <input type="date" className="date-inp" value={dateInputValue(active.repeatDate)} disabled={busy} onChange={(e) => act({ action: 'repeat-save-date', id: active.id, field: 'repeatDate', value: e.target.value }, '✓ تم حفظ التاريخ')} />
                              </div>
                              <div className="dfield">
                                <label>تاريخ وصول الفستان</label>
                                <input type="date" className="date-inp" value={dateInputValue(active.arrivalDate)} disabled={busy} onChange={(e) => act({ action: 'repeat-save-date', id: active.id, field: 'arrivalDate', value: e.target.value }, '✓ تم حفظ التاريخ')} />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* AVAILABILITY */}
                        <div>
                          <div className="dsec-title">📦 التوفر في المستودع</div>
                          <div className="dsec-box">
                            <div className="avail-box">
                              {active.inStock ? (
                                <>
                                  <span className="avail-txt yes">✓ متوفر في المستودع</span>
                                  <button className="avail-btn unset" disabled={busy} onClick={() => act({ action: 'repeat-toggle-stock', id: active.id }, 'تم إلغاء التوفر')}>إلغاء التوفر</button>
                                </>
                              ) : (
                                <>
                                  <span className="avail-txt no">غير متوفر</span>
                                  <button className="avail-btn set" disabled={busy} onClick={() => act({ action: 'repeat-toggle-stock', id: active.id }, '✓ تم تعيين الفستان كـ متوفر')}>تعيين كـ متوفر</button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* RESET ALL */}
                        <div>
                          <div className="dsec-title">↺ إعادة تهيئة</div>
                          <div className="dsec-box">
                            <div className="reset-all-row">
                              <span className="reset-all-desc">إعادة تعيين أقسام محددة إلى الوضع الافتراضي</span>
                              <button className="reset-all-btn" onClick={() => { setResetSections({}); setResetAllOpen(true); }}>إعادة تهيئة</button>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {!canManage && (
                      <div>
                        <div className="dsec-title">📅 التواريخ</div>
                        <div className="dsec-box">
                          <div className="date-txt">
                            <div className="date-txt-row"><span className="date-txt-lbl">تاريخ التكرار</span><span className="date-txt-val">{fmtDateFull(active.repeatDate)}</span></div>
                            <div className="date-txt-row"><span className="date-txt-lbl">تاريخ وصول الفستان</span><span className="date-txt-val">{fmtDateFull(active.arrivalDate)}</span></div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* NOTES */}
                    <div>
                      <div className="dsec-title">💬 ملاحظات الفريق</div>
                      <div className="dsec-box">
                        <div className="chat-msgs">
                          {active.notes.length === 0 ? (
                            <div className="chat-empty">لا توجد ملاحظات بعد</div>
                          ) : (
                            active.notes.map((n) => (
                              <div className="chat-item" key={n.id}>
                                <div className="chat-meta">
                                  <span className="chat-user">{n.authorName}</span>
                                  <span className="chat-ts">{fmtDateFull(n.createdAt)}</span>
                                  {n.edited && <span className="chat-edited">(تم التعديل)</span>}
                                  {n.authorName === currentActor && editingNoteId !== n.id && (
                                    <button className="chat-edit-btn" onClick={() => { setEditingNoteId(n.id); setEditingNoteText(n.message); }}>✏ تعديل</button>
                                  )}
                                </div>
                                {editingNoteId === n.id ? (
                                  <div className="chat-edit-wrap">
                                    <input className="chat-edit-inp" value={editingNoteText} autoFocus onChange={(e) => setEditingNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveNoteEdit(n.id); if (e.key === 'Escape') setEditingNoteId(null); }} />
                                    <button className="chat-edit-save" disabled={busy} onClick={() => saveNoteEdit(n.id)}>حفظ</button>
                                    <button className="chat-edit-cancel" onClick={() => setEditingNoteId(null)}>إلغاء</button>
                                  </div>
                                ) : (
                                  <div className="chat-bubble">{n.message}</div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                        <div className="chat-input">
                          <div className="chat-row">
                            <input className="chat-text" placeholder="اكتب ملاحظة…" value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendNote(); }} />
                            <button className="chat-send" disabled={busy} onClick={sendNote}>إرسال</button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* LOG */}
                    <div>
                      <div className="dsec-title">📋 سجل التعديلات</div>
                      <div className="dsec-box">
                        <div className="log-filter">
                          <select className="log-filter-sel" value={logFilter} onChange={(e) => setLogFilter(e.target.value as typeof logFilter)}>
                            <option value="all">النوع: الكل</option>
                            <option value="counters">عدادات</option>
                            <option value="dates">تواريخ</option>
                            <option value="availability">التوفر</option>
                            <option value="notes">ملاحظات</option>
                          </select>
                          <select className="log-filter-sel" value={logUser} onChange={(e) => setLogUser(e.target.value)}>
                            <option value="all">الموظف: الكل</option>
                            {[...new Set(active.logs.map((l) => l.actor))].map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                          <span className="log-count">{active.logs.filter(logPasses).length} من {active.logs.length}</span>
                        </div>
                        <div className="log-list">
                          {active.logs.filter(logPasses).length === 0 ? (
                            <div className="log-empty">{active.logs.length ? 'لا توجد نتائج للفلتر المحدد' : 'لا يوجد سجل بعد'}</div>
                          ) : (
                            active.logs.filter(logPasses).map((l) => (
                              <div className="log-row" key={l.id}>
                                <span className="log-user">{l.actor}</span>
                                <span className="log-sep">•</span>
                                <span className="log-action">{l.action}{l.detail ? ` (${l.detail})` : ''}</span>
                                <span className="log-sep">•</span>
                                <span className="log-time">{relTime(l.createdAt)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {canManage && (
                      <button className="reset-all-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={async () => {
                        if (active) { await act({ action: 'repeat-delete', id: active.id }, 'تم إيقاف تتبع الموديل'); closeDrawer(); }
                      }}>🗑 إيقاف التتبع</button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* CREATE MODAL */}
            <div className={`modal-ov${createOpen ? ' open' : ''}`} onClick={() => setCreateOpen(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-h">
                  <div className="m-ico" style={{ background: 'var(--orange-s)', color: 'var(--orange)' }}>＋</div>
                  <h3>تتبع موديل جديد</h3>
                </div>
                <div className="modal-b">
                  <div className="create-field">
                    <label>الموديل (SKU)</label>
                    <select className="create-sel" value={createModelId} onChange={(e) => setCreateModelId(e.target.value)}>
                      <option value="">— اختر موديلاً —</option>
                      {data.availableModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.sku}{m.size ? ` — ${m.size}` : ''}</option>
                      ))}
                    </select>
                    {data.availableModels.length === 0 && <div className="create-hint">كل الموديلات متتبَّعة بالفعل.</div>}
                  </div>
                  <div className="create-field">
                    <label>الخياط (اختياري)</label>
                    <select className="create-sel" value={createTailorId} onChange={(e) => setCreateTailorId(e.target.value)}>
                      <option value="">— بدون خياط —</option>
                      {data.tailors.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="create-field">
                    <label>المقاسات</label>
                    <input className="create-inp" value={createSizes} onChange={(e) => setCreateSizes(e.target.value)} placeholder="S, M, L, XL" />
                    <div className="create-hint">افصل المقاسات بفاصلة. اتركها فارغة لتتبع الموديل بدون مقاسات.</div>
                  </div>
                </div>
                <div className="modal-f">
                  <button className="btn primary" disabled={busy || !createModelId} onClick={submitCreate}>إضافة</button>
                  <button className="btn ghost" onClick={() => setCreateOpen(false)}>إلغاء</button>
                </div>
              </div>
            </div>

            {/* SINGLE COUNTER RESET MODAL */}
            <div className={`modal-ov${pendCounterReset ? ' open' : ''}`} onClick={() => setPendCounterReset(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-h">
                  <div className="m-ico" style={{ background: '#fde8e8', color: 'var(--red)' }}>↺</div>
                  <h3>تصفير العدّاد</h3>
                </div>
                <div className="modal-b">
                  سيتم إعادة عدّاد <strong>{active?.sku} — {pendCounterReset?.label}</strong> إلى صفر.
                </div>
                <div className="modal-f">
                  <button className="btn danger" disabled={busy} onClick={confirmCounterReset}>تصفير</button>
                  <button className="btn ghost" onClick={() => setPendCounterReset(null)}>إلغاء</button>
                </div>
              </div>
            </div>

            {/* RESET ALL MODAL */}
            <div className={`modal-ov${resetAllOpen ? ' open' : ''}`} onClick={() => setResetAllOpen(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-h">
                  <div className="m-ico" style={{ background: '#fde8e8', color: 'var(--red)' }}>↺</div>
                  <h3>إعادة تهيئة</h3>
                </div>
                <div className="modal-b">
                  <p style={{ marginBottom: 4 }}>اختر الأقسام التي تريد إعادة تعيينها:</p>
                  <div className="reset-checks">
                    {RESET_OPTS.map((o) => (
                      <label className="reset-check-item" key={o.id}>
                        <input type="checkbox" checked={!!resetSections[o.id]} onChange={(e) => setResetSections((prev) => ({ ...prev, [o.id]: e.target.checked }))} />
                        <div><span className="reset-check-lbl">{o.label}</span><span className="reset-check-sub">{o.sub}</span></div>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="modal-f">
                  <button className="btn danger" disabled={busy} onClick={confirmResetAll}>تهيئة</button>
                  <button className="btn ghost" onClick={() => setResetAllOpen(false)}>إلغاء</button>
                </div>
              </div>
            </div>

            {/* TOAST */}
            <div className={`toast${toastMsg ? ' show' : ''}`}>{toastMsg}</div>
          </>
        ) : null}
      </div>
    </AppPageShell>
  );
}
