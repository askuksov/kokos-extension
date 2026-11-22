// lib/url.ts
// The origin a secret or lookup is scoped to. SECURITY: only http(s) pages
// have one; every other scheme (chrome://, file:, about:, data:) and any
// unparseable value yields null so callers fail closed.
export function httpOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}
