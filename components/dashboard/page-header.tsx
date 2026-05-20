import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

type PageHeaderProps = {
  title: string;
  description?: string;
  badge?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, badge, actions }: PageHeaderProps) {
  return (
    <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {badge && (
          <Badge variant="outline" className="mb-3 rounded-md">
            {badge}
          </Badge>
        )}
        <h1 className="text-2xl font-semibold tracking-normal text-foreground md:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}
