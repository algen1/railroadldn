import type { Train } from "./types";

export type JourneyPoint = { naptanId?: string; commonName: string; lat: number; lon: number; platformName?: string };
export type JourneyLeg = {
  duration: number; departureTime: string; arrivalTime: string;
  departurePoint: JourneyPoint; arrivalPoint: JourneyPoint;
  instruction: { summary: string; detailed?: string };
  mode: { id: string; name: string };
  routeOptions?: { name: string; directions?: string[]; lineIdentifier?: { id: string } }[];
  path?: { lineString?: string; stopPoints?: { id: string; name: string }[] };
  disruptions?: { description?: string }[];
};
export type Journey = { startDateTime: string; arrivalDateTime: string; duration: number; legs: JourneyLeg[] };

// Journey Planner returns London wall times without a UTC offset.
export function londonTimestamp(value: string): number {
  if (/Z$|[+-]\d\d:\d\d$/.test(value)) return Date.parse(value);
  const wall = Date.parse(`${value}Z`);
  if (!Number.isFinite(wall)) return NaN;
  let result = wall;
  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(result);
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    const shown = Date.parse(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`);
    result += wall - shown;
  }
  return result;
}

export function journeyClock(value: string): string {
  return new Date(londonTimestamp(value)).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
}

export function londonInput(date: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

export function liveTrainForLeg(leg: JourneyLeg, trains: Train[], now: number): Train | null {
  const lineIds = new Set(leg.routeOptions?.map((option) => option.lineIdentifier?.id));
  const departure = londonTimestamp(leg.departureTime);
  if (departure < now - 60000 || departure > now + 30 * 60000) return null;
  const matches = trains.flatMap((train) => {
    if (!lineIds.has(train.lineId)) return [];
    const from = train.stops.find((stop) => stop.naptanId === leg.departurePoint.naptanId);
    const to = train.stops.find((stop) => stop.naptanId === leg.arrivalPoint.naptanId);
    if (!from || !to) return [];
    const fromTime = Date.parse(from.expectedArrival);
    const toTime = Date.parse(to.expectedArrival);
    // Require the correct direction and a prediction close to the planned service.
    if (fromTime < now || toTime <= fromTime || toTime > londonTimestamp(leg.arrivalTime) || Math.abs(toTime - londonTimestamp(leg.arrivalTime)) > 180000) return [];
    const delta = Math.abs(fromTime - departure);
    return delta <= 90000 ? [{ train, delta }] : [];
  });
  matches.sort((a, b) => a.delta - b.delta);
  return matches[0]?.train ?? null;
}


export type JourneyMode = "now" | "arrive";

export function eligibleJourneys(journeys: Journey[], mode: JourneyMode, now: number, deadline: number): Journey[] {
  return journeys.filter((journey) => mode === "now"
    ? londonTimestamp(journey.startDateTime) >= now - 60000 && londonTimestamp(journey.arrivalDateTime) > now
    : londonTimestamp(journey.startDateTime) > now && londonTimestamp(journey.arrivalDateTime) <= deadline)
    .sort((a, b) => mode === "now"
      ? londonTimestamp(a.startDateTime) - londonTimestamp(b.startDateTime)
      : londonTimestamp(b.startDateTime) - londonTimestamp(a.startDateTime));
}

export function nextLiveTrainForJourney(journey: Journey, trains: Train[], now: number) {
  const index = journey.legs.findIndex((leg) => leg.mode.id !== "walking");
  if (index < 0) return null;
  const leg = journey.legs[index];
  const lines = new Set(leg.routeOptions?.map((option) => option.lineIdentifier?.id));
  const walkingMinutes = journey.legs.slice(0, index).reduce((sum, leg) => sum + leg.duration, 0);
  const ready = now + walkingMinutes * 60000;
  const hasConnection = journey.legs.slice(index + 1).some((leg) => leg.mode.id !== "walking");
  const matches = trains.flatMap((train) => {
    if (!lines.has(train.lineId)) return [];
    const stop = train.stops.find((stop) => stop.naptanId === leg.departurePoint.naptanId);
    const end = train.stops.find((stop) => stop.naptanId === leg.arrivalPoint.naptanId);
    if (!stop || !end) return [];
    const departure = Date.parse(stop.expectedArrival);
    const arrival = Date.parse(end.expectedArrival);
    if (!Number.isFinite(departure) || !Number.isFinite(arrival) || departure < ready || departure > now + 30 * 60000 || arrival <= departure) return [];
    // Preserve the transfer time allowed by TfL when another train is needed.
    if (hasConnection && arrival > londonTimestamp(leg.arrivalTime)) return [];
    return [{ train, stop, departure, arrival }];
  });
  matches.sort((a, b) => a.departure - b.departure || a.arrival - b.arrival);
  return matches[0] ?? null;
}
