export function detectLocationEnvironment({userAgent = '', nativeLocation, nativeNavigation} = {}) {
  if (nativeLocation || nativeNavigation || /FlowadPleos\//i.test(userAgent)) {
    return {vehicle: true, provider: 'native'};
  }
  if (/\bTesla\b/i.test(userAgent)) return {vehicle: true, provider: 'tesla'};
  return {vehicle: false, provider: 'browser'};
}

// Device detection chooses UX only. Vehicle API authentication remains server-side.
export function locationProvider(environment, selection) {
  return environment.vehicle ? environment.provider : selection === 'vehicle' ? 'tesla' : 'browser';
}

export function createNativeLocationService(bridge) {
  let sequence = 0, active = null;
  return {
    request({signal} = {}) {
      if (active) return active;
      if (!bridge?.postMessage) return Promise.reject(Error('VEHICLE_LOCATION_UNSUPPORTED'));
      const requestId = 'location-' + Date.now() + '-' + (++sequence);
      let timer;
      const promise = new Promise((resolve, reject) => {
        let finished = false;
        const finish = (data, error) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          bridge.onmessage = null;
          if (error) reject(error); else resolve(data);
        };
        const cancel = () => {
          try { bridge.postMessage(JSON.stringify({type:'LOCATION_CANCEL', requestId})); } catch {}
          finish(null, new DOMException('Location cancelled', 'AbortError'));
        };
        bridge.onmessage = event => {
          let data;
          try { data = JSON.parse(event.data); } catch { return; }
          if (data.type !== 'LOCATION_RESULT' || data.requestId !== requestId) return;
          finish(data, data.error ? Error(data.error) : null);
        };
        if (signal?.aborted) { cancel(); return; }
        signal?.addEventListener('abort', cancel, {once:true});
        timer = setTimeout(() => {
          try { bridge.postMessage(JSON.stringify({type:'LOCATION_CANCEL', requestId})); } catch {}
          finish(null, Error('VEHICLE_LOCATION_TIMEOUT'));
        }, 15000);
        try { bridge.postMessage(JSON.stringify({type:'LOCATION_REQUEST', requestId})); }
        catch (error) { finish(null, error); }
      });
      active = promise;
      promise.then(() => { if(active === promise)active = null; }, () => { if(active === promise)active = null; });
      return promise;
    }
  };
}
