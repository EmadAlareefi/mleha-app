import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

type NotePayload = {
  itemId?: string;
  note?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { returnRequestId, notes } = body as {
      returnRequestId?: string;
      notes?: NotePayload[];
    };

    if (!returnRequestId || !Array.isArray(notes)) {
      return NextResponse.json(
        { error: 'بيانات الملاحظات غير مكتملة' },
        { status: 400 }
      );
    }

    const normalizedNotes = notes
      .map((entry) => ({
        itemId: entry.itemId?.trim(),
        note: entry.note?.trim()
          ? entry.note.trim().slice(0, 1000)
          : null,
      }))
      .filter((entry) => Boolean(entry.itemId)) as Array<{
        itemId: string;
        note: string | null;
      }>;

    if (normalizedNotes.length === 0) {
      return NextResponse.json(
        { error: 'لا توجد عناصر لتحديثها' },
        { status: 400 }
      );
    }

    const requestRecord = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: { items: true },
    });

    if (!requestRecord) {
      return NextResponse.json(
        { error: 'طلب الإرجاع غير موجود' },
        { status: 404 }
      );
    }

    const itemsById = new Map(
      requestRecord.items.map((item) => [item.id, item])
    );

    for (const entry of normalizedNotes) {
      const item = itemsById.get(entry.itemId);
      if (!item) {
        return NextResponse.json(
          { error: 'العنصر المحدد غير مرتبط بطلب الإرجاع' },
          { status: 400 }
        );
      }
      if (item.conditionStatus) {
        return NextResponse.json(
          { error: 'لا يمكن تعديل العناصر التي تم فحصها بالفعل' },
          { status: 400 }
        );
      }
    }

    await prisma.$transaction(
      normalizedNotes.map((entry) =>
        prisma.returnItem.update({
          where: { id: entry.itemId },
          data: {
            preInspectionNotes: entry.note,
          },
        })
      )
    );

    const updatedItems = await prisma.returnItem.findMany({
      where: {
        id: {
          in: normalizedNotes.map((entry) => entry.itemId),
        },
      },
      select: {
        id: true,
        preInspectionNotes: true,
      },
    });

    log.info('Updated pre-inspection notes', {
      returnRequestId,
      count: updatedItems.length,
    });

    return NextResponse.json({
      success: true,
      items: updatedItems,
    });
  } catch (error) {
    log.error('Failed to update pre-inspection notes', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء حفظ الملاحظات' },
      { status: 500 }
    );
  }
}
