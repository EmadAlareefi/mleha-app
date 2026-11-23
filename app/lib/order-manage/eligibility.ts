import { isActionEnabled, type OrderManageAction, type OrderManageSettings } from './settings';

/**
 * What a customer may still do to their own order. Pure: the caller loads the
 * facts (app/lib/order-manage/facts.ts) and this decides, so every rule is
 * covered by a table test.
 *
 * This is the answer shown on the page. The binding check happens again at
 * submit, under the order-prep claim lock (`withCustomerHold`), because a
 * packer can take the order between the page load and the tap.
 */

/** "طلب جديد": the only status order prep picks from. */
export const NEW_ORDER_STATUS_ID = '449146439';

export type OrderFacts = {
  /** Salla custom status id from the local mirror. */
  statusCustomId: string | null;
  statusSlug: string | null;
  isPendingPayment: boolean;
  /** Any OrderPrepAssignment row, whatever its status or lease. */
  hasPrepClaim: boolean;
  hasShipment: boolean;
  hasShippingTask: boolean;
  hasOpenEscalation: boolean;
  doNotShip: boolean;
  promoViolator: boolean;
  /** A replacement order the returns app created. */
  isExchangeOrder: boolean;
  hasReturnRequest: boolean;
  /** A customer change holds the order right now. */
  changeInFlight: boolean;
  /** An earlier change is waiting for staff. */
  needsStaff: boolean;
  /** Changes already applied to this order. */
  completedChanges: number;
  isInternational: boolean;
  currency: string | null;
  erpSynced: boolean;
  hasCoupon: boolean;
  /** False while a pilot list is set and the order's mobile is not on it. */
  pilotAllowed: boolean;
};

export type DenyCode =
  | 'unavailable'
  | 'cancelled'
  | 'in_progress'
  | 'not_editable'
  | 'needs_support'
  | 'busy'
  | 'limit'
  | 'not_supported';

export type Verdict = { allowed: true } | { allowed: false; code: DenyCode; reason: string };
export type Verdicts = Record<OrderManageAction, Verdict>;

export const DENY_REASONS: Record<DenyCode, string> = {
  unavailable: 'هذه الخدمة غير متاحة حالياً.',
  cancelled: 'تم إلغاء هذا الطلب.',
  in_progress: 'بدأ تجهيز طلبك، لذلك لا يمكن تعديله أو إلغاؤه الآن.',
  not_editable: 'لا يمكن تعديل هذا الطلب في حالته الحالية.',
  needs_support: 'هذا الطلب يحتاج مراجعة من خدمة العملاء.',
  busy: 'يوجد تعديل قيد التنفيذ على هذا الطلب.',
  limit: 'تم الوصول إلى الحد الأقصى من التعديلات على هذا الطلب.',
  not_supported: 'هذا التعديل غير متاح لهذا الطلب.',
};

const deny = (code: DenyCode): Verdict => ({ allowed: false, code, reason: DENY_REASONS[code] });
const ALLOW: Verdict = { allowed: true };

const CANCELLED_SLUGS = new Set(['canceled', 'cancelled', 'deleted']);

/** The reason no action at all is possible, or null when the order is still open to its customer. */
export function commonBlocker(facts: OrderFacts, settings: OrderManageSettings): DenyCode | null {
  if (!settings.enabled || !facts.pilotAllowed) return 'unavailable';
  if (facts.statusSlug && CANCELLED_SLUGS.has(facts.statusSlug)) return 'cancelled';
  if (facts.hasPrepClaim || facts.hasShipment || facts.hasShippingTask) return 'in_progress';
  if (facts.statusCustomId !== NEW_ORDER_STATUS_ID || facts.isPendingPayment) return 'not_editable';
  if (facts.changeInFlight) return 'busy';
  if (
    facts.needsStaff ||
    facts.hasOpenEscalation ||
    facts.doNotShip ||
    facts.promoViolator ||
    facts.isExchangeOrder ||
    facts.hasReturnRequest
  ) {
    return 'needs_support';
  }
  if (facts.completedChanges >= settings.maxChangesPerOrder) return 'limit';
  return null;
}

function actionBlocker(action: OrderManageAction, facts: OrderFacts, settings: OrderManageSettings): DenyCode | null {
  if (!isActionEnabled(settings, action)) return 'unavailable';
  if (action === 'cancel') return null;
  // Edits rewrite a Saudi national address or re-price lines in SAR.
  if (facts.isInternational) return 'not_supported';
  if (action === 'address') return null;
  const sar = (facts.currency || 'SAR').toUpperCase() === 'SAR';
  // An order already invoiced in the ERP must not change under it.
  if (!sar || facts.erpSynced) return 'not_supported';
  if (action === 'swap') return null;
  // A coupon's discount is recomputed by Salla when lines change, so the
  // amount to refund or collect can no longer be predicted.
  return facts.hasCoupon ? 'not_supported' : null;
}

export function decideVerdicts(facts: OrderFacts, settings: OrderManageSettings): Verdicts {
  const common = commonBlocker(facts, settings);
  const verdictFor = (action: OrderManageAction): Verdict => {
    if (common) return deny(common);
    const blocker = actionBlocker(action, facts, settings);
    return blocker ? deny(blocker) : ALLOW;
  };
  return {
    cancel: verdictFor('cancel'),
    address: verdictFor('address'),
    swap: verdictFor('swap'),
    items: verdictFor('items'),
  };
}
