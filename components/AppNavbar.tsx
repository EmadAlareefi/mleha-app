'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Home,
  IdCard,
  LogOut,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import { serviceDefinitions } from '@/app/lib/service-definitions';
import type { ServiceKey } from '@/app/lib/service-definitions';
import { usePwaInstallPrompt } from '@/components/hooks/usePwaInstallPrompt';

interface AppNavbarProps {
  title?: string;
  subtitle?: string;
  collapseOnMobile?: boolean;
}

export default function AppNavbar({ title, subtitle, collapseOnMobile = false }: AppNavbarProps) {
  const { data: session } = useSession();
  const { showInstallButton, isInstallPromptReady, requestInstall } = usePwaInstallPrompt();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(!collapseOnMobile);
  const sectionId = useId();
  const userName = session?.user?.name || 'المستخدم';
  const userRole = (session?.user as any)?.role;
  const userRoles: string[] = (session?.user as any)?.roles || [];
  const isAdmin = userRole === 'admin' || userRoles.includes('admin');
  const assignedServiceKeys = ((session?.user as any)?.serviceKeys || []) as ServiceKey[];
  const hasOrderInvoiceAccess = isAdmin || assignedServiceKeys.includes('order-invoice-search');

  type Role =
    | 'admin'
    | 'orders'
    | 'store_manager'
    | 'warehouse'
    | 'accountant'
    | 'delivery_agent';

  const roleLabelMap: Record<Role, string> = {
    admin: 'مسؤول النظام',
    orders: 'فريق الطلبات',
    store_manager: 'مدير المتجر',
    warehouse: 'فريق المستودع',
    accountant: 'المحاسبة',
    delivery_agent: 'مندوب التوصيل',
  };

  const primaryRoleKey = (userRole || userRoles[0]) as Role | undefined;
  const primaryRoleLabel = primaryRoleKey ? roleLabelMap[primaryRoleKey] : 'مستخدم';

  const dashboardServiceCount = serviceDefinitions.filter(
    (service) => !service.hideFromDashboard
  ).length;
  const availableServicesCount = isAdmin ? dashboardServiceCount : assignedServiceKeys.length;

  const initials = userName
    .split(' ')
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const heading = title || 'نظام إدارة المتجر';
  const subheading = subtitle || `مرحباً، ${userName}`;

  const navLinks = [
    {
      key: 'home',
      label: 'الرئيسية',
      href: '/',
      icon: Home,
      iconOnly: false,
    },
    {
      key: 'profile',
      label: 'ملفي الشخصي',
      href: '/my-profile',
      icon: IdCard,
      iconOnly: false,
    },
    ...(hasOrderInvoiceAccess
      ? [
          {
            key: 'order-search',
            label: 'بحث الطلبات',
            href: '/order-invoice-search',
            icon: Search,
            iconOnly: true,
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            key: 'manage-users',
            label: 'إدارة المستخدمين',
            href: '/order-users-management',
            icon: Users,
            iconOnly: true,
          },
        ]
      : []),
  ];

  const metaPills = [
    {
      label: 'الدور الرئيسي',
      value: primaryRoleLabel,
    },
    {
      label: 'الخدمات المتاحة',
      value:
        availableServicesCount > 0 ? `${availableServicesCount} خدمة` : 'لم يتم تعيين خدمات بعد',
    },
    {
      label: 'البريد الإلكتروني',
      value: session?.user?.email || 'غير متوفر',
    },
  ];

  const handleInstallClick = useCallback(() => {
    requestInstall();
  }, [requestInstall]);
  const toggleMobileNav = useCallback(() => {
    setIsMobileNavOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    setIsMobileNavOpen(!collapseOnMobile);
  }, [collapseOnMobile]);

  const topSectionPaddingClasses = collapseOnMobile ? 'px-4 py-4 sm:px-6 sm:py-6' : 'px-6 py-6';
  const metaSectionPaddingClasses = collapseOnMobile ? 'px-4 py-3 sm:px-6 sm:py-4' : 'px-6 py-4';
  const topSectionVisibilityClasses =
    collapseOnMobile && !isMobileNavOpen ? 'hidden sm:flex' : 'flex';
  const metaSectionVisibilityClasses =
    collapseOnMobile && !isMobileNavOpen ? 'hidden sm:flex sm:flex-wrap' : 'flex flex-wrap';
  const mobileToggleLabel = isMobileNavOpen ? 'تصغير القائمة' : 'عرض القائمة الكاملة';
  const mobileSummaryClasses = collapseOnMobile ? 'border-b border-slate-100 sm:hidden' : 'hidden';

  return (
    <header className="sticky top-0 z-50 bg-gradient-to-b from-slate-900/80 via-slate-900/40 to-white/50 pb-4 pt-2 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-white/40 bg-white/80 shadow-xl shadow-indigo-100/40 backdrop-blur">
          {collapseOnMobile && (
            <div className={`${mobileSummaryClasses} flex items-center justify-between gap-4 px-4 py-3`}>
              <div className="flex flex-1 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-blue-500 text-lg font-semibold text-white shadow-lg shadow-indigo-500/30">
                  {initials || 'م'}
                </div>
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    لوحة التحكم
                  </p>
                  <p className="text-base font-semibold text-slate-900">{heading}</p>
                  <p className="text-xs text-slate-500">{subheading}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleMobileNav}
                className="shrink-0 rounded-2xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900"
                aria-expanded={isMobileNavOpen}
                aria-controls={sectionId}
              >
                {mobileToggleLabel}
                {isMobileNavOpen ? (
                  <ChevronUp className="ms-2 h-4 w-4" />
                ) : (
                  <ChevronDown className="ms-2 h-4 w-4" />
                )}
              </Button>
            </div>
          )}
          <div
            id={sectionId}
            className={`${topSectionVisibilityClasses} flex-wrap items-center justify-between gap-6 ${topSectionPaddingClasses}`}
          >
            <div className="flex flex-1 items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-blue-500 text-xl font-semibold text-white shadow-lg shadow-indigo-500/30">
                {initials || 'م'}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                  <span>مركز التحكم</span>
                </div>
                <h1 className="text-2xl font-semibold text-slate-900">{heading}</h1>
                <p className="text-sm text-slate-500">{subheading}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {showInstallButton && (
                <Button
                  type="button"
                  onClick={handleInstallClick}
                  className="rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 hover:bg-emerald-100"
                  aria-label="تثبيت التطبيق"
                  title="تثبيت التطبيق على جهازك"
                  variant="ghost"
                  disabled={!isInstallPromptReady}
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">تثبيت التطبيق</span>
                </Button>
              )}
              {navLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <Link key={link.key} href={link.href}>
                    <Button
                      variant="ghost"
                      size={link.iconOnly ? 'icon' : 'sm'}
                      className={
                        link.iconOnly
                          ? 'rounded-2xl border border-indigo-100 bg-indigo-50/60 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700'
                          : 'rounded-2xl px-5 text-sm font-semibold text-slate-600 hover:text-slate-900'
                      }
                      title={link.label}
                      aria-label={link.label}
                    >
                      <Icon className="h-4 w-4" />
                      {!link.iconOnly && <span className="hidden sm:inline">{link.label}</span>}
                    </Button>
                  </Link>
                );
              })}
              <Button
                variant="ghost"
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="rounded-2xl border border-rose-100 bg-gradient-to-r from-rose-50 to-rose-100 text-rose-600 hover:from-rose-100 hover:to-rose-200"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">تسجيل الخروج</span>
              </Button>
            </div>
          </div>

          <div
            className={`${metaSectionVisibilityClasses} gap-3 border-t border-slate-100 ${metaSectionPaddingClasses}`}
          >
            {metaPills.map((pill) => (
              <div
                key={pill.label}
                className="flex min-w-[160px] flex-1 items-center justify-between rounded-2xl border border-slate-100 bg-white/80 px-4 py-2 text-xs text-slate-500"
              >
                <span className="font-semibold text-slate-400">{pill.label}</span>
                <span className="truncate text-slate-900">{pill.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
