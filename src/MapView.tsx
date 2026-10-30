import { useEffect, useRef } from "react";
import { GeoJSONSource, Map, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import maplibreWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(maplibreWorker);
import type { Journey, JourneyLeg } from "./journey";
import { journeyRouteData, journeyStationLabels } from "./journeyMap";
import type { StationHit } from "./MainMenu";
import { shortStation } from "./format";
import { HOME_VIEW } from "./lines";
import { TrainLayer } from "./trainLayer";
import type { LineRoute, Train } from "./types";

export type MapFocus = {
  lng: number;
  lat: number;
  zoom: number;
  token: number;
};

type MapViewProps = {
  routes: LineRoute[];
  trains: Train[];
  visible: Set<string>;
  selectedId: string | null;
  catchTrainId: string | null;
  catchLeg: JourneyLeg | null;
  trainStale: boolean;
  focus: MapFocus | null;
  journey: Journey | null;
  onSelect: (id: string | null) => void;
  onStation: (station: StationHit) => void;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: Record<string, string>;
    geometry: { type: "LineString" | "Point"; coordinates: number[] | number[][] };
  }[];
};

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function geojson(map: Map, id: string): GeoJSONSource | null {
  const source = map.getSource(id);
  return source instanceof GeoJSONSource ? source : null;
}

function paint(map: Map, id: string, name: string, value: unknown) {
  try {
    map.setPaintProperty(id, name as "background-color", value as never);
  } catch {
    // This layer does not use that paint property.
  }
}

function stylize(map: Map) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    const sourceLayer = "source-layer" in layer ? String(layer["source-layer"] ?? "") : "";
    const key = `${layer.id} ${sourceLayer}`.toLowerCase();
    if (layer.type === "background") paint(map, layer.id, "background-color", "#efe4d0");
    if (layer.type === "fill" && key.includes("water")) paint(map, layer.id, "fill-color", "#b7d3e6");
    if (layer.type === "fill" && /park|grass|wood|landcover|pitch|garden/.test(key)) {
      paint(map, layer.id, "fill-color", "#d7e4c6");
    }
    if (layer.type === "fill" && sourceLayer === "building") paint(map, layer.id, "fill-color", "#e7d6c2");
    if (layer.type === "line" && key.includes("water")) paint(map, layer.id, "line-color", "#a9cbe0");
    if (
      layer.type === "line" &&
      /road|transport|bridge|tunnel/.test(key) &&
      !/rail|label|transit|oneway/.test(key)
    ) {
      const major = /motorway|trunk|primary|major/.test(key);
      paint(map, layer.id, "line-color", major ? "#e6d5c0" : "#f7f2e8");
    }
    if (layer.type === "symbol" && /poi|airport|housenumber/.test(key)) {
      try {
        map.setLayoutProperty(layer.id, "visibility", "none");
      } catch {
        // Layer cannot be hidden this way.
      }
    }
    if (layer.type === "symbol") {
      paint(map, layer.id, "text-color", "#3c332a");
      paint(map, layer.id, "text-halo-color", "#f6f0e4");
      paint(map, layer.id, "text-halo-width", 1.15);
    }
  }

  const building = layers.find((layer) => {
    const sourceLayer = "source-layer" in layer ? layer["source-layer"] : "";
    return layer.type === "fill" && sourceLayer === "building";
  });
  if (building && "source" in building && building.source && !map.getLayer("buildings-3d")) {
    map.addLayer({
      id: "buildings-3d",
      type: "fill-extrusion",
      source: building.source,
      "source-layer": "building",
      minzoom: 13,
      paint: {
        "fill-extrusion-color": "#e7d6c2",
        "fill-extrusion-opacity": 0.8,
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          0,
          13.6,
          ["coalesce", ["get", "render_height"], ["get", "height"], 10],
        ],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      },
    });
    try {
      map.setLayoutProperty(building.id, "visibility", "none");
    } catch {
      // Keep the flat footprints if the fill layer cannot be hidden.
    }
  }

  map.setSky({
    "sky-color": "#d7e7f4",
    "horizon-color": "#f4ecde",
    "fog-color": "#efe4d0",
    "sky-horizon-blend": 0.55,
    "horizon-fog-blend": 0.45,
    "fog-ground-blend": 0.35,
    "atmosphere-blend": 0.35,
  });
}

