export type PipMove = "penguin" | "ice" | "pebble";

export function judge(a: PipMove, b: PipMove): -1 | 0 | 1 {
  if (a === b) return 0;
  if ((a==="penguin" && b==="ice") || (a==="ice" && b==="pebble") || (a==="pebble" && b==="penguin")) return 1;
  return -1;
}

export function label(m: PipMove) {
  return m==="penguin" ? "🐧 Penguin" : m==="ice" ? "❄️ Ice" : "🪨 Pebble";
}
