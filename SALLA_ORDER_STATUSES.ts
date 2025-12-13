/**
 * SALLA ORDER STATUSES REFERENCE - COMPLETE LIST
 *
 * This file contains ALL order statuses from your Salla store, including:
 * - Original Salla statuses (10 base statuses)
 * - Custom statuses configured in your store
 * - Sub-statuses (children of parent statuses)
 *
 * Use this reference for implementing order status changes in the order prep page.
 *
 * Generated from: scripts/fetch-salla-statuses.ts
 * Merchant ID: 1696031053
 */

// ==================== MAIN STATUSES ====================

export const MAIN_STATUSES = {
  // Deleted status
  DELETED: {
    id: 2131959877,
    slug: null,
    name: 'محذوف',
    nameEn: 'Deleted',
    icon: 'sicon-folder-cancel',
    type: 'custom',
    originalId: 99911771
  },

  // Payment pending - waiting for customer to pay
  PAYMENT_PENDING: {
    id: 1224232774,
    slug: 'payment_pending',
    name: 'بإنتظار الدفع',
    nameEn: 'Payment Pending',
    icon: 'sicon-watch',
    type: 'custom',
    originalId: 1473353380
  },

  // New order / Under review - order being reviewed before processing
  NEW_ORDER: {
    id: 449146439,
    slug: 'under_review',
    name: 'طلب جديد',
    nameEn: 'New Order',
    icon: 'sicon-time',
    type: 'custom',
    originalId: 566146469,
    hasSubStatuses: true
  },

  // In progress - order is being processed/prepared
  IN_PROGRESS: {
    id: 1956875584,
    slug: 'in_progress',
    name: 'جاري التجهيز',
    nameEn: 'In Progress',
    icon: 'sicon-gift',
    type: 'custom',
    originalId: 1939592358,
    message: '[ {store.name} ]\nأصبحت حالة طلبك {order.id} {status}'
  },

  // Completed - order preparation completed
  COMPLETED: {
    id: 758513988,
    slug: 'completed',
    name: 'تم التنفيذ',
    nameEn: 'Completed',
    icon: 'sicon-check',
    type: 'custom',
    originalId: 1298199463,
    hasSubStatuses: true,
    message: '[ {store.name} ]\nأصبحت حالة طلبك {order.id} {status}'
  },

  // Canceled - order has been canceled
  CANCELED: {
    id: 1183362113,
    slug: 'canceled',
    name: 'ملغي',
    nameEn: 'Canceled',
    icon: 'sicon-cancel',
    type: 'custom',
    originalId: 525144736,
    message: '[ {store.name} ]\nتم إلغاء طلبكم {order.id}'
  },

  // Restored - order has been returned/refunded
  RESTORED: {
    id: 274058050,
    slug: 'restored',
    name: 'مسترجع',
    nameEn: 'Restored',
    icon: 'sicon-refund',
    type: 'custom',
    originalId: 989286562,
    hasSubStatuses: true,
    message: '[ {store.name} ]\nأصبحت حالة طلبك {order.id} {status}'
  },

  // Restoring - order return in progress
  RESTORING: {
    id: 1539389262,
    slug: 'restoring',
    name: 'قيد الإسترجاع',
    nameEn: 'Restoring',
    icon: 'sicon-back',
    type: 'custom',
    originalId: 1548352431,
    message: '[ {store.name} ]\nأصبحت حالة طلبك {order.id} {status}'
  },

  // Request quote - custom status for price quotes
  REQUEST_QUOTE: {
    id: 900617807,
    slug: 'request_quote',
    name: 'طلب عرض سعر',
    nameEn: 'Request Quote',
    icon: 'sicon-receipt-money',
    type: 'custom',
    originalId: 773200552,
    message: '[ {store.name} ]\nأصبحت حالة طلبك {order.id} {status}'
  }
} as const;

// ==================== SUB-STATUSES ====================

