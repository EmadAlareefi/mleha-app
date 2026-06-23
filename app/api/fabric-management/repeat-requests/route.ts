import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';

const FABRIC_SERVICE = 'fabric-management';

// Stage lifecycle (index 0 = none). Mirrors the design prototype.
const STAGES = ['—', 'مطلوب', 'تم الطلب', 'تم الصنع', 'تم الشحن', 'متوفر'];

function toInt(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getActor(session: any) {
  return (
    session?.user?.username ||
    session?.user?.name ||
    session?.user?.email ||
    session?.user?.id ||
    'admin'
  );
}

function parseDate(value: unknown): Date | null {
  const text = cleanText(value);
  if (!text) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function requireAccess() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      error: NextResponse.json(
        { error: 'يجب تسجيل الدخول للوصول إلى طلبات التكرار' },
        { status: 401 }
      ),
    };
  }
  if (!hasServiceAccess(session, FABRIC_SERVICE)) {
    return {
      error: NextResponse.json({ error: 'لا تملك صلاحية لإدارة طلبات التكرار' }, { status: 403 }),
    };
  }
  return { session };
}

type RepeatRequestWithRelations = Prisma.RepeatRequestGetPayload<{
  include: {
    designModel: true;
    tailor: true;
    sizes: true;
    notes: true;
    logs: true;
  };
}>;

const includeAll = {
  designModel: true,
  tailor: true,
  sizes: { orderBy: { label: 'asc' } },
  notes: { orderBy: { createdAt: 'desc' } },
  logs: { orderBy: { createdAt: 'desc' }, take: 100 },
} satisfies Prisma.RepeatRequestInclude;

