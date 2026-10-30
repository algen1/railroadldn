export function shortStation(name: string): string {
  return name
    .replace(/\s+Underground Station$/i, "")
    .replace(/\s+Rail Station$/i, "")
    .replace(/\s+DLR Station$/i, "")
    .replace(/\s+Station$/i, "")
    .trim();
}

export function normalizeStation(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/\bst\.?\b/g, "street")
    .replace(/underground station|dlr station|rail station|elizabeth line|station/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/platform\s+\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

export function formatWait(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes <= 0) return "Due";
  if (minutes === 1) return "1 min";
  return `${minutes} min`;
}

export function formatUpdated(date: Date | null): string {
  if (!date) return "Waiting";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/London",
  });
}

export function inkOn(hex: string): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 155 ? "#241c14" : "#fffaf3";
}
