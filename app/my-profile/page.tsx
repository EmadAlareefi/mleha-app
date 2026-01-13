import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import AppNavbar from '@/components/AppNavbar';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui/card';
import { serviceDefinitions, type ServiceKey } from '@/app/lib/service-definitions';

function formatDateDisplay(value?: Date | string | null) {
  if (!value) {
    return 'غير محدد';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'غير محدد';
  }
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function formatSalaryDisplay(amount?: { toString(): string } | null, currency?: string | null) {
  if (!amount) {
    return 'غير محدد';
  }
  const salaryString = amount.toString();
  const numericAmount = Number(salaryString);
  const safeCurrency = currency || 'SAR';
  if (Number.isNaN(numericAmount)) {
    return `${salaryString} ${safeCurrency}`.trim();
  }
  const formattedAmount = new Intl.NumberFormat('ar-SA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericAmount);
  return `${formattedAmount} ${safeCurrency}`.trim();
}

function calculateTenure(start?: Date | string | null, end?: Date | string | null) {
  if (!start) {
    return 'غير محدد';
  }
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) {
    return 'غير محدد';
  }
  const endDate = end ? new Date(end) : new Date();
  if (Number.isNaN(endDate.getTime())) {
    return 'غير محدد';
  }
  const diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs < 0) {
    return 'غير محدد';
  }
  const totalMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30));
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const segments = [] as string[];
  if (years > 0) {
    segments.push(`${years} سنة`);
  }
  if (months > 0) {
    segments.push(`${months} شهر`);
  }
  return segments.length > 0 ? segments.join(' و ') : 'أقل من شهر';
}

export default async function MyProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }

  const sessionUser = session.user as any;
  const userId = sessionUser?.id as string | undefined;
  const roles = (sessionUser?.roles || []) as string[];
  const serviceKeys = (sessionUser?.serviceKeys || []) as ServiceKey[];
  const isAdmin = roles.includes('admin') || sessionUser?.role === 'admin';

  const profile = !isAdmin && userId
    ? await prisma.orderUser.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          phone: true,
          employmentStartDate: true,
          employmentEndDate: true,
          salaryAmount: true,
          salaryCurrency: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    : null;

  const accessibleServices = serviceDefinitions.filter((service) =>
    serviceKeys.includes(service.key)
  );

  const renderUnavailableCard = (message: string, hint: string) => (
    <Card className="rounded-3xl border border-white/40 bg-white/90 p-8 text-center text-slate-700 shadow-xl">
      <p className="text-xl font-semibold text-slate-900">{message}</p>
      <p className="mt-2 text-sm text-slate-500">{hint}</p>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 pb-16">
      <AppNavbar
        title="ملفي الشخصي"
        subtitle="تابع بيانات عملك وصلاحياتك"
        collapseOnMobile
      />
      <div className="max-w-5xl mx-auto px-4 py-10 sm:px-6 lg:px-8 text-slate-900">
        {isAdmin
          ? renderUnavailableCard(
              'حساب المسؤول العام',
              'لا يتم تخزين بيانات الموارد البشرية للحساب الإداري الافتراضي.'
            )
          : !profile
            ? renderUnavailableCard(
                'لم يتم العثور على بياناتك',
                'تواصل مع المشرف للتأكد من إنشاء ملفك في النظام.'
              )
            : (
              <div className="space-y-6">
                <Card className="rounded-3xl border border-white/40 bg-white/95 p-6 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.4em] text-slate-400">البيانات الشخصية</p>
                      <h2 className="mt-1 text-2xl font-semibold text-slate-900">{profile.name}</h2>
                      <p className="text-sm text-slate-500">@{profile.username}</p>
                    </div>
                    <span
                      className={`rounded-full px-4 py-2 text-sm font-semibold ${profile.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {profile.isActive ? 'حساب نشط' : 'حساب غير نشط'}
                    </span>
                  </div>
                  <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {[{
                      label: 'البريد الإلكتروني',
                      value: profile.email || 'غير محدد',
                    },
                    {
                      label: 'رقم الهاتف',
                      value: profile.phone || 'غير محدد',
                    },
                    {
                      label: 'الأدوار',
                      value: roles.length > 0 ? roles.join('، ') : 'لا توجد أدوار',
                    },
                    {
                      label: 'تاريخ إنشاء الحساب',
                      value: formatDateDisplay(profile.createdAt),
                    }].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
                        <p className="text-xs uppercase tracking-wide text-slate-500">{item.label}</p>
                        <p className="mt-1 text-base font-semibold text-slate-900">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="rounded-3xl border border-amber-100/80 bg-amber-50/70 p-6 shadow-xl">
                  <p className="text-xs uppercase tracking-[0.4em] text-amber-500">المعلومات الوظيفية</p>
                  <h3 className="mt-1 text-xl font-semibold text-amber-900">بيانات الموارد البشرية</h3>
                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {[{
                      label: 'تاريخ بداية العمل',
                      value: formatDateDisplay(profile.employmentStartDate),
                    },
                    {
                      label: 'تاريخ نهاية العمل',
                      value: profile.employmentEndDate
                        ? formatDateDisplay(profile.employmentEndDate)
                        : 'على رأس العمل',
                    },
                    {
                      label: 'مدة الخدمة',
                      value: calculateTenure(profile.employmentStartDate, profile.employmentEndDate),
                    },
                    {
                      label: 'الراتب الشهري',
                      value: formatSalaryDisplay(profile.salaryAmount, profile.salaryCurrency),
                    }].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-white/60 bg-white/90 p-4">
                        <p className="text-xs uppercase tracking-wide text-amber-500">{item.label}</p>
                        <p className="mt-1 text-base font-semibold text-amber-900">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span
                      className={`rounded-full px-4 py-2 text-sm font-semibold ${profile.employmentEndDate ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}
                    >
                      {profile.employmentEndDate ? 'انتهت الخدمة' : 'على رأس العمل'}
                    </span>
                    <span className="rounded-full bg-white/80 px-4 py-2 text-sm text-amber-700">
                      آخر تحديث: {formatDateDisplay(profile.updatedAt)}
                    </span>
                  </div>
                </Card>

                <Card className="rounded-3xl border border-indigo-100 bg-white/95 p-6 shadow-xl">
                  <p className="text-xs uppercase tracking-[0.4em] text-indigo-500">صلاحيات الوصول</p>
                  <h3 className="mt-1 text-xl font-semibold text-slate-900">الخدمات المتاحة لك</h3>
                  {accessibleServices.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">
                      لم يتم تعيين روابط لخدماتك بعد. تواصل مع مدير النظام للحصول على الصلاحيات المناسبة.
                    </p>
                  ) : (
                    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {accessibleServices.map((service) => (
                        <div
                          key={service.key}
                          className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
                        >
                          <p className="text-sm font-semibold text-slate-900">{service.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{service.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            )}
      </div>
    </div>
  );
}
