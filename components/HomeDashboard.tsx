'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ArrowUpRight, TrendingUp } from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { serviceDefinitions } from '@/app/lib/service-definitions';
import type { ServiceKey } from '@/app/lib/service-definitions';

type Role = 'admin' | 'orders' | 'store_manager' | 'warehouse' | 'accountant' | 'delivery_agent';

export default function HomeDashboard() {
  const { data: session, status } = useSession();

  // Don't default to admin - wait for proper session data
  const userRole: Role | undefined = (session?.user as any)?.role;
  const userRoles: Role[] = (session?.user as any)?.roles || (userRole ? [userRole] : []);
  const serviceKeys: ServiceKey[] = ((session?.user as any)?.serviceKeys || []) as ServiceKey[];
  const isAdmin = userRole === 'admin';

  const services = serviceDefinitions;

  const visibleServices = services.filter((service) => {
    if (service.hideFromDashboard) {
      return false;
    }
    if (isAdmin) {
      return true;
    }
    return serviceKeys.includes(service.key);
  });

  const defaultDashboardServices = services.filter((service) => !service.hideFromDashboard);
  const heroPrimaryService = visibleServices[0] || defaultDashboardServices[0];
  const heroCtaHref = heroPrimaryService?.href || '/';
  const heroCtaLabel = heroPrimaryService
    ? `الانتقال إلى ${heroPrimaryService.title}`
    : 'استعراض الخدمات';
  const secondaryCtaHref = '/order-history';
  const secondaryCtaLabel = 'سجل الطلبات';

  const roleLabelMap: Record<Role, string> = {
    admin: 'مسؤول النظام',
    orders: 'فريق الطلبات',
    store_manager: 'مدير المتجر',
    warehouse: 'فريق المستودع',
    accountant: 'المحاسبة',
    delivery_agent: 'مندوب التوصيل',
  };

  const primaryRoleKey: Role | undefined = userRole || userRoles[0];
  const primaryRoleLabel = primaryRoleKey ? roleLabelMap[primaryRoleKey] : 'مستخدم النظام';

  const localizedTime = new Intl.DateTimeFormat('ar-SA', {
    hour: 'numeric',
    minute: 'numeric',
  }).format(new Date());

  const quickStats = [
    {
      label: 'الخدمات المتاحة',
      value: `${(status === 'authenticated' ? visibleServices.length : defaultDashboardServices.length) || 0} خدمة`,
    },
    {
      label: 'وضع الجلسة',
      value: status === 'authenticated' ? 'نشطة الآن' : 'بانتظار الدخول',
    },
    {
      label: 'دورك',
      value: primaryRoleLabel,
    },
    {
      label: 'آخر تحديث',
      value: localizedTime,
    },
  ];

  const showSecondaryPanel = status !== 'authenticated';
  const showIntroSection = isAdmin || showSecondaryPanel;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <AppNavbar />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {showIntroSection && (
          <section
            className={`mb-12 grid gap-6 ${
              isAdmin && showSecondaryPanel ? 'lg:grid-cols-[minmax(0,2fr),minmax(0,1fr)]' : ''
            }`}
          >
            {isAdmin && (
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-900 to-indigo-700 p-8 text-white shadow-2xl">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.2),transparent_55%)]" />
                <div className="absolute -left-10 top-10 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
                <div className="relative z-10 space-y-6">
                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.4em] text-white/70">
                    <span className="rounded-full bg-white/10 px-3 py-1">تجربة حديثة</span>
                    {primaryRoleLabel && (
                      <span className="rounded-full bg-white/10 px-3 py-1">{primaryRoleLabel}</span>
                    )}
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold leading-snug text-white md:text-4xl">
                      أنجز كل عملياتك من لوحة تحكم حديثة
                    </h2>
                    <p className="mt-3 text-lg text-white/80">
                      حرّك فرق التحضير، الشحن، والمستودع من مكان واحد مع نظرة فورية على حالة الحساب
                      وروابط مباشرة لكل خدمة.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link href={heroCtaHref} prefetch={false}>
                      <Button className="rounded-2xl bg-white px-6 py-5 text-slate-900 shadow-lg shadow-slate-900/20 hover:bg-white/90">
                        {heroCtaLabel}
                        <ArrowUpRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Link href={secondaryCtaHref} prefetch={false}>
                      <Button
                        variant="ghost"
                        className="rounded-2xl border border-white/30 bg-white/10 px-6 py-5 text-white hover:bg-white/20"
                      >
                        {secondaryCtaLabel}
                      </Button>
                    </Link>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {quickStats.map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-2xl bg-white/10 px-4 py-3 text-white backdrop-blur"
                      >
                        <dt className="text-xs uppercase tracking-wide text-white/70">{stat.label}</dt>
                        <dd className="text-xl font-semibold">{stat.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            )}
            {showSecondaryPanel && (
              <Card className="rounded-3xl border border-amber-100 bg-white/95 p-6 shadow-lg shadow-amber-100/60">
                <p className="text-sm font-semibold uppercase tracking-wide text-amber-600">تنبيه</p>
                <h3 className="mt-2 text-2xl font-bold text-slate-900">سجّل الدخول للوصول السريع</h3>
                <p className="mt-3 text-sm text-slate-600">
                  عند تسجيل الدخول ستظهر لك روابط مباشرة لكل خدمة مخوّل بها حسابك بالإضافة إلى
                  أهم التنبيهات اليومية.
                </p>
              </Card>
            )}
          </section>
        )}

        {/* Loading State */}
        {status === 'loading' && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">جاري التحميل...</p>
          </div>
        )}

        {/* Services Grid */}
        {status === 'authenticated' && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {visibleServices.length === 0 && (
              <Card className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-center text-gray-600 shadow">
                لا توجد خدمات متاحة لهذا الحساب.
              </Card>
            )}
            {visibleServices.map((service) => (
              <Link key={service.href} href={service.href} className="h-full" prefetch={false}>
                <Card className="group relative flex h-full flex-col justify-between rounded-3xl border border-slate-100/70 bg-white/95 p-6 shadow-[0_20px_40px_rgba(15,23,42,0.08)] transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-[0_30px_60px_rgba(79,70,229,0.25)]">
                  <div>
                    <div
                      className={`mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${service.color} text-3xl text-white shadow-lg shadow-black/10 transition-transform duration-300 group-hover:scale-110`}
                    >
                      {service.icon}
                    </div>
                    <div className="mb-3 flex items-center gap-2">
                      <h3 className="text-xl font-semibold text-slate-900">{service.title}</h3>
                      {service.badge && (
                        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                          {service.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600">{service.description}</p>
                  </div>
                  <div className="mt-6 flex items-center text-indigo-600 transition-transform duration-300 group-hover:translate-x-1">
                    <span className="font-medium">الدخول</span>
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                  </div>
                </Card>
              </Link>
            ))}

            {/* Affiliate Stats Card */}
            {(session?.user as any)?.affiliateName && (
              <Link href="/affiliate-stats" className="h-full" prefetch={false}>
                <Card className="group relative flex h-full flex-col justify-between rounded-3xl border border-slate-100/70 bg-white/95 p-6 shadow-[0_20px_40px_rgba(15,23,42,0.08)] transition-all duration-300 hover:-translate-y-1 hover:border-purple-200 hover:shadow-[0_30px_60px_rgba(147,51,234,0.25)]">
                  <div>
                    <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 text-3xl text-white shadow-lg shadow-black/10 transition-transform duration-300 group-hover:scale-110">
                      <TrendingUp className="h-8 w-8" />
                    </div>
                    <div className="mb-3 flex items-center gap-2">
                      <h3 className="text-xl font-semibold text-slate-900">إحصائيات المسوق</h3>
                      <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">
                        جديد
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">
                      عرض إحصائيات المبيعات والطلبات الخاصة بكود التسويق: {(session?.user as any)?.affiliateName}
                    </p>
                  </div>
                  <div className="mt-6 flex items-center text-indigo-600 transition-transform duration-300 group-hover:translate-x-1">
                    <span className="font-medium">الدخول</span>
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                  </div>
                </Card>
              </Link>
            )}
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
