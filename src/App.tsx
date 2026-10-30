import { useEffect, useMemo, useState } from "react";
import { LINES, type LineMode } from "./lines";
import { formatClock, formatUpdated, formatWait, normalizeStation, shortStation } from "./format";
import MainMenu, { type StationHit } from "./MainMenu";
import MapView, { type MapFocus } from "./MapView";
import { useNetwork } from "./useNetwork";
import type { LineRoute, Train } from "./types";

export default function App() {
  const { routes, trains, status, message, updatedAt, reload } = useNetwork();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(true);
  const [focus, setFocus] = useState<MapFocus | null>(null);

  const visible = useMemo(() => {
    const ids = new Set<string>();
    for (const line of LINES) {
      if (!hidden.has(line.id)) ids.add(line.id);
    }
    return ids;
  }, [hidden]);

  const needle = normalizeStation(query);
  const lineTrains = useMemo(
    () => trains.filter((train) => visible.has(train.lineId)),
    [trains, visible],
  );
  const matchedTrains = useMemo(
    () => lineTrains.filter((train) => trainMatches(train, needle)),
    [lineTrains, needle],
  );
  const selected = lineTrains.find((train) => train.id === selectedId) ?? null;
  const stations = useMemo(() => stationHits(routes, visible, needle), [routes, visible, needle]);

  useEffect(() => {
    if (selectedId && !lineTrains.some((train) => train.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, lineTrains]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (menuOpen) setMenuOpen(false);
        else setSelectedId(null);
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
    setSelectedId(train.id);
    setFocus({ lng: train.lng, lat: train.lat, zoom: 14.2, token: Date.now() });
    setMenuOpen(false);
  }

  function openStation(station: StationHit) {
    setFocus({ lng: station.lng, lat: station.lat, zoom: 14, token: Date.now() });
    setMenuOpen(false);
  }

  return (
    <main className="shell">
      <MapView
        routes={routes}
        trains={lineTrains}
        visible={visible}
        selectedId={selected?.id ?? null}
        focus={focus}
        onSelect={setSelectedId}
      />

      <header className="top">
        <div className="brand-block">
          <p className="eyebrow">Live London</p>
          <h1>Railroom</h1>
          <p className="status-line">
            <span className={status === "live" ? "pulse" : "pulse idle"} />
            {status === "loading" && (message || "Drawing the tracks")}
            {status === "live" &&
              `${lineTrains.length} trains · updated ${formatUpdated(updatedAt)}`}
            {status === "error" && (message || "TfL is not responding")}
          </p>
        </div>
        <div className="top-actions">
          <button type="button" className="text-button" onClick={() => setMenuOpen(true)}>
            Menu
          </button>
          <button type="button" className="text-button" onClick={() => window.dispatchEvent(new Event("railroom-home"))}>
            Reset view
          </button>
        </div>
      </header>

      {selected && !menuOpen ? (
        <aside className="panel" aria-live="polite">
          <header>
            <span className="swatch" style={{ background: selected.color }} />
            <div>
              <p className="kicker">{selected.lineName}</p>
              <h2>To {selected.destination}</h2>
            </div>
            <button type="button" className="close" onClick={() => setSelectedId(null)} aria-label="Close">
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

      <footer className="legal">
        <span>Powered by TfL Open Data. Scroll or pinch to zoom. Positions follow live predictions, not GPS.</span>
        {status === "error" ? (
          <button type="button" onClick={reload}>
            Try again
          </button>
        ) : null}
      </footer>

      {menuOpen ? (
        <MainMenu
          query={query}
          onQuery={setQuery}
          hidden={hidden}
          onToggle={toggle}
          onToggleMode={toggleMode}
          onAll={() => setHidden(new Set())}
          onNone={() => setHidden(new Set(LINES.map((line) => line.id)))}
          trains={matchedTrains.slice(0, 8)}
          stations={stations.slice(0, 6)}
          matchCount={needle ? matchedTrains.length : lineTrains.length}
          onTrain={openTrain}
          onStation={openStation}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </main>
  );
}

function trainMatches(train: Train, needle: string): boolean {
  if (!needle) return true;
  const blob = normalizeStation(
    [train.lineName, train.lineId, train.destination, train.currentLocation, ...train.stops.map((stop) => stop.stationName)].join(
      " ",
    ),
  );
  return blob.includes(needle);
}

function stationHits(routes: LineRoute[], visible: Set<string>, needle: string): StationHit[] {
  if (!needle) return [];
  const seen = new Set<string>();
  const hits: StationHit[] = [];
  for (const route of routes) {
    if (!visible.has(route.id)) continue;
    for (const branch of route.branches) {
      for (const stop of branch.stops) {
        if (seen.has(stop.id) || !stop.norm.includes(needle)) continue;
        seen.add(stop.id);
        hits.push({ id: stop.id, name: shortStation(stop.name), lng: stop.lon, lat: stop.lat });
      }
    }
  }
  hits.sort((a, b) => a.name.localeCompare(b.name));
  return hits;
}
