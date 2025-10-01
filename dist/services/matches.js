function judge(a, b) {
  if (a === b) return 0;
  if (a === "penguin" && b === "ice" || a === "ice" && b === "pebble" || a === "pebble" && b === "penguin") return 1;
  return -1;
}
function label(m) {
  return m === "penguin" ? "\u{1F427} Penguin" : m === "ice" ? "\u{1F9CA} Ice" : "\u{1FAA8} Pebble";
}
export {
  judge,
  label
};
//# sourceMappingURL=matches.js.map
