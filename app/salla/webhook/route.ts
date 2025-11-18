import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { env } from "@/app/lib/env";
import { processSallaWebhook } from "@/app/lib/handlers";

export const runtime = "nodejs";
const prisma = new PrismaClient();

function verifySignature(raw: string, sig: string | null): boolean {
  if (!sig) return false;
  const h = crypto.createHmac("sha256", env.SALLA_WEBHOOK_SECRET).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig));
  } catch {
    return h === sig;
  }
}

function extractSig(req: NextRequest): { value: string | null; headerName: string | null } {
  const sig = req.headers.get("x-salla-signature");
  if (sig) return { value: sig, headerName: "x-salla-signature" };
  const alt = req.headers.get("x-signature");
  if (alt) return { value: alt, headerName: "x-signature" };
  return { value: null, headerName: null };
}

function getClientIp(req: NextRequest): string | undefined {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || undefined;
}

export async function POST(req: NextRequest) {
  const { value: signature, headerName: signatureHeader } = extractSig(req);

  // Read raw body once (needed for logging & signature)
  const raw = await req.text();
  const verified = verifySignature(raw, signature);

  // Try JSON parse (don’t throw)
  let payload: any | null = null;
  let parseError: string | undefined;
  try {
    payload = JSON.parse(raw);
  } catch (e: any) {
    parseError = String(e?.message || e);
  }

  // Best-effort fields
  const event = payload?.event || payload?.topic || payload?.type || null;
  const data = payload?.data || payload?.order || payload || {};
  const order = data?.order || data || {};
  const orderId =
    order?.id?.toString?.() ||
    order?.order_id?.toString?.() ||
    order?.orderId?.toString?.() ||
    null;
  const status = (order?.status || order?.order_status || order?.state || "")
    ?.toString?.()
    ?.toLowerCase?.() || null;

  // ALWAYS save the call to WebhookLog (append-only)
  try {
    await prisma.webhookLog.create({
      data: {
        method: "POST",
        url: req.url,
        ip: getClientIp(req),
        headers: Object.fromEntries(req.headers.entries()),
        signature,
        signatureHeader,
        verified,
        event,
        orderId,
        status,
        rawText: raw,
        json: payload ? payload : null,
        parseError,
      },
    });
  } catch (e) {
    // Logging should never kill the webhook; just return success later
  }

  // Optionally enforce signature; if you want to reject, uncomment:
  // if (!verified) {
  //   return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  // }

  // Your idempotent event saver (optional; keep if you like your uniqueKey logic)
  let isDuplicateStatus = false;
  if (payload && orderId && status) {
    const uniqueKey = `${orderId}:${status}`;
    try {
      await prisma.webhookEvent.create({
        data: {
          sallaEvent: event ?? "unknown",
          orderId,
          status,
          rawPayload: payload,
          signature: signature ?? undefined,
          uniqueKey,
        },
      });
    } catch (e: any) {
      // Ignore duplicates (P2002), don’t fail the webhook
      if (e?.code === "P2002") {
        isDuplicateStatus = true;
      }
    }
  }

  // Business logic only if JSON parsed
  if (!payload) {
    return NextResponse.json({ ok: true, parsed: false, reason: "invalid json, logged" });
  }

  const result = await processSallaWebhook(payload, {
    orderId,
    status,
    isDuplicateStatus,
  });
  return NextResponse.json({ ok: true, verified, ...result });
}
