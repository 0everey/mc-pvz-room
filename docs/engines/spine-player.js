import { assetText, assetBytes, assetImage, bindDrag, UnsupportedPreview } from './lifecycle.js';
import { useStage, registerView } from './shared-stage.js';
import { createSkinSelection } from './spine-skins.js';

export function selectDefaultAnimation(animations) {
  const canonical = name => name.toLowerCase().replace(/[\s-]+/g, '_');
  for (const preferred of ['full_idle', 'idle', 'walk', 'walking', 'drive', 'driving', 'run']) {
    const found = animations.find(animation => canonical(animation.name) === preferred);
    if (found) return found.name;
  }
  const complete = animations.filter(animation => !/blink|head|stem|mouth|eye/i.test(animation.name));
  return [...(complete.length ? complete : animations)].sort((a,b) => b.duration - a.duration)[0]?.name || '';
}

export function parseSpineData(S, bytes, atlas) {
  const loader = new S.SkeletonBinary(new S.AtlasAttachmentLoader(atlas));
  const data = loader.readSkeletonData(bytes);
  if (!/^4\.2(?:\.|$)/.test(data.version || '')) throw new UnsupportedPreview(`当前骨骼版本 ${data.version || '未知'}，此消费者支持 4.2`);
  return data;
}

function poseAt(S, skeleton, state, animation, time) {
  state.clearTracks(); skeleton.setToSetupPose(); skeleton.time = 0;
  if (animation) { const entry = state.setAnimation(0, animation, true); entry.trackTime = time; state.apply(skeleton); }
  skeleton.updateWorldTransform(S.Physics.reset);
}

export function visibleSpineBounds(S, skeleton) {
  const clipper = new S.SkeletonClipping();
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  const include = (vertices, index) => {
    left = Math.min(left, vertices[index]); right = Math.max(right, vertices[index]);
    bottom = Math.min(bottom, vertices[index + 1]); top = Math.max(top, vertices[index + 1]);
  };
  for (const slot of skeleton.drawOrder) {
    const attachment = slot.getAttachment();
    if (!slot.bone.active) { clipper.clipEndWithSlot(slot); continue; }
    if (attachment instanceof S.ClippingAttachment) { clipper.clipStart(slot, attachment); continue; }
    let vertices, triangles;
    if (attachment instanceof S.RegionAttachment) {
      vertices = new Array(8); attachment.computeWorldVertices(slot, vertices, 0, 2); triangles = [0,1,2,2,3,0];
    } else if (attachment instanceof S.MeshAttachment) {
      vertices = new Array(attachment.worldVerticesLength); attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, vertices, 0, 2); triangles = attachment.triangles;
    }
    if (vertices && skeleton.color.a * slot.color.a * attachment.color.a > 0) {
      const visible = [];
      for (let i = 0; i < triangles.length; i += 3) {
        const a = triangles[i] * 2, b = triangles[i + 1] * 2, c = triangles[i + 2] * 2;
        const area = (vertices[b]-vertices[a]) * (vertices[c+1]-vertices[a+1]) - (vertices[b+1]-vertices[a+1]) * (vertices[c]-vertices[a]);
        // Recovered originals contain zero-size animation locator attachments at
        // huge sentinel coordinates. They draw no pixels and must not frame art.
        if (Number.isFinite(area) && Math.abs(area) > 1e-8) visible.push(triangles[i],triangles[i+1],triangles[i+2]);
      }
      if (visible.length && clipper.isClipping()) {
        clipper.clipTriangles(vertices, visible, visible.length);
        for (let i = 0; i < clipper.clippedVertices.length; i += 2) include(clipper.clippedVertices, i);
      } else for (const index of visible) include(vertices, index * 2);
    }
    clipper.clipEndWithSlot(slot);
  }
  clipper.clipEnd();
  return { left, right, bottom, top };
}

export function measureSpine(S, data, animation, skin) {
  const sample = new S.Skeleton(data), state = new S.AnimationState(new S.AnimationStateData(data));
  if (typeof skin === 'string' && skin) sample.setSkinByName(skin);
  else if (skin) sample.setSkin(skin);
  const duration = data.findAnimation(animation)?.duration || 0;
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const fraction of [0, .2, .4, .6, .8, .999]) {
    poseAt(S, sample, state, animation, duration * fraction);
    const visible = visibleSpineBounds(S, sample);
    if (![visible.left,visible.right,visible.bottom,visible.top].every(Number.isFinite)) continue;
    left = Math.min(left, visible.left); right = Math.max(right, visible.right);
    bottom = Math.min(bottom, visible.bottom); top = Math.max(top, visible.top);
  }
  state.clearTracks();
  if (![left,right,bottom,top].every(Number.isFinite)) throw new UnsupportedPreview('此动画/皮肤没有可见附件');
  return { x: (left + right) / 2, y: (bottom + top) / 2, width: right - left, height: top - bottom };
}