function railData(routes: LineRoute[], visible: Set<string>): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes
      .filter((route) => visible.has(route.id))
      .flatMap((route) =>
        route.branches.flatMap((branch) =>
          branch.paths
            .filter((path) => path.length > 1)
            .map((path) => ({
              type: "Feature" as const,
              properties: { color: route.color },
              geometry: { type: "LineString" as const, coordinates: path },
            })),
        ),
      ),
  };
}

function stationData(routes: LineRoute[], visible: Set<string>): FeatureCollection {
  const seen = new Set<string>();
  const features: FeatureCollection["features"] = [];
  for (const route of routes) {
    if (!visible.has(route.id)) continue;
    for (const branch of route.branches) {
      for (const stop of branch.stops) {
        if (seen.has(stop.id)) continue;
        seen.add(stop.id);
        features.push({
          type: "Feature",
          properties: { id: stop.id, name: shortStation(stop.name) },
          geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
        });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

function ensureNetwork(map: Map) {
  if (map.getSource("rails")) return;
  const before = map.getStyle()?.layers.find((layer) => layer.type === "symbol")?.id;
  map.addSource("rails", { type: "geojson", data: EMPTY });
  map.addSource("stations", { type: "geojson", data: EMPTY });
  map.addSource("journey", { type: "geojson", data: EMPTY });
  map.addLayer(
    {
      id: "rail-casing",
      type: "line",
      source: "rails",
      paint: {
        "line-color": "#fbf7ef",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.4, 13, 5.5, 16, 11],
        "line-opacity": 0.95,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    before,
  );
  map.addLayer(
    {
      id: "rail-color",
      type: "line",
      source: "rails",
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.3, 13, 3.1, 16, 6.5],
      },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    before,
  );
  map.addLayer(
    {
      id: "station-dots",
      type: "circle",
      source: "stations",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.4, 13, 3.6, 16, 5.5],
        "circle-color": "#fffaf3",
        "circle-stroke-width": 1.25,
        "circle-stroke-color": "#2c241c",
      },
    },
    before,
  );
  map.addLayer(
    {
      id: "station-labels",
      type: "symbol",
      source: "stations",
      minzoom: 11.4,
      layout: {
        "text-field": ["get", "name"],
        "text-font": labelFont(map),
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 12, 16, 16],
        "text-anchor": "top",
        "text-offset": [0, 0.7],
        "text-padding": 8,
        "text-max-width": 8,
        "text-allow-overlap": false,
        "text-optional": false,
      },
      paint: {
        "text-color": "#1c140c",
        "text-halo-color": "#fffaf3",
        "text-halo-width": 2.2,
      },
    },
    before,
  );
}

function labelFont(map: Map): string[] {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "symbol" || !("layout" in layer) || !layer.layout) continue;
    const font = layer.layout["text-font"];
    if (!Array.isArray(font)) continue;
    const names = font.filter((name): name is string => typeof name === "string");
    if (names.length !== font.length || names.length === 0) continue;
    if (names.some((name) => name.includes("Regular"))) return names;
  }
  return ["Noto Sans Regular"];
}

