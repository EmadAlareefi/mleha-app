import { prisma } from '@/lib/prisma';
import { expenseUser, errorResponse } from '@/app/lib/expenses/auth';
import { ExpenseError } from '@/app/lib/expenses/domain';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await expenseUser();
    const invoice = await prisma.adImportedInvoice.findUnique({ where: { id: (await context.params).id }, select: { document: true } });
    if (!invoice?.document) throw new ExpenseError('المستند غير متاح', 404);
    return new Response(new Uint8Array(invoice.document), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="invoice.pdf"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (e) { return errorResponse(e); }
}
