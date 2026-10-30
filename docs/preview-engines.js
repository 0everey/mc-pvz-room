import { makeScope, UnsupportedPreview } from './engines/lifecycle.js';
import { createMCPreview } from './engines/mc-model.js';
import { createSpinePreview } from './engines/spine-player.js';
export { invalidatePreviews } from './engines/shared-stage.js';

const EMPTY = Object.freeze({ animations: [], skins: [], time: 0, duration: 0, playing: false });

export async function createPreview(host, row, context) {
  if (!host || typeof host.getBoundingClientRect !== 'function' || typeof context?.url !== 'function') throw new TypeError('预览需要 host 和 context.url(assetId)');
  if (!['mc-model', 'spine'].includes(row?.kind)) throw new TypeError(`专用预览不处理类型：${row?.kind}`);
  const scope = makeScope(host, context);
  let engine;
  try {
    scope.check(); scope.status('loading', row.kind === 'spine' ? '正在装配骨骼、atlas 与全部页…' : '正在读取模型父链与贴图…');
    engine = await (row.kind === 'mc-model' ? createMCPreview(scope, row) : createSpinePreview(scope, row));
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
    setSkinGroup: call('setSkinGroup'),
    dispose: () => scope.dispose(),
    get time() { return engine.time || 0; }, get duration() { return engine.duration || 0; },
    get playing() { return scope.active && !!engine.playing; },
    get animations() { return engine.animations || []; }, get skins() { return engine.skins || []; },
    get animation() { return engine.animation || ''; }, get skin() { return engine.skin || ''; },
    get skinGroups() { return engine.skinGroups || []; },
  };
}
