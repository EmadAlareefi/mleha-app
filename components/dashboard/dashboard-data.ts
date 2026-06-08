import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Bell,
  Boxes,
  Calculator,
  ChartNoAxesCombined,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  Gift,
  Handshake,
  LineChart,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  ReceiptText,
  ScanSearch,
  Search,
  Settings,
  ShoppingBag,
  Target,
  Truck,
  Undo2,
  Users,
  Wallet,
  WalletCards,
  Warehouse,
  Webhook,
  Zap,
  Printer,
  Scale,
  Satellite,
  Scissors,
} from 'lucide-react';
import {
  serviceDefinitions,
  type ServiceDefinition,
  type ServiceKey,
} from '@/app/lib/service-definitions';

export type DashboardRole =
  | 'admin'
  | 'orders'
  | 'store_manager'
  | 'warehouse'
  | 'accountant'
  | 'delivery_agent';

export type DashboardCategoryId =
  | 'orders'
  | 'warehouse'
  | 'returns'
  | 'finance'
  | 'store'
  | 'admin'
  | 'agents'
  | 'tools';

export type DashboardService = {
  key: string;
  sourceKey?: ServiceKey;
  title: string;
  description: string;
  href: string;
  badge?: string;
  category: DashboardCategoryId;
  categoryLabel: string;
  Icon: LucideIcon;
  accentClass: string;
  priority: number;
};

export type DashboardServiceInput = {
  isAuthenticated: boolean;
  isAdmin: boolean;
  serviceKeys: ServiceKey[];
  affiliateName?: string | null;
};

export const dashboardCategories: Array<{
  id: DashboardCategoryId;
  label: string;
  description: string;
}> = [
  { id: 'orders', label: 'الطلبات', description: 'التحضير، الشحن، ومراقبة سير الطلبات' },
  { id: 'warehouse', label: 'المستودع', description: 'المخزون، المواقع، والشحنات' },
  { id: 'returns', label: 'المرتجعات', description: 'إدارة الإرجاع والاستبدال والتحليل' },
  { id: 'finance', label: 'المالية', description: 'الفواتير، التسويات، والتحصيل' },
  { id: 'store', label: 'المتجر', description: 'منتجات سلة والتنبيهات التجارية' },
  { id: 'agents', label: 'الفرق', description: 'المناديب والوكلاء وسجلات الأداء' },
  { id: 'admin', label: 'الإدارة', description: 'إعدادات النظام والصلاحيات' },
  { id: 'tools', label: 'أدوات عامة', description: 'أدوات تشغيلية مشتركة' },
];

const categoryLabels = Object.fromEntries(
  dashboardCategories.map((category) => [category.id, category.label])
) as Record<DashboardCategoryId, string>;

const serviceCategoryMap: Partial<Record<ServiceKey, DashboardCategoryId>> = {
  'order-prep': 'orders',
  'order-shortages': 'orders',
  'order-shipping': 'orders',
  'order-monitor': 'orders',
  'admin-order-prep': 'orders',
  'order-invoice-search': 'orders',
  'returns-priority': 'orders',
  'returns-gifts': 'orders',
  'order-reports': 'orders',
  warehouse: 'warehouse',
  'local-shipping': 'warehouse',
  'warehouse-locations': 'warehouse',
  'search-update-stock': 'warehouse',
  'barcode-labels': 'warehouse',
  'shipment-assignments': 'warehouse',
  'warehouse-management': 'warehouse',
  'returns-management': 'returns',
  'returns-inspection': 'returns',
  'returns-analytics': 'returns',
  'cod-tracker': 'finance',
  'delivery-agent-wallets': 'finance',
  'affiliate-management': 'finance',
  invoices: 'finance',
  'invoice-refunds': 'finance',
  'invoices-and-refund-invoices': 'finance',
  settlements: 'finance',
  expenses: 'finance',
  'fabric-management': 'warehouse',
  'salla-products': 'store',
  'salla-notify': 'store',
  'salla-requests': 'store',
  'delivery-agent-tasks': 'agents',
  'my-deliveries': 'agents',
  'agents-live-monitor': 'agents',
  'agents-performance-reports': 'agents',
  'user-recognition': 'agents',
  'my-recognition': 'agents',
  settings: 'admin',
  'order-users-management': 'admin',
  'printer-settings': 'admin',
  'smsa-webhook': 'admin',
};

