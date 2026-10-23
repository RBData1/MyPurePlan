/** Shared palette + helpers for service accent colours. */
export const SERVICE_COLOR_PALETTE = [
  '#3972dc',
  '#199a72',
  '#bf8b27',
  '#806bd2',
  '#c45c6a',
  '#2a9d8f',
  '#e07a3d',
  '#5c6bc0',
] as const;

export function resolveServiceColor(color?: string | null, index = 0): string {
  const trimmed = String(color || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  return SERVICE_COLOR_PALETTE[index % SERVICE_COLOR_PALETTE.length];
}

export function nextServiceColor(existing: Array<{ color?: string | null }>): string {
  const used = new Set(
    existing
      .map(s => resolveServiceColor(s.color))
      .filter(Boolean),
  );
  const unused = SERVICE_COLOR_PALETTE.find(c => !used.has(c));
  return unused || SERVICE_COLOR_PALETTE[existing.length % SERVICE_COLOR_PALETTE.length];
}

export function withServiceColors<T extends { name: string; color?: string | null }>(
  list: T[],
): Array<Omit<T, 'color'> & { color: string }> {
  return list.map((s, i) => ({ ...s, color: resolveServiceColor(s.color, i) }));
}