function serialize(rr: RepeatRequestWithRelations) {
  const sizesTotal = rr.sizes.reduce((sum, s) => sum + s.count, 0);
  return {
    id: rr.id,
    designModelId: rr.designModelId,
    sku: rr.designModel.sku,
    imageData: rr.designModel.imageData,
    tailorId: rr.tailorId,
    tailorName: rr.tailor?.name ?? null,
    stage: rr.stage,
    modelCount: rr.modelCount,
    totalCount: rr.modelCount + sizesTotal,
    repeatDate: rr.repeatDate ? rr.repeatDate.toISOString() : null,
    arrivalDate: rr.arrivalDate ? rr.arrivalDate.toISOString() : null,
    inStock: rr.inStock,
    pinned: rr.pinned,
    updatedAt: rr.updatedAt.toISOString(),
    sizes: rr.sizes.map((s) => ({ id: s.id, label: s.label, count: s.count })),
    notes: rr.notes.map((n) => ({
      id: n.id,
      authorName: n.authorName,
      message: n.message,
      edited: n.edited,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    })),
    logs: rr.logs.map((l) => ({
      id: l.id,
      actor: l.actor,
      action: l.action,
      detail: l.detail,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

// Write a log row + bump the parent's updatedAt, inside the given client.
async function logAndTouch(
  client: Prisma.TransactionClient,
  repeatRequestId: string,
  actor: string,
  action: string,
  detail?: string | null
) {
  await client.repeatRequestLog.create({
    data: { repeatRequestId, actor, action, detail: detail ?? null },
  });
  await client.repeatRequest.update({
    where: { id: repeatRequestId },
    data: { updatedAt: new Date() },
  });
}

export async function GET() {
  try {
    const access = await requireAccess();
    if (access.error) return access.error;

    const [requests, models, tailors] = await Promise.all([
      prisma.repeatRequest.findMany({
        include: includeAll,
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      }),
      prisma.designModel.findMany({
        where: { isActive: true, repeatRequest: null },
        select: { id: true, sku: true, size: true, imageData: true },
        orderBy: { sku: 'asc' },
      }),
      prisma.tailor.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const serialized = requests.map(serialize);
    const totalRequests = serialized.reduce((sum, r) => sum + r.totalCount, 0);

    return NextResponse.json({
      requests: serialized,
      availableModels: models,
      tailors,
      stats: {
        models: serialized.length,
        totalRequests,
        waiting: serialized.filter((r) => r.totalCount > 0 && !r.inStock).length,
        inStock: serialized.filter((r) => r.inStock).length,
      },
    });
  } catch (error) {
    console.error('Error fetching repeat requests:', error);
    return NextResponse.json({ error: 'فشل في جلب طلبات التكرار' }, { status: 500 });
  }
}

async function loadAndRespond(id: string) {
  const fresh = await prisma.repeatRequest.findUnique({ where: { id }, include: includeAll });
  if (!fresh) {
    return NextResponse.json({ error: 'طلب التكرار غير موجود' }, { status: 404 });
  }
  return NextResponse.json({ request: serialize(fresh) });
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAccess();
    if (access.error) return access.error;
    const actor = getActor(access.session);

    const body = await request.json();
    const action = body.action as string;

    // ---- create (start tracking a DesignModel) ----
    if (action === 'repeat-create') {
      const designModelId = cleanText(body.designModelId);
      if (!designModelId) {
        return NextResponse.json({ error: 'اختر الموديل (SKU) لتتبعه' }, { status: 400 });
      }
      const model = await prisma.designModel.findUnique({ where: { id: designModelId } });
      if (!model) {
        return NextResponse.json({ error: 'الموديل غير موجود' }, { status: 404 });
      }
      const existing = await prisma.repeatRequest.findUnique({ where: { designModelId } });
      if (existing) {
        return NextResponse.json({ error: 'هذا الموديل متتبَّع بالفعل' }, { status: 409 });
      }
      const labels = Array.isArray(body.sizes)
        ? Array.from(new Set(body.sizes.map((s: unknown) => cleanText(s)).filter(Boolean)))
        : [];
      const tailorId = cleanText(body.tailorId) || null;

      const created = await prisma.repeatRequest.create({
        data: {
          designModelId,
          tailorId,
          sizes: { create: (labels as string[]).map((label) => ({ label })) },
          logs: { create: { actor, action: 'بدء التتبع', detail: model.sku } },
        },
        include: includeAll,
      });
      return NextResponse.json({ request: serialize(created) });
    }

    // All remaining actions operate on an existing repeat request (by id).
    const id = cleanText(body.id);
    if (action !== 'repeat-edit-note' && !id) {
      return NextResponse.json({ error: 'معرّف طلب التكرار مطلوب' }, { status: 400 });
    }

    // ---- set stage ----
    if (action === 'repeat-set-stage') {
      const stage = toInt(body.stage);
      if (stage < 0 || stage > 5) {
        return NextResponse.json({ error: 'مرحلة غير صحيحة' }, { status: 400 });
      }
      await prisma.$transaction(async (tx) => {
        await tx.repeatRequest.update({
          where: { id },
          data: { stage, inStock: stage === 5 },
        });
        await logAndTouch(tx, id, actor, 'تغيير المرحلة', STAGES[stage]);
      });
      return loadAndRespond(id);
    }

    // ---- change a counter (model or a specific size) ----
    if (action === 'repeat-change-count') {
      const delta = toInt(body.delta);
      const target = cleanText(body.target); // 'model' | <sizeId>
      if (delta === 0) return loadAndRespond(id);

      await prisma.$transaction(async (tx) => {
        if (target === 'model') {
          const rr = await tx.repeatRequest.findUnique({ where: { id } });
          if (!rr) throw new Error('طلب التكرار غير موجود');
          const next = Math.max(0, rr.modelCount + delta);
          await tx.repeatRequest.update({ where: { id }, data: { modelCount: next } });
          await logAndTouch(tx, id, actor, delta > 0 ? 'زيادة' : 'تقليل', 'الموديل');
        } else {
          const size = await tx.repeatRequestSize.findUnique({ where: { id: target } });
          if (!size || size.repeatRequestId !== id) throw new Error('المقاس غير موجود');
          const next = Math.max(0, size.count + delta);
          await tx.repeatRequestSize.update({ where: { id: target }, data: { count: next } });
          await logAndTouch(tx, id, actor, delta > 0 ? 'زيادة' : 'تقليل', 'مقاس ' + size.label);
        }
      });
      return loadAndRespond(id);
    }

    // ---- reset a single counter to zero ----
    if (action === 'repeat-reset-counter') {
      const target = cleanText(body.target);
      await prisma.$transaction(async (tx) => {
        if (target === 'model') {
          await tx.repeatRequest.update({ where: { id }, data: { modelCount: 0 } });
          await logAndTouch(tx, id, actor, 'تصفير', 'الموديل');
        } else {
          const size = await tx.repeatRequestSize.findUnique({ where: { id: target } });
          if (!size || size.repeatRequestId !== id) throw new Error('المقاس غير موجود');
          await tx.repeatRequestSize.update({ where: { id: target }, data: { count: 0 } });
          await logAndTouch(tx, id, actor, 'تصفير', 'مقاس ' + size.label);
        }
      });
      return loadAndRespond(id);
    }

    // ---- reset selected sections (stage / count / dates / notes / log) ----
    if (action === 'repeat-reset-sections') {
      const sections: string[] = Array.isArray(body.sections) ? body.sections : [];
      if (!sections.length) {
        return NextResponse.json({ error: 'اختر قسماً واحداً على الأقل' }, { status: 400 });
      }
      const labelMap: Record<string, string> = {
        stage: 'مرحلة الطلب',
        count: 'العداد',
        dates: 'التواريخ',
        notes: 'الملاحظات',
        log: 'السجل',
      };
      await prisma.$transaction(async (tx) => {
        const data: Prisma.RepeatRequestUpdateInput = {};
        if (sections.includes('stage')) {
          data.stage = 0;
          data.inStock = false;
        }
        if (sections.includes('count')) {
          data.modelCount = 0;
          await tx.repeatRequestSize.updateMany({ where: { repeatRequestId: id }, data: { count: 0 } });
        }
        if (sections.includes('dates')) {
          data.repeatDate = null;
          data.arrivalDate = null;
        }
        if (sections.includes('notes')) {
          await tx.repeatRequestNote.deleteMany({ where: { repeatRequestId: id } });
        }
        if (Object.keys(data).length) {
          await tx.repeatRequest.update({ where: { id }, data });
        }
        if (sections.includes('log')) {
          await tx.repeatRequestLog.deleteMany({ where: { repeatRequestId: id } });
          await tx.repeatRequest.update({ where: { id }, data: { updatedAt: new Date() } });
        } else {
          const parts = sections.map((s) => labelMap[s]).filter(Boolean);
          await logAndTouch(tx, id, actor, 'إعادة تهيئة', parts.join('، '));
        }
      });
      return loadAndRespond(id);
    }

    // ---- save a date field ----
    if (action === 'repeat-save-date') {
      const field = cleanText(body.field);
      if (field !== 'repeatDate' && field !== 'arrivalDate') {
        return NextResponse.json({ error: 'حقل تاريخ غير صحيح' }, { status: 400 });
      }
      const value = parseDate(body.value);
      const actionLabel = field === 'repeatDate' ? 'تحديد تاريخ التكرار' : 'تحديد تاريخ الوصول';
      await prisma.$transaction(async (tx) => {
        await tx.repeatRequest.update({ where: { id }, data: { [field]: value } });
        await logAndTouch(tx, id, actor, actionLabel, value ? value.toISOString().slice(0, 10) : '—');
      });
      return loadAndRespond(id);
    }

    // ---- toggle warehouse availability ----
    if (action === 'repeat-toggle-stock') {
      await prisma.$transaction(async (tx) => {
        const rr = await tx.repeatRequest.findUnique({ where: { id } });
        if (!rr) throw new Error('طلب التكرار غير موجود');
        const next = !rr.inStock;
        await tx.repeatRequest.update({ where: { id }, data: { inStock: next } });
        await logAndTouch(
          tx,
          id,
          actor,
          next ? 'تفعيل التوفر' : 'إلغاء التوفر',
          next ? 'متوفر' : 'غير متوفر'
        );
      });
      return loadAndRespond(id);
    }

    // ---- toggle pin (no log, matches prototype) ----
    if (action === 'repeat-toggle-pin') {
      const rr = await prisma.repeatRequest.findUnique({ where: { id } });
      if (!rr) return NextResponse.json({ error: 'طلب التكرار غير موجود' }, { status: 404 });
      await prisma.repeatRequest.update({ where: { id }, data: { pinned: !rr.pinned } });
      return loadAndRespond(id);
    }

    // ---- assign / change tailor ----
    if (action === 'repeat-set-tailor') {
      const tailorId = cleanText(body.tailorId) || null;
      let tailorName = '—';
      if (tailorId) {
        const tailor = await prisma.tailor.findUnique({ where: { id: tailorId } });
        if (!tailor) return NextResponse.json({ error: 'الخياط غير موجود' }, { status: 404 });
        tailorName = tailor.name;
      }
      await prisma.$transaction(async (tx) => {
        await tx.repeatRequest.update({ where: { id }, data: { tailorId } });
        await logAndTouch(tx, id, actor, 'تعيين الخياط', tailorName);
      });
      return loadAndRespond(id);
    }

    // ---- add a team note ----
    if (action === 'repeat-add-note') {
      const message = cleanText(body.message);
      if (!message) return NextResponse.json({ error: 'الملاحظة فارغة' }, { status: 400 });
      await prisma.$transaction(async (tx) => {
        await tx.repeatRequestNote.create({
          data: { repeatRequestId: id, authorName: actor, message },
        });
        await logAndTouch(tx, id, actor, 'ملاحظة', actor);
      });
      return loadAndRespond(id);
    }

    // ---- edit a note (author only) ----
    if (action === 'repeat-edit-note') {
      const noteId = cleanText(body.noteId);
      const message = cleanText(body.message);
      if (!noteId || !message) {
        return NextResponse.json({ error: 'بيانات التعديل ناقصة' }, { status: 400 });
      }
      const note = await prisma.repeatRequestNote.findUnique({ where: { id: noteId } });
      if (!note) return NextResponse.json({ error: 'الملاحظة غير موجودة' }, { status: 404 });
      if (note.authorName !== actor) {
        return NextResponse.json({ error: 'يمكنك تعديل ملاحظاتك فقط' }, { status: 403 });
      }
      await prisma.$transaction(async (tx) => {
        await tx.repeatRequestNote.update({
          where: { id: noteId },
          data: { message, edited: true },
        });
        await logAndTouch(tx, note.repeatRequestId, actor, 'تعديل ملاحظة', note.authorName);
      });
      return loadAndRespond(note.repeatRequestId);
    }

    // ---- delete (untrack) ----
    if (action === 'repeat-delete') {
      await prisma.repeatRequest.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (error) {
    console.error('Error in repeat requests action:', error);
    const message = error instanceof Error ? error.message : 'فشل تنفيذ الإجراء';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
