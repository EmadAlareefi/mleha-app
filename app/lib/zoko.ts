import { env } from "./env";
import { withBackoff } from "./retry";

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

async function postData(url: string, data: any) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.ZOKO_API_KEY!, // <-- use apikey header
    },
    body: JSON.stringify(data),
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
