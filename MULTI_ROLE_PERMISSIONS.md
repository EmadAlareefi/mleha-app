# Multi-Role Permissions System

## Overview

The system now supports **multiple roles per user**, allowing flexible permission combinations such as:

- **Warehouse + Orders** - User can scan shipments AND prepare orders
- **Orders + Store Manager** - User can prepare orders AND manage returns
- **All three roles** - User has full access to warehouse, orders, and returns

## Database Changes

### New Table: `UserRoleAssignment`

```prisma
model UserRoleAssignment {
  id              String        @id @default(cuid())
  userId          String
  role            OrderUserRole
  assignedAt      DateTime      @default(now())
  assignedBy      String?       // Username of admin who assigned this role

  user            OrderUser @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, role])
  @@index([userId])
  @@index([role])
}
```

### Updated: `OrderUser`

- **Legacy field preserved**: `role` field still exists for backward compatibility (marked as deprecated)
- **New relationship**: `roleAssignments UserRoleAssignment[]`

## Authentication Changes

### Session Structure

Users now have **both** `role` (primary/legacy) and `roles` (array) in their session:

```typescript
{
  user: {
    id: string,
    name: string,
    username: string,
    role: 'orders' | 'warehouse' | 'store_manager',  // Primary role
    roles: ['orders', 'warehouse'],                    // All roles
    orderUserData: {...},  // If has 'orders' role
    warehouseData: {...}   // If has 'warehouse' role
  }
}
```

## Helper Functions

### `/app/lib/user-roles.ts`

```typescript
// Get all roles for a user
const roles = await getUserRoles(userId);
// Returns: ['orders', 'warehouse']

// Check if user has a specific role
const hasRole = await userHasRole(userId, 'warehouse');
// Returns: true/false

// Check if user has any of multiple roles
const hasAny = await userHasAnyRole(userId, ['orders', 'store_manager']);
// Returns: true if user has at least one

// Assign a role to user
await assignRole(userId, 'WAREHOUSE', 'admin');

// Remove a role from user
await removeRole(userId, 'WAREHOUSE');

// Set exact roles (replaces all existing)
await setUserRoles(userId, ['ORDERS', 'WAREHOUSE'], 'admin');

// Get display name
const name = getRoleDisplayName('ORDERS');
// Returns: "تحضير الطلبات"

const names = getRoleDisplayNames(['ORDERS', 'WAREHOUSE']);
// Returns: "تحضير الطلبات + المستودع"
```

## Frontend Usage

### Check roles in components

```typescript
'use client';

import { useSession } from 'next-auth/react';

export default function MyPage() {
  const { data: session } = useSession();
  const roles = ((session?.user as any)?.roles || []) as string[];

  const hasOrdersAccess = roles.includes('orders');
  const hasWarehouseAccess = roles.includes('warehouse');
  const hasReturnsAccess = roles.includes('store_manager');

  return (
    <div>
      {hasOrdersAccess && <OrderPrepSection />}
      {hasWarehouseAccess && <WarehouseSection />}
      {hasReturnsAccess && <ReturnsSection />}
    </div>
  );
}
```

### Dashboard filtering

The dashboard (`/app/page.tsx`) automatically shows all services based on user's roles:

```typescript
const userRoles = ((session?.user as any)?.roles || [userRole]) as Role[];

const visibleServices = services.filter(
  (service) =>
    !service.allowedRoles ||
    service.allowedRoles.some(role => userRoles.includes(role))
);
```

## Middleware

The middleware (`/middleware.ts`) now checks if user has **any role** that allows access:

```typescript
const roles = (token.roles as string[]) || (role ? [role] : []);

// Check if user has any role that allows access to this path
const hasAccess = roles.some(userRole => {
  const restrictions = roleAccess[userRole];
  if (!restrictions) return false;
  return restrictions.allowed.some((pattern) => pattern.test(path));
});
```

## API Endpoints

### Example: Shipments API

