'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, ExternalLink, Loader2, MoreHorizontal, Phone } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CopyPhoneButton } from '@/components/CopyPhoneButton';
import { TYPE_COLORS, typeLabel } from '@/app/lib/returns/status';
import { summarizeRequestMoney } from '@/lib/returns/money-summary';
import { STAGE_LABELS } from '@/lib/returns/workflow';
import { cn } from '@/lib/utils';
import { AttentionPanel, InfoSection, MoneySummary, ShipmentSection, StageProgress, TimelineSection } from './detail-sections';
import { ExchangeSection } from './exchange-section';
import { PiecesSection } from './pieces-section';
import { STAGE_BADGE } from './request-card';
import type { RequestActions } from './use-request-actions';
import { formatDate, REOPENABLE_STAGES, type ReturnRequest } from './types';

const sallaOrderUrl = (orderId: string) => `https://s.salla.sa/orders/order/${orderId}`;

/** Order number, type, stage and the customer; a visible back / close button on every screen size. */
export function DetailHeader({
  request,
  loading,
  onBack,
  title,
  description,
}: {
  request: ReturnRequest;
  loading?: boolean;
  onBack?: () => void;
  /** The sheet passes its accessible title / description wrappers. */
  title?: (children: ReactNode) => ReactNode;
  description?: (children: ReactNode) => ReactNode;
}) {
  const money = summarizeRequestMoney(request);
  const heading = (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-lg font-bold tracking-wide" dir="ltr">
        #{request.orderNumber}
      </span>
      <Badge className={cn('px-1.5', TYPE_COLORS[money.derivedType] || TYPE_COLORS.return)}>{typeLabel(money.derivedType)}</Badge>
      <Badge className={cn('px-1.5', STAGE_BADGE[request.stage])}>{STAGE_LABELS[request.stage]}</Badge>
      {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="جاري التحديث" />}
    </span>
  );
  const meta = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span className="text-foreground">{request.customerName}</span>
      {request.customerPhone && (
        <span className="inline-flex items-center gap-1">
          <a href={`tel:${request.customerPhone}`} className="inline-flex items-center gap-1 hover:text-foreground" dir="ltr">
            <Phone className="size-3.5" /> {request.customerPhone}
          </a>
          <CopyPhoneButton phone={request.customerPhone} />
        </span>
      )}
      <span>{formatDate(request.createdAt)}</span>
    </span>
  );
  return (
    <header className="sticky top-0 z-20 flex items-start gap-3 border-b bg-card/95 px-3 pb-3 pt-[max(env(safe-area-inset-top),12px)] backdrop-blur sm:px-4">
      {onBack && (
        <Button variant="outline" size="icon" className="size-10 shrink-0 rounded-full" onClick={onBack} aria-label="رجوع">
          <ArrowRight />
        </Button>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {title ? title(heading) : <h1>{heading}</h1>}
        {description ? description(meta) : <p>{meta}</p>}
      </div>
    </header>
  );
}

/** Everything about one request, most important first. */
export function RequestDetailBody({ request, actions }: { request: ReturnRequest; actions: RequestActions }) {
  const audit = Array.isArray(request.processingAudit) ? request.processingAudit : [];
  const shipmentFirst = ['awaiting_pickup', 'in_transit'].includes(request.stage) || Boolean(request.needsManualShipment);
  return (
    <div className="space-y-3 sm:space-y-4">
      <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-4" aria-label="ملخص الطلب">
        <StageProgress stage={request.stage} />
        <MoneySummary request={request} />
      </section>

      <AttentionPanel request={request} actions={actions} />
      <PiecesSection request={request} actions={actions} />
      <ExchangeSection request={request} actions={actions} />

      <Accordion
        key={request.id}
        type="multiple"
        defaultValue={shipmentFirst ? ['shipment'] : []}
        className="rounded-xl border bg-card px-3 sm:px-4"
      >
        <AccordionItem value="shipment">
          <AccordionTrigger className="min-h-12 items-center text-right text-base hover:no-underline">شحنة المرتجع</AccordionTrigger>
          <AccordionContent>
            <ShipmentSection request={request} actions={actions} />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="info">
          <AccordionTrigger className="min-h-12 items-center text-right text-base hover:no-underline">معلومات الطلب</AccordionTrigger>
          <AccordionContent>
            <InfoSection request={request} onOpenOverride={() => actions.open('window-override')} />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="timeline">
          <AccordionTrigger className="min-h-12 items-center text-right text-base hover:no-underline">سجل الطلب ({audit.length})</AccordionTrigger>
          <AccordionContent>
            <TimelineSection request={request} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

/**
 * The next step for this stage, always within thumb reach, plus a menu with
 * the rest. Sticky at the bottom with the phone's safe area.
 */
export function ActionBar({
  request,
  actions,
  showFullPageLink,
}: {
  request: ReturnRequest;
  actions: RequestActions;
  showFullPageLink?: boolean;
}) {
  const stage = request.stage;
  const open = !['completed', 'cancelled', 'rejected'].includes(request.status);
  const reopenable = REOPENABLE_STAGES.has(stage) && request.status !== 'cancelled';
  const money = summarizeRequestMoney(request);
  const busy = actions.busy !== null;

  const primary =
    stage === 'ready'
      ? { label: 'اعتماد ومعالجة', onClick: () => actions.open('process'), className: 'bg-emerald-600 text-white hover:bg-emerald-700' }
      : stage === 'needs_attention'
        ? { label: 'إعادة محاولة المعالجة', onClick: () => actions.open('process'), className: '' }
        : (stage === 'completed' || stage === 'closed') && reopenable
          ? { label: 'إعادة للمراجعة', onClick: () => actions.open('reopen'), className: '' }
          : null;

  const closeWithoutProcessing = () =>
    actions.askConfirm({
      title: 'إغلاق بدون معالجة',
      message: 'يُغلق الطلب دون استرجاع أو إرجاع للمخزون أو كوبون من النظام. استخدميه فقط إذا تمت المعالجة خارج النظام.',
      danger: true,
      confirmLabel: 'إغلاق الطلب',
      action: () => actions.run('close', '/api/returns/update', { id: request.id, status: 'completed' }, () => 'تم إغلاق الطلب.'),
    });

  return (
    <div className="sticky bottom-0 z-20 flex items-center gap-2 border-t bg-card/95 px-3 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur sm:px-4">
      {primary ? (
        <Button onClick={primary.onClick} disabled={busy} className={cn('h-12 flex-1 text-base sm:h-10', primary.className)}>
          {primary.label}
        </Button>
      ) : (
        <p className="flex-1 text-sm text-muted-foreground">
          {stage === 'received'
            ? 'بانتظار فحص القطع في المستودع.'
            : stage === 'processing'
              ? 'قيد المعالجة…'
              : stage === 'closed'
                ? 'الطلب ملغي.'
                : 'يتقدم الطلب تلقائياً مع الشحن.'}
        </p>
      )}
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-12 shrink-0 gap-1 px-3 sm:h-10" aria-label="المزيد من الإجراءات">
            <MoreHorizontal /> <span className="hidden sm:inline">المزيد</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {reopenable && !(primary && primary.label === 'إعادة للمراجعة') && (
            <DropdownMenuItem className="min-h-11" onSelect={() => actions.open('reopen')}>
              إعادة للمراجعة
            </DropdownMenuItem>
          )}
          {open && request.items.some((item) => !item.conditionStatus) && (
            <DropdownMenuItem className="min-h-11" onSelect={() => actions.open('inspector-notes')}>
              ملاحظات للمفتش
            </DropdownMenuItem>
          )}
          {money.hasExchange && (
            <DropdownMenuItem className="min-h-11" onSelect={() => actions.open('coupon-amount')}>
              تعديل قيمة رصيد الاستبدال
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="min-h-11" onSelect={() => actions.open('window-override')}>
            استثناء مدة الإرجاع لهذا الطلب
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {showFullPageLink && (
            <DropdownMenuItem className="min-h-11" asChild>
              <Link href={`/returns-management/${request.id}`}>الصفحة الكاملة</Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="min-h-11" asChild>
            <a href={sallaOrderUrl(request.orderId)} target="_blank" rel="noreferrer">
              فتح الطلب في سلة <ExternalLink className="mr-auto size-3.5" />
            </a>
          </DropdownMenuItem>
          {open && request.processingStatus !== 'processing' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11 text-red-700 focus:text-red-700" onSelect={closeWithoutProcessing}>
                إغلاق بدون معالجة
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
