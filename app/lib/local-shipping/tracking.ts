export const LOCAL_SHIPMENT_STATUSES: Record<string, string> = {
  pending: 'بانتظار إسناد مندوب',
  assigned: 'تم إسناد المندوب',
  picked_up: 'استلمها المندوب',
  in_transit: 'قيد التوصيل',
  delivered: 'تم التسليم',
  failed: 'تعذر التسليم',
  cancelled: 'ملغاة',
};

export const RETURN_PICKUP_STATUSES: Record<string, string> = {
  pending: 'بانتظار استلام المرتجع',
  in_progress: 'المندوب ينفذ مهمة الاستلام',
  agent_completed: 'أنهى المندوب المهمة — بانتظار التأكيد',
  completed: 'تم تأكيد إنجاز مهمة الاستلام',
  cancelled: 'مهمة الاستلام ملغاة',
};

export function localShipmentLocation(status: string, warehouse?: string | null) {
  switch (status) {
    case 'pending':
    case 'assigned': return warehouse ? `بانتظار الاستلام من ${warehouse}` : 'بانتظار استلام المندوب من المتجر / المستودع';
    case 'picked_up': return 'مع مندوب التوصيل';
    case 'in_transit': return 'مع المندوب في الطريق للعميل';
    case 'delivered': return 'تم تسليمها للعميل';
    case 'failed': return 'تعذر التسليم — راجع المندوب لتحديد مكان الشحنة';
    case 'cancelled': return 'ألغيت الشحنة — الموقع الحالي غير مؤكد';
    default: return 'لا يتوفر موقع مؤكد';
  }
}
