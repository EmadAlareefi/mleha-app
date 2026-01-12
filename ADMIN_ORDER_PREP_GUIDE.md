# Admin Order Prep Management Guide

## Overview
A comprehensive admin dashboard for managing order preparation operations with advanced reporting, reassignment capabilities, and status management.

## Access
**URL:** `/admin/order-prep`
**Required Role:** `admin`

---

## Features

### 📊 Real-Time Statistics Dashboard

#### Time-Based Views
- **Today**: Current day's orders and performance
- **This Week**: Last 7 days of data
- **This Month**: Current month's statistics

#### Key Metrics Cards
1. **Total Orders** - Total number of orders in selected period
2. **Completed Orders** - Successfully completed orders with completion rate
3. **Under Review** - Orders marked as "تحت المراجعة" needing follow-up
4. **Parts Reservation** - Orders in "تحت المراجعة حجز قطع" status

---

### 🔍 Advanced Filtering

#### Time Filters
- **Today** - Orders from today
- **Week** - Orders from last 7 days
- **Month** - Orders from current month

#### Status Filters
- **All** - All orders regardless of status
- **Active** - Currently being prepared (not completed)
- **Completed** - Finished orders
- **Under Review** - Orders in review status (ID: 1065456688)
- **Reservation** - Orders with parts reservation (ID: 1576217163)

---

### 👥 User Performance Tracking

View detailed performance metrics for each order prep user:
- Total orders assigned
- Completed orders count
- Orders under review
- Orders in parts reservation
- Completion rate percentage

**Use Case:** Identify high-performing users and those who need support

---

### 🔄 Order Reassignment

**How to Reassign:**
1. Select orders using checkboxes
2. Click "📦 نقل للمستخدم" (Transfer to User)
3. Choose target user from dropdown
4. Confirm reassignment

**Features:**
- Bulk reassignment (multiple orders at once)
- Only users with "orders" role are shown
- Assignment timestamp is updated
- Instant feedback on success/failure

**Use Cases:**
- Load balancing between users
- Reassigning orders when a user is unavailable
- Moving orders to specialists for specific issues

---

### 🔓 Reopen Orders

**Purpose:** Return orders from review/reservation status back to "New Order" status for re-preparation after fixing issues.

**Process:**
1. Select orders to reopen (checkboxes)
2. Click "🔄 إعادة فتح" (Reopen)
3. Confirm the action

**What Happens:**
- Order status in Salla changes to "طلب جديد" (New Order) - ID: 449146439
- Assignment is deleted from the system
- Order becomes available for assignment again
- Can be picked up by any order prep user

**When to Use:**
- Customer issue has been resolved
- Parts are now available
- Order information was corrected
- Product was restocked

---

### 📋 Orders Table

**Columns:**
- **Checkbox** - Select for bulk actions
- **Order Number** - Salla order reference
- **User** - Assigned order prep user
- **Status** - Current order status with color coding
- **Assigned At** - When order was assigned
- **Started At** - When user began preparation
- **Completed At** - When order was finished
- **Customer** - Customer name

**Color Coding:**
- 🟢 Green - Completed/Shipped
- 🟠 Orange - Under Review
- 🟣 Purple - Parts Reservation
- 🔵 Blue - In Progress
- 🟡 Yellow - Pending

---

## API Endpoints

### 1. List Orders
```

GET /api/admin/order-assignments/list?timeFilter=today&statusFilter=all
```
**Response:**
```json
{
  "success": true,
  "assignments": [...],
  "count": 42
}
```

### 2. Get Statistics
```
GET /api/admin/order-assignments/stats
```
**Response:**
```json
{
  "success": true,
  "stats": {
    "active": { "total": 12, "completed": 0, "byUser": [...] },
    "today": { "total": 50, "completed": 40, "byUser": [...] },
    "week": { ... },
    "month": { ... }
  }
}
```

Each time bucket now contains a `byUser` array so the dashboard can display
performance metrics that match the selected filter (active, today, week, month).

### 3. Reassign Orders
```
POST /api/admin/order-assignments/reassign
Body: {
  "assignmentIds": ["id1", "id2"],
  "newUserId": "user123"
}
```

