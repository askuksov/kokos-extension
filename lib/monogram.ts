// lib/monogram.ts
// The letter tile shown next to a login, computed exactly like the app's
// entry list (kokos-app EntryList.tsx) so an entry wears the same colour in
// the app and in the browser. Pure: no DOM, no chrome.

function hashTitle(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export function monogram(title: string): { letter: string; bg: string } {
  const hue = hashTitle(title || '?') % 360;
  return {
    letter: (title || '?').trim().charAt(0).toUpperCase() || '?',
    bg: `linear-gradient(135deg, oklch(0.62 0.13 ${hue}), oklch(0.48 0.15 ${(hue + 45) % 360}))`,
  };
}
