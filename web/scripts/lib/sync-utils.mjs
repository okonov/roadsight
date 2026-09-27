// Shared by the per-city sync scripts (sync-vancouver-cameras.mjs, sync-surrey-cameras.mjs).

export async function mapLimit(items, limit, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required — see .env.local.example`);
  return value;
}
