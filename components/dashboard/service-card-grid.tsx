import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { DashboardService } from '@/components/dashboard/dashboard-data';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type ServiceCardGridProps = {
  services: DashboardService[];
};

export function ServiceCardGrid({ services }: ServiceCardGridProps) {
  const featuredServices = services.slice(0, 6);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {featuredServices.map((service) => {
        const Icon = service.Icon;

        return (
          <Link key={service.key} href={service.href} prefetch={false} className="group">
            <Card className="h-full rounded-lg shadow-sm transition-colors hover:border-ring/40 hover:bg-muted/40">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className={cn('rounded-md p-2 ring-1', service.accentClass)}>
                  <Icon className="size-5" />
                </div>
                <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base leading-7">{service.title}</CardTitle>
                  {service.badge && (
                    <Badge variant="secondary" className="rounded-md">
                      {service.badge}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                  {service.description}
                </p>
                <div className="mt-4 text-xs font-medium text-muted-foreground">
                  {service.categoryLabel}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
