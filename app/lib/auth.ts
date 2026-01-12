import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { ensureUserServiceKeys } from '@/app/lib/user-services';
import { getRolesFromServiceKeys, getAllServiceKeys } from '@/app/lib/service-definitions';

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

          const fallbackRoles = [orderUser.role];
          const serviceKeys = await ensureUserServiceKeys(orderUser.id, fallbackRoles);
          const userRoles = getRolesFromServiceKeys(serviceKeys);

          // Primary role is the first role (for backward compatibility)
          const primaryRole = userRoles[0] ?? 'orders';

          // Get warehouse assignments if user has warehouse role
          const hasWarehouseRole = userRoles.includes('warehouse');
          const warehouseAssignments = hasWarehouseRole
            ? await prisma.warehouseAssignment.findMany({
                where: {
                  userId: orderUser.id,
                  warehouse: { isActive: true },
                },
                include: {
                  warehouse: true,
                },
              })
            : [];

          const warehouseData = hasWarehouseRole
            ? {
                warehouses: warehouseAssignments.map((assignment) => ({
                  id: assignment.warehouse.id,
                  name: assignment.warehouse.name,
                  code: assignment.warehouse.code,
                  location: assignment.warehouse.location,
                })),
              }
            : undefined;

          // Include order data if user has orders role
          const hasOrdersRole = userRoles.includes('orders');
          const orderUserData = hasOrdersRole
            ? {
                autoAssign: orderUser.autoAssign,
              }
            : undefined;

          return {
            id: orderUser.id,
            name: orderUser.name,
            username: orderUser.username,
            role: primaryRole, // Primary role for backward compatibility
            roles: userRoles, // Array of all roles
            serviceKeys,
            orderUserData,
            warehouseData,
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
        token.role = (user as any).role; // Primary role for backward compatibility
        token.roles = (user as any).roles || [(user as any).role]; // Array of all roles
        token.serviceKeys = (user as any).serviceKeys;
        token.orderUserData = (user as any).orderUserData;
        token.warehouseData = (user as any).warehouseData;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).username = token.username;
        (session.user as any).role = token.role; // Primary role for backward compatibility
        (session.user as any).roles = token.roles || [token.role]; // Array of all roles
        (session.user as any).serviceKeys = token.serviceKeys;
        (session.user as any).orderUserData = token.orderUserData;
        (session.user as any).warehouseData = token.warehouseData;
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