// Normalize each atlas page to GPU PMA once. Atlas pma:true means the PNG bytes
// are already premultiplied; straight pages require upload premultiplication.
// One normalized representation also handles atlases with mixed page settings.
export function createAtlasTexture(S, managed, image, sourcePma) {
  class NormalizedAtlasTexture extends S.GLTexture {
    update(useMipMaps) {
      const gl = this.context.gl;
      const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
      const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
      const colorspace = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);
      try {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !sourcePma);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        if (!this.texture) this.texture = gl.createTexture();
        this.bind();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.getImage());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, useMipMaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (useMipMaps) gl.generateMipmap(gl.TEXTURE_2D);
      } finally {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, colorspace);
      }
    }
  }
  return new NormalizedAtlasTexture(managed, image, false);
}

// The actual animation controller is independent of GL. The browser uses this
// same core; CPU evidence can exercise its timing/skin/seek rather than a copy.
export function createSpineCore(S, data, autoPlay = false) {
  const skeleton = new S.Skeleton(data), state = new S.AnimationState(new S.AnimationStateData(data));
  const animations = data.animations.map(animation => Object.freeze({ name: animation.name, duration: animation.duration }));
  const skins = data.skins.map(skin => skin.name);
  const selection = createSkinSelection(S, data);
  let animation = selectDefaultAnimation(animations), skin = data.defaultSkin?.name || skins[0] || '';
  let activeSkin = selection.component ? selection.skin : skin;
  let bounds;
  if (selection.component) bounds = measureSpine(S, data, animation, activeSkin);
  else {
    // A raw default can contain only animation locators (actual Wallnut/Tallnut
    // exports). Try the real source skin order before declaring the asset empty.
    let invisible;
    for (const candidate of new Set([skin, ...skins])) {
      try { bounds = measureSpine(S,data,animation,candidate); skin = activeSkin = candidate; break; }
      catch (error) { if (!(error instanceof UnsupportedPreview)) throw error; invisible = error; }
    }
    if (!bounds) throw invisible || new UnsupportedPreview('此骨骼没有可见皮肤');
  }
  if (typeof activeSkin === 'string' && activeSkin) skeleton.setSkinByName(activeSkin);
  else if (activeSkin) skeleton.setSkin(activeSkin);
  let time = 0, speed = 1, playing = !!autoPlay && !!animation, disposed = false;
  let hasVisibleAttachments = true;
  poseAt(S, skeleton, state, animation, 0);
  const duration = () => data.findAnimation(animation)?.duration || 0;
  const core = {
    skeleton, animations, skins,
    get skinGroups() { return selection.groups; },
    get hasVisibleAttachments() { return hasVisibleAttachments; },
    get bounds() { return bounds; }, get animation() { return animation; }, get skin() { return skin; },
    get time() { return time; }, get duration() { return duration(); }, get playing() { return !disposed && playing; },
    update(delta) {
      if (disposed || !playing || !animation || !Number.isFinite(delta) || delta <= 0) return;
      const step = delta * speed;
      time = duration() ? (time + step) % duration() : 0;
      skeleton.update(step); state.update(step); state.apply(skeleton); skeleton.updateWorldTransform(S.Physics.update);
    },
    play() { if (disposed || !animation) return false; playing = true; return true; },
    pause() { if (disposed) return false; playing = false; return true; },
    seek(seconds) {
      if (disposed || !Number.isFinite(seconds)) return false;
      time = Math.max(0, Math.min(duration(), seconds)); poseAt(S, skeleton, state, animation, time); return true;
    },
    setSpeed(value) { if (disposed || !Number.isFinite(value) || value <= 0 || value > 16) return false; speed = value; return true; },
    setAnimation(name) {
      if (disposed || !data.findAnimation(name)) return false;
      const next = measureSelection(name,activeSkin,!selection.component);
      animation = name; time = 0; poseAt(S, skeleton, state, animation, 0); bounds = next.bounds; hasVisibleAttachments = next.visible; return true;
    },
    setSkin(name) {
      if (disposed || !data.findSkin(name)) return false;
      if (selection.component) {
        const candidate = selection.previewSkin(name);
        return candidate ? commitSkin(candidate,name) : false;
      }
      // An explicit raw empty skin remains inspectable. Keep the last finite
      // camera, actually select that source skin and report its empty state.
      const next = measureSelection(animation,name,true);
      skin = name; activeSkin = name; skeleton.setSkinByName(name); poseAt(S, skeleton, state, animation, time); bounds = next.bounds; hasVisibleAttachments = next.visible; return true;
    },
    setSkinGroup(id,value) { if (disposed) return false; const candidate=selection.previewGroup(id,value); return candidate ? commitSkin(candidate,value || data.defaultSkin?.name || '') : false; },
    dispose() { if (disposed) return true; disposed = true; playing = false; state.clearTracks(); state.clearListeners(); return true; },
  };
  function measureSelection(name, selectedSkin, allowEmpty) {
    try { return {bounds:measureSpine(S,data,name,selectedSkin),visible:true}; }
    catch (error) {
      if (allowEmpty && error instanceof UnsupportedPreview) return {bounds,visible:false};
      throw error;
    }
  }
  function commitSkin(candidate, name) {
    const nextBounds = measureSpine(S,data,animation,candidate.skin);
    selection.commit(candidate); activeSkin=candidate.skin; skin=name;
    skeleton.setSkin(activeSkin); poseAt(S,skeleton,state,animation,time); bounds=nextBounds; hasVisibleAttachments=true; return true;
  }
  return core;
}

