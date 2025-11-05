import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { log } from "@/app/lib/logger";
import { PrismaClient } from "@prisma/client";
import { processSallaWebhook } from "@/app/lib/handlers";
import { env } from "@/app/lib/env";

export const runtime = "nodejs";
const prisma = new PrismaClient();

function verifySignature(raw: string, sig: string | null): boolean {
  if (!sig) return false;
  const h = crypto
    .createHmac("sha256", env.SALLA_WEBHOOK_SECRET)
    .update(raw)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig));
  } catch {
    // Fallback if lengths differ
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
  // Various proxies/CDN headers; Next.js also exposes ip on headers sometimes
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  );
}

export async function POST(req: NextRequest) {
  // --- read raw first (for logging & signature) ---
  const { value: signature, headerName: signatureHeader } = extractSig(req);
  const raw = await req.text();
  const verified = verifySignature(raw, signature);

  // --- try to parse JSON; keep failures as rawText in log ---
  let payload: any = undefined;
  let parseError: string | undefined = undefined;
  try {
    payload = JSON.parse(raw);
  } catch (e: any) {
    parseError = String(e?.message || e);
  }

  // --- extract best-effort fields (work with either parsed or raw) ---
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

  // --- persist append-only log REGARDLESS of validity ---
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
        event: event ?? null,
        orderId,
        status,
        rawText: raw,
        json: payload ? payload : null,
        parseError,
      },
    });
  } catch (e: any) {
    // Don’t fail the webhook for logging issues; just record server log
    log.error("Failed to write WebhookLog", { e: String(e) });
  }

  // --- Optionally reject on bad signature (uncomment if you want to enforce) ---
  // if (!verified) {
  //   log.warn("Invalid signature", { signature });
  //   return NextResponse.json(
  //     { ok: false, error: "invalid signature" },
  //     { status: 401 }
  //   );
  // }

  // --- keep your deduplicated WebhookEvent for orderId:status combos (optional) ---
  const uniqueKey = orderId && status ? `${orderId}:${status}` : undefined;
  if (uniqueKey && payload) {
    try {
      await prisma.webhookEvent.create({
        data: {
          sallaEvent: event ?? "unknown",
          orderId: orderId ?? null,
          status: status ?? null,
          rawPayload: payload,
          signature: signature ?? undefined,
          uniqueKey,
        },
      });
    } catch (e: any) {
      // Ignore duplicate inserts; only log real DB errors
      if (e.code !== "P2002") {
        log.error("DB error saving WebhookEvent", { e: String(e) });
        // Do NOT fail the webhook; we already persisted WebhookLog
      }
    }
  }

  // --- process business logic even if JSON failed (guard for undefined) ---
  if (!payload) {
    // Nothing to process, but we logged it; return 200 to avoid retries unless you prefer 400.
    return NextResponse.json({ ok: true, parsed: false, reason: "invalid json" });
  }

  // Your downstream handler
  const result = await processSallaWebhook(payload);
  return NextResponse.json({ ok: true, verified, ...result });
}