### 4. Reopen Orders
```
POST /api/admin/order-assignments/reopen
Body: {
  "assignmentIds": ["id1", "id2"]
}
```

### 5. Get Users
```
GET /api/admin/order-assignments/users
```
**Returns:** List of users with "orders" role

---

## Status Reference

### Salla Status IDs
- `449146439` - طلب جديد (New Order)
- `1065456688` - تحت المراجعة (Under Review)
- `1576217163` - تحت المراجعة حجز قطع (Under Review - Parts Reservation)
- `165947469` - تم الشحن (Shipped)
- `1956875584` - جاري التجهيز (In Progress)

---

## Workflows

### Workflow 1: Rebalance Workload
1. Go to Admin Order Prep page
2. Filter by "Active" to see current work
3. Check User Performance table
4. Select orders from overloaded users
5. Reassign to users with lower workload

### Workflow 2: Reopen Review Orders
1. Filter by "Under Review" status
2. Review order details
3. Fix issues in Salla (add stock, correct info, etc.)
4. Select fixed orders
5. Click "Reopen" to make available for prep again
6. Orders will appear in order prep queue

### Workflow 3: Daily Performance Review
1. Set filter to "Today"
2. Review completion rates by user
3. Identify bottlenecks (high under review count)
4. Take corrective action (training, reassignment, etc.)

### Workflow 4: Weekly Reporting
1. Set filter to "Week"
2. Export statistics (screenshot or manual notes)
3. Review trends:
   - Total orders processed
   - Completion rate
   - Under review rate
   - Top performing users

---

## Best Practices

### For Admins
1. **Monitor Daily** - Check dashboard at start and end of day
2. **Balance Load** - Reassign when one user has too many orders
3. **Review Quickly** - Don't let "under review" orders sit too long
4. **Track Trends** - Use weekly/monthly views to identify patterns
5. **Support Users** - If a user has high review rate, provide training

### For Reopening Orders
1. **Fix Root Cause** - Always fix the issue before reopening
2. **Add Notes** - Document what was fixed in Salla order notes
3. **Verify Stock** - Ensure products are available before reopening
4. **Communicate** - Let order prep team know orders are ready

---

## Troubleshooting

### Orders Not Showing
- Check time filter (today/week/month)
- Check status filter
- Verify orders exist in database
- Try "All" filter to see everything

### Reassignment Failed
- Verify target user has "orders" role
- Check user exists in system
- Ensure orders are not already assigned to that user

### Reopen Failed
- Check Salla API connection
- Verify order still exists in Salla
- Check merchant token is valid
- Review error message for details

---

## Files Created

### Frontend
- `app/admin/order-prep/page.tsx` - Main admin dashboard

### API Endpoints
- `app/api/admin/order-assignments/list/route.ts` - List orders
- `app/api/admin/order-assignments/stats/route.ts` - Get statistics
- `app/api/admin/order-assignments/reassign/route.ts` - Reassign orders
- `app/api/admin/order-assignments/reopen/route.ts` - Reopen orders
- `app/api/admin/order-assignments/users/route.ts` - Get order users

---

## Future Enhancements

### Potential Features
1. **Export to Excel** - Download reports as spreadsheet
2. **Charts/Graphs** - Visual representation of statistics
3. **Notifications** - Alert when orders stuck in review
4. **Comments** - Add internal notes to orders
5. **History Log** - Track all status changes and reassignments
6. **Filters by User** - Filter table by specific user
7. **Search** - Search by order number or customer name
8. **Bulk Status Change** - Change status of multiple orders at once
9. **Performance Goals** - Set targets for completion rates
10. **Automated Reports** - Daily/weekly email summaries

---

## Access Control

**Required:**
- User must be logged in
- User must have `admin` role in their roles array

**Security:**
- All API endpoints should verify admin role
- Audit log all admin actions
- Rate limit bulk operations

---

## Support

For issues or questions:
1. Check troubleshooting section
2. Review API endpoint responses for error details
3. Check browser console for client-side errors
4. Review server logs for backend errors
