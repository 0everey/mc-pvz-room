import * as THREE from '../vendor/three.module.min.js';

let shared = null;

// App layout changes can happen while every view is paused and RAF is asleep.
// Keep invalidation at the existing stage owner; never create a context here.
export function invalidatePreviews() { shared?.invalidate(); }

// Clip the full host viewport, including scroll panes. A cropped host keeps its
// original camera/aspect and is scissored; it is never squeezed into the crop.
export function clipHost(host, width, height) {
  if (!host.isConnected) return null;
  const rect = host.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(width, rect.right), bottom = Math.min(height, rect.bottom);
  for (let parent = host; parent && parent !== document.documentElement; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return null;
    if (parent !== host && /hidden|clip|auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)) {
      const r = parent.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) { left = Math.max(left, r.left + parent.clientLeft); right = Math.min(right, r.left + parent.clientLeft + parent.clientWidth); }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) { top = Math.max(top, r.top + parent.clientTop); bottom = Math.min(bottom, r.top + parent.clientTop + parent.clientHeight); }
    }
  }
  if (right <= left || bottom <= top) return null;
  return { rect, clip: { left, top, right, bottom, width: right - left, height: bottom - top } };
}

class SharedStage {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'shared-resource-preview';
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 'var(--preview-canvas-z, 4)' });
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.gl = this.renderer.getContext();
    this.views = new Set(); this.references = 0; this.raf = null; this.last = null;
    this.spineRenderer = null; this.spineContext = null;
    this.onLayout = () => this.invalidate();
    this.onVisibility = () => { this.last = null; this.invalidate(); };
    this.onLost = event => {
      event.preventDefault();
      for (const view of [...this.views]) view.fail(new Error('图形上下文丢失，请重新打开预览'));
    };
    this.canvas.addEventListener('webglcontextlost', this.onLost);
    window.addEventListener('resize', this.onLayout, { passive: true });
    window.addEventListener('scroll', this.onLayout, { passive: true, capture: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    document.body.append(this.canvas);
  }
  getSpine(S) {
    if (!this.spineRenderer) {
      this.renderer.resetState();
      this.spineContext = new S.ManagedWebGLRenderingContext(this.gl);
      this.spineRenderer = new S.SceneRenderer(this.canvas, this.spineContext, true);
      this.renderer.resetState();
    }
    return { renderer: this.spineRenderer, context: this.spineContext };
  }
  add(view) {
    this.views.add(view);
    this.invalidate();
    return () => { this.views.delete(view); this.invalidate(); };
  }
  invalidate() {
    if (this.references && this.raf === null) this.raf = requestAnimationFrame(time => this.frame(time));
  }
  frame(time) {
    this.raf = null;
    if (!this.references) return;
    const width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
    const maxSize = this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE), maxViewport = this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2, maxSize / width, maxSize / height, maxViewport[0] / width, maxViewport[1] / height);
    if (this.width !== width || this.height !== height || this.renderer.getPixelRatio() !== this.dpr) {
      this.width = width; this.height = height;
      this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(width, height, false);
    }
    const delta = this.last === null || document.hidden ? 0 : Math.min(.1, Math.max(0, (time - this.last) / 1000));
    this.last = time;
    const gl = this.gl;
    this.renderer.resetState(); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    let animating = false;
    for (const view of [...this.views]) {
      if (!view.scope.active) continue;
      const bounds = clipHost(view.scope.host, width, height);
      if (!bounds) continue;
      try {
        this.renderer.resetState();
        const { rect, clip } = bounds;
        this.renderer.setViewport(rect.left, height - rect.bottom, rect.width, rect.height);
        this.renderer.setScissor(clip.left, height - clip.bottom, clip.width, clip.height);
        this.renderer.setScissorTest(true);
        gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
        view.update?.(delta);
        view.draw(this, bounds);
        if (view.continuous?.()) animating = true;
      } catch (error) { view.fail(error); }
    }
    if (this.references) this.renderer.resetState();
    if (this.references && animating && !document.hidden) this.invalidate();
    else this.last = null;
  }
  dispose() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    window.removeEventListener('resize', this.onLayout);
    window.removeEventListener('scroll', this.onLayout, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.spineRenderer?.dispose(); this.spineContext?.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.canvas.remove();
    this.views.clear();
  }
}

export function useStage(scope) {
  scope.check();
  if (!shared) shared = new SharedStage();
  const stage = shared; stage.references++;
  scope.own(() => {
    stage.references--;
    if (!stage.references) { stage.dispose(); if (shared === stage) shared = null; }
  });
  return stage;
}

export function registerView(scope, stage, callbacks) {
  const view = {
    scope, ...callbacks,
    fail(error) {
      if (!scope.active) return;
      scope.status('error', error.message || String(error)); scope.dispose();
    },
  };
  scope.own(stage.add(view));
}
