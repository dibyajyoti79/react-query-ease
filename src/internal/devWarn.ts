// Declared locally so the library doesn't depend on @types/node. Bundlers
// replace `process.env.NODE_ENV` at build time.
declare const process: { env?: { NODE_ENV?: string } } | undefined;

const warned = new Set<string>();

const isDev = (): boolean => {
  try {
    return (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV !== "production"
    );
  } catch {
    return false;
  }
};

/** Logs a warning once per `id`, and only outside production builds. */
export const devWarnOnce = (id: string, message: string): void => {
  if (!isDev() || warned.has(id)) return;
  warned.add(id);
  // eslint-disable-next-line no-console
  console.warn(`[react-query-ease] ${message}`);
};