export const SUB_STATUSES = {
  // Under "New Order" (طلب جديد)
  UNDER_REVIEW: {
    id: 1065456688,
    slug: 'under_review',
    name: 'تحت المراجعة',
    nameEn: 'Under Review',
    icon: 'sicon-help',
    type: 'custom',
    parentId: 449146439,
    parentName: 'طلب جديد',
    originalId: 566146469
  },

  UNDER_REVIEW_RESERVATION: {
    id: 1576217163,
    slug: 'under_review',
    name: 'تحت المراجعة حجز قطع',
    nameEn: 'Under Review - Parts Reservation',
    icon: 'sicon-store',
    type: 'custom',
    parentId: 449146439,
    parentName: 'طلب جديد',
    originalId: 566146469
  },

  // Under "Completed" (تم التنفيذ)
  DELIVERING: {
    id: 1647503939,
    slug: 'delivering',
    name: 'جاري التوصيل',
    nameEn: 'Delivering',
    icon: 'sicon-shipping',
    type: 'custom',
    parentId: 758513988,
    parentName: 'تم التنفيذ',
    originalId: 349994915,
    message: '[ {store.name} ]\nأصبحت حالة طلبك {order.id} {status}'
  },

  DELIVERED: {
    id: 1008666956,
    slug: 'delivered',
    name: 'تم التوصيل',
    nameEn: 'Delivered',
    icon: 'sicon-box-bankers',
    type: 'custom',
    parentId: 758513988,
    parentName: 'تم التنفيذ',
    originalId: 1723506348,
    message: '[ {store.name} ]\nأصبحت حالة طلبك {order.id} {status}'
  },

  SHIPPED: {
    id: 165947469,
    slug: 'shipped',
    name: 'تم الشحن',
    nameEn: 'Shipped',
    icon: 'sicon-box-bankers',
    type: 'custom',
    parentId: 758513988,
    parentName: 'تم التنفيذ',
    originalId: 814202285,
    message: '[ {store.name} ]\nأصبحت حالة طلبك {order.id} {status}'
  },

  // Under "Restored" (مسترجع)
  PARTIALLY_RESTORED: {
    id: 520922376,
    slug: 'restored',
    name: 'مسترجع جزئي',
    nameEn: 'Partially Restored',
    icon: 'sicon-binary',
    type: 'custom',
    parentId: 274058050,
    parentName: 'مسترجع',
    originalId: 989286562
  }
} as const;

// ==================== ORIGINAL SALLA STATUSES (for reference) ====================

export const ORIGINAL_SALLA_STATUSES = {
  PAYMENT_PENDING: { id: 1473353380, name: 'بإنتظار الدفع', slug: 'payment_pending' },
  UNDER_REVIEW: { id: 566146469, name: 'بإنتظار المراجعة', slug: 'under_review' },
  IN_PROGRESS: { id: 1939592358, name: 'قيد التنفيذ', slug: 'in_progress' },
  COMPLETED: { id: 1298199463, name: 'تم التنفيذ', slug: 'completed' },
  DELIVERING: { id: 349994915, name: 'جاري التوصيل', slug: 'delivering' },
  DELIVERED: { id: 1723506348, name: 'تم التوصيل', slug: 'delivered' },
  SHIPPED: { id: 814202285, name: 'تم الشحن', slug: 'shipped' },
  CANCELED: { id: 525144736, name: 'ملغي', slug: 'canceled' },
  RESTORED: { id: 989286562, name: 'مسترجع', slug: 'restored' },
  RESTORING: { id: 1548352431, name: 'قيد الإسترجاع', slug: 'restoring' },
  DELETED: { id: 99911771, name: 'محذوف', slug: null },
  REQUEST_QUOTE: { id: 773200552, name: 'طلب عرض سعر', slug: 'request_quote' }
} as const;

// ==================== STATUS HIERARCHY ====================

export const STATUS_HIERARCHY = {
  'طلب جديد (under_review)': [
    'تحت المراجعة',
    'تحت المراجعة حجز قطع'
  ],
  'تم التنفيذ (completed)': [
    'جاري التوصيل',
    'تم التوصيل',
    'تم الشحن'
  ],
  'مسترجع (restored)': [
    'مسترجع جزئي'
  ]
} as const;

// ==================== HELPERS ====================

/**
 * Get status by ID
 */
export function getStatusById(id: number) {
  const allStatuses = { ...MAIN_STATUSES, ...SUB_STATUSES };
  const entry = Object.values(allStatuses).find(s => s.id === id);
  return entry || null;
}

