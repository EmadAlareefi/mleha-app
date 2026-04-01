import { NextRequest, NextResponse } from "next/server";
import { env } from "@/app/lib/env";
import { processZokoWebhookPayload } from "@/app/lib/zoko-webhook";
import { log } from "@/app/lib/logger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (env.ZOKO_WEBHOOK_SECRET) {
    const providedSecret =
      request.headers.get("x-zoko-webhook-secret") ||
      request.headers.get("x-zoko-signature") ||
      request.nextUrl.searchParams.get("token");

    if (providedSecret !== env.ZOKO_WEBHOOK_SECRET) {
      log.warn("Rejected Zoko webhook due to invalid secret");
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    log.error("Failed to parse Zoko webhook payload", { error });
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await processZokoWebhookPayload(payload);
    log.info("Processed Zoko webhook payload", result);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    log.error("Failed to process Zoko webhook payload", { error });
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 });
  }
}
