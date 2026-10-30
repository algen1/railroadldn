import { Map as MlMap, MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput } from "maplibre-gl";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LINES } from "./lines";
import { haversine, pointAlong } from "./placeTrain";
import type { Train } from "./types";

const CAPACITY = 180;
const PICK_RADIUS = 28;

export type TrainPick = {
  id: string;
  lineName: string;
  destination: string;
  x: number;
  y: number;
};

type Motion = {
  pathKey: string;
  path: Train["path"];
  fraction: number;
  target: number;
  lng: number;
  lat: number;
  bearing: number;
};

type ScreenTrain = TrainPick & { lng: number; lat: number };

type LineBatch = {
  body: THREE.InstancedMesh;
  glass: THREE.InstancedMesh;
  roof: THREE.InstancedMesh;
  lamp: THREE.InstancedMesh;
  disc: THREE.InstancedMesh;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts);
  if (!geometry) throw new Error("Could not build the train model");
  for (const part of parts) part.dispose();
  return geometry;
}

const CARS = 3;
const CAR_GAP = 0.035;
const CAR_LENGTH = (1 - CAR_GAP * (CARS - 1)) / CARS;

function carCenter(index: number): number {
  return -0.5 + CAR_LENGTH / 2 + index * (CAR_LENGTH + CAR_GAP);
}

function buildBody(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < CARS; index += 1) {
    const body = new RoundedBoxGeometry(CAR_LENGTH, 0.19, 0.23, 3, 0.045);
    body.translate(carCenter(index), 0.12, 0);
    parts.push(body);
  }
  return merged(parts);
}

function buildRoof(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < CARS; index += 1) {
    const roof = new RoundedBoxGeometry(CAR_LENGTH * 0.86, 0.045, 0.19, 2, 0.02);
    roof.translate(carCenter(index), 0.215, 0);
    parts.push(roof);
  }
  return merged(parts);
}

function buildGlass(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < CARS; index += 1) {
    for (const side of [-1, 1]) {
      for (let window = 0; window < 3; window += 1) {
        const pane = new THREE.BoxGeometry(0.055, 0.062, 0.008);
        pane.translate(carCenter(index) + (window - 1) * 0.075, 0.15, side * 0.115);
        parts.push(pane);
      }
    }
  }
  const windscreen = new THREE.BoxGeometry(0.009, 0.075, 0.145);
  windscreen.translate(0.5, 0.145, 0);
  parts.push(windscreen);
  return merged(parts);
}

function buildLamp(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const lamp = new THREE.SphereGeometry(0.019, 8, 6);
    lamp.translate(0.495, 0.075, side * 0.073);
    parts.push(lamp);
  }
  return merged(parts);
}

function buildDisc(): THREE.BufferGeometry {
  const disc = new THREE.RingGeometry(0.78, 1, 40);
  disc.rotateX(Math.PI / 2);
  return disc;
}

export class TrainLayer implements CustomLayerInterface {
  id = "trains-3d";
  type = "custom" as const;
  renderingMode = "3d" as const;

