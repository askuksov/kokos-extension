// Composites the toolbar action icon = base logo + an optional colored corner
// dot (the connection-status indicator). Chrome's native badge API can only draw
// a rounded RECTANGLE, so a real circular dot is drawn onto the icon itself and
// pushed via chrome.action.setIcon. The dot geometry is a pure helper (tested);
// the pixel compositing uses OffscreenCanvas, which exists in the MV3 service
// worker (feature-detected by the caller for the Firefox fallback).

export const ICON_SIZES = [16, 32, 48] as const;

export interface DotGeom {
  cx: number;
  cy: number;
  r: number;    // dot radius
  ring: number; // light separator ring radius (r < ring)
}

/** Bottom-right corner dot — small enough to leave the logo dominant, still
 * readable at 16px. Sits tight in the corner. */
export function dotGeometry(size: number): DotGeom {
  const r = size * 0.2;
  const c = size - r - size * 0.03;
  return { cx: c, cy: c, r, ring: r * 1.15 };
}

/** base logo bitmap + optional dot color → ImageData per toolbar size.
 * dot === null draws the plain logo (resting / app-not-running). */
export async function composeStatusIcon(
  base: ImageBitmap,
  dot: string | null,
): Promise<Record<number, ImageData>> {
  const out: Record<number, ImageData> = {};
  for (const size of ICON_SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(base, 0, 0, size, size);
    if (dot) {
      const g = dotGeometry(size);
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.ring, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; // ring separates the dot from the brown logo / any toolbar
      ctx.fill();
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
      ctx.fillStyle = dot;
      ctx.fill();
    }
    out[size] = ctx.getImageData(0, 0, size, size);
  }
  return out;
}
