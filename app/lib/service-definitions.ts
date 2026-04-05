export type ServiceRole =
  | 'orders'
  | 'store_manager'
  | 'warehouse'
  | 'accountant'
  | 'delivery_agent';

export type ServiceAudience = ServiceRole | 'admin';

type ServiceDefinitionSeed = {
  key: string;
  title: string;
  description: string;
  icon: string;
  href: string;
  color: string;
  badge?: string;
  defaultRoles: readonly ServiceAudience[];
  grantsRoles: readonly ServiceRole[];
  assignable?: boolean; // hide from user management when false
  hideFromDashboard?: boolean;
};

const serviceDefinitionsData = [
  {
    key: 'order-prep',
    title: 'تحضير الطلبات',
    description: 'تحضير وإدارة الطلبات المعينة',
    icon: '📝',
    href: '/order-prep',
    color: 'from-amber-500 to-amber-600',
    defaultRoles: ['orders'],
    grantsRoles: ['orders'],
  },
  {
    key: 'order-shortages',
    title: 'صفحة النواقص',
    description: 'سجل بالمنتجات غير المتوفرة التي تم الإبلاغ عنها أثناء التحضير',
    icon: '⚠️',
    href: '/order-shortages',
    color: 'from-rose-500 to-amber-500',
    defaultRoles: ['admin', 'orders'],
    grantsRoles: ['orders'],
  },
  {
    key: 'order-shipping',
    title: 'شحن الطلبات',
    description: 'البحث عن الطلبات وإنشاء الشحنات وطباعة البوالص',
    icon: '🚚',
    href: '/order-shipping',
    color: 'from-emerald-500 to-emerald-600',
    defaultRoles: ['orders'],
    grantsRoles: ['orders'],
  },
  {
    key: 'order-monitor',
    title: 'مراقبة العمليات',
    description: 'رصد من قام بتحضير الطلب ومتابعة من شحنه مع آخر تحديث',
    icon: '🛰️',
    href: '/order-monitor',
    color: 'from-indigo-500 to-purple-600',
    defaultRoles: ['admin', 'orders'],
    grantsRoles: ['orders'],
  },
  {
    key: 'admin-order-prep',
    title: 'إدارة طلبات التحضير',
    description: 'لوحة تحكم المسؤول لإدارة ومتابعة طلبات التحضير',
    icon: '📊',
    href: '/admin/order-prep',
    color: 'from-slate-500 to-slate-600',
    defaultRoles: ['admin'],
    grantsRoles: [],
    assignable: true,
  },
  {
    key: 'warehouse',
    title: 'المستودع',
    description: 'إدارة الشحنات الواردة والصادرة',
    icon: '📦',
    href: '/warehouse',
    color: 'from-blue-500 to-blue-600',
    defaultRoles: ['admin', 'warehouse'],
    grantsRoles: ['warehouse'],
  },
  {
    key: 'local-shipping',
    title: 'الشحن المحلي',
    description: 'إدارة عمليات الشحن المحلي',
    icon: '🚚',
    href: '/local-shipping',
    color: 'from-green-500 to-green-600',
    defaultRoles: ['admin', 'warehouse'],
    grantsRoles: ['warehouse'],
  },
  {
    key: 'warehouse-locations',
    title: 'مواقع التخزين',
    description: 'تسجيل مواقع المنتجات داخل المستودع وتحديثها',
    icon: '🧭',
    href: '/warehouse-locations',
    color: 'from-sky-500 to-indigo-500',
    defaultRoles: ['admin', 'warehouse'],
    grantsRoles: ['warehouse'],
  },
  {
    key: 'search-update-stock',
    title: 'جرد وتحديث المخزون',
    description: 'بحث SKU وخصم الطلبات المفتوحة قبل تحديث كميات سلة',
    icon: '🧮',
    href: '/warehouse/search-update-stock',
    color: 'from-indigo-500 to-blue-500',
    defaultRoles: ['admin', 'warehouse'],
    grantsRoles: ['warehouse'],
  },
  {
    key: 'barcode-labels',
    title: 'ملصقات الباركود',
    description: 'إنشاء وطباعة ملصقات الباركود بحجم ٧×٤ سم',
    icon: '🏷️',
    href: '/barcode-labels',
    color: 'from-rose-500 to-rose-600',
    defaultRoles: ['admin', 'warehouse', 'orders', 'store_manager', 'accountant', 'delivery_agent'],
    grantsRoles: [],
  },
  {
    key: 'shipment-assignments',
    title: 'تعيين الشحنات',
    description: 'تعيين الشحنات المحلية للمناديب',
    icon: '📍',
    href: '/shipment-assignments',
    color: 'from-cyan-500 to-cyan-600',
    defaultRoles: ['admin', 'warehouse'],
    grantsRoles: ['warehouse'],
  },
  {
    key: 'delivery-agent-tasks',
    title: 'طلبات المناديب',
    description: 'إنشاء طلبات خاصة للمناديب ومتابعتها',
    icon: '🧾',
    href: '/delivery-agent-tasks',
    color: 'from-slate-500 to-slate-600',
    defaultRoles: ['admin', 'warehouse', 'orders', 'store_manager'],
    grantsRoles: [],
  },
  {
    key: 'delivery-agent-wallets',
    title: 'محافظ المناديب',
    description: 'متابعة مستحقات الشحنات والمهمات وصرف دفعات المناديب',
    icon: '💰',
    href: '/delivery-agent-wallets',
    color: 'from-emerald-500 to-emerald-600',
    defaultRoles: ['admin', 'warehouse', 'accountant'],
    grantsRoles: ['warehouse'],
  },
  {
    key: 'order-invoice-search',
    title: 'البحث عن الطلبات',
    description: 'البحث عن الطلبات وطباعة الفواتير التجارية',
    icon: '🔍',
    href: '/order-invoice-search',
    color: 'from-violet-500 to-violet-600',
    defaultRoles: ['admin', 'orders'],
    grantsRoles: [],
  },
  {
    key: 'cod-tracker',
    title: 'متابعة التحصيل (COD)',
    description: 'تتبع وإدارة مبالغ الدفع عند الاستلام',
    icon: '💵',
    href: '/cod-tracker',
    color: 'from-amber-500 to-amber-600',
    defaultRoles: ['admin', 'accountant'],
    grantsRoles: ['accountant'],
  },
  {
    key: 'my-deliveries',
    title: 'شحناتي',
    description: 'عرض وإدارة الشحنات المُعيّنة لي',
    icon: '🚛',
    href: '/my-deliveries',
    color: 'from-lime-500 to-lime-600',
    defaultRoles: ['delivery_agent'],
    grantsRoles: ['delivery_agent'],
  },
  {
    key: 'returns-management',
    title: 'إدارة طلبات الإرجاع',
    description: 'متابعة ومراجعة طلبات الإرجاع والاستبدال',
    icon: '📋',
    href: '/returns-management',
    color: 'from-red-500 to-red-600',
    defaultRoles: ['admin', 'store_manager'],
    grantsRoles: ['store_manager'],
  },
  {
    key: 'returns-inspection',
    title: 'فحص المرتجعات',
    description: 'قراءة شحنات الإرجاع وتحديد حالة المنتجات',
    icon: '🔎',
    href: '/returns-inspection',
    color: 'from-red-600 to-rose-500',
    defaultRoles: ['admin', 'warehouse'],
    grantsRoles: ['warehouse'],
  },
  {
    key: 'returns-analytics',
    title: 'تحليل المرتجعات',
    description: 'لوحة لتتبع أسباب الإرجاع وأعلى المنتجات تكراراً',
    icon: '📈',
    href: '/returns-analytics',
    color: 'from-indigo-500 to-violet-600',
    defaultRoles: ['admin', 'store_manager'],
    grantsRoles: ['store_manager'],
  },
  {
    key: 'agents-live-monitor',
    title: 'مراقبة المحادثات',
    description: 'متابعة المحادثات النشطة على زوكو وأحمال الوكلاء',
    icon: '💬',
    href: '/agents/live',
    color: 'from-indigo-500 to-purple-600',
    defaultRoles: ['admin', 'store_manager'],
    grantsRoles: [],
  },
  {
    key: 'agents-performance-reports',
    title: 'تقارير أداء الوكلاء',
    description: 'إحصائيات متقدمة عن الإنتاجية وسرعة الاستجابة',
    icon: '📈',
    href: '/agents/reports',
    color: 'from-emerald-500 to-teal-600',
    defaultRoles: ['admin', 'store_manager'],
    grantsRoles: [],
  },
  {
    key: 'returns-priority',
    title: 'الطلبات عالية الأولوية',
    description: 'تحديد الطلبات التي يجب أن تظهر أولاً لفريق التحضير',
    icon: '⚡',
    href: '/returns-priority',
    color: 'from-orange-500 to-red-500',
    defaultRoles: ['admin', 'store_manager'],
    grantsRoles: ['store_manager'],
  },
  {
    key: 'returns-gifts',
    title: 'علامة تغليف الهدايا',
    description: 'تحديد الطلبات التي تحتاج تنبيه تغليف هدية',
    icon: '🎁',
    href: '/returns-gifts',
    color: 'from-rose-500 to-pink-500',
    defaultRoles: ['admin', 'store_manager'],
    grantsRoles: ['store_manager'],
  },
  {
    key: 'settings',
    title: 'الإعدادات',
    description: 'إدارة إعدادات النظام والرسوم',
    icon: '⚙️',
    href: '/settings',
    color: 'from-purple-500 to-purple-600',
    defaultRoles: ['admin'],
    grantsRoles: [],
    assignable: false,
  },
  {
    key: 'order-users-management',
    title: 'إدارة مستخدمي الطلبات',
    description: 'إنشاء وتعيين مستخدمين لتحضير الطلبات',
    icon: '👥',
    href: '/order-users-management',
    color: 'from-indigo-500 to-indigo-600',
    defaultRoles: ['admin'],
    grantsRoles: [],
    assignable: false,
    hideFromDashboard: true,
  },
  {
    key: 'printer-settings',
    title: 'إعدادات الطابعات',
    description: 'تكوين الطابعات وربطها بالمستخدمين',
    icon: '🖨️',
    href: '/printer-settings',
    color: 'from-slate-500 to-slate-600',
    defaultRoles: ['admin'],
    grantsRoles: [],
    assignable: false,
    hideFromDashboard: true,
  },
  {
    key: 'user-recognition',
    title: 'المخالفات والمكافآت',
    description: 'تسجيل مخالفات أو مكافآت لموظفي الفرق المختلفة',
    icon: '⚖️',
    href: '/user-recognition',
    color: 'from-indigo-600 to-purple-600',
    defaultRoles: ['admin'],
    grantsRoles: [],
    assignable: false,
  },
  {
    key: 'my-recognition',
    title: 'سجلي التحفيزي',
    description: 'عرض المخالفات والمكافآت الخاصة بي',
    icon: '🎯',
    href: '/my-recognition',
    color: 'from-amber-500 to-amber-600',
    defaultRoles: [
      'orders',
      'store_manager',
      'warehouse',
      'accountant',
      'delivery_agent',
    ],
    grantsRoles: [],
  },
  {
    key: 'warehouse-management',
    title: 'إدارة المستودعات',
    description: 'إضافة المستودعات وتحديث بياناتها',
    icon: '🏗️',
    href: '/warehouse-management',
    color: 'from-sky-500 to-sky-600',
    defaultRoles: ['admin'],
    grantsRoles: [],
    assignable: false,
  },
  {
    key: 'order-reports',
    title: 'تقارير الطلبات',
    description: 'عرض تقارير الطلبات المكتملة وإحصائيات المستخدمين',
    icon: '📊',
    href: '/order-reports',
    color: 'from-teal-500 to-teal-600',
    defaultRoles: ['admin', 'accountant'],
    grantsRoles: ['accountant'],
  },
  {
    key: 'settlements',
    title: 'تسويات المدفوعات',
    description: 'رفع وربط ملفات التسويات مع طلبات سلة',
    icon: '🧮',
    href: '/settlements',
    color: 'from-indigo-500 to-indigo-600',
    defaultRoles: ['admin', 'accountant'],
    grantsRoles: ['accountant'],
  },
  {
    key: 'smsa-webhook',
    title: 'ويب هوك سمسا',
    description: 'شرح خطوات التسجيل وطلبات التتبع',
    icon: '🛰️',
    href: '/smsa-webhook',
    color: 'from-indigo-500 to-sky-500',
    defaultRoles: ['admin'],
    grantsRoles: [],
    assignable: false,
  },
  {
    key: 'invoices',
    title: 'الفواتير',
    description: 'عرض ومزامنة فواتير سلة مع نظام ERP',
    icon: '🧾',
    href: '/invoices',
    color: 'from-pink-500 to-pink-600',
    defaultRoles: ['admin', 'store_manager'],
    grantsRoles: ['store_manager'],
  },
  {
    key: 'salla-products',
    title: 'منتجات سلة',
    description: 'استعراض منتجات سلة وجدول توفرها والبحث حسب SKU',
    icon: '🛍️',
    href: '/salla/products',
    color: 'from-fuchsia-500 to-purple-500',
    defaultRoles: ['admin', 'store_manager'],
    grantsRoles: ['store_manager'],
  },
  {
    key: 'salla-notify',
    title: 'أبلغني عند التوفر',
    description: 'تسجيل طلبات العملاء للتواصل عند توفر مقاسات منتجات سلة',
    icon: '🔔',
    href: '/salla/notify',
    color: 'from-indigo-500 to-indigo-600',
    defaultRoles: ['admin', 'store_manager'],
    grantsRoles: ['store_manager'],
  },
  {
    key: 'salla-requests',
    title: 'طلبات كميات سلة',
    description: 'متابعة طلبات الكميات وتواريخ التوريد لكل منتج',
    icon: '📋',
    href: '/salla/requests',
    color: 'from-purple-500 to-rose-500',
    defaultRoles: ['admin', 'store_manager'],
    grantsRoles: ['store_manager'],
  },
  {
    key: 'expenses',
    title: 'إدارة المصروفات',
    description: 'تتبع وإدارة جميع مصروفات المتجر',
    icon: '💰',
    href: '/expenses',
    color: 'from-emerald-500 to-emerald-600',
    defaultRoles: ['admin', 'accountant'],
    grantsRoles: ['accountant'],
  },
] as const satisfies ReadonlyArray<ServiceDefinitionSeed>;

