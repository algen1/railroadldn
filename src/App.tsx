import { useEffect, useMemo, useState } from "react";
import { LINES, type LineMode } from "./lines";
import { formatClock, formatUpdated, formatWait, normalizeStation, shortStation } from "./format";
import MainMenu, { type StationHit } from "./MainMenu";
import MapView, { type MapFocus } from "./MapView";
import { useNetwork } from "./useNetwork";
import type { Journey } from "./journey";
import type { Train, UpcomingStop } from "./types";

export default function App() {
  const { routes, trains, status, message, updatedAt, reload } = useNetwork();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catching, setCatching] = useState<{ trainId: string; lineId: string; stop: UpcomingStop } | null>(null);
  const [selectedStation, setSelectedStation] = useState<StationHit | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [menuOpen, setMenuOpen] = useState(true);
  const [focus, setFocus] = useState<MapFocus | null>(null);

  const visible = useMemo(() => {
    if (catching) return new Set([catching.lineId]);
    const ids = new Set<string>();
    for (const line of LINES) {
      if (!hidden.has(line.id)) ids.add(line.id);
    }
    return ids;
  }, [hidden, catching]);

  const lineTrains = useMemo(() => trains.filter((train) => visible.has(train.lineId)), [trains, visible]);
  const mapTrains = useMemo(() => catching ? trains.filter((train) => train.id === catching.trainId) : lineTrains, [catching, trains, lineTrains]);
  const selected = mapTrains.find((train) => train.id === (catching?.trainId ?? selectedId)) ?? null;
  const catchTrain = catching ? trains.find((train) => train.id === catching.trainId) : null;
  const catchLeg = catching ? journey?.legs.find((leg) => leg.departurePoint.naptanId === catching.stop.naptanId && leg.routeOptions?.some((option) => option.lineIdentifier?.id === catching.lineId)) : null;
  const boarding = catching ? catchTrain?.stops.find((stop) => stop.naptanId === catching.stop.naptanId) : null;

  function showAllTrains() {
    setCatching(null);
    setSelectedId(null);
  }

  function openJourneyTrain(train: Train, stop: UpcomingStop) {
    selectTrain(train.id);
    setCatching({ trainId: train.id, lineId: train.lineId, stop });
    setFocus({ lng: train.lng, lat: train.lat, zoom: 14.2, token: Date.now() });
  }

  function chooseJourney(value: Journey | null) {
    showAllTrains();
    setJourney(value);
  }

  const stationInfo = useMemo(() => {
    if (!selectedStation) return null;
    const ids = new Set([selectedStation.id]);
    const name = normalizeStation(selectedStation.name);
    const lines = routes.filter((route) => route.branches.some((branch) =>
      branch.stops.some((stop) => {
        const matches = stop.id === selectedStation.id || normalizeStation(shortStation(stop.name)) === name;
        if (matches) ids.add(stop.id);
        return matches;
      }),
    ));
    // Collect every platform ID, including branches on the same line.
    for (const route of lines) for (const branch of route.branches) for (const stop of branch.stops) {
      if (normalizeStation(shortStation(stop.name)) === name) ids.add(stop.id);
    }
    const arrivals = trains.flatMap((train) => train.stops
      .filter((stop) => ids.has(stop.naptanId) && Date.parse(stop.expectedArrival) >= now)
      .map((stop) => ({ train, stop })))
      .sort((a, b) => Date.parse(a.stop.expectedArrival) - Date.parse(b.stop.expectedArrival))
      .slice(0, 12);
    return { lines, arrivals };
  }, [selectedStation, routes, trains, now]);

  function selectTrain(id: string | null) {
    setSelectedStation(null);
    setSelectedId(id);
    if (!id) setCatching(null);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (selectedId && !mapTrains.some((train) => train.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, mapTrains]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (menuOpen) setMenuOpen(false);
        else { showAllTrains(); setSelectedStation(null); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  function toggle(id: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMode(mode: LineMode) {
    const ids = LINES.filter((line) => line.mode === mode).map((line) => line.id);
    const allHidden = ids.every((id) => hidden.has(id));
    setHidden((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (allHidden) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function openTrain(train: Train) {
    setCatching(null);
    setHidden((current) => { const next = new Set(current); next.delete(train.lineId); return next; });
    selectTrain(train.id);
    setFocus({ lng: train.lng, lat: train.lat, zoom: 14.2, token: Date.now() });
    setMenuOpen(false);
  }

  function openStation(station: StationHit) {
    setCatching(null);
    setSelectedId(null);
    setSelectedStation(station);
    setFocus({ lng: station.lng, lat: station.lat, zoom: 14, token: Date.now() });
    setMenuOpen(false);
  }

  return (
    <main className="shell">
      <MapView
        routes={routes}
        trains={mapTrains}
        visible={visible}
        selectedId={selected?.id ?? null}
        focus={focus}
        journey={catching ? null : journey}
        onSelect={selectTrain}
        onStation={openStation}
      />

      <header className="top">
        <div className="brand-block">
          <p className="eyebrow">Live London</p>
          <h1>Railroom</h1>
          <p className="status-line">
            <span className={status === "live" ? "pulse" : "pulse idle"} />
            {status === "loading" && (message || "Drawing the tracks")}
            {status === "live" &&
              `${mapTrains.length} ${mapTrains.length === 1 ? "train" : "trains"} · updated ${formatUpdated(updatedAt)}`}
            {status === "error" && (message || "TfL is not responding")}
          </p>
        </div>
        <div className="top-actions">
          <button type="button" className="text-button" onClick={() => { showAllTrains(); setMenuOpen(true); }}>
            Plan journey
          </button>
          <button type="button" className="text-button" onClick={() => { showAllTrains(); window.dispatchEvent(new Event("railroom-home")); }}>
            Reset view
          </button>
        </div>
      </header>

      {catching && !menuOpen ? (
        <section className="catching-banner" aria-label="Isolated journey train" aria-live="polite">
          <div>
            <p className="kicker">Your train · only this line shown</p>
            <strong>{catchTrain ? `${catchTrain.lineName} to ${catchTrain.destination}` : "Live train temporarily unavailable"}</strong>
            {catchLeg && <p>{shortStation(catchLeg.departurePoint.commonName)} → {shortStation(catchLeg.arrivalPoint.commonName)}</p>}
            <p>{boarding ? `${formatClock(boarding.expectedArrival)} at ${shortStation(boarding.stationName)} · ${formatWait(Math.max(0, (Date.parse(boarding.expectedArrival) - now) / 1000))}` : catchTrain ? `No current prediction at ${shortStation(catching.stop.stationName)}. Check the train’s upcoming stops.` : "Waiting for this train to reappear in the live feed."}</p>
          </div>
          <button type="button" className="text-button" onClick={showAllTrains}>Show full map</button>
        </section>
      ) : null}

      {selected && !menuOpen ? (
        <aside className="panel" aria-live="polite">
          <header>
            <span className="swatch" style={{ background: selected.color }} />
            <div>
              <p className="kicker">{selected.lineName}</p>
              <h2>To {selected.destination}</h2>
            </div>
            <button type="button" className="close" onClick={showAllTrains} aria-label="Close">
              ×
            </button>
          </header>
          <p className="where">{selected.currentLocation || "Location is updating"}</p>
          <h3>Upcoming arrivals</h3>
          {selected.stops.length === 0 ? (
            <p className="empty">This train has not reported any upcoming stops.</p>
          ) : (
            <ol>
              {selected.stops.map((stop) => (
                <li key={`${stop.naptanId}-${stop.expectedArrival}`}>
                  <div>
                    <strong>{shortStation(stop.stationName)}</strong>
                    {stop.platformName ? <small>{stop.platformName}</small> : null}
                  </div>
                  <div className="when">
                    <span>{formatWait(stop.timeToStation)}</span>
                    <time dateTime={stop.expectedArrival}>{formatClock(stop.expectedArrival)}</time>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      ) : null}

      {selectedStation && stationInfo && !menuOpen ? (
        <aside className="panel station-panel" aria-label="Station information" aria-live="polite">
          <header>
            <div>
              <p className="kicker">Station</p>
              <h2>{selectedStation.name}</h2>
            </div>
            <button type="button" className="close" onClick={() => setSelectedStation(null)} aria-label="Close station information">×</button>
          </header>
          <h3 className="station-heading">Lines at this station</h3>
          <div className="pills station-lines">
            {stationInfo.lines.map((line) => (
              <span className="pill" key={line.id}><span className="dot" style={{ background: line.color }} />{line.name}</span>
            ))}
          </div>
          <h3 className="station-heading">Upcoming arrivals</h3>
          <p className="station-note">From the latest live train predictions across all lines.</p>
          {stationInfo.arrivals.length ? (
            <ol>
              {stationInfo.arrivals.map(({ train, stop }) => (
                <li key={`${train.id}-${stop.naptanId}-${stop.expectedArrival}`}>
                  <button type="button" className="station-arrival" onClick={() => openTrain(train)}>
                    <span className="dot" style={{ background: train.color }} />
                    <span><strong>To {train.destination}</strong><small>{train.lineName}{stop.platformName ? ` · ${stop.platformName}` : ""}</small></span>
                    <span className="when"><span>{formatWait(Math.max(0, (Date.parse(stop.expectedArrival) - now) / 1000))}</span><time dateTime={stop.expectedArrival}>{formatClock(stop.expectedArrival)}</time></span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="empty">No upcoming arrivals in the current feed. Predictions refresh automatically.</p>}
        </aside>
      ) : null}

      <footer className="legal">
        <span>Powered by TfL Open Data. Scroll or pinch to zoom. Positions follow live predictions, not GPS.</span>
        {status === "error" ? (
          <button type="button" onClick={reload}>
            Try again
          </button>
        ) : null}
      </footer>

      <MainMenu
        open={menuOpen}
        routes={routes}
        trains={trains}
        hidden={hidden}
        onToggle={toggle}
        onToggleMode={toggleMode}
        onAll={() => setHidden(new Set())}
        onNone={() => setHidden(new Set(LINES.map((line) => line.id)))}
        onTrain={openJourneyTrain}
        onJourney={chooseJourney}
        onClose={() => setMenuOpen(false)}
      />
    </main>
  );
}
