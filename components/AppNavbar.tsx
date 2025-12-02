'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Home, LogOut } from 'lucide-react';

interface AppNavbarProps {
  title?: string;
  subtitle?: string;
}

export default function AppNavbar({ title, subtitle }: AppNavbarProps) {
  const { data: session } = useSession();
  const userName = session?.user?.name || 'المستخدم';

  return (
    <header className="bg-white shadow-sm border-b sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center">
          {/* Left side - Title */}
          <div>
            {title ? (
              <>
                <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                {subtitle && (
                  <p className="text-sm text-gray-600 mt-1">{subtitle}</p>
                )}
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-gray-900">لوحة التحكم</h1>
                <p className="text-sm text-gray-600 mt-1">مرحباً، {userName}</p>
              </>
            )}
          </div>

          {/* Right side - Actions */}
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button
                variant="outline"
                className="flex items-center gap-2 hover:bg-gray-50"
              >
                <Home className="h-4 w-4" />
                <span className="hidden sm:inline">الرئيسية</span>
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex items-center gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">تسجيل الخروج</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
