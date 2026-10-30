import { normalizeStation, shortStation } from "./format";
import type { Arrival, Branch, LineRoute, LngLat, Stop, Train, UpcomingStop } from "./types";

const SEGMENT_SECONDS: Record<string, number> = {
  Tube: 130,
  DLR: 110,
  "Elizabeth line": 150,
  Overground: 160,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function namesMatch(stopNorm: string, hint: string): boolean {
  if (!hint || !stopNorm) return false;
  if (stopNorm === hint) return true;
  if (hint.length < 4 || stopNorm.length < 4) return false;
  return stopNorm.startsWith(hint) || hint.startsWith(stopNorm);
}

function findStop(stops: Stop[], hint: string): number {
  return stops.findIndex((stop) => namesMatch(stop.norm, hint));
}

export function haversine(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const radius = 6371000;
  const phi1 = (aLat * Math.PI) / 180;
  const phi2 = (bLat * Math.PI) / 180;
  const dPhi = ((bLat - aLat) * Math.PI) / 180;
  const dLambda = ((bLng - aLng) * Math.PI) / 180;
  const sin = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(sin)));
}

function geographicBearing(from: LngLat, to: LngLat): number {
  const phi1 = (from[1] * Math.PI) / 180;
  const phi2 = (to[1] * Math.PI) / 180;
  const lambda1 = (from[0] * Math.PI) / 180;
  const lambda2 = (to[0] * Math.PI) / 180;
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return Math.atan2(y, x);
}

export function pointAlong(path: LngLat[], fraction: number): { lng: number; lat: number; bearing: number } {
  if (path.length === 0) return { lng: -0.12, lat: 51.5, bearing: 0 };
  if (path.length === 1) return { lng: path[0][0], lat: path[0][1], bearing: 0 };
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    const length = haversine(path[index - 1][0], path[index - 1][1], path[index][0], path[index][1]);
    lengths.push(length);
    total += length;
  }
  let remaining = clamp(fraction, 0, 1) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (remaining <= length || index === lengths.length - 1) {
      const local = length === 0 ? 0 : remaining / length;
      const start = path[index];
      const end = path[index + 1];
      return {
        lng: start[0] + (end[0] - start[0]) * local,
        lat: start[1] + (end[1] - start[1]) * local,
        bearing: geographicBearing(start, end),
      };
    }
    remaining -= length;
  }
  const last = path[path.length - 1];
  return { lng: last[0], lat: last[1], bearing: 0 };
}

type LocationHint =
  | { kind: "at" | "left" | "approaching"; name: string }
  | { kind: "between"; from: string; to: string }
  | { kind: "unknown" };

function parseLocation(raw: string): LocationHint {
  const text = raw.trim();
  const between = text.match(/^between\s+(.+?)\s+and\s+(.+)$/i);
  if (between) {
    return {
      kind: "between",
      from: normalizeStation(between[1]),
      to: normalizeStation(between[2]),
    };
  }
  const headed = text.match(/^(at|approaching|left|departed|departing)\s+(.+)$/i);
  if (headed) {
    const word = headed[1].toLowerCase();
    const name = normalizeStation(headed[2]);
    if (word === "at") return { kind: "at", name };
    if (word === "approaching") return { kind: "approaching", name };
    return { kind: "left", name };
  }
  return { kind: "unknown" };
}

