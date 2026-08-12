const baseUrl = (process.env.ZOKO_BASE_URL || 'https://chat.zoko.io').replace(/\/$/, '');
const apiKey = process.env.ZOKO_API_KEY || '';

if (!apiKey) {
  console.error('ZOKO_API_KEY is not configured');
  process.exitCode = 1;
} else {
  const expected = [
    [process.env.ZOKO_TPL_ORDER_RECEIVED_INVOICE || 'order_received_invoice_ar_v1', 'richTemplate', 3],
    [process.env.ZOKO_TPL_ORDER_SHIPPED_LABEL || 'order_shipped_label_ar_v1', 'buttonTemplate', 5],
    [process.env.ZOKO_TPL_ORDER_DELIVERED_RATING || 'order_delivered_rating_ar_v1', 'buttonTemplate', 3],
    [process.env.ZOKO_TPL_ORDER_CANCELLED || 'order_cancelled_ar_v1', 'template', 2],
    [process.env.ZOKO_TPL_ORDER_REFUNDED || 'order_refund_processed_ar_v1', 'template', 4],
  ];

  const response = await fetch(`${baseUrl}/v2/account/templates`, {
    headers: { apikey: apiKey, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    console.error(`Zoko template audit failed: HTTP ${response.status}`);
    process.exitCode = 1;
  } else {
    const templates = await response.json();
    const byId = new Map(templates.map((template) => [template.templateId, template]));
    let invalid = 0;
    for (const [id, type, variables] of expected) {
      const template = byId.get(id);
      const actualType =
        template?.isRichTemplate && template?.templateType === 'template'
          ? 'richTemplate'
          : template?.templateType;
      const valid = Boolean(
        template &&
        template.active &&
        template.templateLanguage === 'ar' &&
        actualType === type &&
        template.templateVariableCount === variables
      );
      if (!valid) invalid += 1;
      console.log(
        `${valid ? 'OK' : 'INVALID'} ${id} expected=${type}/${variables} actual=${actualType || 'missing'}/${template?.templateVariableCount ?? '-'} active=${template?.active ?? false}`
      );
    }
    if (invalid > 0) process.exitCode = 1;
  }
}
