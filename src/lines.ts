export type LineMode = "Tube" | "Elizabeth line" | "Overground" | "DLR";

export type LineMeta = {
  id: string;
  name: string;
  mode: LineMode;
  color: string;
};

export const LINES: LineMeta[] = [
  { id: "bakerloo", name: "Bakerloo", mode: "Tube", color: "#B36305" },
  { id: "central", name: "Central", mode: "Tube", color: "#E32017" },
  { id: "circle", name: "Circle", mode: "Tube", color: "#FFD300" },
  { id: "district", name: "District", mode: "Tube", color: "#00782A" },
  { id: "hammersmith-city", name: "Hammersmith & City", mode: "Tube", color: "#F3A9BB" },
  { id: "jubilee", name: "Jubilee", mode: "Tube", color: "#A0A5A9" },
  { id: "metropolitan", name: "Metropolitan", mode: "Tube", color: "#9B0056" },
  { id: "northern", name: "Northern", mode: "Tube", color: "#000000" },
  { id: "piccadilly", name: "Piccadilly", mode: "Tube", color: "#003688" },
  { id: "victoria", name: "Victoria", mode: "Tube", color: "#0098D4" },
  { id: "waterloo-city", name: "Waterloo & City", mode: "Tube", color: "#95CDBA" },
  { id: "elizabeth", name: "Elizabeth line", mode: "Elizabeth line", color: "#6950A1" },
  { id: "liberty", name: "Liberty", mode: "Overground", color: "#5D6061" },
  { id: "lioness", name: "Lioness", mode: "Overground", color: "#FAA61A" },
  { id: "mildmay", name: "Mildmay", mode: "Overground", color: "#0077AD" },
  { id: "suffragette", name: "Suffragette", mode: "Overground", color: "#5BBD72" },
  { id: "weaver", name: "Weaver", mode: "Overground", color: "#823A62" },
  { id: "windrush", name: "Windrush", mode: "Overground", color: "#ED1B00" },
  { id: "dlr", name: "DLR", mode: "DLR", color: "#00A4A7" },
];

export const MODES: LineMode[] = ["Tube", "Elizabeth line", "Overground", "DLR"];

const byId = new Map(LINES.map((line) => [line.id, line]));

export function lineMeta(id: string): LineMeta {
  return byId.get(id) ?? { id, name: id, mode: "Tube", color: "#241c14" };
}

export const HOME_VIEW = {
  center: [-0.12, 51.507] as [number, number],
  zoom: 11.7,
  pitch: 50,
  bearing: -16,
};
