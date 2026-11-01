// One owner per host, including while an asynchronous creation is still pending.
const owners = new WeakMap();

export class UnsupportedPreview extends Error {
  constructor(message) { super(message); this.name = 'UnsupportedPreview'; }
}

export function abortError() {
  return new DOMException('预览已取消', 'AbortError');
}

export function makeScope(host, context) {
  owners.get(host)?.dispose();
  const abort = new AbortController();
  const cleanups = [];
  let active = true;
  const scope = {
    host, context, signal: abort.signal,
    get active() { return active && owners.get(host) === scope && !context.signal?.aborted; },
    check() { if (!scope.active) throw abortError(); },
    status(phase, message) { if (scope.active) context.onStatus?.({ phase, message }); },
    own(cleanup) {
      if (active) cleanups.push(cleanup); else cleanup();
      return cleanup;
    },
    dispose() {
      if (!active) return true;
      active = false;
      abort.abort();
      context.signal?.removeEventListener('abort', externalAbort);
      for (const cleanup of cleanups.reverse()) {
        try { cleanup(); } catch (error) { console.error('Preview cleanup failed', error); }
      }
      cleanups.length = 0;
      if (owners.get(host) === scope) owners.delete(host);
      return true;
    },
  };
  function externalAbort() { scope.dispose(); }
  owners.set(host, scope);
  if (context.signal?.aborted) scope.dispose();
  else context.signal?.addEventListener('abort', externalAbort, { once: true });
  return scope;
}

export async function assetResponse(scope, asset) {
  scope.check();
  if (typeof asset !== 'string' || !asset) throw new Error('资源缺少有效 asset ID');
  const address = scope.context.url(asset);
  const url = new URL(address, globalThis.location?.href || 'http://localhost/');
  if (globalThis.location && url.origin !== location.origin) throw new Error('预览只读取同源白名单资源');
  if (!/^https?:$/.test(url.protocol)) throw new Error('预览资源须通过本地 HTTP 提供');
  const response = await fetch(url.href, { signal: scope.signal, priority: scope.context.networkPriority || (scope.context.detail ? 'high' : 'auto') });
  scope.check();
  if (!response.ok) throw new Error(`资源读取失败：HTTP ${response.status}`);
  return response;
}

export async function assetText(scope, asset) {
  const response = await assetResponse(scope, asset);
  const text = await response.text(); scope.check(); return text;
}

export async function assetBytes(scope, asset) {
  const response = await assetResponse(scope, asset);
  const bytes = new Uint8Array(await response.arrayBuffer()); scope.check(); return bytes;
}

// Fetch is abortable; a decoded image belongs only to this live scope. Object URLs
// are revoked on success, failure and cancellation, never retained as a library cache.
export async function assetImage(scope, asset) {
  const response = await assetResponse(scope, asset);
  const blob = await response.blob(); scope.check();
  const image = new Image();
  const objectURL = URL.createObjectURL(blob);
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    const finish = error => {
      if (settled) return;
      settled = true;
      image.onload = image.onerror = null;
      scope.signal.removeEventListener('abort', cancel);
      URL.revokeObjectURL(objectURL);
      if (error) reject(error); else resolve(image);
    };
    const cancel = () => { image.src = ''; finish(abortError()); };
    image.onload = () => { if (scope.active) finish(); else cancel(); };
    image.onerror = () => finish(new Error('贴图无法解码'));
    scope.signal.addEventListener('abort', cancel, { once: true });
    image.src = objectURL;
    if (scope.signal.aborted) cancel();
  });
  const decoded = await promise; scope.check(); return decoded;
}

export function bindDrag(scope, handlers) {
  const host = scope.host;
  let pointer = null, suppressClick = false;
  const previousTouchAction = host.style.touchAction;
  host.style.touchAction = scope.context.detail ? 'none' : 'pan-y';
  const down = event => {
    if (event.button !== 0 || !scope.active || pointer) return;
    suppressClick = false;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
    host.setPointerCapture?.(event.pointerId);
    handlers.start?.();
  };
  const move = event => {
    if (!pointer || event.pointerId !== pointer.id || !scope.active) return;
    const rect = host.getBoundingClientRect();
    pointer.distance += Math.abs(event.clientX - pointer.x) + Math.abs(event.clientY - pointer.y);
    handlers.drag(event.clientX - pointer.x, event.clientY - pointer.y, rect);
    pointer.x = event.clientX; pointer.y = event.clientY;
  };
  const up = event => {
    if (pointer?.id !== event.pointerId) return;
    suppressClick = pointer.distance > 5;
    if (host.hasPointerCapture?.(pointer.id)) host.releasePointerCapture(pointer.id);
    pointer = null;
  };
  const wheel = event => {
    // Grid scrolling stays usable under the pointer; the detail pane is an
    // explicit inspection surface. Ctrl/Meta+wheel also zooms a list preview.
    if (!scope.active || (!scope.context.detail && !event.ctrlKey && !event.metaKey)) return;
    event.preventDefault(); handlers.zoom(Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * .004));
  };
  const click = event => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; } };
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['lostpointercapture', up], ['wheel', wheel]];
  for (const [name, fn] of listeners) host.addEventListener(name, fn, name === 'wheel' ? { passive: false } : undefined);
  host.addEventListener('click', click, true);
  scope.own(() => {
    for (const [name, fn] of listeners) host.removeEventListener(name, fn);
    host.removeEventListener('click', click, true);
    if (pointer && host.hasPointerCapture?.(pointer.id)) host.releasePointerCapture(pointer.id);
    host.style.touchAction = previousTouchAction;
    pointer = null;
  });
}

// DOM semantic previews become ready only after their actual images can draw.
// The abort listener also covers a decode promise that outlives its old host.
export function imageElementsReady(root, signal) {
  return Promise.all([...root.querySelectorAll('img')].map(image => new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return; settled = true;
      image.removeEventListener('load', loaded); image.removeEventListener('error', failed);
      signal?.removeEventListener('abort', cancelled);
      error ? reject(error) : resolve();
    };
    const cancelled = () => finish(abortError());
    const failed = () => finish(new Error('预览图片读取或解码失败，可重试此项。'));
    const loaded = () => {
      if (signal?.aborted) return cancelled();
      if (!image.naturalWidth) return failed();
      if (typeof image.decode === 'function') image.decode().then(() => signal?.aborted ? cancelled() : finish(), failed);
      else finish();
    };
    image.addEventListener('load', loaded, {once:true}); image.addEventListener('error', failed, {once:true});
    signal?.addEventListener('abort', cancelled, {once:true});
    if (signal?.aborted) cancelled(); else if (image.complete) loaded();
  })));
}
