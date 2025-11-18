# Order Assignment & Preparation Workflow

## Salla Order Statuses

The system works with the following Salla order statuses:

### 1. **تحت المراجعة** (under_review)
- **When**: New orders from Salla
- **System Action**: Available for auto-assignment to users
- **Description**: Orders that have been placed but not yet assigned to anyone

### 2. **جاري التجهيز** (processing)
- **When**: Order assigned to a user
- **System Action**: Automatically set when order is assigned during auto-assign
- **Description**: Order is assigned and being prepared by warehouse staff

### 3. **جاهز للاستلام** (ready_for_pickup)
- **When**: User marks order as "prepared/completed"
- **System Action**: Set when user clicks "إكمال الطلب"
- **Description**: Order is ready to be picked up or shipped

## Complete Workflow

### Phase 1: Order Assignment (Automatic)

```
New Order in Salla
    ↓
Status: "تحت المراجعة" (under_review)
    ↓
User logs into /order-prep
    ↓
Auto-Assign triggered (if enabled)
    ↓
System fetches orders with status "under_review"
    ↓
Filters by user's order type (COD/prepaid/all)
    ↓
Creates OrderAssignment records
    ↓
Updates Salla status to "جاري التجهيز" (processing)
    ↓
Order appears in user's queue
```

### Phase 2: Order Preparation (Manual)

```
User sees assigned orders
    ↓
Clicks on order to view details
    ↓
Reviews customer info and products
    ↓
Clicks "بدء التحضير" (Start Preparation)
    ↓
Local status: assigned → preparing
(Salla status already "جاري التجهيز")
    ↓
User gathers products and packs order
    ↓
Clicks "إكمال الطلب" (Complete Order)
    ↓
Validation: Checks if Salla status is "processing"
    ↓
Local status: preparing → prepared
Salla status: processing → ready_for_pickup
    ↓
Order removed from active queue
    ↓
System auto-moves to next order
```

## Status Validations

### Assignment Validation
- ✅ Only fetches orders with status "تحت المراجعة" (under_review)
- ✅ Immediately updates to "جاري التجهيز" (processing) upon assignment
- ✅ Prevents duplicate assignments (checks existing OrderAssignments)

### Preparation Validation
- ✅ **Critical**: Only allows completing orders that are in "جاري التجهيز" (processing) status
- ✅ Error message if user tries to complete order in wrong status:
  > "يمكن تجهيز الطلبات التي في حالة 'جاري التجهيز' فقط"

## Order Types Assignment

Users can be configured to handle specific order types:

### 1. **All Orders** (orderType: 'all')
- Receives all orders regardless of payment method

### 2. **COD Only** (orderType: 'cod')
- Only receives "Cash on Delivery" orders
- Filters: `payment_method === 'cash_on_delivery' || payment_method === 'cod'`

### 3. **Prepaid Only** (orderType: 'prepaid')
- Only receives prepaid orders (credit card, online payment, etc.)
- Filters: `payment_method !== 'cash_on_delivery' && payment_method !== 'cod'`

### 4. **Specific Status** (orderType: 'specific_status')
- Can be configured to fetch orders with any specific Salla status
- Useful for custom workflows

## API Endpoints & Status Flow

### Auto-Assignment API
```
POST /api/order-assignments/auto-assign
Body: { userId: "user123" }

Actions:
1. Fetch orders from Salla: GET /orders?status=under_review
2. Filter by payment method (if applicable)
3. Create OrderAssignment records
4. Update Salla: PUT /orders/{id}/status → { status: "processing" }
```

### Status Update API
```
POST /api/order-assignments/update-status
Body: {
  assignmentId: "assignment123",
  status: "prepared",
  updateSalla: true,
  sallaStatus: "ready_for_pickup"
}

Validations:
- Checks assignment.sallaStatus === "processing"
- Only allows completion if order is in correct state
```

## User Dashboard Features

### Stats Display
- **Assigned**: Orders waiting to be started (status: assigned)
- **Preparing**: Orders currently being worked on (status: preparing)
- **Total**: Total active assignments (assigned + preparing)

### Order Queue
- Shows all active orders in sidebar
- FIFO order (First In, First Out)
- Click to switch between orders
- Current order highlighted in blue

### Order Details
- Customer: Name, phone, email
- Products: Item names, SKUs, quantities
- Visual status indicator (color-coded)

## Admin Configuration

### Creating Users (`/order-users-management`)
1. Set username and password
2. Choose order type (all/COD/prepaid/specific)
3. Set max orders limit (e.g., 50)
4. Enable auto-assign (recommended)
5. Mark as active

### Order Type Examples

**User 1 - COD Handler:**
- Order Type: COD Only
- Max Orders: 30
- Auto-Assign: Enabled
- Result: Only gets COD orders from "تحت المراجعة"

**User 2 - Prepaid Handler:**
- Order Type: Prepaid Only
- Max Orders: 50
- Auto-Assign: Enabled
- Result: Only gets prepaid orders from "تحت المراجعة"

## Error Handling

### Assignment Errors
- **No available slots**: User has reached maxOrders limit
- **No orders found**: No "تحت المراجعة" orders in Salla
- **Already assigned**: Order was assigned to another user

### Preparation Errors
- **Wrong status**: Order not in "processing" status
  - Cannot complete orders in other statuses
  - User must contact admin to fix status

## Best Practices

1. **Auto-Assign on Login**: Enable for smooth workflow
2. **Set Appropriate Limits**: Based on warehouse capacity
3. **Use Order Types**: Separate COD/prepaid for better organization
4. **Monitor Queue**: Check stats regularly to balance load
5. **Complete in Order**: Follow FIFO for fair processing

## Troubleshooting

### Order stuck in wrong status?
**Solution**: Admin can manually update in Salla or database

### User can't complete order?
**Check**: Is order status "جاري التجهيز" in Salla?

### Orders not auto-assigning?
**Check**:
- Is user active?
- Is auto-assign enabled?
- Has user reached maxOrders?
- Are there "تحت المراجعة" orders in Salla?