function nearestIndex(path: LngLat[], point: LngLat): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < path.length; index += 1) {
    const distance = (path[index][0] - point[0]) ** 2 + (path[index][1] - point[1]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function pathBetween(branch: Branch, from: Stop, to: Stop): LngLat[] {
  const start: LngLat = [from.lon, from.lat];
  const end: LngLat = [to.lon, to.lat];
  let best: LngLat[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const path of branch.paths) {
    if (path.length < 2) continue;
    const startIndex = nearestIndex(path, start);
    const endIndex = nearestIndex(path, end);
    const score =
      (path[startIndex][0] - start[0]) ** 2 +
      (path[startIndex][1] - start[1]) ** 2 +
      (path[endIndex][0] - end[0]) ** 2 +
      (path[endIndex][1] - end[1]) ** 2 +
      (startIndex === endIndex ? 0.01 : 0);
    if (score < bestScore) {
      bestScore = score;
      if (startIndex === endIndex) best = [start, end];
      else if (startIndex < endIndex) best = path.slice(startIndex, endIndex + 1);
      else best = path.slice(endIndex, startIndex + 1).reverse();
    }
  }
  return best && best.length > 1 ? best : [start, end];
}

function stopById(stops: Stop[], id: string): number {
  return stops.findIndex((stop) => stop.id === id);
}

type Span = {
  branch: Branch;
  from: number;
  to: number;
  fraction: number;
};

function travelFraction(secondsAway: number, segmentSeconds: number): number {
  return clamp(1 - secondsAway / segmentSeconds, 0.05, 0.96);
}

function chooseSpan(route: LineRoute, head: Arrival, hint: LocationHint): Span | null {
  const segment = SEGMENT_SECONDS[route.mode] ?? 140;
  const along = travelFraction(head.timeToStation, segment);
  let best: { score: number; span: Span } | null = null;

  for (const branch of route.branches) {
    const nextIndex = stopById(branch.stops, head.naptanId);
    if (nextIndex < 0) continue;
    const directionBonus = branch.direction && branch.direction === head.direction ? 2 : 0;

    if (hint.kind === "between") {
      const fromIndex = findStop(branch.stops, hint.from);
      const toIndex = findStop(branch.stops, hint.to);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) continue;
      const forward = fromIndex < toIndex;
      const span: Span = {
        branch,
        from: forward ? fromIndex : toIndex,
        to: forward ? toIndex : fromIndex,
        fraction: toIndex === nextIndex || fromIndex === nextIndex ? along : 0.55,
      };
      if (!forward) span.fraction = 1 - span.fraction;
      const adjacent = Math.abs(fromIndex - toIndex) === 1 ? 8 : 2;
      const score = adjacent + directionBonus + (fromIndex === nextIndex || toIndex === nextIndex ? 3 : 0);
      if (!best || score > best.score) best = { score, span };
      continue;
    }

    const named = hint.kind === "unknown" ? -1 : findStop(branch.stops, hint.name);
    let from = nextIndex > 0 ? nextIndex - 1 : nextIndex;
    let to = nextIndex;
    let fraction = along;

    if (named >= 0 && named !== nextIndex) {
      from = Math.min(named, nextIndex);
      to = Math.max(named, nextIndex);
      const movingForward = named < nextIndex;
      if (hint.kind === "at") fraction = movingForward ? Math.min(0.18, along) : Math.max(0.9, along);
      else if (hint.kind === "left") fraction = movingForward ? clamp(Math.max(0.2, along), 0.12, 0.6) : clamp(along, 0.4, 0.9);
      else if (hint.kind === "approaching") fraction = movingForward ? Math.max(0.72, along) : Math.min(0.28, along);
      if (!movingForward) {
        const swap = from;
        from = to;
        to = swap;
        fraction = 1 - fraction;
      }
    } else if (named === nextIndex) {
      fraction = hint.kind === "approaching" ? Math.max(0.78, along) : Math.max(0.9, along);
    }

    if (from === to) continue;
    const near = named >= 0 && Math.abs(named - nextIndex) <= 1 ? 6 : named >= 0 ? 3 : 1;
    const score = near + directionBonus;
    const span = { branch, from, to, fraction: clamp(fraction, 0.04, 0.97) };
    if (!best || score > best.score) best = { score, span };
  }

  return best?.span ?? null;
}

function inLondon(lng: number, lat: number): boolean {
  return lng > -0.95 && lng < 0.55 && lat > 51.15 && lat < 51.85;
}

function destinationOf(head: Arrival): string {
  const raw = head.destinationName && head.destinationName !== "None" ? head.destinationName : head.towards;
  return raw ? shortStation(raw) : "Destination not reported";
}

function upcomingStops(group: Arrival[]): UpcomingStop[] {
  const sorted = [...group].sort((a, b) => a.timeToStation - b.timeToStation);
  const seen = new Set<string>();
  const stops: UpcomingStop[] = [];
  for (const item of sorted) {
    if (!item.stationName || item.timeToStation > 45 * 60) continue;
    const key = normalizeStation(item.stationName);
    if (seen.has(key)) continue;
    seen.add(key);
    stops.push({
      naptanId: item.naptanId || key,
      stationName: item.stationName,
      platformName: item.platformName,
      timeToStation: item.timeToStation,
      expectedArrival: item.expectedArrival,
    });

  }
  return stops;
}

function placeGroup(route: LineRoute, group: Arrival[]): Train | null {
  const head = [...group].sort((a, b) => a.timeToStation - b.timeToStation)[0];
  if (!head) return null;
  const hint = parseLocation(head.currentLocation);
  const span = chooseSpan(route, head, hint);
  if (!span) return null;
  const from = span.branch.stops[span.from];
  const to = span.branch.stops[span.to];
  const path = pathBetween(span.branch, from, to);
  const point = pointAlong(path, span.fraction);
  if (!inLondon(point.lng, point.lat)) return null;
  return {
    id: `${route.id}:${head.vehicleId}`,
    vehicleId: head.vehicleId,
    lineId: route.id,
    lineName: route.name,
    mode: route.mode,
    color: route.color,
    destination: destinationOf(head),
    currentLocation: head.currentLocation,
    pathKey: `${route.id}:${from.id}:${to.id}`,
    path,
    fraction: span.fraction,
    lng: point.lng,
    lat: point.lat,
    bearing: point.bearing,
    stops: upcomingStops(group),
  };
}

export function placeTrains(routes: LineRoute[], arrivals: Arrival[]): Train[] {
  const routesById = new Map(routes.map((route) => [route.id, route]));
  const groups = new Map<string, Arrival[]>();
  for (const arrival of arrivals) {
    const key = `${arrival.lineId}:${arrival.vehicleId}`;
    const group = groups.get(key);
    if (group) group.push(arrival);
    else groups.set(key, [arrival]);
  }
  const trains: Train[] = [];
  for (const [key, group] of groups) {
    const route = routesById.get(key.slice(0, key.indexOf(":")));
    if (!route) continue;
    const train = placeGroup(route, group);
    if (train) trains.push(train);
  }
  return trains;
}
