'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import AppNavbar from '@/components/AppNavbar';

type Role = 'admin' | 'orders' | 'store_manager' | 'warehouse' | 'accountant' | 'delivery_agent';

type ServiceCard = {
  title: string;
  description: string;
  icon: string;
  href: string;
  color: string;
  badge?: string;
  allowedRoles?: Role[];
};

export default function AdminDashboard() {
  const { data: session, status } = useSession();

  // Don't default to admin - wait for proper session data
  const userRole: Role | undefined = (session?.user as any)?.role;
  const userRoles: Role[] = (session?.user as any)?.roles || (userRole ? [userRole] : []);

  const services: ServiceCard[] = [
    {
      title: 'تحضير الطلبات',
      description: 'تحضير وإدارة الطلبات المعينة',
      icon: '📝',
      href: '/order-prep',
      color: 'from-amber-500 to-amber-600',
      allowedRoles: ['orders'],
    },
    {
      title: 'المستودع',
      description: 'إدارة الشحنات الواردة والصادرة',
      icon: '📦',
      href: '/warehouse',
      color: 'from-blue-500 to-blue-600',
      allowedRoles: ['admin', 'warehouse'],
    },
    {
      title: 'الشحن المحلي',
      description: 'إدارة عمليات الشحن المحلي',
      icon: '🚚',
      href: '/local-shipping',
      color: 'from-green-500 to-green-600',
      allowedRoles: ['admin', 'warehouse'],
    },
    {
      title: 'تعيين الشحنات',
      description: 'تعيين الشحنات المحلية للمناديب',
      icon: '📍',
      href: '/shipment-assignments',
      color: 'from-cyan-500 to-cyan-600',
      allowedRoles: ['admin', 'warehouse'],
    },
    {
      title: 'متابعة التحصيل (COD)',
      description: 'تتبع وإدارة مبالغ الدفع عند الاستلام',
      icon: '💵',
      href: '/cod-tracker',
      color: 'from-amber-500 to-amber-600',
      allowedRoles: ['admin', 'warehouse', 'accountant'],
    },
    {
      title: 'شحناتي',
      description: 'عرض وإدارة الشحنات المُعيّنة لي',
      icon: '🚛',
      href: '/my-deliveries',
      color: 'from-lime-500 to-lime-600',
      allowedRoles: ['delivery_agent'],
    },
    // {
    //   title: 'الإرجاع والاستبدال',
    //   description: 'إدارة طلبات الإرجاع والاستبدال',
    //   icon: '🔄',
    //   href: '/returns',
    //   color: 'from-orange-500 to-orange-600',
    //   badge: 'عام',
    // },
    {
      title: 'إدارة طلبات الإرجاع',
      description: 'متابعة ومراجعة طلبات الإرجاع والاستبدال',
      icon: '📋',
      href: '/returns-management',
      color: 'from-red-500 to-red-600',
      allowedRoles: ['admin', 'store_manager'],
    },
    {
      title: 'الإعدادات',
      description: 'إدارة إعدادات النظام والرسوم',
      icon: '⚙️',
      href: '/settings',
      color: 'from-purple-500 to-purple-600',
      allowedRoles: ['admin'],
    },
    {
      title: 'إدارة مستخدمي الطلبات',
      description: 'إنشاء وتعيين مستخدمين لتحضير الطلبات',
      icon: '👥',
      href: '/order-users-management',
      color: 'from-indigo-500 to-indigo-600',
      allowedRoles: ['admin'],
    },
    {
      title: 'إدارة المستودعات',
      description: 'إضافة المستودعات وتحديث بياناتها',
      icon: '🏗️',
      href: '/warehouse-management',
      color: 'from-sky-500 to-sky-600',
      allowedRoles: ['admin'],
    },
    {
      title: 'تقارير الطلبات',
      description: 'عرض تقارير الطلبات المكتملة وإحصائيات المستخدمين',
      icon: '📊',
      href: '/order-reports',
      color: 'from-teal-500 to-teal-600',
      allowedRoles: ['admin', 'accountant'],
    },
    {
      title: 'الفواتير',
      description: 'عرض ومزامنة فواتير سلة مع نظام ERP',
      icon: '🧾',
      href: '/invoices',
      color: 'from-pink-500 to-pink-600',
      allowedRoles: ['admin', 'store_manager'],
    },
    {
      title: 'إدارة المصروفات',
      description: 'تتبع وإدارة جميع مصروفات المتجر',
      icon: '💰',
      href: '/expenses',
      color: 'from-emerald-500 to-emerald-600',
      allowedRoles: ['admin', 'accountant'],
    },
  ];

  // Filter services based on user roles - only show services where user has at least one matching role
  const visibleServices = services.filter((service) => {
    // If no roles defined for service, don't show it (all services should have explicit roles)
    if (!service.allowedRoles || service.allowedRoles.length === 0) {
      return false;
    }

    // If user has no roles, don't show any services
    if (!userRoles || userRoles.length === 0) {
      return false;
    }

    // Show service if user has at least one role that matches the service's allowed roles
    return service.allowedRoles.some(role => userRoles.includes(role));
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <AppNavbar />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Welcome Message */}
        <div className="mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            مرحباً بك في نظام الإدارة
          </h2>
          <p className="text-lg text-gray-600">
            اختر الخدمة التي تريد الوصول إليها
          </p>
        </div>

        {/* Loading State */}
        {status === 'loading' && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">جاري التحميل...</p>
          </div>
        )}

        {/* Services Grid */}
        {status === 'authenticated' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleServices.length === 0 && (
              <Card className="p-6 text-center text-gray-600">
                لا توجد خدمات متاحة لهذا الحساب.
              </Card>
            )}
            {visibleServices.map((service) => (
            <Link key={service.href} href={service.href}>
              <Card className="p-6 hover:shadow-xl transition-all duration-200 cursor-pointer group h-full">
                <div className="flex flex-col h-full">
                  {/* Icon */}
                  <div
                    className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${service.color} flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform`}
                  >
                    {service.icon}
                  </div>

                  {/* Title */}
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xl font-bold text-gray-900">
                      {service.title}
                    </h3>
                    {service.badge && (
                      <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                        {service.badge}
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-gray-600 mb-4 flex-grow">
                    {service.description}
                  </p>

                  {/* Arrow */}
                  <div className="flex items-center text-blue-600 font-medium group-hover:translate-x-1 transition-transform">
                    <span>الدخول</span>
                    <svg
                      className="w-5 h-5 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                  </div>
                </div>
              </Card>
            </Link>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-16 py-8 border-t bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-600">
          <p>نظام إدارة المتجر © 2024</p>
        </div>
      </footer>
    </div>
  );
}