const serviceIconMap: Partial<Record<ServiceKey, LucideIcon>> = {
  'order-prep': ClipboardList,
  'order-shortages': AlertTriangle,
  'order-shipping': Truck,
  'order-monitor': Satellite,
  'admin-order-prep': BarChart3,
  warehouse: Package,
  'local-shipping': Truck,
  'warehouse-locations': Navigation,
  'search-update-stock': Calculator,
  'barcode-labels': ScanSearch,
  'shipment-assignments': MapPin,
  'delivery-agent-tasks': ClipboardCheck,
  'delivery-agent-wallets': WalletCards,
  'affiliate-management': Handshake,
  'order-invoice-search': Search,
  'cod-tracker': Banknote,
  'my-deliveries': Truck,
  'returns-management': ClipboardList,
  'returns-inspection': ScanSearch,
  'returns-analytics': LineChart,
  'agents-live-monitor': MessageCircle,
  'agents-performance-reports': ChartNoAxesCombined,
  'returns-priority': Zap,
  'returns-gifts': Gift,
  settings: Settings,
  'order-users-management': Users,
  'printer-settings': Printer,
  'user-recognition': Scale,
  'my-recognition': Target,
  'warehouse-management': Warehouse,
  'order-reports': FileSpreadsheet,
  settlements: Calculator,
  'smsa-webhook': Webhook,
  invoices: ReceiptText,
  'invoice-refunds': Undo2,
  'invoices-and-refund-invoices': ReceiptText,
  'salla-products': ShoppingBag,
  'salla-notify': Bell,
  'salla-requests': ClipboardList,
  expenses: Wallet,
  'fabric-management': Scissors,
};

const categoryAccentMap: Record<DashboardCategoryId, string> = {
  orders: 'bg-blue-50 text-blue-700 ring-blue-100',
  warehouse: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  returns: 'bg-rose-50 text-rose-700 ring-rose-100',
  finance: 'bg-amber-50 text-amber-700 ring-amber-100',
  store: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100',
  agents: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
  admin: 'bg-slate-100 text-slate-700 ring-slate-200',
  tools: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
};

const priorityMap: Partial<Record<ServiceKey, number>> = {
  'order-prep': 100,
  'order-shipping': 96,
  warehouse: 92,
  'returns-management': 88,
  invoices: 84,
  'order-reports': 80,
  'admin-order-prep': 76,
  'cod-tracker': 72,
  'fabric-management': 70,
};

export function getRoleLabel(role?: string | null) {
  const labels: Record<DashboardRole, string> = {
    admin: 'مسؤول النظام',
    orders: 'فريق الطلبات',
    store_manager: 'مدير المتجر',
    warehouse: 'فريق المستودع',
    accountant: 'المحاسبة',
    delivery_agent: 'مندوب التوصيل',
  };

  return role && role in labels ? labels[role as DashboardRole] : 'مستخدم النظام';
}

export function getInitials(name?: string | null) {
  if (!name) {
    return 'م';
  }

  const initials = name
    .split(' ')
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('');

  return initials || 'م';
}

export function getVisibleDashboardServices({
  isAuthenticated,
  isAdmin,
  serviceKeys,
  affiliateName,
}: DashboardServiceInput): DashboardService[] {
  if (!isAuthenticated) {
    return [];
  }

  const visibleServices = serviceDefinitions.filter((service) => {
    if (service.hideFromDashboard) {
      return false;
    }

    if (isAdmin) {
      return true;
    }

    return serviceKeys.includes(service.key);
  });

  const dashboardServices = visibleServices.map(mapServiceDefinition);

  if (affiliateName) {
    dashboardServices.push({
      key: 'affiliate-stats',
      title: 'إحصائيات المسوق',
      description: `عرض المبيعات والطلبات الخاصة بكود التسويق: ${affiliateName}`,
      href: '/affiliate-stats',
      badge: 'خاص',
      category: 'finance',
      categoryLabel: categoryLabels.finance,
      Icon: LineChart,
      accentClass: categoryAccentMap.finance,
      priority: 78,
    });
  }

  return dashboardServices.sort((first, second) => {
    if (second.priority !== first.priority) {
      return second.priority - first.priority;
    }

    return first.title.localeCompare(second.title, 'ar');
  });
}

export function getDashboardServiceCount() {
  return serviceDefinitions.filter((service) => !service.hideFromDashboard).length;
}

function mapServiceDefinition(service: ServiceDefinition): DashboardService {
  const category = serviceCategoryMap[service.key] ?? 'tools';
  const Icon = serviceIconMap[service.key] ?? Boxes;

  return {
    key: service.key,
    sourceKey: service.key,
    title: service.title,
    description: service.description,
    href: service.href,
    badge: service.badge,
    category,
    categoryLabel: categoryLabels[category],
    Icon,
    accentClass: categoryAccentMap[category],
    priority: priorityMap[service.key] ?? 0,
  };
}
