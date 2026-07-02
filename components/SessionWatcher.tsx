'use client';

import { useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';

export default function SessionWatcher() {
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if ((session as any)?.error === 'AccountDeactivated') {
      toast({
        title: 'تم إلغاء تفعيل حسابك',
        description: 'تم تسجيل خروجك تلقائياً',
        variant: 'destructive',
      });
      signOut({ redirect: false }).then(() => {
        router.push('/login?reason=deactivated');
      });
    }
  }, [session, toast, router]);

  return null;
}
