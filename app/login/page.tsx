'use client';

import { useState, Suspense } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultCallbackUrl = searchParams.get('callbackUrl') || '/';
  const { update: updateSession } = useSession();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('اسم المستخدم أو كلمة المرور غير صحيحة');
      } else if (result?.ok) {
        // Force session refresh so the home page has fresh data immediately
        await updateSession();

        router.push(defaultCallbackUrl);
        router.refresh();
      }
    } catch (err) {
      setError('حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  const inputClasses =
    'w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100';

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent_55%)]" />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950 opacity-90" />
      <Card className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-white/95 p-8 shadow-2xl shadow-slate-900/30">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-500">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <span>نظام الإدارة</span>
          </div>
          <h2 className="mt-4 text-2xl font-semibold text-slate-900">تسجيل الدخول</h2>
          <p className="mt-1 text-sm text-slate-500">
            أدخل بيانات الحساب للوصول إلى صلاحياتك المعتمدة.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-semibold text-slate-600">
              اسم المستخدم
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="أدخل اسم المستخدم"
              className={inputClasses}
              required
              disabled={loading}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-semibold text-slate-600">
              كلمة المرور
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="أدخل كلمة المرور"
              className={inputClasses}
              required
              disabled={loading}
            />
          </div>
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error}
            </div>
          )}
          <Button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-blue-500 py-5 text-lg text-white shadow-lg shadow-indigo-500/30 hover:from-indigo-600 hover:to-blue-600"
          >
            {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
          جاري التحميل...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
