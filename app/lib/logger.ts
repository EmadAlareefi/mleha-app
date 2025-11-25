const formatMeta = (meta?: Record<string, unknown>) => {
  if (!meta) return undefined;
  if (meta.error instanceof Error) {
    const { message, name, stack } = meta.error;
    return { ...meta, errorMessage: message, errorName: name, errorStack: stack, error: undefined };
  }
  return meta;
};

export const log = {
  info: (msg: string, meta?: any) =>
    console.log(JSON.stringify({ level: 'info', msg, ...formatMeta(meta) })),
  warn: (msg: string, meta?: any) =>
    console.warn(JSON.stringify({ level: 'warn', msg, ...formatMeta(meta) })),
  error: (msg: string, meta?: any) =>
    console.error(JSON.stringify({ level: 'error', msg, ...formatMeta(meta) })),
};
