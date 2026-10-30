export type LngLat = [number, number];

export type Stop = {
  id: string;
  name: string;
  norm: string;
  lat: number;
  lon: number;
};

export type Branch = {
  direction: string;
  stops: Stop[];
  paths: LngLat[][];
};

export type LineRoute = {
  id: string;
  name: string;
  mode: string;
  color: string;
  branches: Branch[];
};

export type Arrival = {
  lineId: string;
  lineName: string;
  vehicleId: string;
  naptanId: string;
  stationName: string;
  platformName: string;
  destinationName: string;
  towards: string;
  currentLocation: string;
  direction: string;
  timeToStation: number;
  expectedArrival: string;
};

export type UpcomingStop = {
  naptanId: string;
  stationName: string;
  platformName: string;
  timeToStation: number;
  expectedArrival: string;
};

export type Train = {
  id: string;
  vehicleId: string;
  lineId: string;
  lineName: string;
  mode: string;
  color: string;
  destination: string;
  currentLocation: string;
  pathKey: string;
  path: LngLat[];
  fraction: number;
  lng: number;
  lat: number;
  bearing: number;
  stops: UpcomingStop[];
};
