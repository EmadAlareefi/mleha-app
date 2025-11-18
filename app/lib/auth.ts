import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/prisma';

// In production, store users in database
// For now, using environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'اسم المستخدم', type: 'text' },
        password: { label: 'كلمة المرور', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        // First, check if it's an admin user
        if (credentials.username === ADMIN_USERNAME) {
          const isValidPassword = ADMIN_PASSWORD_HASH
            ? await compare(credentials.password, ADMIN_PASSWORD_HASH)
            : credentials.password === process.env.ADMIN_PASSWORD;

          if (isValidPassword) {
            return {
              id: 'admin-1',
              name: 'مسؤول النظام',
              username: ADMIN_USERNAME,
              role: 'admin',
            };
          }
          return null;
        }

        // Check if it's an order user
        const orderUser = await prisma.orderUser.findUnique({
          where: { username: credentials.username },
        });

        if (orderUser) {
          // Check if user is active
          if (!orderUser.isActive) {
            return null;
          }

          // Verify password
          const isValidPassword = await compare(credentials.password, orderUser.password);
          if (!isValidPassword) {
            return null;
          }

          return {
            id: orderUser.id,
            name: orderUser.name,
            username: orderUser.username,
            role: 'order_user',
            orderUserData: {
              autoAssign: orderUser.autoAssign,
              maxOrders: orderUser.maxOrders,
              orderType: orderUser.orderType,
              specificStatus: orderUser.specificStatus,
            },
          };
        }

        // User not found
        return null;
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = (user as any).username;
        token.role = (user as any).role;
        token.orderUserData = (user as any).orderUserData;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).username = token.username;
        (session.user as any).role = token.role;
        (session.user as any).orderUserData = token.orderUserData;
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};
