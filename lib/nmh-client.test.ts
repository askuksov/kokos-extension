import { describe, it, expect } from 'vitest';
import {
  buildRequest, PROTOCOL_VERSION, NATIVE_HOST, NMH_CODES,
  isKeepaliveId, KEEPALIVE_PREFIX,
} from './nmh-client';

describe('nmh-client', () => {
  it('stamps version and a unique id and preserves action/payload', () => {
    const a = buildRequest('get_logins', { url: 'https://a.com' });
    const b = buildRequest('get_logins', { url: 'https://a.com' });
    expect(a.version).toBe(PROTOCOL_VERSION);
    expect(a.version).toBe(1);
    expect(a.action).toBe('get_logins');
    expect(a.payload).toEqual({ url: 'https://a.com' });
    expect(a.id).not.toBe(b.id); // unique per call
    expect(typeof a.id).toBe('string');
  });

  it('exposes the exact native host name', () => {
    expect(NATIVE_HOST).toBe('dev.kuksov.kokos');
  });

  it('enumerates every wire error code', () => {
    expect(Object.values(NMH_CODES)).toEqual([
      'bad_request', 'unsupported_version', 'unknown_action', 'app_not_running',
      'locked', 'no_vault', 'denied', 'not_in_scope', 'entry_not_found',
      'invalid_url', 'too_large', 'timeout', 'unsupported_platform', 'internal',
    ]);
  });

  it('recognises keepalive echo ids', () => {
    expect(isKeepaliveId(`${KEEPALIVE_PREFIX}123`)).toBe(true);
    expect(isKeepaliveId('req-abc')).toBe(false);
  });
});
