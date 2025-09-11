import { env } from "./env";
import { withBackoff } from "./retry";

interface TemplateArgs {
  to: string;
  templateId: string;
  lang?: string;
  args?: (string | number)[];
}

export async function sendWhatsAppTemplate(args: TemplateArgs) {
  const {
    to,
    templateId,
    lang = env.WHATSAPP_DEFAULT_LANG,
    args: templateArgs = []
  } = args;

  const payload = {
    channel: "whatsapp",
    recipient: to.replace(/\s/g, ""), // remove spaces
    type: "template",
    templateId,
    templateLanguage: lang,
    templateArgs
  };

  const res = await withBackoff(async () =>
    fetch(`${env.ZOKO_BASE_URL}/v2/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.ZOKO_API_KEY}`
      },
      body: JSON.stringify(payload)
    })
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoko API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function sendWhatsAppText(to: string, body: string) {
  const payload = {
    channel: "whatsapp",
    recipient: to.replace(/\s/g, ""),
    type: "text",
    text: { body }
  };

  const res = await withBackoff(async () =>
    fetch(`${env.ZOKO_BASE_URL}/v2/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.ZOKO_API_KEY}`
      },
      body: JSON.stringify(payload)
    })
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoko API error ${res.status}: ${text}`);
  }
  return res.json();
}
