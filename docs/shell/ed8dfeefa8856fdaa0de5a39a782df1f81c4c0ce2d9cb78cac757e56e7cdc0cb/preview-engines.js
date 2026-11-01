import { makeScope, UnsupportedPreview } from './engines/lifecycle.js';
let stage = null, stagePromise = null, spineRuntime = null, spineScript = null;
const engines = new Map(), attempts = new Map();
export function invalidatePreviews() { stage?.invalidatePreviews(); }

function runtime(detail = false) {
  if (globalThis.spine) return Promise.resolve();
  if (spineRuntime) { if (detail && spineScript) spineScript.fetchPriority = 'high'; return spineRuntime; }
  spineRuntime = new Promise((resolve, reject) => {
    const script = document.createElement('script'); spineScript = script; script.fetchPriority = detail ? 'high' : 'low';
    script.src = new URL('./vendor/spine-webgl.min.js', import.meta.url).href;
    script.async = true;
    script.onload = () => globalThis.spine ? resolve() : reject(Error('骨骼运行时未就绪，可重试。'));
    script.onerror = () => { script.remove(); reject(Error('骨骼运行时读取失败，可重试。')); };
    document.head.append(script);
  }).catch(error => { spineRuntime = null; throw error; });
  return spineRuntime;
}

function loadEngine(kind, detail) {
  if (engines.has(kind)) { if (kind === 'spine' && detail && spineScript) spineScript.fetchPriority = 'high'; return engines.get(kind); }
  const attempt = attempts.get(kind) || 0, suffix = attempt ? '?retry=' + attempt : '';
  const promise = (kind === 'spine'
    ? Promise.all([runtime(detail), import('./engines/spine-player.js' + suffix)]).then(([, module]) => module)
    : import('./engines/mc-model.js' + suffix))
    .catch(error => { engines.delete(kind); attempts.set(kind, attempt + 1); throw error; });
  engines.set(kind, promise); return promise;
}

async function sharedStage() {
  if (!stagePromise) stagePromise = import('./engines/shared-stage.js').then(module => (stage = module)).catch(error => { stagePromise = null; throw error; });
  return stagePromise;
}

const EMPTY = Object.freeze({ animations: [], skins: [], time: 0, duration: 0, playing: false });

export async function createPreview(host, row, context) {
  if (!host || typeof host.getBoundingClientRect !== 'function' || typeof context?.url !== 'function') throw new TypeError('预览需要 host 和 context.url(assetId)');
  if (!['mc-model', 'spine'].includes(row?.kind)) throw new TypeError(`专用预览不处理类型：${row?.kind}`);
  const scope = makeScope(host, {...context, networkPriority: context.detail ? 'high' : 'low'});
  let engine;
  try {
    scope.check(); scope.status('loading', row.kind === 'spine' ? '正在装配骨骼、atlas 与全部页…' : '正在读取模型父链与贴图…');
    const [module] = await Promise.all([loadEngine(row.kind, context.detail), sharedStage()]);
    scope.check();
    engine = await (row.kind === 'mc-model' ? module.createMCPreview(scope, row) : module.createSpinePreview(scope, row));
    scope.check();
  } catch (error) {
    if (error instanceof UnsupportedPreview && scope.active) { scope.status('unsupported', error.message); scope.dispose(); engine = EMPTY; }
    else {
      if (error.name !== 'AbortError') scope.status('error', error.message || String(error));
      scope.dispose(); throw error;
    }
  }
  const call = name => (...args) => scope.active && typeof engine[name] === 'function' ? engine[name](...args) : false;
  return {
    play: call('play'), pause: call('pause'), seek: call('seek'), setSpeed: call('setSpeed'),
    setAnimation: call('setAnimation'), setSkin: call('setSkin'), resetView: call('resetView'),
    setSkinGroup: call('setSkinGroup'), zoomBy: call('zoomBy'),
    get canZoom() { return scope.active && typeof engine.zoomBy === 'function'; },
    dispose: () => scope.dispose(),
    get time() { return engine.time || 0; }, get duration() { return engine.duration || 0; },
    get playing() { return scope.active && !!engine.playing; },
    get animations() { return engine.animations || []; }, get skins() { return engine.skins || []; },
    get animation() { return engine.animation || ''; }, get skin() { return engine.skin || ''; },
    get skinGroups() { return engine.skinGroups || []; },
  };
}
