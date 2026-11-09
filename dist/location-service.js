export const nearbyLocationPolicy = Object.freeze({
  highMeters: 30, maxMeters: 100, maxAgeMs: 15000,
  initialMs: 15000, samplingMs: 7000, cacheMs: 5000
});

export function validCoordinates(lat, lng) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    Number.isFinite(lng) && Math.abs(lng) <= 180;
}

export function createLocationService({
  geolocation, permissions, secure = true, now = Date.now,
  policy = nearbyLocationPolicy
}) {
  let active = null;
  let cached = null;
  const age = fix => now() - fix.observedAt;
  const fresh = fix => age(fix) >= -1000 && age(fix) <= policy.maxAgeMs;
  const error = code => Object.assign(new Error(code), { code });

  function request() {
    if (active) return active.promise;
    if (!secure) return Promise.reject(error('INSECURE'));
    if (!geolocation) return Promise.reject(error('UNAVAILABLE'));

    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    let watchId, timer, started = false, sampling = false, sawStale = false, sawLow = false;
    let best = null, lastError = 'TIMEOUT';
    const operation = { promise, cancel: () => finish(null, 'CANCELLED') };
    active = operation;
    const running = () => active === operation;

    function finish(fix, code) {
      if (!running()) return;
      active = null;
      clearTimeout(timer);
      if (watchId !== undefined) geolocation.clearWatch(watchId);
      if (fix) {
        if (fix.source === 'BROWSER_GPS') cached = fix;
        resolve(fix);
      } else {
        if (code === 'DENIED') cached = null;
        reject(error(code));
      }
    }

    function endSampling() {
      if (best && fresh(best)) finish(best);
      else finish(null, sawLow ? 'LOW_ACCURACY' : sawStale || best ? 'STALE' : lastError);
    }

    function sample(position) {
      if (!running()) return;
      const { latitude: lat, longitude: lng, accuracy, speed } = position.coords;
      const observedAt = position.timestamp;
      if (!validCoordinates(lat, lng) || !Number.isFinite(accuracy) || accuracy < 0 ||
          !Number.isFinite(observedAt) || observedAt <= 0) {
        lastError = 'UNAVAILABLE';
      } else {
        const quality = accuracy <= policy.highMeters ? 'HIGH' :
          accuracy <= policy.maxMeters ? 'MEDIUM' : 'LOW';
        const fix = { lat, lng, accuracy, observedAt, speed, quality, source: 'BROWSER_GPS' };
        if (!fresh(fix)) sawStale = true;
        else if (quality === 'LOW') sawLow = true;
        else {
          // Prefer a tighter fix unless its age outweighs the accuracy gain.
          const score = point => point.accuracy + Math.max(0, age(point)) / 500;
          if (!best || !fresh(best) || score(fix) < score(best) ||
              (score(fix) === score(best) && observedAt > best.observedAt)) best = fix;
          if (best.quality === 'HIGH') return finish(best);
        }
      }
      refine();
    }

    function failed(cause) {
      if (!running()) return;
      if (cause.code === 1) return finish(null, 'DENIED');
      lastError = cause.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE';
      refine();
    }

    function refine() {
      if (!running() || sampling) return;
      sampling = true;
      clearTimeout(timer);
      timer = setTimeout(endSampling, policy.samplingMs);
      const options = { enableHighAccuracy: true, timeout: policy.samplingMs, maximumAge: 0 };
      try {
        if (!geolocation.watchPosition) {
          geolocation.getCurrentPosition(sample, failed, options);
          return;
        }
        const id = geolocation.watchPosition(sample, failed, options);
        if (running()) watchId = id;
        else geolocation.clearWatch(id);
      } catch {
        lastError = 'UNAVAILABLE';
        endSampling();
      }
    }

    function start() {
      if (!running()) return;
      timer = setTimeout(refine, policy.initialMs);
      try {
        geolocation.getCurrentPosition(sample, failed, {
          enableHighAccuracy: true, timeout: policy.initialMs, maximumAge: 0
        });
      } catch (cause) {
        if (cause.name === 'SecurityError') finish(null, 'INSECURE');
        else { lastError = 'UNAVAILABLE'; refine(); }
      }
    }

    // Permission lookup is advisory and must not delay or block a fresh fix.
    if (cached && age(cached) > policy.cacheMs) cached = null;
    if (permissions?.query) {
      timer = setTimeout(beginMeasurement, 250);
      Promise.resolve().then(() => permissions.query({ name: 'geolocation' })).then(result => {
        if (!running() || sampling || started) return;
        clearTimeout(timer);
        if (result.state === 'denied') finish(null, 'DENIED');
        else if (result.state === 'granted' && cached && fresh(cached) &&
            age(cached) <= policy.cacheMs && cached.quality === 'HIGH' &&
            Number.isFinite(cached.speed) && cached.speed >= 0 && cached.speed <= 0.5) {
          finish({ ...cached, source: 'BROWSER_CACHE' });
        } else beginMeasurement();
      }).catch(() => { if (!started && running()) { clearTimeout(timer); beginMeasurement(); } });
    } else beginMeasurement();
    function beginMeasurement() { started = true; start(); }
    return promise;
  }

  return { request, cancel: () => active?.cancel() };
}
