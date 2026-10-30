import type { Journey } from "./journey";
import { LINES } from "./lines";

export function journeyRouteData(journey: Journey | null) {
  return { type: "FeatureCollection" as const, features: (journey?.legs ?? []).flatMap(leg => {
    try {
      const raw: unknown = JSON.parse(leg.path?.lineString ?? "[]");
      if (!Array.isArray(raw)) return [];
      const coordinates = raw.filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])).map(([lat, lng]) => [lng, lat]);
      if (coordinates.length < 2) return [];
      const line = LINES.find(line => leg.routeOptions?.some(option => option.lineIdentifier?.id === line.id));
      return [{ type: "Feature" as const, properties: { color: line?.color ?? "#667085", mode: leg.mode.id }, geometry: { type: "LineString" as const, coordinates } }];
    } catch { return []; }
  }) };
}

export function journeyStationLabels(journey: Journey | null) {
  const legs = journey?.legs.filter(leg => leg.mode.id !== "walking") ?? [];
  if (!legs.length) return [];
  const labels = legs.map((leg, index) => {
    const line = LINES.find(line => leg.routeOptions?.some(option => option.lineIdentifier?.id === line.id));
    return { point: leg.departurePoint, role: index === 0 ? "Board here" : `Change to ${line?.name ?? leg.mode.name ?? "next train"}`, kind: index === 0 ? "boarding" : "change", color: line?.color ?? "#1675df" };
  });
  // Keep the alighting station visible when a transfer includes a walk.
  legs.slice(0, -1).forEach((leg, index) => {
    const next = legs[index + 1].departurePoint;
    if (leg.arrivalPoint.naptanId !== next.naptanId || leg.arrivalPoint.commonName !== next.commonName) labels.push({ point: leg.arrivalPoint, role: "Change here · walk to next line", kind: "change", color: "#667085" });
  });
  labels.push({ point: legs[legs.length - 1].arrivalPoint, role: "Get off here", kind: "destination", color: "#12845a" });
  return labels;
}
