# Authentication Setup Guide

This document explains the authentication system implemented using NextAuth.js with username/password credentials.

## Overview

The system now has two types of access:
1. **Protected Routes** - Require authentication (admin access)
2. **Public Routes** - Open to everyone (customer access)

## Features

✅ Username/password authentication with NextAuth.js
✅ Session management with JWT
✅ Protected routes with middleware
✅ Public returns page for customers
✅ Admin dashboard with service navigation
✅ Secure logout functionality
✅ Arabic RTL interface

## Routes

### Public Routes (No Login Required)
- `/returns` - Customer return/exchange requests
- `/login` - Login page
- `/api/returns/*` - Return API endpoints
- `/api/orders/lookup` - Order lookup for returns
- `/api/auth/*` - NextAuth endpoints
- `/salla/webhook` - Salla webhook receiver

### Protected Routes (Login Required)
- `/` - Admin dashboard home
- `/warehouse` - Warehouse management
- `/local-shipping` - Local shipping management
- All other routes

## Default Credentials

**Username:** `admin`
**Password:** `admin123`

⚠️ **IMPORTANT:** Change these credentials in production!

## Environment Variables

The following environment variables control authentication:

```env
# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000  # Change to your production URL
NEXTAUTH_SECRET=mMv3KCLjNmnG3kxsGY2SbSHR5aVDS+VNKBZGF8NU9lA=  # Already generated
ADMIN_USERNAME=admin  # Change this
ADMIN_PASSWORD=admin123  # Change this
```

### For Production (Recommended)

Use a bcrypt hash instead of plain password:

1. Generate hash:
```bash
node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('your_new_password', 10));"
```

2. Update `.env`:
```env
ADMIN_PASSWORD_HASH=$2a$10$your_generated_hash
# Remove or comment out ADMIN_PASSWORD
```

## How It Works

### 1. Authentication Flow

```
User visits protected route
    ↓
Middleware checks session
    ↓
No session? → Redirect to /login
    ↓
User enters credentials
    ↓
NextAuth validates against env variables
    ↓
Valid? → Create session → Redirect to original page
    ↓
Invalid? → Show error
```

### 2. Middleware Protection

The middleware (`middleware.ts`) protects all routes except:
- `/returns` - Public for customers
- `/login` - Login page
- `/api/returns/*` - Return APIs
- `/api/orders/lookup` - Order lookup
- `/api/auth/*` - NextAuth
- `/salla/webhook` - Webhooks
- Static files

### 3. Session Management

- Sessions use JWT (JSON Web Tokens)
- Sessions last 30 days
- Sessions stored client-side (httpOnly cookies)
- Automatic session refresh on page navigation

## User Interface

### Login Page (`/login`)
- Username and password fields
- Error messages in Arabic
- Link to public returns page
- Gradient background design

### Admin Dashboard (`/`)
- Welcome message with user name
- Service cards with icons
- Logout button
- Info cards about system status

### Service Cards
1. **المستودع** (Warehouse) - Blue
2. **الشحن المحلي** (Local Shipping) - Green
3. **الإرجاع والاستبدال** (Returns) - Orange with "عام" badge

## Adding More Users

Currently, the system supports single-user authentication. To add more users:

### Option 1: Environment Variables (Quick)
Add multiple users in `app/lib/auth.ts`:

```typescript
const users = [
  {
    id: '1',
    username: process.env.ADMIN_USERNAME || 'admin',
    name: 'مسؤول النظام',
    role: 'admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
  },
  {
    id: '2',
    username: 'user2',
    name: 'مستخدم آخر',
    role: 'staff',
    passwordHash: '$2a$10$...',
  },
];
```

### Option 2: Database (Recommended for Production)

1. Create a `User` model in `prisma/schema.prisma`:

