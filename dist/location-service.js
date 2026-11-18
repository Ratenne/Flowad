export const nearbyLocationPolicy = Object.freeze({
  highMeters: 20, goodMeters: 50, preciseMeters: 100, maxMeters: 500,
  maxAgeMs: 15000, maxDurationMs: 5000, stableMs: 3000,
  stagnantMs: 8000, sampleIntervalMs: 1000,
  // Permit road travel, but require another sample after an implausible jump.
  maxSpeedMps: 60, movementSlackMeters: 30
});

export function validCoordinates(lat, lng) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    Number.isFinite(lng) && Math.abs(lng) <= 180;
}

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function createLocationService({
  geolocation, secure = true, now = Date.now, policy = nearbyLocationPolicy,
  timers = {setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id)}
}) {
  let active = null, lastKnown = null;
  const fresh = fix => now() - fix.observedAt >= -1000 && now() - fix.observedAt <= policy.maxAgeMs;
  const error = code => Object.assign(new Error(code), {code});

  function request({onProgress} = {}) {
    if (active) return active.promise;
    if (!secure) return Promise.reject(error('INSECURE'));
    if (!geolocation || (!geolocation.watchPosition && !geolocation.getCurrentPosition)) {
      return Promise.reject(error('UNSUPPORTED'));
    }
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    let watchId, deadline, settleTimer, retryTimer;
    let best = null, reference = null, jump = null, bestSince = now(), samples = 0;
    let sawStale = false, lastError = 'TIMEOUT';
    const startedAt = now();
    const operation = {promise, cancel: () => finish(null, 'CANCELLED')};
    active = operation;
    const running = () => active === operation;
    const compatible = (a, b) => distanceMeters(a, b) <= a.accuracy + b.accuracy +
      policy.movementSlackMeters + policy.maxSpeedMps * Math.abs(b.observedAt - a.observedAt) / 1000;

    function finish(fix, code, fallbackUsed = false) {
      if (!running()) return;
      active = null;
      for (const timer of [deadline, settleTimer, retryTimer]) timers.clearTimeout(timer);
      if (watchId !== undefined) geolocation.clearWatch(watchId);
      if (fix) {
        // Session memory only. Cancelled samples and vehicle/manual positions
        // never become the browser's last confirmed location.
        lastKnown = {...fix};
        resolve({...fix, accuracyAccepted: !fallbackUsed, userConfirmed: false, fallbackUsed});
      }
      else {
        const failure = error(code);
        if (['LOW_ACCURACY', 'UNSTABLE'].includes(code) && best && fresh(best)) {
          failure.fix = {...best, accuracyAccepted: false, userConfirmed: false};
        }
        reject(failure);
      }
    }

    function endMeasurement() {
      if (best && fresh(best)) {
        const accepted = !jump && best.accuracy <= policy.preciseMeters &&
          samples >= 2 && now() - bestSince >= policy.stableMs;
        return finish(best, undefined, !accepted);
      }
      if (lastKnown) return finish({...lastKnown, source: 'BROWSER_CACHE'}, undefined, true);
      finish(null, best || sawStale ? 'STALE' : lastError);
    }

    function considerFinish() {
      if (!running() || !best || jump || !fresh(best) || samples < 2) return;
      const wait = best.accuracy <= policy.goodMeters ? policy.stableMs : policy.stagnantMs;
      if (best.accuracy > policy.preciseMeters) return;
      const remaining = bestSince + wait - now();
      if (remaining <= 0) finish(best);
      else {
        timers.clearTimeout(settleTimer);
        settleTimer = timers.setTimeout(considerFinish, remaining);
      }
    }

    function sample(position) {
      if (!running()) return;
      const {latitude: lat, longitude: lng, accuracy, speed} = position.coords;
      const observedAt = position.timestamp;
      if (!validCoordinates(lat, lng) || !Number.isFinite(accuracy) || accuracy < 0 ||
          !Number.isFinite(observedAt) || observedAt <= 0) {
        lastError = 'UNAVAILABLE';
      } else if (!fresh({observedAt})) sawStale = true;
      else if (!reference || observedAt >= reference.observedAt) {
        const quality = accuracy <= policy.highMeters ? 'HIGH' :
          accuracy <= policy.preciseMeters ? 'MEDIUM' :
          accuracy <= policy.maxMeters ? 'APPROXIMATE' : 'LOW';
        const fix = {lat, lng, accuracy, speed, observedAt, quality, source: 'BROWSER_GPS'};
        if (reference && !compatible(reference, fix)) {
          if (jump && observedAt > jump.observedAt && compatible(jump, fix)) {
            // Two samples confirm the new area; restart stabilization there.
            best = null;
            reference = null;
            jump = null;
            samples = 0;
          } else jump = fix;
        } else jump = null;
        if (!jump) {
          if (!reference || observedAt > reference.observedAt) samples++;
          reference = fix;
          if (!best || !fresh(best) || accuracy < best.accuracy ||
              (accuracy === best.accuracy && observedAt > best.observedAt)) {
            if (!best || !fresh(best) || accuracy < best.accuracy) bestSince = now();
            best = fix;
          }
        }
        // Candidates must never start address/weather/recommendation requests.
        onProgress?.({fix: best ? {...best} : null, unstable: !!jump, elapsedMs: now() - startedAt});
        considerFinish();
      }
      scheduleFallback();
    }

    function failed(cause) {
      if (!running()) return;
      if (cause.code === 1) return finish(null, 'DENIED');
      lastError = cause.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE';
      scheduleFallback();
    }

    function scheduleFallback() {
      if (!running() || geolocation.watchPosition) return;
      timers.clearTimeout(retryTimer);
      retryTimer = timers.setTimeout(measureOnce, policy.sampleIntervalMs);
    }

    function measureOnce() {
      if (!running()) return;
      try { geolocation.getCurrentPosition(sample, failed, options()); }
      catch (cause) { finish(null, cause.name === 'SecurityError' ? 'INSECURE' : 'UNAVAILABLE'); }
    }
    const options = () => ({enableHighAccuracy: true, maximumAge: 0,
      timeout: Math.max(1, policy.maxDurationMs - (now() - startedAt))});
    deadline = timers.setTimeout(endMeasurement, policy.maxDurationMs);
    try {
      if (geolocation.watchPosition) {
        const id = geolocation.watchPosition(sample, failed, options());
        if (running()) watchId = id;
        else geolocation.clearWatch(id);
      } else measureOnce();
    } catch (cause) {
      finish(null, cause.name === 'SecurityError' ? 'INSECURE' : 'UNAVAILABLE');
    }
    return promise;
  }
  return {request, cancel: () => active?.cancel()};
}
