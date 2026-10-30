import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';

const dir = await mkdtemp(join(tmpdir(), 'railroom-test-'));
try {
  for (const name of ['format', 'journey', 'placeTrain']) {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
    const { code: outputText } = await transformWithOxc(source, `${name}.ts`);
    await writeFile(join(dir, `${name}.mjs`), outputText.replace('"./format"', '"./format.mjs"'));
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
  const walking = { ...journey.legs[0], mode: { id: 'walking' }, duration: 4 };
  assert.equal(nextLiveTrainForJourney({ ...journey, legs: [walking, journey.legs[0]] }, [earlier, train], now)?.train.id, 'train1');
  assert.equal(nextLiveTrainForJourney({ ...journey, legs: [walking] }, [train], now), null);
  assert.equal(nextLiveTrainForJourney(journey, [earlier], now + 3 * 60000), null);
  assert.equal(nextLiveTrainForJourney(journey, [train], now - 60 * 60000), null);
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
  console.log('Journey checks passed: London time, DST, arrival deadlines, leave-now ordering, earliest live train, direction, walking time, transfers, missing predictions, and full stop retention.');
} finally { await rm(dir, { recursive: true, force: true }); }
