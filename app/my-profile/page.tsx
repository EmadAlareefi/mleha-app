import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState } from '@/components/dashboard/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <EmptyState title={message} description={hint} />
  );

  return (
    <AppPageShell title="ملفي الشخصي" subtitle="تابع بيانات عملك وصلاحياتك">
      <div className="mx-auto w-full max-w-5xl">
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
                <Card className="rounded-lg">
                  <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardDescription>البيانات الشخصية</CardDescription>
                      <CardTitle className="text-2xl">{profile.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">@{profile.username}</p>
                    </div>
                    <Badge variant={profile.isActive ? 'default' : 'secondary'}>
                      {profile.isActive ? 'حساب نشط' : 'حساب غير نشط'}
                    </Badge>
                  </CardHeader>
                  <CardContent>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                      <div key={item.label} className="rounded-lg border bg-muted/40 p-4">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="mt-1 text-base font-semibold text-foreground">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  </CardContent>
                </Card>

                <Card className="rounded-lg">
                  <CardHeader>
                    <CardDescription>المعلومات الوظيفية</CardDescription>
                    <CardTitle>بيانات الموارد البشرية</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                      <div key={item.label} className="rounded-lg border bg-muted/40 p-4">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="mt-1 text-base font-semibold text-foreground">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={profile.employmentEndDate ? 'destructive' : 'default'}>
                      {profile.employmentEndDate ? 'انتهت الخدمة' : 'على رأس العمل'}
                    </Badge>
                    <Badge variant="secondary">
                      آخر تحديث: {formatDateDisplay(profile.updatedAt)}
                    </Badge>
                  </div>
                  </CardContent>
                </Card>

                <Card className="rounded-lg">
                  <CardHeader>
                    <CardDescription>صلاحيات الوصول</CardDescription>
                    <CardTitle>الخدمات المتاحة لك</CardTitle>
                  </CardHeader>
                  <CardContent>
                  {accessibleServices.length === 0 ? (
                    <EmptyState
                      title="لا توجد خدمات معينة"
                      description="لم يتم تعيين روابط لخدماتك بعد. تواصل مع مدير النظام للحصول على الصلاحيات المناسبة."
                    />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {accessibleServices.map((service) => (
                        <div
                          key={service.key}
                          className="rounded-lg border bg-muted/40 p-4"
                        >
                          <p className="text-sm font-semibold text-foreground">{service.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{service.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  </CardContent>
                </Card>
              </div>
            )}
      </div>
    </AppPageShell>
  );
}
