export function gameRequestHeaders(): Record<string, string> {
  const fromDom = String(
    document.documentElement?.dataset?.game
    || document.documentElement?.getAttribute("data-game")
    || "",
  ).trim().toLowerCase();
  const fromStorage = String(localStorage.getItem("mm_selected_game") || "").trim().toLowerCase();
  const gameType = fromDom === "chezz" || fromDom === "pool"
    ? fromDom
    : (fromStorage === "chezz" ? "chezz" : "pool");
  return { "X-MM-Game": gameType };
}