export default function MapView({ routes, trains, visible, selectedId, catchTrainId, catchLeg, trainStale, focus, journey, onSelect, onStation }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const catchMarkerRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const layerRef = useRef<TrainLayer | null>(null);
  const onSelectRef = useRef(onSelect);
  const onStationRef = useRef(onStation);
  useEffect(() => { onStationRef.current = onStation; }, [onStation]);
  const trainsRef = useRef(trains);
  const visibleRef = useRef(visible);
  const routesRef = useRef(routes);
  onSelectRef.current = onSelect;
  trainsRef.current = trains;
  visibleRef.current = visible;
  routesRef.current = routes;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const layer = new TrainLayer();
    layerRef.current = layer;
    const map = new Map({
      container,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: HOME_VIEW.center,
      zoom: HOME_VIEW.zoom,
      pitch: HOME_VIEW.pitch,
      bearing: HOME_VIEW.bearing,
      maxPitch: 68,
      minZoom: 9,
      maxZoom: 17.5,
      maxBounds: [
        [-1.05, 51.12],
        [0.65, 51.9],
      ],
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true },
      scrollZoom: true,
      cooperativeGestures: false,
      doubleClickZoom: true,
      touchZoomRotate: true,
    });
    container.style.width = "100%";
    container.style.height = "100%";
    map.scrollZoom.enable();
    map.scrollZoom.setWheelZoomRate(1 / 140);
    map.scrollZoom.setZoomRate(1 / 80);
    map.touchZoomRotate.enable();
    map.doubleClickZoom.enable();
    map.resize();
    map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
    mapRef.current = map;

    const stationAt = (x: number, y: number): StationHit | null => {
      if (!map.getLayer("station-dots")) return null;
      const features = map.queryRenderedFeatures([[x - 7, y - 7], [x + 7, y + 7]], {
        layers: ["station-dots", "station-labels"],
      });
      const feature = features.find((item) => item.geometry.type === "Point");
      if (!feature || feature.geometry.type !== "Point") return null;
      return {
        id: String(feature.properties.id),
        name: String(feature.properties.name),
        lng: feature.geometry.coordinates[0],
        lat: feature.geometry.coordinates[1],
      };
    };
    map.on("load", () => {
      map.resize();
      stylize(map);
      ensureNetwork(map);
      map.addLayer(layer);
      geojson(map, "rails")?.setData(railData(routesRef.current, visibleRef.current));
      geojson(map, "stations")?.setData(stationData(routesRef.current, visibleRef.current));
      layer.setTrains(trainsRef.current);
    });

    map.on("click", (event) => {
      const station = stationAt(event.point.x, event.point.y);
      if (station) {
        onStationRef.current(station);
        return;
      }
      const hit = layer.pick(event.point.x, event.point.y);
      onSelectRef.current(hit?.id ?? null);
    });
    map.on("mousemove", (event) => {
      const station = stationAt(event.point.x, event.point.y);
      const hit = station ? null : layer.pick(event.point.x, event.point.y);
      map.getCanvas().style.cursor = station || hit ? "pointer" : "";
      const tip = tipRef.current;
      if (!tip) return;
      tip.hidden = !station && !hit;
      if (tip.hidden) return;
      tip.style.transform = `translate(${event.point.x + 14}px, ${event.point.y + 16}px)`;
      tip.textContent = station ? `${station.name} · Click for station info` : `${hit!.lineName} to ${hit!.destination}`;
    });
    map.on("mouseout", () => {
      if (tipRef.current) tipRef.current.hidden = true;
    });

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);

    const onHome = () => {
      map.easeTo({
        center: HOME_VIEW.center,
        zoom: HOME_VIEW.zoom,
        pitch: HOME_VIEW.pitch,
        bearing: HOME_VIEW.bearing,
        duration: 800,
      });
    };
    window.addEventListener("railroom-home", onHome);

    return () => {
      resize.disconnect();
      window.removeEventListener("railroom-home", onHome);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getSource("rails")) return;
      geojson(map, "rails")?.setData(railData(routes, visible));
      geojson(map, "stations")?.setData(stationData(routes, visible));
    };
    apply();
    map.on("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [routes, visible]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!layer) return;
    layer.setTrains(trains);
    layer.setSelected(selectedId);
    map?.triggerRepaint();
  }, [trains, visible, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getSource("journey")) return;
      if (!map.getLayer("journey-casing")) {
        map.addLayer({ id: "journey-casing", type: "line", source: "journey", paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.95 }, layout: { "line-cap": "round", "line-join": "round" } });
        map.addLayer({ id: "journey-route", type: "line", source: "journey", filter: ["!=", ["get", "mode"], "walking"], paint: { "line-color": ["get", "color"], "line-width": 5 }, layout: { "line-cap": "round", "line-join": "round" } });
      }
      map.setPaintProperty("journey-route", "line-color", ["get", "color"]);
      map.setFilter("journey-route", ["!=", ["get", "mode"], "walking"]);
      if (!map.getLayer("journey-walk")) map.addLayer({ id: "journey-walk", type: "line", source: "journey", filter: ["==", ["get", "mode"], "walking"], paint: { "line-color": "#667085", "line-width": 4, "line-dasharray": [1, 2] } });
      const data = journeyRouteData(journey);
      geojson(map, "journey")?.setData(data);
      const points = data.features.flatMap((feature) => feature.geometry.coordinates as number[][]);
      if (points.length && !catchLeg) {
        const lngs = points.map((point) => point[0]); const lats = points.map((point) => point[1]);
        const wide = map.getCanvas().clientWidth > 800;
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: wide ? { left: 480, right: 80, top: 100, bottom: 80 } : 60, maxZoom: 14, duration: 900 });
      }
    };
    apply(); map.on("load", apply);
    return () => { map.off("load", apply); };
  }, [journey, catchLeg]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || catchLeg) return;
    map.easeTo({
      center: [focus.lng, focus.lat],
      zoom: focus.zoom,
      duration: 900,
    });
  }, [focus, catchLeg]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !catchLeg) return;
    const labels = journeyStationLabels(journey ?? { startDateTime: catchLeg.departureTime, arrivalDateTime: catchLeg.arrivalTime, duration: catchLeg.duration, legs: [catchLeg] });
    const endpoints = labels.map(label => label.point);
    const markers = labels.flatMap(({ point, role: label, kind, color }) => {
      if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return [];
      const element = document.createElement("div");
      element.className = `journey-station-marker ${kind}-station`;
      element.style.setProperty("--station-color", color);
      const role = document.createElement("span");
      role.textContent = label;
      const name = document.createElement("strong");
      name.textContent = shortStation(point.commonName);
      element.append(role, name);
      return [new Marker({ element, anchor: "bottom", offset: [0, -8] }).setLngLat([point.lon, point.lat]).addTo(map)];
    });
    const fit = () => {
      const points = endpoints.filter(point => Number.isFinite(point.lon) && Number.isFinite(point.lat)).map(point => [point.lon, point.lat]);
      points.push(...journeyRouteData(journey).features.flatMap(feature => feature.geometry.coordinates));
      if (focus) points.push([focus.lng, focus.lat]);
      if (!points.length) return;
      const lngs = points.map(point => point[0]); const lats = points.map(point => point[1]);
      const wide = map.getCanvas().clientWidth > 800;
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
        padding: wide ? { left: 160, right: 420, top: 190, bottom: 220 } : { left: 70, right: 70, top: 250, bottom: 340 },
        maxZoom: 14.2, duration: 900,
      });
    };
    fit(); map.on("load", fit);
    return () => { markers.forEach(marker => marker.remove()); map.off("load", fit); };
  }, [catchLeg, focus, journey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const train = trainsRef.current.find((item) => item.id === selectedId);
    if (!train) return;
    const bounds = map.getBounds();
    if (!bounds.contains([train.lng, train.lat])) {
      map.easeTo({
        center: [train.lng, train.lat],
        zoom: Math.max(map.getZoom(), 13),
        duration: 800,
      });
    }
  }, [selectedId, trains]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !catchTrainId) return;
    const update = () => {
      const marker = catchMarkerRef.current;
      const train = trainsRef.current.find(train => train.id === catchTrainId);
      const position = layerRef.current?.screenPosition(catchTrainId) ?? (train ? map.project([train.lng, train.lat]) : null);
      if (!marker) return;
      marker.style.visibility = position ? "visible" : "hidden";
      if (position) marker.style.transform = `translate(${position.x}px, ${position.y}px) translate(-50%, calc(-100% - 20px))`;
    };
    map.on("render", update); update();
    return () => { map.off("render", update); };
  }, [catchTrainId]);

  const markedTrain = trains.find(train => train.id === catchTrainId);
  const markerRoute = catchLeg ? `${shortStation(catchLeg.departurePoint.commonName)} → ${shortStation(catchLeg.arrivalPoint.commonName)}` : markedTrain ? `${markedTrain.lineName} → ${markedTrain.destination}` : "Your next departure";

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      {catchTrainId && <button ref={catchMarkerRef} type="button" className="catch-train-marker" onClick={() => onSelect(catchTrainId)} aria-label="Catch this train. Show live train details"><span aria-hidden="true">🚆</span><span><strong>{trainStale ? "Your train · last seen" : "Catch this train"}</strong><small>{trainStale ? "Waiting for the next live update" : `${markerRoute} · live location`}</small></span></button>}
      <div ref={tipRef} className="tip" hidden />
    </div>
  );
}
