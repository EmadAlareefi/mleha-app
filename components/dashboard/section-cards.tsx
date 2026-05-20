import type { LucideIcon } from 'lucide-react';
import { Activity, BadgeCheck, Clock3, LayoutDashboard } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type SectionCardsProps = {
  availableServices: number;
  totalServices: number;
  sessionLabel: string;
  roleLabel: string;
  lastUpdated: string;
};

type StatCard = {
  label: string;
  value: string;
  description: string;
  Icon: LucideIcon;
  className: string;
};

export function SectionCards({
  availableServices,
  totalServices,
  sessionLabel,
  roleLabel,
  lastUpdated,
}: SectionCardsProps) {
  const stats: StatCard[] = [
    {
      label: 'الخدمات المتاحة',
      value: `${availableServices} / ${totalServices}`,
      description: 'حسب صلاحيات الحساب الحالية',
      Icon: LayoutDashboard,
      className: 'bg-blue-50 text-blue-700 ring-blue-100',
    },
    {
      label: 'وضع الجلسة',
      value: sessionLabel,
      description: 'حالة تسجيل الدخول لهذا المتصفح',
      Icon: Activity,
      className: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    },
    {
      label: 'الدور الرئيسي',
      value: roleLabel,
      description: 'يحدد ترتيب الروابط والصلاحيات',
      Icon: BadgeCheck,
      className: 'bg-amber-50 text-amber-700 ring-amber-100',
    },
    {
      label: 'آخر تحديث',
      value: lastUpdated,
      description: 'وقت تحميل بيانات لوحة التحكم',
      Icon: Clock3,
      className: 'bg-slate-100 text-slate-700 ring-slate-200',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.Icon;

        return (
          <Card key={stat.label} className="rounded-lg shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
              <div className={cn('rounded-md p-2 ring-1', stat.className)}>
                <Icon className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="truncate text-2xl font-semibold tracking-normal text-foreground">
                {stat.value}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
