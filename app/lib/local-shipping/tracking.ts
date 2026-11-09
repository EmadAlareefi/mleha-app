// Labels read as plain sentences describing who holds the shipment, so staff never have to decode a status.
export const LOCAL_SHIPMENT_STATUSES: Record<string, string> = {
  pending: 'الشحنة جاهزة — بانتظار إسناد مندوب',
  assigned: 'تم إسناد الشحنة للمندوب — لم يستلمها بعد',
  picked_up: 'استلم المندوب الشحنة من المستودع',
  in_transit: 'الشحنة في الطريق إلى العميل',
  delivered: 'تم تسليم الشحنة للعميل',
  failed: 'تعذر تسليم الشحنة للعميل',
  cancelled: 'تم إلغاء الشحنة',
};

export const RETURN_PICKUP_STATUSES: Record<string, string> = {
  pending: 'بانتظار استلام المرتجع من العميل',
  in_progress: 'المندوب في الطريق لاستلام المرتجع من العميل',
  agent_completed: 'تم استلام المرتجع من العميل — بانتظار تسليمه للمستودع',
  completed: 'تم تسليم المرتجع للمستودع',
  cancelled: 'تم إلغاء استلام المرتجع',
};

// Drivers record a failed attempt as a note while the task stays open (see my-deliveries/StatusDialogs).
const FAILED_PICKUP_NOTE = /^تعذر الاستلام(?:\s|[:(]|$)/u;

export function returnPickupStatusLabel(status: string, completionNotes?: string | null) {
  const note = (completionNotes ?? '').normalize('NFD').replace(/[ً-ٰٟ]/gu, '').trim();
  if ((status === 'pending' || status === 'in_progress') && FAILED_PICKUP_NOTE.test(note)) {
    return 'تعذر استلام المرتجع من العميل — بانتظار إعادة المحاولة';
  }
  return RETURN_PICKUP_STATUSES[status] || status;
}

export function localShipmentLocation(status: string, warehouse?: string | null) {
  switch (status) {
    case 'pending':
    case 'assigned': return warehouse ? `الشحنة ما زالت في ${warehouse}` : 'الشحنة ما زالت في المستودع';
    case 'picked_up': return 'الشحنة مع مندوب التوصيل';
    case 'in_transit': return 'الشحنة مع مندوب التوصيل في الطريق إلى العميل';
    case 'delivered': return 'الشحنة لدى العميل';
    case 'failed': return 'غير معروف — راجع المندوب لمعرفة مكان الشحنة';
    case 'cancelled': return 'غير مؤكد بعد الإلغاء';
    default: return 'لا يتوفر مكان مؤكد';
  }
}
