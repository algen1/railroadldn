import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';

const dir = await mkdtemp(join(tmpdir(), 'railroom-test-'));
try {
  for (const name of ['format', 'journey', 'placeTrain', 'lines', 'journeyMap']) {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
    const { code: outputText } = await transformWithOxc(source, `${name}.ts`);
    await writeFile(join(dir, `${name}.mjs`), outputText.replace('"./format"', '"./format.mjs"').replace('"./lines"', '"./lines.mjs"'));
  }
  const { londonTimestamp, journeyClock, londonInput, liveTrainForLeg, eligibleJourneys, nextLiveTrainForJourney } = await import(pathToFileURL(join(dir, 'journey.mjs')));
  assert.equal(londonTimestamp('2026-10-30T09:00:00'), Date.parse('2026-10-30T09:00:00Z'));
  assert.equal(londonTimestamp('2026-07-01T09:00:00'), Date.parse('2026-07-01T08:00:00Z'));
  assert.equal(londonTimestamp('2026-03-29T03:00:00'), Date.parse('2026-03-29T02:00:00Z'));
  assert.equal(londonTimestamp('2026-10-25T03:00:00'), Date.parse('2026-10-25T03:00:00Z'));
  assert.equal(journeyClock('2026-07-01T09:00:00'), '09:00');
  assert.deepEqual(londonInput(new Date('2026-07-01T23:30:00Z')), { date: '2026-07-02', time: '00:30' });
  const now = Date.parse('2026-10-30T08:00:00Z');
  const leg = { departureTime: '2026-10-30T08:05:00', arrivalTime: '2026-10-30T08:35:00', departurePoint: { naptanId: 'origin' }, arrivalPoint: { naptanId: 'destination' }, routeOptions: [{ lineIdentifier: { id: 'central' } }] };
  const train = { id: 'train1', lineId: 'central', stops: [{ naptanId: 'origin', expectedArrival: '2026-10-30T08:05:30Z' }, { naptanId: 'destination', expectedArrival: '2026-10-30T08:34:30Z' }] };
  assert.equal(liveTrainForLeg(leg, [train], now), train);
  assert.equal(liveTrainForLeg(leg, [{ ...train, lineId: 'district' }], now), null);
  assert.equal(liveTrainForLeg(leg, [{ ...train, stops: [train.stops[0], { ...train.stops[1], expectedArrival: '2026-10-30T08:01:00Z' }] }], now), null);
  assert.equal(liveTrainForLeg(leg, [{ ...train, stops: [train.stops[0]] }], now), null);
  assert.equal(liveTrainForLeg(leg, [train], now + 10 * 60000), null);
  assert.equal(liveTrainForLeg(leg, [train], now - 60 * 60000), null);
  assert.equal(liveTrainForLeg(leg, [{ ...train, stops: [train.stops[0], { ...train.stops[1], expectedArrival: '2026-10-30T08:36:00Z' }] }], now), null);
  const distant = { ...train, stops: [{ ...train.stops[0], expectedArrival: '2026-10-30T08:10:00Z' }, train.stops[1]] };
  assert.equal(liveTrainForLeg(leg, [distant], now), null);
  const journey = { startDateTime: leg.departureTime, arrivalDateTime: leg.arrivalTime, duration: 30, legs: [{ ...leg, mode: { id: 'tube' }, duration: 30 }] };
  const earlier = { ...train, id: 'earlier', stops: [{ ...train.stops[0], expectedArrival: '2026-10-30T08:02:00Z' }, { ...train.stops[1], expectedArrival: '2026-10-30T08:32:00Z' }] };
  assert.equal(nextLiveTrainForJourney(journey, [train, earlier], now)?.train.id, 'earlier');
  assert.equal(nextLiveTrainForJourney(journey, [{ ...train, lineId: 'district' }], now), null);
  assert.equal(nextLiveTrainForJourney(journey, [{ ...train, stops: [train.stops[0]] }], now), null);
  assert.equal(nextLiveTrainForJourney(journey, [{ ...train, stops: [train.stops[0], { ...train.stops[1], expectedArrival: '2026-10-30T08:01:00Z' }] }], now), null);
  const late = { ...train, id: 'late', stops: [{ ...train.stops[0], expectedArrival: '2026-10-30T08:10:00Z' }, { ...train.stops[1], expectedArrival: '2026-10-30T08:40:00Z' }] };
  // Leave-now direct trips can use a later live train; arrival deadlines remain strict.
  assert.equal(nextLiveTrainForJourney(journey, [late], now)?.train.id, 'late');
  assert.equal(liveTrainForLeg(leg, [late], now), null);
  const connection = { ...journey, legs: [journey.legs[0], { ...journey.legs[0], departureTime: '2026-10-30T08:40:00', mode: { id: 'tube' } }] };
  assert.equal(nextLiveTrainForJourney(connection, [late], now), null);
  assert.equal(nextLiveTrainForJourney(connection, [train], now)?.train.id, 'train1');
  const delayedClosest = { ...earlier, stops: [earlier.stops[0], { ...earlier.stops[1], expectedArrival: '2026-10-30T08:36:00Z' }] };
  assert.equal(nextLiveTrainForJourney(connection, [train, delayedClosest], now)?.train.id, 'earlier', 'closest service can still make the connection despite a later-than-scheduled arrival');
  const walking = { ...journey.legs[0], mode: { id: 'walking' }, duration: 4 };
  assert.equal(nextLiveTrainForJourney({ ...journey, legs: [walking, journey.legs[0]] }, [earlier, train], now)?.train.id, 'train1');
  assert.equal(nextLiveTrainForJourney({ ...journey, legs: [walking] }, [train], now), null);
  assert.equal(nextLiveTrainForJourney(journey, [earlier], now + 3 * 60000), null);
  assert.equal(nextLiveTrainForJourney(journey, [train], now - 60 * 60000), null);
  // Ruislip Gardens → North Acton: board the soonest eastbound service,
  // regardless of feed order or how close another train appears on the map.
  const ruislipLeg = { ...journey.legs[0], departurePoint: { naptanId: 'ruislip-gardens' }, arrivalPoint: { naptanId: 'north-acton' } };
  const ruislipJourney = { ...journey, legs: [ruislipLeg] };
  const service = (id, from, to) => ({ ...train, id, stops: [
    { naptanId: 'ruislip-gardens', expectedArrival: new Date(now + from * 60000).toISOString() },
    { naptanId: 'north-acton', expectedArrival: new Date(now + to * 60000).toISOString() },
  ] });
  const nextEastbound = service('next-eastbound', 2, 16);
  const laterEastbound = service('later-eastbound', 6, 20);
  const westbound = service('westbound', 1, -12);
  const alreadyGone = service('already-gone', -1, 13);
  assert.equal(nextLiveTrainForJourney(ruislipJourney, [laterEastbound, westbound, alreadyGone, nextEastbound], now)?.train.id, 'next-eastbound');
  assert.equal(nextLiveTrainForJourney(ruislipJourney, [nextEastbound, laterEastbound], now + 3 * 60000)?.train.id, 'later-eastbound');
  const walkJourney = { ...journey, legs: [walking, journey.legs[0]] };
  assert.equal(nextLiveTrainForJourney(walkJourney, [train], now + 2 * 60000, now)?.train.id, 'train1', 'elapsed walking time is not restarted on every feed refresh');
  const future = { ...journey, startDateTime: '2026-10-30T08:10:00', arrivalDateTime: '2026-10-30T08:40:00' };
  const past = { ...journey, startDateTime: '2026-10-30T07:55:00' };
  assert.deepEqual(eligibleJourneys([future, past, journey], 'now', now, 0), [journey, future]);
  assert.deepEqual(eligibleJourneys([journey, future, past], 'arrive', now, Date.parse('2026-10-30T08:45:00Z')), [future, journey]);
  assert.deepEqual(eligibleJourneys([future], 'arrive', now, Date.parse('2026-10-30T08:35:00Z')), []);
  const { placeTrains } = await import(pathToFileURL(join(dir, 'placeTrain.mjs')));
  const stops = Array.from({ length: 9 }, (_, i) => ({ id: `stop${i}`, name: `Test ${i}`, norm: `test ${i}`, lat: 51.5, lon: -0.1 + i * 0.002 }));
  const route = { id: 'central', name: 'Central', mode: 'Tube', color: '#E32017', branches: [{ direction: 'outbound', stops, paths: [stops.map((stop) => [stop.lon, stop.lat])] }] };
  const arrivals = stops.slice(1).map((stop, i) => ({ lineId: 'central', lineName: 'Central', vehicleId: '123', naptanId: stop.id, stationName: stop.name, platformName: 'Eastbound', destinationName: 'Test 7', towards: 'Test 7', currentLocation: 'At Test 0', direction: 'outbound', timeToStation: 60 + i * 120, expectedArrival: new Date(now + (60 + i * 120) * 1000).toISOString() }));
  assert.equal(placeTrains([route], arrivals)[0].stops.length, 8);
  const { journeyRouteData, journeyStationLabels } = await import(pathToFileURL(join(dir, 'journeyMap.mjs')));
  const point = (id, name, lat, lon) => ({ naptanId: id, commonName: name, lat, lon });
  const start = point('edgware', 'Edgware Road', 51.52, -0.17);
  const change = point('oxford', 'Oxford Circus', 51.515, -0.14);
  const finish = point('brixton', 'Brixton', 51.46, -0.115);
  const first = { ...journey.legs[0], departurePoint: start, arrivalPoint: change, routeOptions: [{ lineIdentifier: { id: 'bakerloo' } }], path: { lineString: JSON.stringify([[51.52,-0.17],[51.515,-0.14]]) } };
  const second = { ...first, departurePoint: change, arrivalPoint: finish, routeOptions: [{ lineIdentifier: { id: 'victoria' } }], path: { lineString: JSON.stringify([[51.515,-0.14],[51.46,-0.115]]) } };
  const transferJourney = { ...journey, legs: [first, second] };
  assert.deepEqual(journeyRouteData(transferJourney).features.map(f => f.properties.color), ['#B36305', '#0098D4']);
  assert.deepEqual(journeyRouteData(transferJourney).features[0].geometry.coordinates[0], [-0.17, 51.52]);
  assert.deepEqual(journeyStationLabels(transferJourney).map(s => [s.point.naptanId, s.role]), [['edgware','Board here'], ['oxford','Change to Victoria'], ['brixton','Get off here']]);
  assert.equal(journeyStationLabels({ ...journey, legs: [first] }).length, 2);
  assert.equal(journeyRouteData({ ...journey, legs: [{ ...first, path: { lineString: 'invalid' } }] }).features.length, 0);
  console.log('Journey checks passed: London time, DST, arrival deadlines, leave-now ordering, earliest live train, direction, walking time, transfers, missing predictions, and full stop retention.');
} finally { await rm(dir, { recursive: true, force: true }); }
