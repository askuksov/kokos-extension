import { describe, it, expect } from 'vitest';
import { httpOrigin } from './url';

describe('httpOrigin', () => {
  it('returns the origin of an http(s) url', () => {
    expect(httpOrigin('https://a.com/login?x=1')).toBe('https://a.com');
    expect(httpOrigin('http://a.com:8080/p')).toBe('http://a.com:8080');
  });
  it('returns null for other schemes, garbage and absent values', () => {
    for (const u of ['chrome://newtab', 'file:///etc/passwd', 'about:blank', 'not-a-url', '', undefined]) {
      expect(httpOrigin(u)).toBeNull();
    }
  });
});
