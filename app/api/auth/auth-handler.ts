import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { authOptions } from '@/app/lib/auth';

type AuthRouteContext = {
  params: Promise<{ nextauth: string[] }>;
};

type ProviderRouteContext = {
  params: Promise<{ provider: string }>;
};

export const authHandler = NextAuth(authOptions);

export function createAuthActionHandler(nextauth: string[]) {
  return function handler(req: NextRequest) {
    return authHandler(req, {
      params: Promise.resolve({ nextauth }),
    } satisfies AuthRouteContext);
  };
}

export async function authProviderCallbackHandler(
  req: NextRequest,
  context: ProviderRouteContext
) {
  const { provider } = await context.params;
  return authHandler(req, {
    params: Promise.resolve({ nextauth: ['callback', provider] }),
  } satisfies AuthRouteContext);
}

export async function authProviderSigninHandler(
  req: NextRequest,
  context: ProviderRouteContext
) {
  const { provider } = await context.params;
  return authHandler(req, {
    params: Promise.resolve({ nextauth: ['signin', provider] }),
  } satisfies AuthRouteContext);
}
