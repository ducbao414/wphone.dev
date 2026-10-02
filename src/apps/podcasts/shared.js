// Helpers shared by the Podcasts app and its background position tracker.
export function epKey(url) {
  let h = 5381;
  const s = String(url || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'ep:' + (h >>> 0).toString(36) + s.length.toString(36);
}

/** "1753" | "29:13" | "01:02:03" -> seconds (0 if unknown) */
export function parseDuration(d) {
  if (d == null || d === '') return 0;
  if (typeof d === 'number') return d;
  const parts = String(d).trim().split(':').map(Number);
  if (parts.some((n) => !isFinite(n))) return 0;
  return parts.reduce((a, n) => a * 60 + n, 0);
}
