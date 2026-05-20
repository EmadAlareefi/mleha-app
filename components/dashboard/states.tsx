import type { ReactNode } from 'react';
import { SearchX } from 'lucide-react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX className="size-5" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = 'جاري التحميل...' }: LoadingStateProps) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner className="size-6" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
