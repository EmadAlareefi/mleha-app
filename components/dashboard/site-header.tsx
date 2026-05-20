'use client';

import Link from 'next/link';
import { Download, LogIn, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { usePwaInstallPrompt } from '@/components/hooks/usePwaInstallPrompt';

type SiteHeaderProps = {
  isAuthenticated: boolean;
  userName?: string | null;
  lastUpdated: string;
  title?: string;
  subtitle?: string;
};

export function SiteHeader({
  isAuthenticated,
  userName,
  lastUpdated,
  title = 'لوحة التحكم',
  subtitle,
}: SiteHeaderProps) {
  const { showInstallButton, isInstallPromptReady, requestInstall } = usePwaInstallPrompt();
  const resolvedSubtitle =
    subtitle || (isAuthenticated ? `مرحباً، ${userName || 'المستخدم'}` : 'سجّل الدخول لعرض خدماتك');

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <SidebarTrigger className="-me-1 ms-0 rtl:rotate-180" />
      <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div className="min-w-0">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <p className="truncate text-xs text-muted-foreground">{resolvedSubtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground sm:flex">
            <RefreshCw className="size-3.5" />
            <span>{lastUpdated}</span>
          </div>
          {showInstallButton && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={requestInstall}
              disabled={!isInstallPromptReady}
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">تثبيت التطبيق</span>
            </Button>
          )}
          {!isAuthenticated && (
            <Button asChild size="sm">
              <Link href="/login" prefetch={false}>
                <LogIn className="size-4" />
                تسجيل الدخول
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
