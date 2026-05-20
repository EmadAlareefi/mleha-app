import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { DashboardService } from '@/components/dashboard/dashboard-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type ServicesDataTableProps = {
  services: DashboardService[];
};

export function ServicesDataTable({ services }: ServicesDataTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="w-[260px]">الخدمة</TableHead>
            <TableHead>الوصف</TableHead>
            <TableHead className="hidden w-[140px] md:table-cell">التصنيف</TableHead>
            <TableHead className="w-[110px] text-end">الإجراء</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => {
            const Icon = service.Icon;

            return (
              <TableRow key={service.key}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={cn('rounded-md p-2 ring-1', service.accentClass)}>
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <span>{service.title}</span>
                        {service.badge && (
                          <Badge variant="outline" className="rounded-md">
                            {service.badge}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground md:hidden">
                        {service.categoryLabel}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-[420px] text-sm leading-6 text-muted-foreground">
                  {service.description}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant="secondary" className="rounded-md">
                    {service.categoryLabel}
                  </Badge>
                </TableCell>
                <TableCell className="text-end">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={service.href} prefetch={false}>
                      دخول
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
