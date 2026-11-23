'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { CheckCircle2, EllipsisVertical, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/use-toast';
import {
  requestInstall,
  setInstallGuideOpen,
  usePwaInstallPrompt,
} from '@/components/hooks/usePwaInstallPrompt';
import {
  INSTALL_DISMISS_KEY,
  isInstallBadgeSuppressed,
  isIosInAppBrowser,
  isSnoozed,
} from '@/lib/pwa';

const SERVICE_WORKER_URL = '/service-worker.js';

function useServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Never inside an iframe (the /embed widgets run in the Salla storefront),
    // and only over https so `next dev` on localhost stays worker-free.
    if (window.top !== window.self || location.protocol !== 'https:') return;

    const register = () => {
      navigator.serviceWorker
        .register(SERVICE_WORKER_URL, { scope: '/', updateViaCache: 'none' })
        .catch((error) => console.warn('Service worker registration failed', error));
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
}

function readSnoozed() {
  try {
    return isSnoozed(localStorage.getItem(INSTALL_DISMISS_KEY), Date.now());
  } catch {
    return false;
  }
}

export default function PwaProvider() {
  useServiceWorker();

  const { status } = useSession();
  const pathname = usePathname() ?? '/';
  const { toast } = useToast();
  const { showInstallButton, platform, guideOpen, isInstalled } = usePwaInstallPrompt();
  const [snoozed, setSnoozed] = useState(true);

  useEffect(() => setSnoozed(readSnoozed()), []);

  useEffect(() => {
    const onInstalled = () =>
      toast({ title: 'تم تثبيت التطبيق على جهازك', description: 'افتحه من الشاشة الرئيسية.' });
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, [toast]);

  // Staff only: customers on /returns, /my-order etc. have no NextAuth session.
  const isStaff = status === 'authenticated';
  const showBadge =
    isStaff &&
    showInstallButton &&
    !snoozed &&
    platform !== 'desktop' &&
    !isInstallBadgeSuppressed(pathname);

  const dismiss = () => {
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
    setSnoozed(true);
  };

  return (
    <>
      {showBadge && <InstallBadge onDismiss={dismiss} />}
      <InstallGuide
        open={guideOpen && !isInstalled}
        platform={platform}
        onOpenChange={setInstallGuideOpen}
      />
    </>
  );
}

function InstallBadge({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="region"
      aria-label="تثبيت التطبيق"
      className="fixed inset-x-3 bottom-[calc(0.875rem+env(safe-area-inset-bottom))] z-[60] flex items-center gap-1 rounded-[20px] border bg-card py-2 ps-2.5 pe-1.5 text-card-foreground shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)] animate-in fade-in slide-in-from-bottom-4 duration-500 md:hidden print:hidden"
    >
      <button
        type="button"
        onClick={() => void requestInstall()}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
      >
        <Image
          src="/pwa/icon-192.png"
          alt=""
          width={40}
          height={40}
          className="shrink-0 rounded-[10px]"
          unoptimized
        />
        <span className="min-w-0 flex-1 leading-snug">
          <strong className="block text-[0.95rem]">ثبّت التطبيق على جوالك</strong>
          <small className="block text-xs text-muted-foreground">وصول أسرع من الشاشة الرئيسية</small>
        </span>
        <span className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground">
          تثبيت
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="إخفاء"
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

type Step = { text: React.ReactNode; icon: React.ReactNode };

function InstallGuide({
  open,
  platform,
  onOpenChange,
}: {
  open: boolean;
  platform: 'ios' | 'android' | 'desktop';
  onOpenChange: (open: boolean) => void;
}) {
  const [inAppBrowser, setInAppBrowser] = useState(false);
  useEffect(() => setInAppBrowser(isIosInAppBrowser(navigator.userAgent)), []);

  const ios = platform === 'ios';
  const steps: Step[] = ios
    ? [
        {
          text: (
            <>
              اضغط زر <b>المشاركة</b> في شريط المتصفح
            </>
          ),
          icon: <Share className="size-5 text-sky-600" />,
        },
        {
          text: (
            <>
              اختر <b>إضافة إلى الشاشة الرئيسية</b>
            </>
          ),
          icon: <PlusSquare className="size-5" />,
        },
        {
          text: (
            <>
              اضغط <b>إضافة</b> في الأعلى
            </>
          ),
          icon: <CheckCircle2 className="size-5 text-emerald-600" />,
        },
      ]
    : [
        {
          text: (
            <>
              افتح قائمة المتصفح <b>⋮</b>
            </>
          ),
          icon: <EllipsisVertical className="size-5" />,
        },
        {
          text: (
            <>
              اختر <b>تثبيت التطبيق</b> أو <b>إضافة إلى الشاشة الرئيسية</b>
            </>
          ),
          icon: <Smartphone className="size-5" />,
        },
      ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[90vh] max-w-lg rounded-t-[22px] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-foreground/15" aria-hidden />
        <SheetHeader className="flex-row items-center gap-3 p-0 text-start">
          <Image
            src="/pwa/icon-192.png"
            alt=""
            width={52}
            height={52}
            className="rounded-[14px]"
            unoptimized
          />
          <div>
            <SheetTitle className="text-lg font-extrabold">
              {ios ? 'تثبيت التطبيق على الآيفون' : 'تثبيت التطبيق'}
            </SheetTitle>
            <SheetDescription>
              {ios ? 'ثلاث خطوات فقط' : 'خطوتان فقط من قائمة المتصفح'}
            </SheetDescription>
          </div>
        </SheetHeader>

        {ios && inAppBrowser && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            افتح الرابط في متصفح <b>Safari</b> أولاً، فالتثبيت غير متاح من داخل هذا التطبيق.
          </p>
        )}

        <ol className="grid gap-2.5">
          {steps.map((step, index) => (
            <li key={index} className="flex items-center gap-3 rounded-2xl bg-muted px-3.5 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-background font-extrabold">
                {index + 1}
              </span>
              <span className="flex-1 text-sm">{step.text}</span>
              <span aria-hidden>{step.icon}</span>
            </li>
          ))}
        </ol>

        {ios && (
          <p className="px-1 text-xs text-muted-foreground">
            إذا لم يظهر الخيار، مرّر قائمة المشاركة للأسفل أو اضغط «تعديل الإجراءات».
          </p>
        )}

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="w-full rounded-2xl bg-primary py-3 font-bold text-primary-foreground"
        >
          فهمت
        </button>
      </SheetContent>
    </Sheet>
  );
}
