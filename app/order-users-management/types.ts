import type { ServiceKey } from '@/app/lib/service-definitions';

export interface WarehouseOption {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
}

export interface PrinterLinkInfo {
  printerId: number;
  printerName?: string | null;
  computerId?: number | null;
  computerName?: string | null;
  paperName?: string | null;
}

export interface OrderUser {
  id: string;
  username: string;
  name: string;
  serviceKeys: ServiceKey[];
  email?: string;
  phone?: string;
  affiliateName?: string | null;
  affiliateCommission?: string | number | null;
  employmentStartDate?: string | null;
  employmentEndDate?: string | null;
  salaryAmount?: string | null;
  salaryCurrency?: string | null;
  userType?: string | null;
  isActive: boolean;
  autoAssign: boolean;
  createdAt: string;
  _count: {
    assignments: number;
  };
  warehouses?: WarehouseOption[];
  printerLink?: PrinterLinkInfo | null;
}

export interface PrinterProfileConfig {
  id: string;
  printerId: number;
  label: string;
  location?: string | null;
  paperName?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrintNodeInventoryPrinter {
  id: number;
  name: string;
  description?: string;
  state?: string;
  default?: {
    paper?: string;
    paperName?: string;
  };
  computer?: {
    id?: number;
    name?: string;
    hostname?: string;
    state?: string;
    description?: string;
  };
}

export interface PrinterOption {
  id: number;
  label: string;
  description?: string;
  paperName?: string;
  location?: string | null;
  notes?: string | null;
  source: 'profile' | 'printnode';
  state?: string;
  computerId?: number;
  computerName?: string;
  printerName?: string;
}

export interface UserFormData {
  username: string;
  password: string;
  name: string;
  email: string;
  phone: string;
  affiliateName: string;
  affiliateCommission: string;
  employmentStartDate: string;
  employmentEndDate: string;
  salaryAmount: string;
  salaryCurrency: string;
  userType: string;
  isActive: boolean;
  autoAssign: boolean;
  warehouseIds: string[];
  serviceKeys: ServiceKey[];
}

export type MutationResult = { ok: true; user?: OrderUser } | { ok: false; error: string };
