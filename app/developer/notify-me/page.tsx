'use client';

import dynamic from 'next/dynamic';
import { javascript } from '@codemirror/lang-javascript';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Code2,
  ExternalLink,
  FileClock,
  Loader2,
  RefreshCcw,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), {
  ssr: false,
  loading: () => <div className="h-[65vh] animate-pulse rounded-lg bg-muted" />,
});

type Actor = {
  id: string | null;
  name: string | null;
  username: string | null;
};

type Validation = {
  valid: boolean;
  error: string | null;
};

type ScriptState = {
  id: string;
  draftSource: string;
  draftVersion: number;
  draftChecksum: string;
  draftValidation: Validation;
  draftUpdatedBy: Actor;
  draftUpdatedAt: string;
  publishedVersion: number;
  publishedChecksum: string | null;
  publishedBy: Actor;
  publishedAt: string | null;
  isUsingRepositoryDefault: boolean;
  repositoryDefaultChecksum: string;
  maxBytes: number;
};

type Revision = {
  id: string;
  version: number;
  checksum: string;
  publishedAt: string;
  publishedBy: Actor;
};

type RevisionDetail = Revision & { source: string };

type ConfirmAction =
  | { type: 'publish' }
  | { type: 'reset' }
  | { type: 'restore'; revision: Revision }
  | null;

class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error || 'تعذر تنفيذ الطلب', response.status, data.code);
  }
  return data as T;
}

function actorLabel(actor: Actor) {
  return actor.name || actor.username || 'غير محدد';
}

function dateLabel(value?: string | null) {
  if (!value) return 'لم ينشر بعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortHash(value?: string | null) {
  return value ? value.slice(0, 12) : '—';
}