```prisma
model User {
  id            String   @id @default(cuid())
  username      String   @unique
  passwordHash  String
  name          String
  role          String
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

2. Update `app/lib/auth.ts` to query database:

```typescript
async authorize(credentials) {
  const user = await prisma.user.findUnique({
    where: { username: credentials.username }
  });

  if (!user || !user.active) return null;

  const isValid = await compare(credentials.password, user.passwordHash);
  if (!isValid) return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
  };
}
```

## Security Best Practices

### 1. Change Default Credentials
```bash
# Update in .env
ADMIN_USERNAME=your_new_username
ADMIN_PASSWORD=your_strong_password
```

### 2. Use Password Hashing
```bash
# Generate bcrypt hash
node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('strong_password_123', 10));"

# Add to .env
ADMIN_PASSWORD_HASH=$2a$10$generated_hash_here
```

### 3. Update NEXTAUTH_URL for Production
```env
NEXTAUTH_URL=https://your-domain.com
```

### 4. Keep NEXTAUTH_SECRET Secret
- Never commit to git
- Regenerate for production
- Store securely in Vercel/hosting platform

### 5. Enable HTTPS in Production
NextAuth requires HTTPS in production for security.

## Customization

### Change Session Duration
In `app/lib/auth.ts`:

```typescript
session: {
  strategy: 'jwt',
  maxAge: 7 * 24 * 60 * 60, // 7 days instead of 30
}
```

### Add Role-Based Access Control
Update middleware to check roles:

```typescript
export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    // Example: Only admins can access /warehouse
    if (path.startsWith('/warehouse') && token?.role !== 'admin') {
      return NextResponse.redirect(new URL('/', req.url));
    }

    return NextResponse.next();
  },
  // ...
);
```

### Customize Login Page
Edit `app/login/page.tsx` to:
- Add logo
- Change colors
- Add "Remember me" checkbox
- Add "Forgot password" link

## Testing

### Test Login
1. Start dev server: `npm run dev`
2. Visit `http://localhost:3000`
3. Should redirect to `/login`
4. Enter credentials:
   - Username: `admin`
   - Password: `admin123`
5. Should redirect to dashboard

### Test Public Access
1. Visit `http://localhost:3000/returns`
2. Should load without authentication
3. Order lookup should work

### Test Logout
1. Login first
2. Click "تسجيل الخروج" button
3. Should redirect to login page
4. Try accessing `/` - should redirect to login

### Test Session Persistence
1. Login
2. Close browser
3. Open browser and visit `http://localhost:3000`
4. Should still be logged in (session persists)

## Troubleshooting

### "Invalid username or password"
- Check environment variables are loaded
- Verify username and password match `.env`
- Check for typos

### Infinite redirect loop
- Clear browser cookies
- Check `NEXTAUTH_URL` matches your dev URL
- Verify middleware is not blocking `/login`

### Session not persisting
- Check `NEXTAUTH_SECRET` is set
- Verify cookies are enabled in browser
- Check for HTTPS issues in production

### Can't access protected routes after login
- Check session is created (use browser dev tools → Application → Cookies)
- Verify middleware matcher is correct
- Check NextAuth callback is working

## Deployment Checklist

- [ ] Change `ADMIN_USERNAME` from default
- [ ] Change `ADMIN_PASSWORD` or use `ADMIN_PASSWORD_HASH`
- [ ] Update `NEXTAUTH_URL` to production URL
- [ ] Verify `NEXTAUTH_SECRET` is secure and different from dev
- [ ] Test login flow in production
- [ ] Test logout functionality
- [ ] Verify public routes work without auth
- [ ] Test protected routes require auth
- [ ] Enable HTTPS

## Support

For issues:
1. Check browser console for errors
2. Check server logs
3. Verify environment variables
4. Test with default credentials first
5. Clear browser cache and cookies

## Future Enhancements

Possible improvements:
- Multi-factor authentication (2FA)
- Password reset functionality
- Email verification
- OAuth providers (Google, etc.)
- Activity logging
- Session management page
- Password strength requirements
- Account lockout after failed attempts