/**
 * Get status by slug
 */
export function getStatusBySlug(slug: string) {
  const allStatuses = { ...MAIN_STATUSES, ...SUB_STATUSES };
  const entry = Object.values(allStatuses).find(s => s.slug === slug);
  return entry || null;
}

/**
 * Get all sub-statuses for a parent status
 */
export function getSubStatuses(parentId: number) {
  return Object.values(SUB_STATUSES).filter(s => s.parentId === parentId);
}

/**
 * Check if a status has sub-statuses
 */
export function hasSubStatuses(statusId: number): boolean {
  return Object.values(SUB_STATUSES).some(s => s.parentId === statusId);
}

// ==================== WORKFLOW RECOMMENDATIONS ====================

/**
 * RECOMMENDED STATUS FLOW FOR ORDER PREP PAGE:
 *
 * Current Implementation (app/order-prep/page.tsx):
 * 1. Order assigned → 'in_progress' (جاري التجهيز)
 * 2. Create shipment → 'shipped' (تم الشحن)
 * 3. Complete order → moves to history
 *
 * SUGGESTED IMPROVEMENTS:
 *
 * Option A - Use Status Dropdown:
 * Allow users to change order status manually with these options:
 * - جاري التجهيز (in_progress) - Default when assigned
 * - تم التنفيذ (completed) - When ready for delivery
 * - تم الشحن (shipped) - When shipment created
 * - جاري التوصيل (delivering) - When out for delivery
 * - تم التوصيل (delivered) - When delivered
 * - ملغي (canceled) - If order needs to be canceled
 *
 * Option B - Quick Action Buttons:
 * - "جاهز للتوصيل" → changes to 'completed' (ID: 758513988)
 * - "تم الشحن" → changes to 'shipped' (ID: 165947469)
 * - "جاري التوصيل" → changes to 'delivering' (ID: 1647503939)
 * - "تم التوصيل" → changes to 'delivered' (ID: 1008666956)
 * - "إلغاء الطلب" → changes to 'canceled' (ID: 1183362113)
 *
 * Option C - Automatic Flow:
 * - Assign order → 'جاري التجهيز' (in_progress, ID: 1956875584)
 * - Create shipment → 'تم الشحن' (shipped, ID: 165947469)
 * - Complete order → 'تم التوصيل' (delivered, ID: 1008666956)
 *
 * IMPORTANT NOTES:
 * 1. Use status IDs (not slugs) when updating via API
 * 2. Sub-statuses require parent status to be set first
 * 3. Some statuses have customer notification messages
 * 4. All custom statuses support Arabic notifications
 *
 * API Endpoint: PUT /admin/v2/orders/{orderId}/status
 * Body: { "status_id": 165947469 } // Example for "shipped"
 *
 * Files to modify:
 * - app/order-prep/page.tsx (UI components)
 * - app/api/order-assignments/update-status/route.ts (backend logic)
 * - app/lib/salla-api.ts (API calls to update Salla status)
 */

// ==================== STATUS CONSTANTS FOR EASY ACCESS ====================

export const STATUS_IDS = {
  // Main statuses
  PAYMENT_PENDING: 1224232774,
  NEW_ORDER: 449146439,
  IN_PROGRESS: 1956875584,
  COMPLETED: 758513988,
  CANCELED: 1183362113,
  RESTORED: 274058050,
  RESTORING: 1539389262,
  REQUEST_QUOTE: 900617807,

  // Sub-statuses
  UNDER_REVIEW: 1065456688,
  UNDER_REVIEW_RESERVATION: 1576217163,
  DELIVERING: 1647503939,
  DELIVERED: 1008666956,
  SHIPPED: 165947469,
  PARTIALLY_RESTORED: 520922376
} as const;

export const STATUS_SLUGS = {
  PAYMENT_PENDING: 'payment_pending',
  UNDER_REVIEW: 'under_review',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  DELIVERING: 'delivering',
  DELIVERED: 'delivered',
  SHIPPED: 'shipped',
  CANCELED: 'canceled',
  RESTORED: 'restored',
  RESTORING: 'restoring',
  REQUEST_QUOTE: 'request_quote'
} as const;
