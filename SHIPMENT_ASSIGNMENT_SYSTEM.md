# Shipment Assignment & COD Management System

## Overview

This system allows warehouse administrators to assign local shipments to delivery agents and track COD (Cash on Delivery) collections throughout the entire delivery and payment lifecycle.

## Features

### 1. Shipment Assignment
- **Warehouse Admin** can assign pending local shipments to delivery agents
- View delivery agent statistics (assigned, in transit, delivered, failed)
- Unassign shipments if needed
- Add notes for delivery agents

### 2. Delivery Agent Interface
- View all assigned shipments with customer details
- Update shipment status through the delivery workflow:
  - `assigned` → `picked_up` → `in_transit` → `delivered`
  - Mark as `failed` with reason if delivery unsuccessful
- View active and completed deliveries
- See COD amounts that need to be collected

### 3. COD Tracking
- Automatic COD collection creation for COD shipments when assigned
- Track COD through multiple stages:
  - `pending`: Awaiting collection from customer
  - `collected`: Delivery agent collected from customer (auto-marked on delivery)
  - `deposited`: Warehouse admin records deposit
  - `reconciled`: Accountant reconciles the payment
  - `failed`: Collection failed

### 4. Multi-Role Permissions
- **Delivery Agent (مناديب توصيل)**: New role for delivery personnel
  - Access to `/my-deliveries` page
  - Can update their own shipment statuses
  - Can mark COD as collected upon delivery

- **Warehouse Admin**:
  - Access to `/shipment-assignments` page
  - Can assign/unassign shipments
  - Can record COD deposits
  - View COD tracker

- **Accountant**:
  - Access to `/cod-tracker` page
  - Can reconcile COD payments
  - View payment discrepancies

## Database Schema

### New Models

#### `ShipmentAssignment`
- Links local shipments to delivery agents
- Tracks assignment lifecycle with timestamps
- Stores delivery proof and recipient information
- Records failure/cancellation reasons

#### `CODCollection`
- Tracks COD payment from customer to company
- Records collection, deposit, and reconciliation details
- Handles payment discrepancies
- Links to shipment and assignment

### Updated Models

#### `LocalShipment`
- Added `paymentMethod` and `isCOD` fields
- Added `status` tracking (pending, assigned, in_transit, delivered, etc.)
- Added `deliveredAt`, `cancelledAt` timestamps
- Added relations to `ShipmentAssignment` and `CODCollection`

#### `OrderUserRole` Enum
- Added `DELIVERY_AGENT` role

## API Endpoints

### Shipment Assignments
- `GET /api/shipment-assignments` - List assignments (filtered by role)
- `POST /api/shipment-assignments` - Assign shipment to delivery agent
- `PATCH /api/shipment-assignments/[id]` - Update assignment status
- `DELETE /api/shipment-assignments/[id]` - Unassign shipment

### COD Collections
- `GET /api/cod-collections` - List COD collections with totals
- `PATCH /api/cod-collections/[id]` - Update COD status (role-based)

### Delivery Agents
- `GET /api/delivery-agents` - List all delivery agents with statistics

## Workflows

### Shipment Assignment Workflow
1. Local shipment is created via `/local-shipping`
2. Warehouse admin goes to `/shipment-assignments`
3. Selects pending shipment and delivery agent
4. System creates assignment and updates shipment status to "assigned"
5. If COD shipment, system automatically creates COD collection record

### Delivery Workflow (Delivery Agent)
1. Delivery agent logs in and sees their assignments at `/my-deliveries`
2. Updates status as they progress:
   - Click "تم الاستلام" (Picked Up) when collecting from warehouse
   - Click "قيد التوصيل" (In Transit) when en route
   - Click "تم التوصيل" (Delivered) upon successful delivery
   - If COD, collection is automatically marked as collected
3. If delivery fails, mark as failed with reason

### COD Collection Workflow
1. **Pending**: Created when COD shipment is assigned
2. **Collected**: Auto-marked when delivery agent delivers shipment
3. **Deposited**: Warehouse admin records deposit via `/cod-tracker`
   - Selects deposit method (cash, bank transfer, mobile wallet)
   - Enters reference number and notes
4. **Reconciled**: Accountant reconciles payment
   - Adds reconciliation notes
   - Records any discrepancies with reasons

## User Interface

### Pages

#### `/shipment-assignments` (Warehouse Admin)
- View delivery agent statistics
- Assign new shipments
- View current assignments
- Unassign shipments

#### `/my-deliveries` (Delivery Agent)
- Dashboard with statistics
- Active deliveries with customer details and map-ready addresses
- Quick status update buttons
- Completed deliveries history
- COD amounts to collect

#### `/cod-tracker` (Warehouse Admin & Accountant)
- COD totals dashboard (total, pending, collected, deposited, reconciled)
- Filter by status
- Detailed collection list with shipment info
- Update status based on role permissions

### Navigation
All pages are accessible from the home page dashboard with role-based visibility.

## Setup Instructions

### 1. Database Migration
The schema has been updated and migrated. New tables created:
- `ShipmentAssignment`
- `CODCollection`

### 2. Create Delivery Agent Users
Use the order users management page to create users with the `DELIVERY_AGENT` role (مناديب توصيل).

### 3. Assign Shipments
1. Create local shipments as usual via `/local-shipping`
2. Go to `/shipment-assignments`
3. Assign pending shipments to delivery agents

### 4. Track COD
Monitor COD collections via `/cod-tracker` and update statuses as payments progress through the workflow.

## Technical Notes

- Shipment status is synchronized between `LocalShipment` and `ShipmentAssignment`
- COD collections are automatically created for COD shipments when assigned
- Delivery agents can only update their own assignments
- Role-based permissions enforced at both API and middleware levels
- All currency amounts stored as `Decimal` for precision
- Timestamps tracked for all status transitions

## Future Enhancements

Potential improvements:
- Photo upload for delivery proof
- Signature capture for recipient
- GPS location tracking
- Push notifications for status updates
- Delivery route optimization
- Performance metrics and reports
- Bulk assignment capabilities
- Mobile app for delivery agents
