export function judge(a, b) {
    if (a === b)
        return 0;
    if ((a === "penguin" && b === "ice") || (a === "ice" && b === "pebble") || (a === "pebble" && b === "penguin"))
        return 1;
    return -1;
}
export function label(m) {
    return m === "penguin" ? "🐧 Penguin" : m === "ice" ? "🧊 Ice" : "🪨 Pebble";
}