  private map: MlMap | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.Camera | null = null;
  private scene = new THREE.Scene();
  private bodyGeo: THREE.BufferGeometry | null = null;
  private roofGeo: THREE.BufferGeometry | null = null;
  private glassGeo: THREE.BufferGeometry | null = null;
  private lampGeo: THREE.BufferGeometry | null = null;
  private discGeo: THREE.BufferGeometry | null = null;
  private batches = new Map<string, LineBatch>();
  private motions = new Map<string, Motion>();
  private trains: Train[] = [];
  private selectedId: string | null = null;
  private screen: ScreenTrain[] = [];
  private last = performance.now();
  private readonly reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly translation = new THREE.Matrix4();
  private readonly mercatorScale = new THREE.Matrix4();
  private readonly rotX = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  private readonly rotY = new THREE.Matrix4();
  private readonly size = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0xd8c7ae, 0.9));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.38));
    const sun = new THREE.DirectionalLight(0xfffaf3, 1.15);
    sun.position.set(0.35, -0.25, 1);
    this.scene.add(sun);
  }

  onAdd(map: MlMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.camera = new THREE.Camera();
    this.camera.matrixAutoUpdate = false;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    const bodyGeo = buildBody();
    const glassGeo = buildGlass();
    const roofGeo = buildRoof();
    this.roofGeo = roofGeo;
    const lampGeo = buildLamp();
    const discGeo = buildDisc();
    this.bodyGeo = bodyGeo;
    this.glassGeo = glassGeo;
    this.lampGeo = lampGeo;
    this.discGeo = discGeo;
    for (const line of LINES) {
      const bodyMaterial = new THREE.MeshBasicMaterial({
        color: line.color,
        side: THREE.DoubleSide,
      });
      const glassMaterial = new THREE.MeshBasicMaterial({
        color: "#12283b",
        side: THREE.DoubleSide,
      });
      const roofMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide });
      const lampMaterial = new THREE.MeshBasicMaterial({
        color: "#ffe7a0",
        side: THREE.DoubleSide,
      });
      const discMaterial = new THREE.MeshBasicMaterial({
        color: line.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      });
      const body = new THREE.InstancedMesh(bodyGeo, bodyMaterial, CAPACITY);
      const glass = new THREE.InstancedMesh(glassGeo, glassMaterial, CAPACITY);
      const roof = new THREE.InstancedMesh(roofGeo, roofMaterial, CAPACITY);
      const lamp = new THREE.InstancedMesh(lampGeo, lampMaterial, CAPACITY);
      const disc = new THREE.InstancedMesh(discGeo, discMaterial, CAPACITY);
      for (const mesh of [disc, body, glass, roof, lamp]) {
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.scene.add(mesh);
      }
      this.batches.set(line.id, { body, glass, roof, lamp, disc });
    }
    this.last = performance.now();
  }

  onRemove(): void {
    for (const batch of this.batches.values()) {
      this.scene.remove(batch.body, batch.glass, batch.roof, batch.lamp, batch.disc);
      (batch.roof.material as THREE.Material).dispose();
      (batch.body.material as THREE.Material).dispose();
      (batch.glass.material as THREE.Material).dispose();
      (batch.lamp.material as THREE.Material).dispose();
      (batch.disc.material as THREE.Material).dispose();
    }
    this.batches.clear();
    this.roofGeo?.dispose();
    this.roofGeo = null;
    this.bodyGeo?.dispose();
    this.glassGeo?.dispose();
    this.lampGeo?.dispose();
    this.discGeo?.dispose();
    this.bodyGeo = null;
    this.glassGeo = null;
    this.lampGeo = null;
    this.discGeo = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  setTrains(trains: Train[]): void {
    this.trains = trains;
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  pick(x: number, y: number): TrainPick | null {
    let best: TrainPick | null = null;
    let bestDistance = PICK_RADIUS * PICK_RADIUS;
    for (const train of this.screen) {
      const dx = train.x - x;
      const dy = train.y - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = train;
      }
    }
    return best;
  }

  screenPosition(id: string): { x: number; y: number } | undefined {
    return this.screen.find((train) => train.id === id);
  }

  sampleNearCenter(): TrainPick | null {
    const map = this.map;
    if (!map || this.screen.length === 0) return null;
    const canvas = map.getCanvas();
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;
    let best: ScreenTrain | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const train of this.screen) {
      if (train.x < 0 || train.y < 0 || train.x > canvas.clientWidth || train.y > canvas.clientHeight) {
        continue;
      }
      const distance = (train.x - centerX) ** 2 + (train.y - centerY) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = train;
      }
    }
    return best;
  }

  render(_gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.renderer || !this.camera || !this.map) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.writeInstances();

    this.camera.matrix.identity();
    this.camera.matrixWorld.identity();
    this.camera.matrixWorldInverse.identity();
    this.camera.projectionMatrix.fromArray(options.defaultProjectionData.mainMatrix);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (!document.hidden) this.map.triggerRepaint();
  }

  private step(dt: number): void {
    const seen = new Set<string>();
    for (const train of this.trains) {
      seen.add(train.id);
      const current = this.motions.get(train.id);
      if (!current || current.pathKey !== train.pathKey) {
        const jumped = current
          ? haversine(current.lng, current.lat, train.lng, train.lat) > 700
          : true;
        const fraction = !current || jumped || this.reduceMotion ? train.fraction : current.fraction;
        const point = pointAlong(train.path, fraction);
        this.motions.set(train.id, {
          pathKey: train.pathKey,
          path: train.path,
          fraction,
          target: train.fraction,
          lng: point.lng,
          lat: point.lat,
          bearing: point.bearing,
        });
        continue;
      }
      current.path = train.path;
      current.target = train.fraction;
      if (this.reduceMotion) {
        current.fraction = train.fraction;
      } else {
        const gap = current.target - current.fraction;
        const creep = dt / 140;
        if (gap > 0) current.fraction = Math.min(current.target, current.fraction + Math.max(creep, gap * dt * 1.5));
        else current.fraction += gap * Math.min(1, dt * 2);
      }
      const point = pointAlong(current.path, current.fraction);
      current.lng = point.lng;
      current.lat = point.lat;
      current.bearing = point.bearing;
    }
    for (const id of this.motions.keys()) {
      if (!seen.has(id)) this.motions.delete(id);
    }
  }

  private metersPerPixel(lat: number): number {
    const zoom = this.map?.getZoom() ?? 12;
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  }

  private lengthFor(lat: number): number {
    return clamp(26 * this.metersPerPixel(lat), 28, 900);
  }

  private discRadius(lat: number): number {
    return clamp(15 * this.metersPerPixel(lat), 17, 520);
  }

  private chooseVisible(): { train: Train; motion: Motion; x: number; y: number }[] {
    const map = this.map;
    if (!map) return [];
    const zoom = map.getZoom();
    const gap = zoom >= 14.6 ? 0 : zoom >= 13.2 ? 16 : 26;
    const items: { train: Train; motion: Motion; x: number; y: number }[] = [];
    for (const train of this.trains) {
      const motion = this.motions.get(train.id);
      if (!motion) continue;
      const point = map.project([motion.lng, motion.lat]);
      items.push({ train, motion, x: point.x, y: point.y });
    }
    items.sort((a, b) => Number(b.train.id === this.selectedId) - Number(a.train.id === this.selectedId));
    const kept: typeof items = [];
    for (const item of items) {
      const selected = item.train.id === this.selectedId;
      if (!selected && gap > 0) {
        const blocked = kept.some((other) => {
          const dx = other.x - item.x;
          const dy = other.y - item.y;
          return dx * dx + dy * dy < gap * gap;
        });
        if (blocked) continue;
      }
      kept.push(item);
    }
    this.screen = kept.map((item) => ({
      id: item.train.id,
      lineName: item.train.lineName,
      destination: item.train.destination,
      x: item.x,
      y: item.y,
      lng: item.motion.lng,
      lat: item.motion.lat,
    }));
    return kept;
  }

  private compose(lng: number, lat: number, bearing: number, length: number, altitude: number): THREE.Matrix4 {
    const mercator = MercatorCoordinate.fromLngLat([lng, lat], altitude);
    const unit = mercator.meterInMercatorCoordinateUnits();
    this.translation.makeTranslation(mercator.x, mercator.y, mercator.z ?? 0);
    this.mercatorScale.makeScale(unit, -unit, unit);
    this.rotY.makeRotationY(Math.PI / 2 - bearing);
    this.size.makeScale(length, length, length);
    return this.matrix
      .copy(this.translation)
      .multiply(this.mercatorScale)
      .multiply(this.rotX)
      .multiply(this.rotY)
      .multiply(this.size);
  }

  private writeInstances(): void {
    const visible = this.chooseVisible();
    const grouped = new Map<string, { train: Train; motion: Motion }[]>();
    for (const item of visible) {
      const list = grouped.get(item.train.lineId);
      const entry = { train: item.train, motion: item.motion };
      if (list) list.push(entry);
      else grouped.set(item.train.lineId, [entry]);
    }
    for (const [lineId, batch] of this.batches) {
      const entries = (grouped.get(lineId) ?? []).slice(0, CAPACITY);
      batch.body.count = entries.length;
      batch.glass.count = entries.length;
      batch.roof.count = entries.length;
      batch.lamp.count = entries.length;
      batch.disc.count = entries.length;
      entries.forEach((entry, index) => {
        const selected = entry.train.id === this.selectedId;
        const emphasis = selected ? 1.2 : 1;
        const length = this.lengthFor(entry.motion.lat) * emphasis;
        const matrix = this.compose(entry.motion.lng, entry.motion.lat, entry.motion.bearing, length, 6);
        batch.body.setMatrixAt(index, matrix);
        batch.glass.setMatrixAt(index, matrix);
        batch.roof.setMatrixAt(index, matrix);
        batch.lamp.setMatrixAt(index, matrix);
        const marker = this.compose(
          entry.motion.lng,
          entry.motion.lat,
          0,
          this.discRadius(entry.motion.lat) * emphasis,
          2,
        );
        batch.disc.setMatrixAt(index, marker);
      });
      batch.body.instanceMatrix.needsUpdate = true;
      batch.glass.instanceMatrix.needsUpdate = true;
      batch.roof.instanceMatrix.needsUpdate = true;
      batch.lamp.instanceMatrix.needsUpdate = true;
      batch.disc.instanceMatrix.needsUpdate = true;
    }
  }
}
