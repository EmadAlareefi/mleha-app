export interface WarehouseInfo {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
}

export interface ShipmentWarehouseDetails {
  id: string;
  name: string;
  code?: string | null;
}

export interface Shipment {
  id: string;
  trackingNumber: string;
  company: string;
  type: 'incoming' | 'outgoing';
  scannedAt: string;
  notes?: string | null;
  scannedBy?: string | null;
  warehouse?: ShipmentWarehouseDetails | null;
}