export async function createSpinePreview(scope, row) {
  const S = globalThis.spine;
  if (!S?.SkeletonBinary || !S.SceneRenderer) throw new Error('Spine 4.2 本地运行时尚未加载');
  const bundle = row.spine;
  if (!bundle?.skeleton || !bundle.atlas || !bundle.pages) throw new Error('Spine 记录缺少骨骼、atlas 或页映射');
  const [atlasText, bytes] = await Promise.all([assetText(scope, bundle.atlas), assetBytes(scope, bundle.skeleton)]); scope.check();
  const atlas = new S.TextureAtlas(atlasText);
  if (!atlas.pages.length) throw new Error('Atlas 没有贴图页');
  for (const page of atlas.pages) if (!Object.prototype.hasOwnProperty.call(bundle.pages, page.name)) throw new Error(`Atlas 页未收录：${page.name}`);
  const data = parseSpineData(S, bytes, atlas);
  const images = new Map(); let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, atlas.pages.length) }, async () => {
    while (next < atlas.pages.length) {
      const page = atlas.pages[next++]; images.set(page.name, await assetImage(scope, bundle.pages[page.name])); scope.check();
    }
  }));
  scope.check();
  const stage = useStage(scope), shared = stage.getSpine(S);
  // Atlas owns these page textures; it is disposed before the stage is released.
  scope.own(() => { atlas.dispose(); images.clear(); });
  for (const page of atlas.pages) {
    const image = images.get(page.name);
    if (image.naturalWidth !== page.width || image.naturalHeight !== page.height) throw new Error(`Atlas 页尺寸不符：${page.name}`);
    const texture = createAtlasTexture(S, shared.context, image, page.pma); page.setTexture(texture);
  }
  stage.renderer.resetState();
  const core = createSpineCore(S, data, scope.context.autoPlay);
  let panX = 0, panY = 0, zoom = 1;
  const resetView = () => { panX = panY = 0; zoom = 1; stage.invalidate(); return true; };
  const fit = rect => {
    const aspect = rect.width / Math.max(1, rect.height);
    const height = Math.max(core.bounds.height, core.bounds.width / aspect) * 1.12 / zoom;
    return { width: height * aspect, height };
  };
  bindDrag(scope, { drag(dx,dy,rect) { const view = fit(rect); panX -= dx / rect.width * view.width; panY += dy / rect.height * view.height; stage.invalidate(); }, zoom(factor) { zoom = Math.max(.2, Math.min(8, zoom * factor)); stage.invalidate(); } });
  scope.own(() => core.dispose());
  registerView(scope, stage, {
    continuous: () => core.playing,
    update: delta => core.update(delta),
    draw(manager, { rect }) {
      const gl = manager.gl, renderer = shared.renderer, view = fit(rect);
      // Three and Spine share this exact GL. Clear all library-specific bindings
      // before Spine and let Three reset its own state on the next host.
      gl.bindVertexArray?.(null); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE); gl.blendEquation(gl.FUNC_ADD);
      renderer.camera.setViewport(view.width, view.height); renderer.camera.zoom = 1;
      renderer.camera.position.set(core.bounds.x + panX, core.bounds.y + panY, 0);
      renderer.begin();
      try { renderer.drawSkeleton(core.skeleton, true); } finally { renderer.end(); }
    },
  });
  const reportSelection = () => scope.status('ready', core.hasVisibleAttachments ? `Spine ${data.version} · ${atlas.pages.length} 页 · ${core.animation || '静态姿态'} · ${core.skin}` : `原始皮肤 ${core.skin} / ${core.animation || '静态姿态'} 没有可绘制附件；可切换其它皮肤`);
  reportSelection();
  return {
    animations: core.animations, skins: core.skins,
    get skinGroups() { return core.skinGroups; },
    get animation() { return core.animation; }, get skin() { return core.skin; }, get time() { return core.time; }, get duration() { return core.duration; }, get playing() { return core.playing; },
    play() { const result = core.play(); stage.invalidate(); return result; },
    pause() { const result = core.pause(); stage.invalidate(); return result; },
    seek(seconds) { const result = core.seek(seconds); if (result) stage.invalidate(); return result; },
    setSpeed: value => core.setSpeed(value),
    setAnimation(name) { const result = core.setAnimation(name); if (result) { resetView(); reportSelection(); } return result; },
    setSkin(name) { const result = core.setSkin(name); if (result) { resetView(); reportSelection(); } return result; },
    setSkinGroup(id,value) { const result = core.setSkinGroup(id,value); if (result) { resetView(); reportSelection(); } return result; },
    resetView,
  };
}
