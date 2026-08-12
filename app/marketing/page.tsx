'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Download,
  Loader2,
  Megaphone,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

type CustomerGroup = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  campaignCount: number;
  optedInCount: number;
  optedOutCount: number;
  unknownConsentCount: number;
  updatedAt: string;
};

type Customer = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  source: string;
  consentStatus: 'unknown' | 'opted_in' | 'opted_out';
  createdAt: string;
};

type ZokoTemplate = {
  templateId: string;
  templateLanguage: string;
  templateType: 'template' | 'buttonTemplate' | 'richTemplate';
  templateVariableCount: number;
  templateDesc: string;
};

type Campaign = {
  id: string;
  groupId: string;
  group?: { id: string; name: string };
  name: string;
  templateId: string;
  templateDescription: string | null;
  status: 'ready' | 'sending' | 'completed' | 'partial' | 'failed';
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
};

type Pagination = { page: number; perPage: number; total: number; totalPages: number };

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
  if (!response.ok) throw new ApiError(data.error || 'تعذر تنفيذ الطلب', response.status, data.code);
  return data as T;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).format(new Date(value));
}

function consentLabel(status: Customer['consentStatus']) {
  if (status === 'opted_in') return 'موافق';
  if (status === 'opted_out') return 'منسحب';
  return 'غير محدد';
}

function statusLabel(status: Campaign['status']) {
  return ({
    ready: 'جاهزة',
    sending: 'قيد الإرسال',
    completed: 'مكتملة',
    partial: 'مكتملة جزئياً',
    failed: 'فشلت',
  } as const)[status];
}

