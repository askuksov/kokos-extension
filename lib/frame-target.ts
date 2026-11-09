// lib/frame-target.ts
// Picks the frame a popup or shortcut fill is sent to. Many sign-in pages
// (Apple ID, for one) render the login form inside a same-origin iframe, so
// always targeting the top frame reports "no login form" on them.
//
// The content script publishes a probe in the extension's isolated world. It
// runs only in the top frame and in subframes same-origin with it, so a
// cross-origin frame has no probe and can never be chosen. The probe reports
// booleans only; no field values leave the page.

export const PROBE_KEY = '__kokosFrameProbe';

export interface FrameProbe {
  login: boolean;
  otp: boolean;
}

export type ProbeKind = keyof FrameProbe;

export interface ProbedFrame {
  frameId: number;
  result: unknown;
}

const TOP_FRAME = 0;

function isProbe(v: unknown): v is FrameProbe {
  return typeof v === 'object' && v !== null
    && typeof (v as FrameProbe).login === 'boolean'
    && typeof (v as FrameProbe).otp === 'boolean';
}

/** The top frame when it has the field, else the first frame that has it.
 * Falls back to the top frame, whose receiver then answers no-form / no-field
 * exactly as before. */
export function pickFrame(frames: ProbedFrame[], kind: ProbeKind): number {
  const hits = frames.filter((f) => isProbe(f.result) && f.result[kind]);
  if (hits.some((f) => f.frameId === TOP_FRAME)) return TOP_FRAME;
  return hits[0]?.frameId ?? TOP_FRAME;
}

/** Runs the probe in every frame of the tab. Must stay self-contained:
 * chrome.scripting serialises it, so it cannot close over module scope. */
function runProbe(key: string): unknown {
  const probe = (globalThis as Record<string, unknown>)[key];
  return typeof probe === 'function' ? (probe as () => unknown)() : null;
}

export interface FrameTargetDeps {
  executeScript(tabId: number, key: string): Promise<ProbedFrame[]>;
}

export const chromeFrameTargetDeps: FrameTargetDeps = {
  executeScript: async (tabId, key) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: runProbe,
      args: [key],
    });
    return results.map((r) => ({ frameId: r.frameId, result: r.result }));
  },
};

/** The frame id to send a fill-entry / totp-fill message to. Any probe failure
 * (site not enabled, restricted page) keeps the old top-frame behaviour. */
export async function resolveFillFrame(
  tabId: number,
  kind: ProbeKind,
  deps: FrameTargetDeps = chromeFrameTargetDeps,
): Promise<number> {
  try {
    return pickFrame(await deps.executeScript(tabId, PROBE_KEY), kind);
  } catch {
    return TOP_FRAME;
  }
}