export default function NotifyMeScriptEditorPage() {
  const { toast } = useToast();
  const [state, setState] = useState<ScriptState | null>(null);
  const [source, setSource] = useState('');
  const [savedSource, setSavedSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revisionDetail, setRevisionDetail] = useState<RevisionDetail | null>(null);
  const [revisionDetailLoading, setRevisionDetailLoading] = useState(false);

  const dirty = source !== savedSource;
  const byteLength = useMemo(() => new TextEncoder().encode(source).length, [source]);
  const tooLarge = Boolean(state && byteLength > state.maxBytes);

  const applyState = useCallback((next: ScriptState) => {
    setState(next);
    setSource(next.draftSource);
    setSavedSource(next.draftSource);
    setConflict(false);
  }, []);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ success: true; state: ScriptState }>(
        '/api/developer/notify-me-script'
      );
      applyState(data.state);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'تعذر تحميل السكربت');
    } finally {
      setLoading(false);
    }
  }, [applyState]);

  const loadRevisions = useCallback(async (cursor?: string, append = false) => {
    setRevisionsLoading(true);
    try {
      const params = new URLSearchParams({ take: '20' });
      if (cursor) params.set('cursor', cursor);
      const data = await api<{
        success: true;
        revisions: Revision[];
        nextCursor: string | null;
      }>(`/api/developer/notify-me-script/revisions?${params.toString()}`);
      setRevisions((current) => (append ? [...current, ...data.revisions] : data.revisions));
      setNextCursor(data.nextCursor);
    } catch (requestError) {
      toast({
        title: 'تعذر تحميل سجل النشر',
        description: requestError instanceof Error ? requestError.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setRevisionsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadState();
    void loadRevisions();
  }, [loadState, loadRevisions]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const handleApiError = useCallback((requestError: unknown) => {
    const message = requestError instanceof Error ? requestError.message : 'تعذر تنفيذ الطلب';
    setError(message);
    if (requestError instanceof ApiError && requestError.status === 409) setConflict(true);
    toast({ title: 'لم تكتمل العملية', description: message, variant: 'destructive' });
  }, [toast]);

  const saveDraft = useCallback(async () => {
    if (!state || busy || tooLarge) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ success: true; state: ScriptState }>(
        '/api/developer/notify-me-script',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, baseDraftVersion: state.draftVersion }),
        }
      );
      applyState(data.state);
      toast({
        title: 'تم حفظ المسودة',
        description: data.state.draftValidation.valid
          ? 'اجتاز السكربت فحص الصياغة وأصبح جاهزاً للنشر.'
          : 'تم الحفظ، لكن يجب إصلاح خطأ الصياغة قبل النشر.',
      });
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setBusy(false);
    }
  }, [applyState, busy, handleApiError, source, state, toast, tooLarge]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveDraft();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [saveDraft]);

  const publish = async () => {
    if (!state) return;
    setBusy(true);
    try {
      await api('/api/developer/notify-me-script/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseDraftVersion: state.draftVersion }),
      });
      setConfirmAction(null);
      await Promise.all([loadState(), loadRevisions()]);
      toast({ title: 'تم نشر السكربت', description: 'أصبح الإصدار الجديد متاحاً للمتجر.' });
    } catch (requestError) {
      setConfirmAction(null);
      handleApiError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const resetDraft = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const data = await api<{ success: true; state: ScriptState }>(
        '/api/developer/notify-me-script/reset-draft',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseDraftVersion: state.draftVersion }),
        }
      );
      applyState(data.state);
      setConfirmAction(null);
      toast({ title: 'تمت استعادة نسخة المشروع كمسودة' });
    } catch (requestError) {
      setConfirmAction(null);
      handleApiError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const restoreRevision = async (revision: Revision) => {
    if (!state) return;
    setBusy(true);
    try {
      const data = await api<{ success: true; state: ScriptState }>(
        `/api/developer/notify-me-script/revisions/${revision.id}/restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseDraftVersion: state.draftVersion }),
        }
      );
      applyState(data.state);
      setConfirmAction(null);
      toast({
        title: `تمت استعادة الإصدار ${revision.version} كمسودة`,
        description: 'لن يتغير السكربت المباشر حتى تنشر المسودة.',
      });
    } catch (requestError) {
      setConfirmAction(null);
      handleApiError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const viewRevision = async (revision: Revision) => {
    setRevisionDetailLoading(true);
    try {
      const data = await api<{ success: true; revision: RevisionDetail }>(
        `/api/developer/notify-me-script/revisions/${revision.id}`
      );
      setRevisionDetail(data.revision);
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setRevisionDetailLoading(false);
    }
  };

  if (loading && !state) {
    return (
      <AppPageShell title="محرر سكربت أبلغني" subtitle="إدارة سكربت واجهة المتجر">
        <Card><LoadingState label="جاري تحميل المسودة..." /></Card>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell
      title="محرر سكربت أبلغني"
      subtitle="حفظ المسودات ومراجعتها ونشرها إلى واجهة المتجر"
      contentClassName="flex flex-1 flex-col gap-4 p-4 md:p-6"
    >
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>{conflict ? 'توجد نسخة أحدث من المسودة' : 'تعذر تنفيذ العملية'}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error}</span>
            {conflict && (
              <Button size="sm" variant="outline" onClick={() => void loadState()}>
                <RefreshCcw className="size-4" /> إعادة تحميل أحدث نسخة
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {state && (
        <section className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>المسودة</CardDescription>
              <CardTitle className="flex items-center gap-2 text-lg">
                الإصدار {state.draftVersion}
                {dirty ? <Badge variant="secondary">تغييرات غير محفوظة</Badge> : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {actorLabel(state.draftUpdatedBy)} · {dateLabel(state.draftUpdatedAt)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>النسخة المباشرة</CardDescription>
              <CardTitle className="flex items-center gap-2 text-lg">
                {state.isUsingRepositoryDefault ? 'نسخة المشروع' : `الإصدار ${state.publishedVersion}`}
                <Badge variant={state.isUsingRepositoryDefault ? 'secondary' : 'default'}>
                  مباشر
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {state.isUsingRepositoryDefault
                ? `البصمة ${shortHash(state.repositoryDefaultChecksum)}`
                : `${actorLabel(state.publishedBy)} · ${dateLabel(state.publishedAt)}`}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>فحص الصياغة</CardDescription>
              <CardTitle className="flex items-center gap-2 text-lg">
                {dirty ? (
                  <><Clock3 className="size-5 text-amber-600" /> احفظ لإعادة الفحص</>
                ) : state.draftValidation.valid ? (
                  <><CheckCircle2 className="size-5 text-emerald-600" /> صالح للنشر</>
                ) : (
                  <><AlertTriangle className="size-5 text-destructive" /> يحتاج إلى إصلاح</>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {byteLength.toLocaleString('en-US')} / {state.maxBytes.toLocaleString('en-US')} بايت
            </CardContent>
          </Card>
        </section>
      )}

      <Tabs defaultValue="editor" className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList>
            <TabsTrigger value="editor"><Code2 className="size-4" /> المحرر</TabsTrigger>
            <TabsTrigger value="history"><FileClock className="size-4" /> سجل النشر</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href="/embed/notify-me-runtime.js" target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> فتح السكربت المباشر
              </a>
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmAction({ type: 'reset' })}
              disabled={!state || busy}
            >
              <RotateCcw className="size-4" /> نسخة المشروع
            </Button>
            <Button onClick={() => void saveDraft()} disabled={!state || busy || !dirty || tooLarge}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              حفظ المسودة
            </Button>
            <Button
              onClick={() => setConfirmAction({ type: 'publish' })}
              disabled={!state || busy || dirty || !state.draftValidation.valid}
            >
              <Upload className="size-4" /> نشر
            </Button>
          </div>
        </div>

        <TabsContent value="editor" className="min-h-0">
          <Card className="overflow-hidden">
            <CardHeader className="border-b">
              <CardTitle className="text-base">notify-me-runtime.js</CardTitle>
              <CardDescription>
                الحفظ لا يغير المتجر. استخدم زر النشر بعد نجاح فحص JavaScript.
              </CardDescription>
            </CardHeader>
            {state?.draftValidation.error && !dirty && (
              <Alert variant="destructive" className="m-3 mb-0">
                <AlertDescription dir="ltr" className="font-mono text-xs">
                  {state.draftValidation.error}
                </AlertDescription>
              </Alert>
            )}
            {tooLarge && (
              <Alert variant="destructive" className="m-3 mb-0">
                <AlertDescription>تجاوز السكربت الحد المسموح ولا يمكن حفظه.</AlertDescription>
              </Alert>
            )}
            <div dir="ltr" className="text-left">
              <CodeMirror
                value={source}
                height="65vh"
                extensions={[javascript()]}
                onChange={setSource}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: true,
                }}
                className="text-sm [&_.cm-editor]:outline-none [&_.cm-scroller]:font-mono"
              />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>الإصدارات المنشورة</CardTitle>
              <CardDescription>
                الاستعادة تنشئ مسودة جديدة ولا تغير النسخة المباشرة تلقائياً.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {revisions.length === 0 && revisionsLoading ? (
                <LoadingState label="جاري تحميل سجل النشر..." />
              ) : revisions.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  لم يتم نشر نسخة من المحرر بعد.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الإصدار</TableHead>
                        <TableHead>الناشر</TableHead>
                        <TableHead>وقت النشر</TableHead>
                        <TableHead>البصمة</TableHead>
                        <TableHead className="text-left">الإجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revisions.map((revision) => (
                        <TableRow key={revision.id}>
                          <TableCell><Badge variant="outline">v{revision.version}</Badge></TableCell>
                          <TableCell>{actorLabel(revision.publishedBy)}</TableCell>
                          <TableCell>{dateLabel(revision.publishedAt)}</TableCell>
                          <TableCell dir="ltr" className="font-mono text-xs">
                            {shortHash(revision.checksum)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={revisionDetailLoading}
                                onClick={() => void viewRevision(revision)}
                              >
                                عرض
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => setConfirmAction({ type: 'restore', revision })}
                              >
                                استعادة كمسودة
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {nextCursor && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    disabled={revisionsLoading}
                    onClick={() => void loadRevisions(nextCursor, true)}
                  >
                    {revisionsLoading && <Loader2 className="size-4 animate-spin" />}
                    تحميل المزيد
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmationDialog
        open={confirmAction !== null}
        title={
          confirmAction?.type === 'publish'
            ? 'نشر السكربت إلى المتجر؟'
            : confirmAction?.type === 'reset'
              ? 'استعادة نسخة المشروع؟'
              : `استعادة الإصدار ${confirmAction?.revision.version}؟`
        }
        message={
          confirmAction?.type === 'publish'
            ? 'سيبدأ زوار صفحات المنتجات في تحميل هذا السكربت فور إعادة التحقق من النسخة المخزنة.'
            : confirmAction?.type === 'reset'
              ? 'سيتم استبدال المسودة الحالية بنسخة المشروع، دون تغيير السكربت المباشر.'
              : 'سيتم استبدال المسودة الحالية بهذا الإصدار. ستحتاج إلى نشره بشكل منفصل.'
        }
        confirmLabel={confirmAction?.type === 'publish' ? 'نشر الآن' : 'استعادة'}
        confirmVariant={confirmAction?.type === 'publish' ? 'danger' : 'primary'}
        confirmDisabled={busy}
        onCancel={() => !busy && setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction?.type === 'publish') void publish();
          if (confirmAction?.type === 'reset') void resetDraft();
          if (confirmAction?.type === 'restore') void restoreRevision(confirmAction.revision);
        }}
      />

      <Dialog open={revisionDetail !== null} onOpenChange={(open) => !open && setRevisionDetail(null)}>
        <DialogContent className="max-w-[min(96vw,1100px)]">
          <DialogHeader className="text-right sm:text-right">
            <DialogTitle>الإصدار {revisionDetail?.version}</DialogTitle>
            <DialogDescription>
              {revisionDetail ? `${actorLabel(revisionDetail.publishedBy)} · ${dateLabel(revisionDetail.publishedAt)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {revisionDetail && (
            <div dir="ltr" className="overflow-hidden rounded-lg border text-left">
              <CodeMirror
                value={revisionDetail.source}
                height="65vh"
                extensions={[javascript()]}
                editable={false}
                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                className="text-sm [&_.cm-scroller]:font-mono"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppPageShell>
  );
}
