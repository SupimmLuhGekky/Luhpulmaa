/**
 * Round axis ticks for money charts (values in cents): 0, $1,000, $2,000… instead of
 * $0, $900, $1.8K. Display-only arithmetic; no money is computed here.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 10_000];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step));
}
