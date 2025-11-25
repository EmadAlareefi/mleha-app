'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Role = 'admin' | 'orders' | 'store_manager' | 'warehouse';

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
  const { data: session } = useSession();
  const userRole: Role = ((session?.user as any)?.role || 'admin') as Role;

  const services: ServiceCard[] = [
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
      title: 'الإرجاع والاستبدال',
      description: 'إدارة طلبات الإرجاع والاستبدال',
      icon: '🔄',
      href: '/returns',
      color: 'from-orange-500 to-orange-600',
      badge: 'عام',
    },
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
      allowedRoles: ['admin'],
    },
  ];

  const visibleServices = services.filter(
    (service) =>
      !service.allowedRoles || service.allowedRoles.includes(userRole)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">لوحة التحكم</h1>
              <p className="text-sm text-gray-600 mt-1">
                مرحباً، {session?.user?.name || 'المسؤول'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {userRole === 'admin' && (
                <Link href="/warehouse-management">
                  <Button variant="outline" className="hover:bg-indigo-50 hover:text-indigo-700">
                    إدارة المستودعات
                  </Button>
                </Link>
              )}
              <Link href="/warehouse">
                <Button variant="outline" className="hover:bg-indigo-50 hover:text-indigo-700">
                  المستودعات
                </Button>
              </Link>
              <Button
                variant="outline"
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                تسجيل الخروج
              </Button>
            </div>
          </div>
        </div>
      </header>

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

        {/* Services Grid */}
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

        {/* Info Cards */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Public Access Note */}
          <Card className="p-6 bg-blue-50 border-blue-200">
            <div className="flex items-start gap-3">
              <div className="text-2xl">ℹ️</div>
              <div>
                <h4 className="font-semibold text-blue-900 mb-1">
                  الوصول العام
                </h4>
                <p className="text-sm text-blue-800">
                  صفحة الإرجاع والاستبدال متاحة للعملاء بدون تسجيل دخول على:
                  <br />
                  <code className="bg-blue-100 px-2 py-1 rounded mt-1 inline-block">
                    /returns
                  </code>
                </p>
              </div>
            </div>
          </Card>

          {/* System Info */}
          <Card className="p-6 bg-green-50 border-green-200">
            <div className="flex items-start gap-3">
              <div className="text-2xl">✅</div>
              <div>
                <h4 className="font-semibold text-green-900 mb-1">
                  النظام نشط
                </h4>
                <p className="text-sm text-green-800">
                  جميع الخدمات تعمل بشكل طبيعي. يتم تحديث رموز Salla تلقائياً كل 10 أيام.
                </p>
              </div>
            </div>
          </Card>
        </div>
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
