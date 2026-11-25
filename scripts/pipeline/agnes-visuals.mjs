/** Clamp measured scene durations to Agnes Video 2.5 Flash's supported range. */
export function agnesSlotSeconds(slotDuration) {
  const value = Number(slotDuration);
  if (!Number.isFinite(value) || value <= 0) return 4;
  return Math.max(4, Math.min(12, Math.round(value)));
}
