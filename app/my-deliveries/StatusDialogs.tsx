'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  type Assignment,
  type DeliveryAgentTask,
  FAILURE_REASONS,
  formatCurrency,
  getCollectAmount,
  getRecipientPhone,
  maskPhoneForDisplay,
} from './delivery-helpers';

export async function parseJsonResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  const text = (await response.text()).toLowerCase();
  const unauthorized =
    response.status === 401 ||
    response.status === 403 ||
    text.includes('<!doctype html') ||
    text.includes('__next_data__');
  throw new Error(
    unauthorized
      ? 'انتهت صلاحية الجلسة أو تم تسجيل خروجك. يرجى تسجيل الدخول مرة أخرى.'
      : 'تعذر التواصل مع الخادم، حاول مرة أخرى.'
  );
}

async function patchAssignment(assignmentId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/shipment-assignments/${assignmentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || 'فشل في تحديث الحالة');
  }
  return data;
}

const OTP_LENGTH = 6;

const hasLiveOtp = (assignment: Assignment) =>
  Boolean(
    assignment.deliveryOtpRequestedAt &&
      assignment.deliveryOtpExpiresAt &&
      new Date(assignment.deliveryOtpExpiresAt).getTime() > Date.now()
  );

interface DeliverDialogProps {
  assignment: Assignment | null;
  requiresOtp: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function DeliverDialog({ assignment, requiresOtp, onClose, onDone }: DeliverDialogProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const autoSentFor = useRef<string | null>(null);

  const sendOtp = async (target: Assignment) => {
    setSending(true);
    setError('');
    try {
      const response = await fetch(`/api/shipment-assignments/${target.id}/otp`, { method: 'POST' });
      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر إرسال رمز التحقق');
      }
      setSentTo(data?.maskedPhone || maskPhoneForDisplay(getRecipientPhone(target.shipment)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال رمز التحقق');
    } finally {
      setSending(false);
    }
  };

  // Send the code as soon as the agent opens the dialog, unless one is still valid.
  useEffect(() => {
    setCode('');
    setError('');
    setSentTo(null);
    if (!assignment || !requiresOtp) return;
    if (hasLiveOtp(assignment)) {
      setSentTo(maskPhoneForDisplay(getRecipientPhone(assignment.shipment)));
      return;
    }
    if (autoSentFor.current !== assignment.id) {
      autoSentFor.current = assignment.id;
      void sendOtp(assignment);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.id, requiresOtp]);

  const submit = async (otp: string) => {
    if (!assignment || submitting) return;
    if (requiresOtp && otp.length !== OTP_LENGTH) {
      setError('أدخل الرمز المكوّن من 6 أرقام');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await patchAssignment(assignment.id, {
        status: 'delivered',
        deliveryOtpCode: requiresOtp ? otp : undefined,
      });
      autoSentFor.current = null;
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل في تأكيد التسليم');
      setCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCodeChange = (value: string) => {
    const digits = value.replace(/[^\d]/g, '').slice(0, OTP_LENGTH);
    setCode(digits);
    if (digits.length === OTP_LENGTH) {
      void submit(digits);
    }
  };

  const collectAmount = assignment ? getCollectAmount(assignment) : 0;

  return (
    <Dialog open={Boolean(assignment)} onOpenChange={(open) => !open && onClose()}>
      {assignment && (
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تأكيد تسليم #{assignment.shipment.orderNumber}</DialogTitle>
            <DialogDescription>
              {requiresOtp ? 'اطلب من العميل الرمز الذي وصله برسالة نصية.' : 'تأكيد التسليم بدون رمز العميل.'}
            </DialogDescription>
          </DialogHeader>

          {collectAmount > 0 && (
            <div className="rounded-lg bg-orange-50 p-3 text-center">
              <p className="text-sm text-orange-700">حصّل من العميل</p>
              <p className="text-2xl font-bold text-orange-700">{formatCurrency(collectAmount)}</p>
            </div>
          )}

          {requiresOtp && (
            <div className="space-y-2">
              <Input
                autoFocus
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={OTP_LENGTH}
                value={code}
                onChange={(event) => handleCodeChange(event.target.value)}
                placeholder="• • • • • •"
                aria-label="رمز التحقق"
                className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
                disabled={submitting}
              />
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>
                  {sending
                    ? 'جاري إرسال الرمز...'
                    : sentTo
                      ? `أُرسل الرمز إلى ${sentTo}`
                      : 'لم يُرسل الرمز بعد'}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => sendOtp(assignment)}
                  disabled={sending || submitting}
                >
                  إعادة الإرسال
                </Button>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2">
            <Button
              className="h-12 w-full bg-emerald-600 text-base font-bold hover:bg-emerald-700"
              onClick={() => submit(code)}
              disabled={submitting || (requiresOtp && code.length !== OTP_LENGTH)}
            >
              {submitting ? 'جاري التأكيد...' : 'تأكيد التسليم'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

interface FailDialogProps {
  /** Dialog title; null keeps the dialog closed. */
  title: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}

export function FailDialog({ title, onClose, onSubmit }: FailDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setReason('');
    setError('');
  }, [title]);

  const submit = async () => {
    if (!reason.trim()) {
      setError('اختر سبباً أو اكتبه');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل في تحديث الحالة');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={title !== null} onOpenChange={(open) => !open && onClose()}>
      {title !== null && (
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>اختر السبب.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            {FAILURE_REASONS.map((option) => (
              <Button
                key={option}
                type="button"
                variant={reason === option ? 'default' : 'outline'}
                className="h-11 justify-start"
                onClick={() => setReason(option)}
              >
                {option}
              </Button>
            ))}
          </div>
          <Textarea
            rows={2}
            value={FAILURE_REASONS.includes(reason) ? '' : reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="سبب آخر..."
            aria-label="سبب آخر"
          />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              variant="destructive"
              className="h-12 w-full text-base"
              onClick={submit}
              disabled={submitting || !reason.trim()}
            >
              {submitting ? 'جاري الحفظ...' : 'تأكيد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

export async function markAssignmentFailed(assignmentId: string, reason: string) {
  await patchAssignment(assignmentId, { status: 'failed', failureReason: reason });
}

async function patchTask(taskId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/delivery-agent-tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || 'فشل في تحديث المهمة');
  }
  return data;
}

/** A failed pickup stays open for another attempt; only the reason is recorded. */
export async function recordPickupAttemptFailed(taskId: string, reason: string) {
  const stamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  await patchTask(taskId, { completionNotes: `تعذّر الاستلام (${stamp}): ${reason}` });
}

interface PickupDialogProps {
  task: DeliveryAgentTask | null;
  onClose: () => void;
  onDone: () => void;
}

export function PickupDialog({ task, onClose, onDone }: PickupDialogProps) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setNotes('');
    setError('');
  }, [task?.id]);

  const submit = async () => {
    if (!task) return;
    setSubmitting(true);
    setError('');
    try {
      await patchTask(task.id, { status: 'agent_completed', completionNotes: notes.trim() || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل في تأكيد الاستلام');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      {task && (
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تأكيد استلام المرتجع</DialogTitle>
            <DialogDescription>تأكد أن القطع كاملة قبل التأكيد.</DialogDescription>
          </DialogHeader>

          {task.requestedItem && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">القطع المطلوب استلامها{task.quantity ? ` (${task.quantity})` : ''}:</p>
              <p className="mt-1">{task.requestedItem}</p>
            </div>
          )}

          <Textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="ملاحظة (اختياري): قطعة ناقصة، بدون كيس..."
            aria-label="ملاحظة الاستلام"
          />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              className="h-12 w-full bg-teal-600 text-base font-bold hover:bg-teal-700"
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? 'جاري التأكيد...' : 'استلمت المرتجع'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