function statusVariant(status: Campaign['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default';
  if (status === 'partial' || status === 'failed') return 'destructive';
  if (status === 'sending') return 'secondary';
  return 'outline';
}

const csvExample = 'name,phone,email,consent_status\nسارة محمد,+966501234567,sara@example.com,opted_in\n';

export default function MarketingPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || null;

  const [members, setMembers] = useState<Customer[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberPage, setMemberPage] = useState(1);
  const [memberQueryInput, setMemberQueryInput] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [consentFilter, setConsentFilter] = useState('all');
  const [memberPagination, setMemberPagination] = useState<Pagination | null>(null);

  const [templates, setTemplates] = useState<ZokoTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const selectedTemplate = templates.find((template) => template.templateId === selectedTemplateId) || null;
  const [templateArgs, setTemplateArgs] = useState<string[]>([]);
  const [campaignName, setCampaignName] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  const [createGroupName, setCreateGroupName] = useState('');
  const [createGroupDescription, setCreateGroupDescription] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualConsent, setManualConsent] = useState<Customer['consentStatus']>('unknown');
  const [manualConsentConfirmed, setManualConsentConfirmed] = useState(false);
  const [importConsent, setImportConsent] = useState<Customer['consentStatus']>('unknown');
  const [importConsentConfirmed, setImportConsentConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCampaign, setConfirmCampaign] = useState<Campaign | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [sendingCampaignId, setSendingCampaignId] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const data = await api<{ success: true; groups: CustomerGroup[] }>('/api/marketing/groups');
      setGroups(data.groups);
      setSelectedGroupId((current) => current && data.groups.some((group) => group.id === current)
        ? current
        : data.groups[0]?.id || '');
    } catch (error) {
      toast({ title: 'تعذر تحميل المجموعات', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setGroupsLoading(false);
    }
  }, [toast]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const data = await api<{ success: true; templates: ZokoTemplate[] }>('/api/marketing/templates');
      setTemplates(data.templates);
      setSelectedTemplateId((current) => current && data.templates.some((template) => template.templateId === current)
        ? current
        : data.templates[0]?.templateId || '');
    } catch (error) {
      toast({ title: 'تعذر تحميل قوالب زوكو', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setTemplatesLoading(false);
    }
  }, [toast]);

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    try {
      const data = await api<{ success: true; campaigns: Campaign[] }>('/api/marketing/campaigns');
      setCampaigns(data.campaigns);
    } catch (error) {
      toast({ title: 'تعذر تحميل سجل الحملات', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setCampaignsLoading(false);
    }
  }, [toast]);

  const loadMembers = useCallback(async () => {
    if (!selectedGroupId) {
      setMembers([]);
      setMemberPagination(null);
      return;
    }
    setMembersLoading(true);
    try {
      const params = new URLSearchParams({ page: String(memberPage), perPage: '50' });
      if (memberQuery) params.set('q', memberQuery);
      if (consentFilter !== 'all') params.set('consent', consentFilter);
      const data = await api<{ success: true; members: Customer[]; pagination: Pagination }>(
        `/api/marketing/groups/${selectedGroupId}/members?${params.toString()}`
      );
      setMembers(data.members);
      setMemberPagination(data.pagination);
    } catch (error) {
      toast({ title: 'تعذر تحميل العملاء', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setMembersLoading(false);
    }
  }, [consentFilter, memberPage, memberQuery, selectedGroupId, toast]);

  useEffect(() => {
    void Promise.all([loadGroups(), loadTemplates(), loadCampaigns()]);
  }, [loadCampaigns, loadGroups, loadTemplates]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    setMemberPage(1);
  }, [selectedGroupId, consentFilter, memberQuery]);

  useEffect(() => {
    setTemplateArgs(Array.from({ length: selectedTemplate?.templateVariableCount || 0 }, () => ''));
  }, [selectedTemplate?.templateId, selectedTemplate?.templateVariableCount]);

  const totalMembers = useMemo(() => groups.reduce((sum, group) => sum + group.memberCount, 0), [groups]);
  const totalOptedIn = useMemo(() => groups.reduce((sum, group) => sum + group.optedInCount, 0), [groups]);

  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!createGroupName.trim()) return;
    setBusy('group');
    try {
      const data = await api<{ success: true; group: CustomerGroup }>('/api/marketing/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createGroupName, description: createGroupDescription }),
      });
      setCreateGroupName('');
      setCreateGroupDescription('');
      await loadGroups();
      setSelectedGroupId(data.group.id);
      toast({ title: 'تم إنشاء المجموعة' });
    } catch (error) {
      toast({ title: 'تعذر إنشاء المجموعة', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const addCustomer = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedGroupId) return;
    setBusy('member');
    try {
      await api(`/api/marketing/groups/${selectedGroupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: manualName,
          phone: manualPhone,
          email: manualEmail,
          consentStatus: manualConsent,
          confirmMarketingConsent: manualConsentConfirmed,
        }),
      });
      setManualName('');
      setManualPhone('');
      setManualEmail('');
      setManualConsent('unknown');
      setManualConsentConfirmed(false);
      await Promise.all([loadGroups(), loadMembers()]);
      toast({ title: 'تمت إضافة العميل' });
    } catch (error) {
      toast({ title: 'تعذر إضافة العميل', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const importCustomers = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedGroupId || !fileRef.current?.files?.[0]) return;
    const form = new FormData();
    form.set('file', fileRef.current.files[0]);
    form.set('defaultConsent', importConsent);
    form.set('confirmMarketingConsent', String(importConsentConfirmed));
    setBusy('import');
    try {
      const data = await api<{ imported: number; skippedDuplicates: number; invalidRows: number }>(
        `/api/marketing/groups/${selectedGroupId}/import`,
        { method: 'POST', body: form }
      );
      fileRef.current.value = '';
      await Promise.all([loadGroups(), loadMembers()]);
      toast({
        title: `تم استيراد ${data.imported} عميل`,
        description: `مكرر: ${data.skippedDuplicates}، غير صالح: ${data.invalidRows}`,
      });
    } catch (error) {
      toast({ title: 'تعذر استيراد الملف', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const removeCustomer = async (customer: Customer) => {
    if (!selectedGroupId || !window.confirm(`إزالة ${customer.name || customer.phone} من المجموعة؟`)) return;
    setBusy(`remove:${customer.id}`);
    try {
      await api(`/api/marketing/groups/${selectedGroupId}/members/${customer.id}`, { method: 'DELETE' });
      await Promise.all([loadGroups(), loadMembers()]);
    } catch (error) {
      toast({ title: 'تعذر إزالة العميل', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const createCampaign = async () => {
    if (!selectedGroup || !selectedTemplate) return;
    setBusy('campaign');
    try {
      const data = await api<{ success: true; campaign: Campaign }>('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: selectedGroup.id,
          name: campaignName,
          templateId: selectedTemplate.templateId,
          templateArgs,
        }),
      });
      setCampaignName('');
      await loadCampaigns();
      setConfirmCampaign({ ...data.campaign, group: { id: selectedGroup.id, name: selectedGroup.name } });
      toast({ title: 'تم تجهيز الحملة', description: 'راجع العدد ثم أكد الإرسال.' });
    } catch (error) {
      toast({ title: 'تعذر تجهيز الحملة', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const sendCampaign = async (campaign: Campaign) => {
    setConfirmCampaign(null);
    setConfirmationText('');
    setSendingCampaignId(campaign.id);
    try {
      let hasMore = true;
      let current = campaign;
      while (hasMore) {
        const data = await api<{ success: true; campaign: Campaign; hasMore: boolean }>(
          `/api/marketing/campaigns/${campaign.id}/send`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true }),
          }
        );
        current = { ...current, ...data.campaign, group: current.group };
        hasMore = data.hasMore;
        setCampaigns((rows) => rows.map((row) => row.id === current.id ? current : row));
      }
      toast({
        title: current.status === 'completed' ? 'اكتمل إرسال الحملة' : 'انتهت الحملة مع بعض الأخطاء',
        description: `تم: ${current.sentCount}، فشل: ${current.failedCount}، تخطي: ${current.skippedCount}`,
        variant: current.status === 'completed' ? 'default' : 'destructive',
      });
      await Promise.all([loadCampaigns(), loadGroups()]);
    } catch (error) {
      toast({
        title: 'توقف الإرسال ويمكن استكماله',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
      await loadCampaigns();
    } finally {
      setSendingCampaignId(null);
    }
  };

  return (
    <AppPageShell
      title="حملات واتساب"
      subtitle="مجموعات العملاء، قوالب زوكو، وسجل إرسال قابل للتدقيق"
      contentClassName="flex flex-1 flex-col gap-6 p-4 md:p-6"
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>المجموعات</CardDescription><CardTitle>{groups.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>إجمالي العملاء</CardDescription><CardTitle>{totalMembers.toLocaleString('ar-SA')}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>موافقون تسويقياً</CardDescription><CardTitle>{totalOptedIn.toLocaleString('ar-SA')}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>قوالب زوكو النشطة</CardDescription><CardTitle>{templates.length}</CardTitle></CardHeader></Card>
      </div>

      <Alert>
        <AlertTriangle className="size-4" />
        <AlertTitle>حماية الإرسال</AlertTitle>
        <AlertDescription>
          لا يدخل أي عميل في الحملة إلا إذا كانت حالته «موافق». إذا ذكر القالب عدداً حصرياً مثل «ضمن 30 عميلة»، يمنع النظام الإرسال إلى مجموعة بحجم مختلف.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="groups" className="space-y-4">
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="groups">المجموعات والعملاء</TabsTrigger>
          <TabsTrigger value="compose">إنشاء حملة</TabsTrigger>
          <TabsTrigger value="history">سجل الحملات</TabsTrigger>
        </TabsList>

        <TabsContent value="groups" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-lg">مجموعة جديدة</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={createGroup}>
                    <div className="space-y-1"><Label>الاسم</Label><Input value={createGroupName} onChange={(event) => setCreateGroupName(event.target.value)} placeholder="عملاء عرض 48 ساعة" /></div>
                    <div className="space-y-1"><Label>الوصف</Label><Textarea value={createGroupDescription} onChange={(event) => setCreateGroupDescription(event.target.value)} rows={3} /></div>
                    <Button className="w-full" disabled={busy === 'group' || !createGroupName.trim()}>
                      {busy === 'group' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} إنشاء المجموعة
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-lg">المجموعات</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {groupsLoading ? <Loader2 className="mx-auto size-5 animate-spin" /> : groups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">أنشئ أول مجموعة للبدء.</p>
                  ) : groups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`w-full rounded-lg border p-3 text-start transition ${selectedGroupId === group.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                    >
                      <div className="flex items-center justify-between gap-2"><span className="font-semibold">{group.name}</span><Badge variant="secondary">{group.memberCount}</Badge></div>
                      <div className="mt-2 text-xs text-muted-foreground">موافقون: {group.optedInCount} · حملات: {group.campaignCount}</div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              {!selectedGroup ? (
                <Card><CardContent className="py-16 text-center text-muted-foreground"><Users className="mx-auto mb-3 size-10" />اختر مجموعة أو أنشئ مجموعة جديدة.</CardContent></Card>
              ) : (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>{selectedGroup.name}</CardTitle>
                      <CardDescription>{selectedGroup.description || 'بدون وصف'}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg bg-muted p-3"><div className="text-xs text-muted-foreground">موافق</div><div className="text-xl font-bold text-emerald-600">{selectedGroup.optedInCount}</div></div>
                      <div className="rounded-lg bg-muted p-3"><div className="text-xs text-muted-foreground">موافقة غير محددة</div><div className="text-xl font-bold">{selectedGroup.unknownConsentCount}</div></div>
                      <div className="rounded-lg bg-muted p-3"><div className="text-xs text-muted-foreground">منسحب</div><div className="text-xl font-bold text-destructive">{selectedGroup.optedOutCount}</div></div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><UserPlus className="size-5" /> إضافة عميل</CardTitle></CardHeader>
                      <CardContent>
                        <form className="space-y-3" onSubmit={addCustomer}>
                          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label>الاسم</Label><Input value={manualName} onChange={(e) => setManualName(e.target.value)} /></div><div className="space-y-1"><Label>الجوال مع رمز الدولة</Label><Input dir="ltr" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} placeholder="+9665XXXXXXXX" required /></div></div>
                          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label>البريد</Label><Input dir="ltr" type="email" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} /></div><div className="space-y-1"><Label>الموافقة التسويقية</Label><NativeSelect className="w-full" value={manualConsent} onChange={(e) => { setManualConsent(e.target.value as Customer['consentStatus']); setManualConsentConfirmed(false); }}><NativeSelectOption value="unknown">غير محددة</NativeSelectOption><NativeSelectOption value="opted_in">موافق</NativeSelectOption><NativeSelectOption value="opted_out">منسحب</NativeSelectOption></NativeSelect></div></div>
                          {manualConsent === 'opted_in' && <label className="flex items-start gap-2 text-sm"><Checkbox checked={manualConsentConfirmed} onCheckedChange={(checked) => setManualConsentConfirmed(checked === true)} /><span>أؤكد أن العميل وافق صراحة على استلام رسائل تسويقية عبر واتساب.</span></label>}
                          <Button disabled={busy === 'member' || !manualPhone || (manualConsent === 'opted_in' && !manualConsentConfirmed)}>{busy === 'member' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} إضافة</Button>
                        </form>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Upload className="size-5" /> استيراد CSV</CardTitle><CardDescription>الأعمدة المدعومة: name, phone, email, consent_status</CardDescription></CardHeader>
                      <CardContent>
                        <form className="space-y-3" onSubmit={importCustomers}>
                          <Input ref={fileRef} type="file" accept=".csv,text/csv" required />
                          <div className="space-y-1"><Label>الحالة الافتراضية إذا لم توجد في الملف</Label><NativeSelect className="w-full" value={importConsent} onChange={(e) => { setImportConsent(e.target.value as Customer['consentStatus']); setImportConsentConfirmed(false); }}><NativeSelectOption value="unknown">غير محددة</NativeSelectOption><NativeSelectOption value="opted_in">موافق</NativeSelectOption><NativeSelectOption value="opted_out">منسحب</NativeSelectOption></NativeSelect></div>
                          {importConsent === 'opted_in' && <label className="flex items-start gap-2 text-sm"><Checkbox checked={importConsentConfirmed} onCheckedChange={(checked) => setImportConsentConfirmed(checked === true)} /><span>أؤكد أن جميع العملاء المحددين كموافقين قدموا موافقة تسويقية صريحة.</span></label>}
                          <div className="flex flex-wrap gap-2">
                            <Button disabled={busy === 'import' || (importConsent === 'opted_in' && !importConsentConfirmed)}>{busy === 'import' ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} استيراد</Button>
                            <Button asChild type="button" variant="outline"><a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvExample)}`} download="marketing-customers-example.csv"><Download className="size-4" /> نموذج CSV</a></Button>
                          </div>
                        </form>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-lg">عملاء المجموعة</CardTitle><CardDescription>{memberPagination?.total || 0} عميل نشط</CardDescription></div><Button variant="outline" size="sm" onClick={() => void loadMembers()}><RefreshCcw className="size-4" /> تحديث</Button></div>
                      <form className="flex flex-wrap gap-2 pt-3" onSubmit={(event) => { event.preventDefault(); setMemberQuery(memberQueryInput.trim()); }}><div className="relative min-w-64 flex-1"><Search className="absolute right-3 top-2.5 size-4 text-muted-foreground" /><Input className="pr-9" value={memberQueryInput} onChange={(e) => setMemberQueryInput(e.target.value)} placeholder="بحث بالاسم أو الجوال" /></div><NativeSelect value={consentFilter} onChange={(e) => setConsentFilter(e.target.value)}><NativeSelectOption value="all">كل حالات الموافقة</NativeSelectOption><NativeSelectOption value="opted_in">موافق</NativeSelectOption><NativeSelectOption value="unknown">غير محدد</NativeSelectOption><NativeSelectOption value="opted_out">منسحب</NativeSelectOption></NativeSelect><Button type="submit" variant="secondary">بحث</Button></form>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>العميل</TableHead><TableHead>الجوال</TableHead><TableHead>المصدر</TableHead><TableHead>الموافقة</TableHead><TableHead>تاريخ الإضافة</TableHead><TableHead /></TableRow></TableHeader><TableBody>{membersLoading ? <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="mx-auto size-5 animate-spin" /></TableCell></TableRow> : members.length === 0 ? <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">لا يوجد عملاء مطابقون.</TableCell></TableRow> : members.map((member) => <TableRow key={member.id}><TableCell><div className="font-medium">{member.name || 'بدون اسم'}</div><div className="text-xs text-muted-foreground">{member.email || '—'}</div></TableCell><TableCell dir="ltr" className="text-right font-mono">{member.phone}</TableCell><TableCell>{member.source === 'csv' ? 'CSV' : 'يدوي'}</TableCell><TableCell><Badge variant={member.consentStatus === 'opted_in' ? 'default' : member.consentStatus === 'opted_out' ? 'destructive' : 'secondary'}>{consentLabel(member.consentStatus)}</Badge></TableCell><TableCell>{dateLabel(member.createdAt)}</TableCell><TableCell><Button size="icon" variant="ghost" disabled={busy === `remove:${member.id}`} onClick={() => void removeCustomer(member)}><Trash2 className="size-4 text-destructive" /></Button></TableCell></TableRow>)}</TableBody></Table></div>
                      {memberPagination && memberPagination.totalPages > 1 && <div className="mt-4 flex items-center justify-between"><Button variant="outline" size="sm" disabled={memberPage <= 1} onClick={() => setMemberPage((page) => page - 1)}>السابق</Button><span className="text-sm text-muted-foreground">صفحة {memberPage} من {memberPagination.totalPages}</span><Button variant="outline" size="sm" disabled={memberPage >= memberPagination.totalPages} onClick={() => setMemberPage((page) => page + 1)}>التالي</Button></div>}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="compose" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <Card>
              <CardHeader><CardTitle>إعداد الحملة</CardTitle><CardDescription>لن يبدأ الإرسال عند الحفظ؛ ستظهر خطوة تأكيد مستقلة.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1"><Label>اسم الحملة</Label><Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="عرض 48 ساعة - أغسطس" /></div>
                <div className="space-y-1"><Label>مجموعة العملاء</Label><NativeSelect className="w-full" value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}><NativeSelectOption value="">اختر مجموعة</NativeSelectOption>{groups.map((group) => <NativeSelectOption key={group.id} value={group.id}>{group.name} — {group.optedInCount} موافق</NativeSelectOption>)}</NativeSelect></div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label>قالب زوكو</Label>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void loadTemplates()} disabled={templatesLoading}>
                      {templatesLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />} تحديث
                    </Button>
                  </div>
                  <Popover open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={templatePickerOpen}
                        className="w-full justify-between font-normal"
                        disabled={templatesLoading}
                      >
                        <span className="truncate">
                          {selectedTemplate
                            ? `${selectedTemplate.templateId} (${selectedTemplate.templateLanguage})`
                            : 'ابحث عن قالب زوكو...'}
                        </span>
                        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                      <Command>
                        <CommandInput placeholder="ابحث بالاسم أو محتوى القالب..." />
                        <CommandList>
                          <CommandEmpty>لا يوجد قالب مطابق.</CommandEmpty>
                          <CommandGroup>
                            {templates.map((template) => (
                              <CommandItem
                                key={`${template.templateId}:${template.templateLanguage}`}
                                value={`${template.templateId} ${template.templateLanguage} ${template.templateDesc}`}
                                onSelect={() => {
                                  setSelectedTemplateId(template.templateId);
                                  setTemplatePickerOpen(false);
                                }}
                              >
                                <Check className={`size-4 ${selectedTemplateId === template.templateId ? 'opacity-100' : 'opacity-0'}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-mono text-xs">{template.templateId}</div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {template.templateLanguage} · {template.templateType} · {template.templateVariableCount} متغير
                                  </div>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                {templateArgs.map((value, index) => <div className="space-y-1" key={index}><Label>متغير القالب {index + 1}</Label><Input dir={index === 0 && selectedTemplate?.templateType === 'richTemplate' ? 'ltr' : undefined} value={value} onChange={(e) => setTemplateArgs((rows) => rows.map((row, rowIndex) => rowIndex === index ? e.target.value : row))} placeholder={index === 0 && selectedTemplate?.templateType === 'richTemplate' ? 'رابط وسائط الرأس أو قيمة المتغير' : `قيمة {{${index + 1}}}`} /></div>)}
                <Button className="w-full" onClick={() => void createCampaign()} disabled={busy === 'campaign' || !campaignName.trim() || !selectedGroup || !selectedTemplate || templateArgs.some((value) => !value.trim()) || selectedGroup.optedInCount === 0}>{busy === 'campaign' ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />} تجهيز الحملة للمراجعة</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>معاينة القالب</CardTitle><CardDescription>{selectedTemplate ? `${selectedTemplate.templateType} · ${selectedTemplate.templateLanguage} · ${selectedTemplate.templateVariableCount} متغير` : 'اختر قالباً من زوكو'}</CardDescription></CardHeader>
              <CardContent>
                {selectedTemplate ? <div className="mx-auto max-w-lg rounded-2xl bg-[#efeae2] p-4 shadow-inner"><div className="rounded-lg bg-white p-4 shadow-sm"><div className="mb-2 text-xs font-semibold text-emerald-700">{selectedTemplate.templateId}</div><pre className="whitespace-pre-wrap font-sans text-sm leading-7">{selectedTemplate.templateDesc || 'لا يتوفر وصف للقالب من زوكو.'}</pre></div></div> : <div className="py-20 text-center text-muted-foreground"><Send className="mx-auto mb-3 size-10" />اختر قالباً لعرض محتواه.</div>}
                {selectedGroup && <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">المجموعة</div><div className="font-semibold">{selectedGroup.name}</div></div><div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">المستلمون المؤهلون</div><div className="text-xl font-bold">{selectedGroup.optedInCount}</div></div></div>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>سجل الحملات</CardTitle><CardDescription>الحفظ والإرسال والتقدم لكل حملة.</CardDescription></div><Button variant="outline" size="sm" onClick={() => void loadCampaigns()}><RefreshCcw className="size-4" /> تحديث</Button></div></CardHeader>
            <CardContent><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>الحملة</TableHead><TableHead>المجموعة</TableHead><TableHead>القالب</TableHead><TableHead>الحالة</TableHead><TableHead>التقدم</TableHead><TableHead>التاريخ</TableHead><TableHead /></TableRow></TableHeader><TableBody>{campaignsLoading ? <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="mx-auto size-5 animate-spin" /></TableCell></TableRow> : campaigns.length === 0 ? <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">لا توجد حملات بعد.</TableCell></TableRow> : campaigns.map((campaign) => { const finished = campaign.sentCount + campaign.failedCount + campaign.skippedCount; const percent = campaign.totalRecipients ? Math.round(finished / campaign.totalRecipients * 100) : 0; const canSend = ['ready', 'sending'].includes(campaign.status); return <TableRow key={campaign.id}><TableCell><div className="font-semibold">{campaign.name}</div><div className="text-xs text-muted-foreground">{campaign.totalRecipients} مستلم</div></TableCell><TableCell>{campaign.group?.name || '—'}</TableCell><TableCell className="font-mono text-xs">{campaign.templateId}</TableCell><TableCell><Badge variant={statusVariant(campaign.status)}>{statusLabel(campaign.status)}</Badge></TableCell><TableCell className="min-w-44"><div className="mb-1 flex justify-between text-xs"><span>{campaign.sentCount} تم</span><span>{campaign.failedCount} فشل</span></div><Progress value={percent} /></TableCell><TableCell>{dateLabel(campaign.createdAt)}</TableCell><TableCell>{canSend && <Button size="sm" disabled={Boolean(sendingCampaignId)} onClick={() => { setConfirmCampaign(campaign); setConfirmationText(''); }}>{sendingCampaignId === campaign.id ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{campaign.status === 'sending' ? 'استكمال' : 'إرسال'}</Button>}</TableCell></TableRow>; })}</TableBody></Table></div></CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmationDialog
        open={Boolean(confirmCampaign)}
        title="تأكيد إرسال حملة واتساب"
        message={confirmCampaign ? `سيتم إرسال القالب ${confirmCampaign.templateId} إلى ${confirmCampaign.totalRecipients} عميل في مجموعة ${confirmCampaign.group?.name || ''}. لا يمكن التراجع عن الرسائل التي تم إرسالها.` : ''}
        confirmLabel="ابدأ الإرسال"
        cancelLabel="إلغاء"
        confirmVariant="danger"
        confirmDisabled={confirmationText !== 'إرسال'}
        onCancel={() => { setConfirmCampaign(null); setConfirmationText(''); }}
        onConfirm={() => { if (confirmCampaign && confirmationText === 'إرسال') void sendCampaign(confirmCampaign); }}
        content={<div className="mt-4 space-y-2"><Label>اكتب «إرسال» للتأكيد</Label><Input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} /></div>}
      />
    </AppPageShell>
  );
}
