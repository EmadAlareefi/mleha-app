export interface ManualSmsaShipmentItemInput {
  id?: string | number | null;
  productId?: string | number | null;
  variantId?: string | number | null;
  name: string;
  sku?: string | null;
  quantity: number;
  price?: number | string | null;
  weight?: number | string | null;
  source?: string | null;
  notes?: string | null;
}

export interface ManualSmsaShipmentItem extends ManualSmsaShipmentItemInput {
  total?: number | string | null;
}

export interface ManualSmsaShipmentPayload {
  merchantId?: string | null;
  orderNumber: string;
  items: ManualSmsaShipmentItemInput[];
  declaredValue?: number | string | null;
  parcels?: number | string | null;
  weight?: number | string | null;
  currency?: string | null;
  codAmount?: number | string | null;
  contentDescription?: string | null;
}

export interface ManualSmsaShipmentRecord {
  id: string;
  merchantId: string;
  orderId: string | null;
  orderNumber: string;
  status: string;
  parcels: number;
  declaredValue: number | null;
  currency: string;
  weight: number | null;
  weightUnit: string | null;
  contentDescription: string | null;
  codAmount: number | null;
  smsaAwbNumber?: string | null;
  smsaTrackingNumber?: string | null;
  smsaLabelDataUrl?: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  country?: string | null;
  district?: string | null;
  postalCode?: string | null;
  shortCode?: string | null;
  shipmentItems: ManualSmsaShipmentItem[];
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
  deletedAt?: string | null;
  createdByName?: string | null;
}
