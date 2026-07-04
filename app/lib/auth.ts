import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { getUserServiceKeys } from '@/app/lib/user-services';
import { getRolesFromServiceKeys, getAllServiceKeys } from '@/app/lib/service-definitions';

// In production, store users in database
// For now, using environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

// How often an already-issued session token is re-synced against the DB
// (role/serviceKeys/isActive). Bounds how long a permission change or a
// deactivation can take to propagate to an existing session.
const SESSION_REFRESH_INTERVAL_MS = 60 * 1000;

async function buildOrderUserSessionFields(orderUser: {
  id: string;
  affiliateName: string | null;
  autoAssign: boolean;
}) {
  const serviceKeys = await getUserServiceKeys(orderUser.id);
  const userRoles = getRolesFromServiceKeys(serviceKeys);
  const primaryRole = userRoles[0] ?? 'orders';

  const hasWarehouseRole = userRoles.includes('warehouse');
  const warehouseData = hasWarehouseRole
    ? {
        warehouses: (
          await prisma.warehouseAssignment.findMany({
            where: {
              userId: orderUser.id,
              warehouse: { isActive: true },
            },
            include: {
              warehouse: true,
            },
          })
        ).map((assignment) => ({
          id: assignment.warehouse.id,
          name: assignment.warehouse.name,
          code: assignment.warehouse.code,
          location: assignment.warehouse.location,
        })),
      }
    : undefined;

  const hasOrdersRole = userRoles.includes('orders');
  const orderUserData = hasOrdersRole ? { autoAssign: orderUser.autoAssign } : undefined;

  return { serviceKeys, userRoles, primaryRole, warehouseData, orderUserData };
}

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
              roles: ['admin'],
              serviceKeys: getAllServiceKeys(),
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

          const fields = await buildOrderUserSessionFields(orderUser);
          // Manufacturer (tailor) accounts sign in without any service keys —
          // their access is derived from userType, not the service catalog.
          if (fields.serviceKeys.length === 0 && orderUser.userType !== 'manufacturer') {
            return null;
          }

          const sessionPayload = {
            id: orderUser.id,
            name: orderUser.name,
            username: orderUser.username,
            role: fields.primaryRole,
            roles: fields.userRoles,
            serviceKeys: fields.serviceKeys,
            userType: orderUser.userType,
            affiliateName: orderUser.affiliateName,
            orderUserData: fields.orderUserData,
            warehouseData: fields.warehouseData,
          };

          return sessionPayload;
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
        token.role = (user as any).role; // Primary role for backward compatibility
        token.roles = (user as any).roles || [(user as any).role]; // Array of all roles
        token.serviceKeys = (user as any).serviceKeys;
        token.userType = (user as any).userType;
        token.affiliateName = (user as any).affiliateName;
        token.orderUserData = (user as any).orderUserData;
        token.warehouseData = (user as any).warehouseData;
        token.isEnvAdmin = user.id === 'admin-1';
        token.lastRefreshed = Date.now();
        delete (token as any).error;
        return token;
      }

      // The env-var pseudo-admin has no OrderUser row — never DB-refetch it.
      if ((token as any).isEnvAdmin) {
        return token;
      }

      const lastRefreshed = ((token as any).lastRefreshed as number | undefined) ?? 0;
      if (Date.now() - lastRefreshed < SESSION_REFRESH_INTERVAL_MS) {
        return token;
      }

      const orderUser = await prisma.orderUser.findUnique({
        where: { id: token.id as string },
        select: { id: true, affiliateName: true, autoAssign: true, isActive: true, userType: true },
      });

      if (!orderUser || !orderUser.isActive) {
        token.role = undefined;
        token.roles = [];
        token.serviceKeys = [];
        token.orderUserData = undefined;
        token.warehouseData = undefined;
        (token as any).error = 'AccountDeactivated';
        (token as any).lastRefreshed = Date.now();
        return token;
      }

      const fields = await buildOrderUserSessionFields(orderUser);
      token.role = fields.primaryRole;
      token.roles = fields.userRoles;
      token.serviceKeys = fields.serviceKeys;
      token.userType = orderUser.userType;
      token.affiliateName = orderUser.affiliateName;
      token.orderUserData = fields.orderUserData;
      token.warehouseData = fields.warehouseData;
      delete (token as any).error;
      (token as any).lastRefreshed = Date.now();
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).username = token.username;
        (session.user as any).role = token.role; // Primary role for backward compatibility
        (session.user as any).roles = token.roles || [token.role]; // Array of all roles
        (session.user as any).serviceKeys = token.serviceKeys;
        (session.user as any).userType = token.userType;
        (session.user as any).affiliateName = token.affiliateName;
        (session.user as any).orderUserData = token.orderUserData;
        (session.user as any).warehouseData = token.warehouseData;
      }
      if ((token as any).error) {
        (session as any).error = (token as any).error;
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