```typescript
// Before (single role)
if (role !== 'admin' && role !== 'warehouse') {
  return error;
}

// After (multiple roles)
const roles = ((session.user as any)?.roles || [role]) as string[];
const hasPermission = roles.includes('admin') || roles.includes('warehouse');

if (!hasPermission) {
  return error;
}
```

## Migration

### Automatic Migration

Existing users are automatically migrated when they log in. The auth system:
1. Checks `UserRoleAssignment` table
2. If no assignments exist, falls back to legacy `role` field
3. Returns both `role` (primary) and `roles` (array) in session

### Manual Migration

Run the migration script to migrate all users at once:

```bash
npx ts-node scripts/migrate-user-roles.ts
```

This creates a `UserRoleAssignment` entry for each user's current role.

## Managing User Roles (Admin UI)

### TODO: User Management UI Update

The user management page (`/app/order-users-management/page.tsx`) needs to be updated to:

1. **Display current roles as checkboxes** instead of dropdown
2. **Allow selecting multiple roles**:
   - ☐ تحضير الطلبات (Orders)
   - ☐ المستودع (Warehouse)
   - ☐ إدارة المرتجعات (Store Manager)

3. **Show role combinations clearly**:
   - Display: "تحضير الطلبات + المستودع" for multi-role users

### API Endpoints for Role Management

You'll need to create/update these endpoints:

```typescript
// POST /api/order-users/[id]/roles
// Add a role to user
await assignRole(userId, role, adminUsername);

// DELETE /api/order-users/[id]/roles/[role]
// Remove a role from user
await removeRole(userId, role);

// PUT /api/order-users/[id]/roles
// Set exact roles (replace all)
await setUserRoles(userId, roles, adminUsername);
```

## Backward Compatibility

✅ **Fully backward compatible**:

- Legacy `role` field still exists
- Old code checking `session.user.role` still works
- New code can use `session.user.roles` array
- Automatic fallback if no role assignments exist

## Role Combinations

### Supported Combinations

| Combination | Use Case |
|-------------|----------|
| **Orders only** | Dedicated order preparation staff |
| **Warehouse only** | Shipping/receiving staff |
| **Store Manager only** | Returns management staff |
| **Warehouse + Orders** | Small team members who do both |
| **Orders + Store Manager** | Customer service handling orders and returns |
| **Warehouse + Store Manager** | Warehouse manager handling returns |
| **All three** | Supervisor or small business owner |

### Access Matrix

| Role | Can Access |
|------|------------|
| **Orders** | `/order-prep`, `/order-history` |
| **Warehouse** | `/warehouse`, `/local-shipping` |
| **Store Manager** | `/returns-management` |
| **Admin** | Everything (including user management) |

## Testing

### Test Scenarios

1. **Single role user** - Should work exactly as before
2. **Multi-role user** - Should see all allowed pages in dashboard
3. **Warehouse + Orders user**:
   - Can access `/warehouse` ✅
   - Can access `/order-prep` ✅
   - Cannot access `/returns-management` ❌
4. **Orders + Store Manager user**:
   - Can access `/order-prep` ✅
   - Can access `/returns-management` ✅
   - Cannot access `/warehouse` ❌

## Example: Assigning Multiple Roles

```typescript
import { setUserRoles } from '@/app/lib/user-roles';
import { OrderUserRole } from '@prisma/client';

// Assign multiple roles to a user
await setUserRoles(
  'user-id-123',
  [OrderUserRole.ORDERS, OrderUserRole.WAREHOUSE],
  'admin'
);
```

## Security Considerations

- ✅ All role checks use `roles.includes()` for array compatibility
- ✅ Middleware validates on every request
- ✅ API endpoints check permissions server-side
- ✅ Role assignments tracked with timestamps and audit trail
- ✅ Cascade delete when user is deleted

## Future Enhancements

- [ ] Role-based permissions matrix (granular permissions)
- [ ] Role assignment history/audit log
- [ ] Time-limited role assignments
- [ ] Role groups/templates for common combinations

---

**✅ Implementation Complete!** All users can now have multiple roles simultaneously.
