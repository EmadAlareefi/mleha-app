import { env } from "./env";
import { withBackoff } from "./retry";

const ZOKO_REQUEST_TIMEOUT_MS = 15_000;

export interface SendTemplateArgs {
  to: string; // recipient phone
  templateId: string; // your approved template ID
  lang?: string; // e.g. "ar"
  args?: (string | number)[]; // placeholders
}

export interface SendButtonTemplateArgs {
  to: string;
  templateId: string;
  lang?: string;
  templateArgs?: (string | number)[];
  message?: string;
}

export interface SendRichTemplateArgs {
  to: string;
  templateId: string;
  lang?: string;
  /** Header media URL is the first argument, followed by body variables. */
  args: (string | number)[];
}

export type ZokoTemplateType = "template" | "buttonTemplate" | "richTemplate";

export interface ZokoTemplate {
  templateId: string;
  templateLanguage: string;
  templateType: ZokoTemplateType;
  templateVariableCount: number;
  templateDesc: string;
  active: boolean;
  channel: string;
  isRichTemplate: boolean;
}

async function postData(url: string, data: any) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.ZOKO_API_KEY!, // <-- use apikey header
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(ZOKO_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Zoko error ${response.status}: ${text}`);
  }
  return response.json();
}

export async function sendWhatsAppTemplate(args: SendTemplateArgs) {
  const { to, templateId, lang = env.WHATSAPP_DEFAULT_LANG, args: templateArgs = [] } = args;

  const payload = {
    channel: "whatsapp",
    recipient: to.replace(/\s/g, ""), // strip spaces
    type: "template",
    templateId,
    templateLanguage: lang,
    templateArgs,
  };

  return withBackoff(() => postData(`${env.ZOKO_BASE_URL}/v2/message`, payload));
}

export async function sendWhatsAppText(to: string, body: string) {
  const payload = {
    channel: "whatsapp",
    recipient: to.replace(/\s/g, ""),
    type: "text",
    text: { body },
  };

  return withBackoff(() => postData(`${env.ZOKO_BASE_URL}/v2/message`, payload));
}

export async function getZokoTemplates(): Promise<ZokoTemplate[]> {
  const response = await withBackoff(() =>
    fetch(`${env.ZOKO_BASE_URL}/v2/account/templates`, {
      headers: { apikey: env.ZOKO_API_KEY!, accept: "application/json" },
      signal: AbortSignal.timeout(ZOKO_REQUEST_TIMEOUT_MS),
      cache: "no-store",
    })
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Zoko error ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload?.templates ?? payload?.data ?? [];
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row: any): ZokoTemplate | null => {
      const templateId = typeof row?.templateId === "string" ? row.templateId.trim() : "";
      const rawType = row?.isRichTemplate && row?.templateType === "template"
        ? "richTemplate"
        : row?.templateType;
      if (!templateId || !["template", "buttonTemplate", "richTemplate"].includes(rawType)) {
        return null;
      }
      return {
        templateId,
        templateLanguage: typeof row.templateLanguage === "string" ? row.templateLanguage : "ar",
        templateType: rawType as ZokoTemplateType,
        templateVariableCount: Number.isInteger(row.templateVariableCount)
          ? Math.max(0, row.templateVariableCount)
          : 0,
        templateDesc: typeof row.templateDesc === "string" ? row.templateDesc : "",
        active: row.active === true,
        channel: typeof row.channel === "string" ? row.channel : "whatsapp",
        isRichTemplate: row.isRichTemplate === true,
      };
    })
    .filter((row: ZokoTemplate | null): row is ZokoTemplate => Boolean(row))
    .sort((a, b) => a.templateId.localeCompare(b.templateId));
}

export async function sendWhatsAppRichTemplate(args: SendRichTemplateArgs) {
  const { to, templateId, lang = env.WHATSAPP_DEFAULT_LANG, args: templateArgs } = args;
  const payload = {
    channel: "whatsapp",
    recipient: to.replace(/\s/g, ""),
    type: "richTemplate",
    templateId,
    templateLanguage: lang,
    templateArgs,
  };

  return withBackoff(() => postData(`${env.ZOKO_BASE_URL}/v2/message`, payload));
}

export async function sendWhatsAppButtonTemplate(args: SendButtonTemplateArgs) {
  const {
    to,
    templateId,
    lang = env.WHATSAPP_DEFAULT_LANG || "ar",
    templateArgs = [],
    message = " ",
  } = args;

  const payload = {
    channel: "whatsapp",
    recipient: to.replace(/\s/g, ""),
    type: "buttonTemplate",
    message,
    templateId,
    templateArgs,
    templateLanguage: lang,
  };

  return withBackoff(() => postData(`${env.ZOKO_BASE_URL}/v2/message`, payload));
}

export async function sendWhatsAppTemplateByType(args: {
  to: string;
  templateId: string;
  templateLanguage: string;
  templateType: ZokoTemplateType;
  templateArgs: (string | number)[];
}) {
  if (args.templateType === "buttonTemplate") {
    return sendWhatsAppButtonTemplate({
      to: args.to,
      templateId: args.templateId,
      lang: args.templateLanguage,
      templateArgs: args.templateArgs,
    });
  }
  if (args.templateType === "richTemplate") {
    return sendWhatsAppRichTemplate({
      to: args.to,
      templateId: args.templateId,
      lang: args.templateLanguage,
      args: args.templateArgs,
    });
  }
  return sendWhatsAppTemplate({
    to: args.to,
    templateId: args.templateId,
    lang: args.templateLanguage,
    args: args.templateArgs,
  });
}
