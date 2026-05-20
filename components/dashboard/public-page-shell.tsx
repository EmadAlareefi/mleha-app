import type { ReactNode } from 'react';
import Link from 'next/link';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PublicPageShellProps = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  showHomeLink?: boolean;
};

export function PublicPageShell({
  title = 'مليحة',
  subtitle,
  children,
  showHomeLink = true,
}: PublicPageShellProps) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {showHomeLink && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/" prefetch={false}>
                <Home className="size-4" />
                الرئيسية
              </Link>
            </Button>
          )}
        </header>
        <div className="flex flex-1 items-center justify-center py-8">{children}</div>
      </div>
    </main>
  );
}
