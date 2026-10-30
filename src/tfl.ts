import { LINES, lineMeta } from "./lines";
import { normalizeStation } from "./format";
import type { Arrival, Branch, LineRoute, LngLat, Stop } from "./types";

const BASE = "https://api.tfl.gov.uk";

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  const key = import.meta.env.VITE_TFL_APP_KEY;
  if (key) url.searchParams.set("app_key", key);
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`TfL ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}

function isLngLat(value: unknown): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function parseLineString(raw: unknown): LngLat[][] {
  if (typeof raw === "string") {
    try {
      return parseLineString(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first: unknown = raw[0];
  if (isLngLat(first)) {
    return [raw.filter(isLngLat)];
  }
  if (Array.isArray(first)) {
    return raw.flatMap((part) => parseLineString(part));
  }
  return [];
}

type RawStop = {
  id?: string;
  name?: string;
  lat?: number;
  lon?: number;
};

type RawSequence = {
  direction?: string;
  stopPoint?: RawStop[];
};

type RawRoute = {
  stopPointSequences?: RawSequence[];
  lineStrings?: unknown[];
};

function toStop(raw: RawStop): Stop | null {
  if (!raw.id || !raw.name || typeof raw.lat !== "number" || typeof raw.lon !== "number") {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    norm: normalizeStation(raw.name),
    lat: raw.lat,
    lon: raw.lon,
  };
}

export async function fetchRoute(lineId: string, signal?: AbortSignal): Promise<LineRoute> {
  const meta = lineMeta(lineId);
  const raw = await fetchJson<RawRoute>(`/Line/${lineId}/Route/Sequence/all`, signal);
  const sequences = raw.stopPointSequences ?? [];
  const branches: Branch[] = sequences.map((sequence, index) => {
    const stops = (sequence.stopPoint ?? [])
      .map(toStop)
      .filter((stop): stop is Stop => stop !== null);
    const drawn = parseLineString(raw.lineStrings?.[index]).filter((path) => path.length > 1);
    const fallback: LngLat[] = stops.map((stop) => [stop.lon, stop.lat]);
    return {
      direction: (sequence.direction ?? "").toLowerCase(),
      stops,
      paths: drawn.length > 0 ? drawn : fallback.length > 1 ? [fallback] : [],
    };
  });
  return {
    id: meta.id,
    name: meta.name,
    mode: meta.mode,
    color: meta.color,
    branches: branches.filter((branch) => branch.stops.length > 1),
  };
}

let routeCache: LineRoute[] | null = null;
let routePromise: Promise<LineRoute[]> | null = null;

export function loadRoutes(): Promise<LineRoute[]> {
  if (routeCache) return Promise.resolve(routeCache);
  if (!routePromise) {
    routePromise = Promise.all(
      LINES.map(async (line) => {
        try {
          return await fetchRoute(line.id);
        } catch (error) {
          console.warn(`Could not load ${line.name}`, error);
          return null;
        }
      }),
    )
      .then((routes) => {
        const ready = routes.filter((route): route is LineRoute => route !== null);
        if (ready.length === 0) {
          routePromise = null;
          throw new Error("TfL did not return any routes");
        }
        routeCache = ready;
        return ready;
      })
      .catch((error: unknown) => {
        routePromise = null;
        throw error;
      });
  }
  return routePromise;
}

type RawArrival = {
  lineId?: string;
  lineName?: string;
  vehicleId?: string | number | null;
  naptanId?: string;
  stationName?: string;
  platformName?: string;
  destinationName?: string | null;
  towards?: string | null;
  currentLocation?: string | null;
  direction?: string | null;
  timeToStation?: number | null;
  expectedArrival?: string | null;
};

function toArrival(raw: RawArrival): Arrival | null {
  const vehicleId = raw.vehicleId == null ? "" : String(raw.vehicleId);
  const lineId = raw.lineId ?? "";
  if (!vehicleId || !lineId) return null;
  return {
    lineId,
    lineName: raw.lineName || lineMeta(lineId).name,
    vehicleId,
    naptanId: raw.naptanId ?? "",
    stationName: raw.stationName ?? "",
    platformName: raw.platformName ?? "",
    destinationName: raw.destinationName ?? "",
    towards: raw.towards ?? "",
    currentLocation: raw.currentLocation ?? "",
    direction: (raw.direction ?? "").toLowerCase(),
    timeToStation: typeof raw.timeToStation === "number" ? raw.timeToStation : 0,
    expectedArrival: raw.expectedArrival ?? "",
  };
}

export async function fetchArrivals(signal?: AbortSignal): Promise<Arrival[]> {
  const chunks: string[][] = [];
  const ids = LINES.map((line) => line.id);
  for (let index = 0; index < ids.length; index += 5) {
    chunks.push(ids.slice(index, index + 5));
  }
  const batches = await Promise.all(
    chunks.map((chunk) =>
      fetchJson<RawArrival[]>(`/Line/${chunk.join(",")}/Arrivals`, signal),
    ),
  );
  return batches.flat().map(toArrival).filter((item): item is Arrival => item !== null);
}
