'use client';

import { useState, useEffect, Suspense } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PublicPageShell } from '@/components/dashboard/public-page-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Sparkles } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultCallbackUrl = searchParams.get('callbackUrl') || '/';
  const { update: updateSession } = useSession();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (searchParams.get('reason') === 'deactivated') {
      setError('تم إلغاء تفعيل حسابك. الرجاء التواصل مع الإدارة.');
    }
  }, [searchParams]);

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
    } catch {
      setError('حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicPageShell title="مليحة" subtitle="نظام الإدارة الداخلي" showHomeLink={false}>
      <Card className="w-full max-w-md rounded-lg">
        <CardHeader className="text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-lg border bg-muted">
            <Sparkles className="size-5 text-primary" />
          </div>
          <CardTitle className="text-2xl">تسجيل الدخول</CardTitle>
          <CardDescription>أدخل بيانات الحساب للوصول إلى صلاحياتك المعتمدة.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">اسم المستخدم</FieldLabel>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="أدخل اسم المستخدم"
                  required
                  disabled={loading}
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">كلمة المرور</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور"
                  required
                  disabled={loading}
                />
              </Field>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={loading} className="w-full">
                {loading && <Spinner />}
                {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </PublicPageShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <PublicPageShell title="مليحة" subtitle="نظام الإدارة الداخلي" showHomeLink={false}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            جاري التحميل...
          </div>
        </PublicPageShell>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
