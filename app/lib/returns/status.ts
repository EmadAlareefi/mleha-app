export const STATUS_LABELS: Record<string, string> = {
  pending_review: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

export const STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  approved: 'bg-blue-100 text-blue-800 border-blue-300',
  rejected: 'bg-red-100 text-red-800 border-red-300',
  shipped: 'bg-purple-100 text-purple-800 border-purple-300',
  delivered: 'bg-green-100 text-green-800 border-green-300',
  completed: 'bg-gray-100 text-gray-800 border-gray-300',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-300',
};

export const INSPECTION_BADGE_STYLES = {
  success: 'bg-green-50 text-green-800 border-green-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
  muted: 'bg-gray-100 text-gray-700 border-gray-200',
};
