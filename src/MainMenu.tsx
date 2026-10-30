import { useEffect, useMemo, useRef, useState } from "react";
import { LINES, MODES, type LineMode } from "./lines";
import { normalizeStation, shortStation, formatClock } from "./format";
import { journeyClock, liveTrainForLeg, londonInput, londonTimestamp, eligibleJourneys, nextLiveTrainForJourney, type Journey, type JourneyMode } from "./journey";
import { planJourney } from "./tfl";
import type { LineRoute, Train, UpcomingStop } from "./types";

export type StationHit = { id: string; name: string; lng: number; lat: number };
type Props = {
  open: boolean; routes: LineRoute[]; trains: Train[]; hidden: Set<string>;
  onToggle: (id: string) => void; onToggleMode: (mode: LineMode) => void;
  onAll: () => void; onNone: () => void; onTrain: (train: Train, stop: UpcomingStop) => void;
  onJourney: (journey: Journey | null) => void; onClose: () => void;
};

function StationField({ label, value, onChange, stations }: { label: string; value: string; onChange: (value: string) => void; stations: StationHit[] }) {
  const [focused, setFocused] = useState(false);
  const matches = stations.filter((station) => normalizeStation(station.name).includes(normalizeStation(value))).slice(0, 7);
  return <div className="station-field">
    <label className="field-label" htmlFor={`station-${label}`}>{label}</label>
    <input id={`station-${label}`} value={value} autoComplete="off" placeholder={label === "From" ? "Departure station" : "Destination station"}
      onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setFocused(false); }}
      aria-expanded={focused && matches.length > 0} aria-controls={`suggestions-${label}`} />
    {focused && <div id={`suggestions-${label}`} className="station-suggestions" aria-label={`${label} suggestions`}>
      {matches.map((station) => <button type="button" key={station.id} onClick={() => { onChange(station.name); setFocused(false); }}>{station.name}<span>Station</span></button>)}
      {!matches.length && <p>{stations.length ? "No matching stations" : "Loading stations…"}</p>}
    </div>}
  </div>;
}

