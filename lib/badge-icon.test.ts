import { describe, it, expect } from 'vitest';
import { dotGeometry, ICON_SIZES } from './badge-icon';

describe('dotGeometry', () => {
  it('places the dot in the bottom-right corner, inside the icon', () => {
    const g = dotGeometry(48);
    expect(g.cx).toBeGreaterThan(24); // right half
    expect(g.cy).toBeGreaterThan(24); // bottom half
    expect(g.cx + g.r).toBeLessThanOrEqual(48); // fits within the icon
    expect(g.cy + g.r).toBeLessThanOrEqual(48);
  });
  it('ring is larger than the dot (separator halo)', () => {
    const g = dotGeometry(16);
    expect(g.ring).toBeGreaterThan(g.r);
  });
  it('scales proportionally with icon size', () => {
    const a = dotGeometry(16);
    const b = dotGeometry(32);
    expect(b.r).toBeCloseTo(a.r * 2, 5);
  });
  it('exposes the toolbar sizes it renders', () => {
    expect(ICON_SIZES).toEqual([16, 32, 48]);
  });
});
