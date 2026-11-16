import assert from 'node:assert/strict';
import {createLocationService, nearbyLocationPolicy} from '../dist/location-service.js';

// Advance real production deadlines without sleeping or requesting a device's location.
function clock() {
  let time = 100000, id = 0;
  const tasks = new Map();
  return {
    now: () => time, tasks,
    setTimeout(fn, ms) { tasks.set(++id, {fn, at: time + ms}); return id; },
    clearTimeout(key) { tasks.delete(key); },
    async tick(ms) {
      const end = time + ms;
      let next;
      while ((next = [...tasks].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0])) {
        time = next[1].at; tasks.delete(next[0]); next[1].fn();
        await Promise.resolve();
      }
      time = end;
      await Promise.resolve();
    }
  };
}
function fixture({watch = true} = {}) {
  const time = clock(), progress = [], counts = {watch: 0, first: 0, cleared: 0};
  let good, bad, outcome;
  const options = [];
  const geo = {
    getCurrentPosition(yes, no, config) { counts.first++; good = yes; bad = no; options.push(config); },
    clearWatch(id) { assert.equal(id, 0); counts.cleared++; }
  };
  if (watch) geo.watchPosition = (yes, no, config) => {
    counts.watch++; good = yes; bad = no; options.push(config); return 0;
  };
  const service = createLocationService({geolocation: geo, now: time.now, timers: time});
  const promise = service.request({onProgress: p => progress.push(p)});
  const settled = promise.then(value => outcome = {value}, error => outcome = {error});
  return {
    time, counts, options, service, promise, settled, progress, result: () => outcome,
    send(accuracy, {age = 0, lat = 37.5, lng = 127} = {}) {
      good({timestamp: time.now() - age, coords: {latitude: lat, longitude: lng, accuracy}});
    },
    fail(code) { bad({code}); },
    callbacks: () => ({good, bad}),
    clean() { assert.equal(time.tasks.size, 0); assert.equal(counts.cleared, watch ? 1 : 0); }
  };
}

const improving = fixture();
assert.equal(improving.service.request(), improving.promise, 'Duplicate clicks share the active measurement');
assert.deepEqual(improving.options[0], {enableHighAccuracy: true, maximumAge: 0, timeout: 20000});
improving.send(1500);
assert.equal(improving.result(), undefined);
await improving.time.tick(1000); improving.send(200);
await improving.time.tick(1000); improving.send(30);
await improving.time.tick(1000); improving.send(30);
await improving.time.tick(2000);
assert.equal((await improving.settled).value.accuracy, 30);
assert.deepEqual(improving.progress.map(p => p.fix.accuracy), [1500, 200, 30, 30]);
improving.clean();

const degrading = fixture();
degrading.send(20);
await degrading.time.tick(1000); degrading.send(500);
await degrading.time.tick(2000);
assert.equal((await degrading.settled).value.accuracy, 20);
degrading.clean();

// Desktop-like low precision remains a candidate, even when <=500m.
for (const accuracy of [101, 500, 1500]) {
  const pc = fixture();
  pc.send(accuracy);
  for (let i = 0; i < 3; i++) { await pc.time.tick(5000); pc.send(accuracy); }
  assert.equal(pc.result(), undefined);
  await pc.time.tick(5000);
  const {error} = await pc.settled;
  assert.equal(error.code, 'LOW_ACCURACY');
  assert.equal(error.fix.accuracy, accuracy);
  assert.equal(error.fix.accuracyAccepted, false);
  assert.equal(error.fix.userConfirmed, false);
  pc.clean();
}

const usable = fixture();
usable.send(80);
await usable.time.tick(1000); usable.send(100);
await usable.time.tick(6999); assert.equal(usable.result(), undefined);
await usable.time.tick(1);
assert.equal((await usable.settled).value.accuracy, 80);
usable.clean();

for (const [nativeCode, expected] of [[1, 'DENIED'], [2, 'UNAVAILABLE'], [3, 'TIMEOUT']]) {
  const failure = fixture(); failure.fail(nativeCode);
  if (nativeCode !== 1) await failure.time.tick(20000);
  assert.equal((await failure.settled).error.code, expected);
  failure.clean();
}
await assert.rejects(createLocationService({secure: false}).request(), {code: 'INSECURE'});
await assert.rejects(createLocationService({}).request(), {code: 'UNSUPPORTED'});
const noReply = fixture(); await noReply.time.tick(20000);
assert.equal((await noReply.settled).error.code, 'TIMEOUT'); noReply.clean();
const stale = fixture(); stale.send(10, {age: 16000}); await stale.time.tick(20000);
assert.equal((await stale.settled).error.code, 'STALE'); stale.clean();
const future = fixture(); future.send(10, {age: -2000}); await future.time.tick(20000);
assert.equal((await future.settled).error.code, 'STALE'); future.clean();

const cancelled = fixture(); cancelled.send(200);
const old = cancelled.callbacks(); cancelled.service.cancel();
assert.equal((await cancelled.settled).error.code, 'CANCELLED'); cancelled.clean();
const restarted = cancelled.service.request();
const second = restarted.then(value => ({value}));
old.good({timestamp: cancelled.time.now(), coords: {latitude: 0, longitude: 0, accuracy: 1}});
cancelled.send(30); await cancelled.time.tick(1000); cancelled.send(30);
await cancelled.time.tick(2000);
assert.equal((await second).value.lat, 37.5);
assert.equal(cancelled.counts.cleared, 2); assert.equal(cancelled.time.tasks.size, 0);

const jump = fixture(); jump.send(30);
await jump.time.tick(1000); jump.send(10, {lat: 38});
await jump.time.tick(19000);
assert.equal((await jump.settled).error.code, 'UNSTABLE'); jump.clean();
const confirmedJump = fixture(); confirmedJump.send(30);
await confirmedJump.time.tick(1000); confirmedJump.send(10, {lat: 38});
await confirmedJump.time.tick(1000); confirmedJump.send(10, {lat: 38});
await confirmedJump.time.tick(1000); confirmedJump.send(10, {lat: 38});
await confirmedJump.time.tick(2000);
assert.equal((await confirmedJump.settled).value.lat, 38); confirmedJump.clean();

const older = fixture(); older.send(80);
await older.time.tick(1000); older.send(10, {age: 2000}); older.send(80);
await older.time.tick(7000);
assert.equal((await older.settled).value.accuracy, 80); older.clean();
const fallback = fixture({watch: false}); fallback.send(40);
await fallback.time.tick(1000); fallback.send(40); await fallback.time.tick(2000);
assert.equal((await fallback.settled).value.accuracy, 40); fallback.clean();
assert.ok(fallback.counts.first >= 2);

const latePrecision = fixture(); latePrecision.send(1500);
await latePrecision.time.tick(19000); latePrecision.send(30);
await latePrecision.time.tick(1000);
assert.equal((await latePrecision.settled).error.code,'UNSTABLE');
latePrecision.clean();

// A synchronous permission callback must still clear a returned watch ID of zero.
let cleared = 0;
await assert.rejects(createLocationService({geolocation: {
  watchPosition(yes, no) { no({code: 1}); return 0; },
  clearWatch(id) { assert.equal(id, 0); cleared++; }
}}).request(), {code: 'DENIED'});
assert.equal(cleared, 1);
assert.equal(nearbyLocationPolicy.maxDurationMs, 20000);
console.log('PASS: mocked continuous geolocation, 20-second deadline, accuracy stabilization, movement, fallback, cancellation and cleanup.');
