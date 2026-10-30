import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';

// Exercise the real component event handlers with a small hook/element harness.
// This checks the UI-to-map contract without requiring WebGL or a browser.
const dir = await mkdtemp(join(tmpdir(), 'railroom-selection-'));
try {
  await writeFile(join(dir, 'react.mjs'), `
    export const Fragment = Symbol("Fragment");
    export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;
    export function useState(initial) { const h = globalThis.railroomHooks; const i = h.cursor++; if (!(i in h.values)) h.values[i] = typeof initial === 'function' ? initial() : initial; return [h.values[i], value => { h.values[i] = typeof value === 'function' ? value(h.values[i]) : value; }]; }
    export const useMemo = fn => fn(); export const useEffect = () => {};
    export const useRef = value => useState(() => ({ current: value }))[0];
  `);
  await writeFile(join(dir, 'MapView.mjs'), 'export default function MapView() {}');
  await writeFile(join(dir, 'useNetwork.mjs'), 'export const useNetwork = () => globalThis.railroomFixture.network;');
  await writeFile(join(dir, 'tfl.mjs'), 'export const planJourney = async () => globalThis.railroomFixture.journeys;');
  for (const name of ['App', 'MainMenu', 'journey', 'format', 'lines']) {
    const ext = ['App', 'MainMenu'].includes(name) ? 'tsx' : 'ts';
    const source = await readFile(new URL(`../src/${name}.${ext}`, import.meta.url), 'utf8');
    const result = await transformWithOxc(source, `${name}.${ext}`, { jsx: { runtime: 'automatic' } });
    const code = result.code.replaceAll('"react/jsx-runtime"', '"./react.mjs"').replaceAll('"react"', '"./react.mjs"').replace(/from "\.\/([^".]+)"/g, 'from "./$1.mjs"');
    await writeFile(join(dir, `${name}.mjs`), code);
  }
  const { default: App } = await import(pathToFileURL(join(dir, 'App.mjs')));
  const { default: MainMenu } = await import(pathToFileURL(join(dir, 'MainMenu.mjs')));
  const { default: MapView } = await import(pathToFileURL(join(dir, 'MapView.mjs')));
  const now = Date.now();
  const time = minutes => new Date(now + minutes * 60000).toISOString();
  const from = { id: 'south-ruislip', name: 'South Ruislip', lat: 51.556, lon: -0.398 };
  const to = { id: 'north-acton', name: 'North Acton', lat: 51.523, lon: -0.26 };
  const stops = [from, to].map((stop, i) => ({ naptanId: stop.id, stationName: stop.name, expectedArrival: time(i ? 18 : 5), timeToStation: (i ? 18 : 5) * 60 }));
  const train = { id: 'central:123', lineId: 'central', lineName: 'Central', color: '#e32017', lng: -0.41, lat: 51.56, stops, destination: 'Epping' };
  const journey = { startDateTime: time(5), arrivalDateTime: time(18), duration: 13, legs: [{ mode: { id: 'tube' }, departurePoint: { naptanId: from.id, commonName: from.name }, arrivalPoint: { naptanId: to.id, commonName: to.name }, departureTime: time(5), arrivalTime: time(18), duration: 13, instruction: { summary: 'Central line eastbound' }, routeOptions: [{ lineIdentifier: { id: 'central' } }] }] };
  globalThis.railroomFixture = { journeys: [journey], network: { routes: [{ id: 'central', name: 'Central', color: '#e32017', branches: [{ stops: [from, to] }] }], trains: [train, { ...train, id: 'central:456' }, { ...train, id: 'district:789', lineId: 'district' }], status: 'live', updatedAt: new Date(now) } };
  function render(component, props, hooks) { hooks.cursor = 0; globalThis.railroomHooks = hooks; return component(props); }
  function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
  for (const control of ['journey-option', 'departure-summary-time', 'departure-time', 'live-catch']) {
    const appHooks = { values: [] }; const menuHooks = { values: [] };
    const app = () => render(App, {}, appHooks);
    const menu = () => render(MainMenu, nodes(app()).find(n => n.type === MainMenu).props, menuHooks);
    let tree = menu();
    nodes(tree).find(n => n.props?.label === 'From').props.onChange('South Ruislip');
    tree = menu(); nodes(tree).find(n => n.props?.label === 'To').props.onChange('North Acton');
    tree = menu(); await nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    tree = menu();
    const waitingMap = nodes(app()).find(n => n.type === MapView).props;
    assert.equal(waitingMap.trains.length, 0, 'search hides all trains while waiting for an exact live match');
    assert.equal(waitingMap.visible.size, 0, 'search hides lines immediately');
    assert.equal(waitingMap.journey, journey);
    nodes(tree).find(n => n.props?.className?.split(' ').includes(control)).props.onClick();
    let rendered = app(); let map = nodes(rendered).find(n => n.type === MapView).props;
    assert.deepEqual(map.trains.map(t => t.id), [train.id], `${control}: only the clicked train reaches the renderer`);
    assert.equal(map.selectedId, train.id); assert.equal(map.catchTrainId, train.id);
    assert.equal(map.visible.size, 0); assert.equal(map.journey, journey);
    assert.equal(nodes(rendered).find(n => n.type === MainMenu).props.open, false);
    map.onSelect(null); map = nodes(app()).find(n => n.type === MapView).props;
    assert.deepEqual(map.trains.map(t => t.id), [train.id], 'empty-map click keeps isolation');
    // Feed refresh must not substitute another train if the selected train disappears.
    const original = globalThis.railroomFixture.network.trains;
    globalThis.railroomFixture.network.trains = original.filter(t => t.id !== train.id);
    map = nodes(app()).find(n => n.type === MapView).props;
    assert.deepEqual(map.trains.map(t => t.id), [train.id]); assert.equal(map.visible.size, 0);
    assert.equal(map.trainStale, true, 'missing feed retains the exact train, clearly marked as last reported');
    map.onStation({ id: from.id, name: from.name, lat: from.lat, lng: from.lon });
    map = nodes(app()).find(n => n.type === MapView).props;
    assert.deepEqual(map.trains.map(t => t.id), [train.id], 'station inspection must not restore all trains');
    assert.equal(map.visible.size, 0);
    globalThis.railroomFixture.network.trains = original;
  }
  // A direct click on a 3D train must also isolate and identify it.
  const directHooks = { values: [] };
  let direct = nodes(render(App, {}, directHooks)).find(n => n.type === MapView).props;
  direct.onSelect(train.id);
  direct = nodes(render(App, {}, directHooks)).find(n => n.type === MapView).props;
  assert.equal(direct.trains.length, 3, 'arbitrary map selection must not claim a journey match');
  assert.equal(direct.catchTrainId, null);
  assert.equal(direct.selectedId, train.id);
  assert.ok(direct.visible.size > 0);
  console.log('Selection checks passed: option time, summary time, live departure and live card isolate one train, select its marker, hide lines, close planner, and retain isolation across map clicks and missing feed updates.');
} finally { delete globalThis.railroomHooks; delete globalThis.railroomFixture; await rm(dir, { recursive: true, force: true }); }
