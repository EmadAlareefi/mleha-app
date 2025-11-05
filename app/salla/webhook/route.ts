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
    return h === sig;
  }
}

function extractSig(req: NextRequest): string | null {
  return req.headers.get("x-salla-signature") || req.headers.get("x-signature");
}

export async function POST(req: NextRequest) {
  const signature = extractSig(req);
  const raw = await req.text();

  // if (!verifySignature(raw, signature)) {
  //   log.warn("Invalid signature", { signature });
  //   return NextResponse.json(
  //     { ok: false, error: "invalid signature" },
  //     { status: 401 }
  //   );
  // }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    log.error("Invalid JSON", { e: String(e) });
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const event = payload?.event || payload?.topic || "unknown";
  const data = payload?.data || payload?.order || payload || {};
  const order = data?.order || data;

  const orderId =
    order?.id?.toString?.() || order?.order_id?.toString?.() || "";
  const status = (order?.status || order?.order_status || "")
    .toString()
    .toLowerCase();
  const uniqueKey = orderId && status ? `${orderId}:${status}` : undefined;

  if (uniqueKey) {
    try {
      await prisma.webhookEvent.create({
        data: {
          sallaEvent: event,
          orderId: orderId || null,
          status: status || null,
          rawPayload: payload,
          signature: signature || undefined,
          uniqueKey
        }
      });
    } catch (e: any) {
      if (e.code === "P2002") {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      log.error("DB error saving webhook", { e: String(e) });
      return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
    }
  }

  const result = await processSallaWebhook(payload);
  return NextResponse.json({ ok: true, ...result });
}
