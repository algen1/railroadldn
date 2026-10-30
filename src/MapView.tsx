import { useEffect, useRef } from "react";
import { GeoJSONSource, Map, NavigationControl, setWorkerUrl } from "maplibre-gl";
import maplibreWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(maplibreWorker);
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
  focus: MapFocus | null;
  onSelect: (id: string | null) => void;
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
          properties: { name: shortStation(stop.name) },
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

export default function MapView({ routes, trains, visible, selectedId, focus, onSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const layerRef = useRef<TrainLayer | null>(null);
  const onSelectRef = useRef(onSelect);
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

    let down: { x: number; y: number } | null = null;
    map.on("load", () => {
      map.resize();
      stylize(map);
      ensureNetwork(map);
      map.addLayer(layer);
      geojson(map, "rails")?.setData(railData(routesRef.current, visibleRef.current));
      geojson(map, "stations")?.setData(stationData(routesRef.current, visibleRef.current));
      layer.setTrains(trainsRef.current.filter((train) => visibleRef.current.has(train.lineId)));
    });

    map.on("mousedown", (event) => {
      down = { x: event.point.x, y: event.point.y };
    });
    map.on("click", (event) => {
      if (!down) return;
      const moved = (event.point.x - down.x) ** 2 + (event.point.y - down.y) ** 2;
      if (moved > 16) return;
      const hit = layer.pick(event.point.x, event.point.y);
      onSelectRef.current(hit?.id ?? null);
    });
    map.on("mousemove", (event) => {
      const hit = layer.pick(event.point.x, event.point.y);
      map.getCanvas().style.cursor = hit ? "pointer" : "";
      const tip = tipRef.current;
      if (!tip) return;
      if (!hit) {
        tip.hidden = true;
        return;
      }
      tip.hidden = false;
      tip.style.transform = `translate(${event.point.x + 14}px, ${event.point.y + 16}px)`;
      if (tip.dataset.id !== hit.id) {
        tip.dataset.id = hit.id;
        tip.textContent = `${hit.lineName} to ${hit.destination}`;
      }
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
    layer.setTrains(trains.filter((train) => visible.has(train.lineId)));
    layer.setSelected(selectedId);
    map?.triggerRepaint();
  }, [trains, visible, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.easeTo({
      center: [focus.lng, focus.lat],
      zoom: focus.zoom,
      duration: 900,
    });
  }, [focus]);

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
  }, [selectedId]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <div ref={tipRef} className="tip" hidden />
    </div>
  );
}
