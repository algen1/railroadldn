import { LINES, MODES, type LineMode } from "./lines";
import { inkOn } from "./format";
import type { Train } from "./types";

export type StationHit = {
  id: string;
  name: string;
  lng: number;
  lat: number;
};

type MainMenuProps = {
  query: string;
  onQuery: (value: string) => void;
  hidden: Set<string>;
  onToggle: (id: string) => void;
  onToggleMode: (mode: LineMode) => void;
  onAll: () => void;
  onNone: () => void;
  trains: Train[];
  stations: StationHit[];
  matchCount: number;
  onTrain: (train: Train) => void;
  onStation: (station: StationHit) => void;
  onClose: () => void;
};

export default function MainMenu({
  query,
  onQuery,
  hidden,
  onToggle,
  onToggleMode,
  onAll,
  onNone,
  trains,
  stations,
  matchCount,
  onTrain,
  onStation,
  onClose,
}: MainMenuProps) {
  const selectedCount = LINES.length - hidden.size;
  const searching = query.trim().length > 0;

  return (
    <div className="menu-backdrop">
      <section className="menu" aria-label="Main menu">
        <p className="eyebrow">Live London</p>
        <h1>Railroom</h1>
        <p className="menu-lead">
          Choose the lines to show, then search for a station or a destination. Scroll or pinch the map to zoom.
        </p>

        <label className="search">
          <span>Search trains</span>
          <input
            value={query}
            autoFocus
            placeholder="Victoria, Heathrow, Jubilee…"
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>

        <div className="menu-row">
          <h2>Lines</h2>
          <div className="menu-actions">
            <button type="button" onClick={onAll}>
              All
            </button>
            <button type="button" onClick={onNone}>
              None
            </button>
          </div>
        </div>

        {MODES.map((mode) => (
          <div key={mode} className="mode-group">
            <button type="button" className="mode" onClick={() => onToggleMode(mode)}>
              {mode}
            </button>
            <div className="pills">
              {LINES.filter((line) => line.mode === mode).map((line) => {
                const on = !hidden.has(line.id);
                return (
                  <button
                    key={line.id}
                    type="button"
                    className="pill"
                    aria-pressed={on}
                    style={on ? { background: line.color, color: inkOn(line.color) } : { color: "#6d6256" }}
                    onClick={() => onToggle(line.id)}
                  >
                    <span className="dot" style={{ background: line.color }} />
                    {line.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <p className="match-count">
          {selectedCount === 0
            ? "Choose at least one line."
            : query.trim()
              ? `${matchCount} matching ${matchCount === 1 ? "train" : "trains"}`
              : `${matchCount} trains on ${selectedCount} ${selectedCount === 1 ? "line" : "lines"}`}
        </p>

        {searching ? (
          <div className="results">
            {stations.length === 0 && trains.length === 0 ? (
              <p className="empty">Nothing matches that search.</p>
            ) : null}
            {stations.length > 0 ? <h3>Stations</h3> : null}
            {stations.map((station) => (
              <button key={station.id} type="button" className="result" onClick={() => onStation(station)}>
                <strong>{station.name}</strong>
                <span>Show on the map</span>
              </button>
            ))}
            {trains.length > 0 ? <h3>Trains</h3> : null}
            {trains.map((train) => (
              <button key={train.id} type="button" className="result" onClick={() => onTrain(train)}>
                <strong>
                  <i style={{ background: train.color }} />
                  {train.lineName}
                </strong>
                <span>To {train.destination}</span>
              </button>
            ))}
          </div>
        ) : null}

        <button type="button" className="go" disabled={selectedCount === 0} onClick={onClose}>
          Show the map
        </button>
      </section>
    </div>
  );
}
