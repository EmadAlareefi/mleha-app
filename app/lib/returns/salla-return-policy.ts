import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';

export const CREATE_RETURN_POLICY_ACTION = 'create_return_policy';

export interface SallaOrderActionOperation {
  operation_id?: string;
  action_name?: string;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

export interface SallaOrderActionsResponse {
  status?: number;
  success?: boolean;
  data?: SallaOrderActionOperation[];
  message?: string;
  error?: {
    message?: string;
    [key: string]: unknown;
  };
}

export type ReturnPolicyFailureReason =
  | 'request_failed'
  | 'no_operation'
  | 'operation_failed';

export type ReturnPolicyResult =
  | {
      success: true;
      operation: SallaOrderActionOperation;
      operationId?: string;
      operationStatus: string;
      request: unknown;
      response: SallaOrderActionsResponse;
    }
  | {
      success: false;
      reason: ReturnPolicyFailureReason;
      error: string;
      details?: unknown;
      operationStatus?: string;
      operationId?: string;
      request: unknown;
      response?: SallaOrderActionsResponse | null;
    };

/**
 * Asks Salla to issue the return waybill (بوليصة الرجيع) for an order.
 *
 * Salla fulfils this asynchronously — a `success` here only means the request was
 * accepted ("جاري انشاء شحنات مرتجع"); the shipment can sit at `status: "creating"`
 * with no tracking number and no label indefinitely. Callers must not assume a
 * waybill exists afterwards.
 *
 * Shared by `/api/returns/create` and the admin re-issue action so a retry sends
 * exactly the payload the original request sent.
 */
export async function requestSallaReturnPolicy(
  merchantId: string,
  orderId: string
): Promise<ReturnPolicyResult> {
  const parsedOrderId = parseInt(orderId, 10);
  const normalizedOrderId = Number.isNaN(parsedOrderId) ? orderId : parsedOrderId;

  const request = {
    operations: [
      {
        action_name: CREATE_RETURN_POLICY_ACTION,
        value: [normalizedOrderId],
      },
    ],
    filters: {
      order_ids: [normalizedOrderId],
    },
  };

  log.info('Creating Salla return policy', { merchantId, orderId, request });

  const response = await sallaMakeRequest<SallaOrderActionsResponse>(
    merchantId,
    '/orders/actions',
    {
      method: 'POST',
      body: JSON.stringify(request),
    }
  );

  if (!response || !response.success) {
    const error =
      response?.error?.message || response?.message || 'فشل إنشاء سياسة الإرجاع';

    log.error('Salla return policy creation failed', { merchantId, orderId, error, response });

    return {
      success: false,
      reason: 'request_failed',
      error,
      details: response?.error || undefined,
      request,
      response: response ?? null,
    };
  }

  const operations = Array.isArray(response.data) ? response.data : [];
  const operation =
    operations.find((op) => op.action_name === CREATE_RETURN_POLICY_ACTION) ??
    (operations.length === 1 ? operations[0] : undefined);

  if (!operation) {
    log.error('No return policy operation found in Salla response', {
      merchantId,
      orderId,
      operations,
    });

    return {
      success: false,
      reason: 'no_operation',
      error: 'لم يتم العثور على عملية إنشاء سياسة الإرجاع في استجابة سلة',
      request,
      response,
    };
  }

  const operationStatus = String(operation.status || '').toLowerCase();
  const operationId = operation.operation_id;

  if (operationStatus !== 'success' && operationStatus !== 'in_progress') {
    log.error('Salla return policy operation failed', { merchantId, orderId, operation });

    const message =
      typeof operation.message === 'string'
        ? operation.message
        : typeof response.message === 'string'
          ? response.message
          : undefined;

    return {
      success: false,
      reason: 'operation_failed',
      error: message || 'فشل إنشاء سياسة الإرجاع',
      details: `status=${operationStatus || 'unknown'} | opId=${operationId ?? 'n/a'}`,
      operationStatus,
      operationId,
      request,
      response,
    };
  }

  return {
    success: true,
    operation,
    operationId,
    operationStatus,
    request,
    response,
  };
}