export type ServiceKey = (typeof serviceDefinitionsData)[number]['key'];

export type ServiceDefinition = Omit<ServiceDefinitionSeed, 'key'> & {
  key: ServiceKey;
};

export const serviceDefinitions: readonly ServiceDefinition[] = serviceDefinitionsData;

const serviceMap = new Map<ServiceKey, ServiceDefinition>(
  serviceDefinitions.map((service) => [service.key, service])
);

export function getServiceDefinition(key: ServiceKey): ServiceDefinition | undefined {
  return serviceMap.get(key);
}

export function getAssignableServices(): ServiceDefinition[] {
  return serviceDefinitions.filter((service) => service.assignable !== false);
}

export function sanitizeServiceKeys(keys: unknown): ServiceKey[] {
  if (!Array.isArray(keys)) return [];
  const validKeys = keys.filter((key): key is ServiceKey => serviceMap.has(key as ServiceKey));
  return Array.from(new Set(validKeys));
}

export function getRolesFromServiceKeys(serviceKeys: ServiceKey[]): ServiceRole[] {
  const roles = new Set<ServiceRole>();
  serviceKeys.forEach((key) => {
    const service = serviceMap.get(key);
    service?.grantsRoles.forEach((role) => roles.add(role));
  });
  return Array.from(roles);
}

export function getDefaultServiceKeysForRoles(roles: ServiceRole[]): ServiceKey[] {
  if (!roles || roles.length === 0) {
    return [];
  }

  const keys = new Set<ServiceKey>();
  serviceDefinitions.forEach((service) => {
    if (service.defaultRoles.some((role) => roles.includes(role as ServiceRole))) {
      keys.add(service.key);
    }
  });
  return Array.from(keys);
}

export function getAllServiceKeys(): ServiceKey[] {
  return serviceDefinitions.map((service) => service.key);
}