export default function MainMenu({ open, routes, trains, hidden, onToggle, onToggleMode, onAll, onNone, onTrain, onJourney, onClose }: Props) {
  const [mode, setMode] = useState<JourneyMode>("now");
  const [pendingAuto, setPendingAuto] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [when, setWhen] = useState(() => londonInput(new Date(Date.now() + 60 * 60000)));
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchedAt, setSearchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const request = useRef<AbortController | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => { window.clearInterval(timer); request.current?.abort(); }; }, []);
  const stations = useMemo(() => {
    const seen = new Set<string>(); const result: StationHit[] = [];
    for (const route of routes) for (const branch of route.branches) for (const stop of branch.stops) {
      const name = shortStation(stop.name); const key = normalizeStation(name);
      if (seen.has(key)) continue;
      seen.add(key); result.push({ id: stop.id, name, lat: stop.lat, lng: stop.lon });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [routes]);

  function invalidate() { setPendingAuto(false); onJourney(null); request.current?.abort(); setLoading(false); setJourneys([]); setError(""); setSearchedAt(null); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); request.current?.abort();
    const origin = stations.find((station) => normalizeStation(station.name) === normalizeStation(from));
    const destination = stations.find((station) => normalizeStation(station.name) === normalizeStation(to));
    if (!origin || !destination) { setError("Choose a departure and destination from the station suggestions."); return; }
    if (origin.id === destination.id) { setError("Choose two different stations."); return; }
    if (mode === "arrive" && londonTimestamp(`${when.date}T${when.time}:00`) <= Date.now()) { setError("Choose an arrival time in the future. Times are in London time."); return; }
    const controller = new AbortController(); request.current = controller;
    setPendingAuto(false); onJourney(null); setLoading(true); setError(""); setJourneys([]);
    try {
      const searchTime = mode === "now" ? londonInput(new Date()) : when;
      const results = await planJourney(origin.id, destination.id, searchTime.date, searchTime.time, controller.signal, mode);
      if (controller.signal.aborted) return;
      const eligible = eligibleJourneys(results, mode, Date.now(), londonTimestamp(`${when.date}T${when.time}:00`));
      if (!eligible.length) throw new Error(mode === "now" ? "No journeys are available to leave now. Try Arrive by for a later service." : "No journey leaving now or later reaches your destination by that time. Try a later arrival.");
      setJourneys(eligible); setActive(0); setSearchedAt(Date.now()); onJourney(eligible[0]);
      setPendingAuto(mode === "now" && eligible.some((journey) => journey.legs.some((leg) => leg.mode.id !== "walking")));
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not plan this journey. Please try again."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    if (!pendingAuto || !open || mode !== "now") return;
    const matches = journeys.flatMap((journey, index) => {
      const match = nextLiveTrainForJourney(journey, trains, now);
      return match ? [{ ...match, index, journey }] : [];
    }).sort((a, b) => a.departure - b.departure || a.arrival - b.arrival);
    const match = matches[0];
    if (!match) return;
    setPendingAuto(false);
    setActive(match.index);
    onJourney(match.journey);
    onTrain(match.train, match.stop);
  }, [pendingAuto, open, mode, journeys, trains, now, onJourney, onTrain]);
  const journey = journeys[active];
  return <aside className="planner" hidden={!open} aria-label="Journey planner">
    <header className="planner-header"><div><p className="eyebrow">Railroom / London</p><h1>Plan your journey</h1></div><button type="button" className="close" onClick={onClose} aria-label="Close journey planner">×</button></header>
    <form onSubmit={submit} className="journey-form">
      <div className="endpoints"><StationField label="From" value={from} onChange={(value) => { invalidate(); setFrom(value); }} stations={stations} />
        <button type="button" className="swap" aria-label="Swap departure and destination" onClick={() => { invalidate(); setFrom(to); setTo(from); }}>⇅</button>
        <StationField label="To" value={to} onChange={(value) => { invalidate(); setTo(value); }} stations={stations} /></div>
      <div className="journey-mode" role="group" aria-label="Journey time">
        <button type="button" aria-pressed={mode === "now"} onClick={() => { invalidate(); setMode("now"); }}>Leave now</button>
        <button type="button" aria-pressed={mode === "arrive"} onClick={() => { invalidate(); setMode("arrive"); }}>Arrive by</button>
      </div>
      {mode === "arrive" ? <><div className="arrival-label"><strong>Arrive by</strong><span>London time</span></div>
      <div className="time-fields"><label><span className="sr-only">Arrival date</span><input type="date" required value={when.date} min={londonInput(new Date(now)).date} onChange={(event) => { invalidate(); setWhen({ ...when, date: event.target.value }); }} /></label><label><span className="sr-only">Arrival time</span><input type="time" required value={when.time} onChange={(event) => { invalidate(); setWhen({ ...when, time: event.target.value }); }} /></label></div></> : <p className="leave-now-note">Find the next live train and show only that train and its line on the map.</p>}
      <button className="plan-button" disabled={loading || !routes.length || !from || !to}>{loading ? "Finding journeys…" : "Find a journey"}<span aria-hidden="true">→</span></button>
      {error && <p className="planner-error" role="alert">{error}</p>}
    </form>
    {!journey && !loading && !error && <div className="planner-intro"><span className="section-number">{mode === "now" ? "LIVE JOURNEY PLANNING" : "ARRIVAL TIME PLANNING"}</span><h2>Where are you heading?</h2><p>{mode === "now" ? "Choose your stations. We’ll find the next suitable train and show where it is now." : "Choose your stations and arrival time. We’ll work backwards to find your route and when to leave."}</p><button type="button" className="example-link" onClick={() => { invalidate(); setFrom("Ruislip Gardens"); setTo("Greenford"); }}>Try Ruislip Gardens → Greenford</button></div>}
    {journey && <section className="journey-results" aria-label="Journey results" aria-live="polite">
      {pendingAuto && <p className="live-waiting" role="status">Waiting for a suitable live train prediction. Its location will open automatically when available.</p>}
      <div className="results-heading"><h2>{journeys.length} {journeys.length === 1 ? "option" : "options"}</h2><span>{searchedAt ? `Checked ${formatClock(new Date(searchedAt).toISOString())}` : ""}</span></div>
      <div className="journey-options">{journeys.map((option, index) => <button type="button" key={`${option.startDateTime}-${index}`} aria-pressed={active === index} className={active === index ? "journey-option active" : "journey-option"} onClick={() => { setPendingAuto(false); setActive(index); onJourney(option); if (mode === "now") { const match = nextLiveTrainForJourney(option, trains, now); if (match) onTrain(match.train, match.stop); } }}><strong>{journeyClock(option.startDateTime)} → {journeyClock(option.arrivalDateTime)}</strong><span>{option.duration} min · {Math.max(0, option.legs.filter((leg) => leg.mode.id !== "walking").length - 1)} changes</span></button>)}</div>
      <div className="departure-summary"><span>Leave by</span><strong>{journeyClock(journey.startDateTime)}</strong><span>Arrive {journeyClock(journey.arrivalDateTime)} · {journey.duration} min</span></div>
      {londonTimestamp(journey.startDateTime) < now && <p className="planner-error">This departure has passed. Search again for an updated journey.</p>}
      <button type="button" className="view-route" onClick={onClose}>View route on map →</button>
      <ol className="journey-legs">{journey.legs.map((leg, index) => {
        const firstTrainLeg = journey.legs.findIndex((item) => item.mode.id !== "walking");
        const live = mode === "now" && index === firstTrainLeg ? nextLiveTrainForJourney(journey, trains, now)?.train ?? null : liveTrainForLeg(leg, trains, now);
        const liveStop = live?.stops.find((stop) => stop.naptanId === leg.departurePoint.naptanId);
        const line = LINES.find((line) => leg.routeOptions?.some((option) => option.lineIdentifier?.id === line.id));
        return <li className="journey-leg" key={`${leg.departureTime}-${index}`} style={{ "--leg-color": line?.color ?? "#8b929a" } as React.CSSProperties}>
          <div className="leg-time">{live && liveStop ? <button type="button" className="departure-time" aria-label={`Show the ${formatClock(liveStop.expectedArrival)} train from ${shortStation(leg.departurePoint.commonName)} on the map`} onClick={() => onTrain(live, liveStop)}>{formatClock(liveStop.expectedArrival)}</button> : journeyClock(leg.departureTime)}</div><div className="leg-content"><h3>{shortStation(leg.departurePoint.commonName)}</h3><p className="leg-instruction">{leg.instruction.summary}</p>{leg.instruction.detailed && leg.instruction.detailed !== leg.instruction.summary && <p className="leg-detail">{leg.instruction.detailed}</p>}<p className="leg-detail">{leg.duration} min{leg.path?.stopPoints?.length ? ` · ${leg.path.stopPoints.length} stops` : ""}{leg.departurePoint.platformName ? ` · ${leg.departurePoint.platformName}` : ""}</p>
          {leg.mode.id !== "walking" && (live && liveStop ? <button type="button" className="live-catch" onClick={() => onTrain(live, liveStop)}><span className="live-badge">LIVE</span> Catch {formatClock(liveStop.expectedArrival)} to {live.destination}<small>{(liveStop.platformName ? `${liveStop.platformName} · ` : "") + "Isolate this train on map"} →</small></button> : <p className="scheduled-note">Scheduled departure · {londonTimestamp(leg.departureTime) > now + 30 * 60000 ? "Live train details closer to departure" : "No matching live train prediction yet"}</p>)}
          {leg.disruptions?.map((disruption, i) => disruption.description ? <p className="disruption" key={i}>{disruption.description}</p> : null)}
          <details className="leg-stops"><summary>To {shortStation(leg.arrivalPoint.commonName)} · {journeyClock(leg.arrivalTime)}</summary>{leg.path?.stopPoints?.map((stop) => <p key={stop.id}>{shortStation(stop.name)}</p>)}</details></div></li>;
      })}</ol><p className="results-footnote">TfL journey times can change. Live matches update with the train feed; search again to refresh your route.</p>
    </section>}
    <details className="map-settings"><summary>Map layers <span>{LINES.length - hidden.size} lines shown</span></summary><div className="menu-actions"><button type="button" onClick={onAll}>Show all</button><button type="button" onClick={onNone}>Hide all</button></div>{MODES.map((mode) => <div className="mode-group" key={mode}><button className="mode" type="button" onClick={() => onToggleMode(mode)}>{mode}</button><div className="pills">{LINES.filter((line) => line.mode === mode).map((line) => <button type="button" className="pill" aria-pressed={!hidden.has(line.id)} key={line.id} onClick={() => onToggle(line.id)}><span className="dot" style={{ background: line.color }} />{line.name}</button>)}</div></div>)}</details>
  </aside>;
}
