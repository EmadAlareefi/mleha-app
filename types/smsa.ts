export interface SmsaLiveStatus {
  awb?: string | null;
  reference?: string | null;
  code?: string | null;
  description?: string | null;
  city?: string | null;
  timestamp?: string | null;
  timezone?: string | null;
  receivedBy?: string | null;
  delivered?: boolean | null;
  source?: 'webhook' | 'api';
}
