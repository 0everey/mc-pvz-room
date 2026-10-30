import * as THREE from '../vendor/three.module.min.js';
import { assetText, assetImage, bindDrag, UnsupportedPreview } from './lifecycle.js';
import { useStage, registerView } from './shared-stage.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const radians = value => value * Math.PI / 180;

export function resourceKey(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('..') || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*$/.test(value)) throw new Error(`资源键无效：${String(value)}`);
  return value.startsWith('minecraft:') ? value.slice(10) : value;
}

function lookup(map, key) {
  return own(map || {}, key) ? map[key] : key.includes(':') ? undefined : map?.[`minecraft:${key}`];
}

export async function resolveModel(row, context, readJSON) {
  const seen = new Set(); const stack = [];
  let key = resourceKey(row.modelKey || row.id), asset = row.asset, builtin = null;
  while (true) {
    if (seen.has(key) || seen.size >= 64) throw new Error('模型父链循环或过深');
    seen.add(key);
    if (!asset) throw new UnsupportedPreview(`缺少父模型：${key}`);
    const model = await readJSON(asset);
    if (!model || typeof model !== 'object' || Array.isArray(model)) throw new Error('模型定义必须是 JSON 对象');
    stack.unshift(model);
    if (!model.parent) break;
    key = resourceKey(model.parent);
    if (key.startsWith('builtin/')) { builtin = key; break; }
    asset = lookup(context.models, key);
  }
  const result = { textures: {}, display: {}, elements: undefined, builtin, chainLength: stack.length };
  for (const model of stack) {
    Object.assign(result.textures, model.textures || {});
    Object.assign(result.display, model.display || {});
    if (own(model, 'elements')) result.elements = model.elements;
  }
  return result;
}

export function resolveTexture(reference, textures) {
  const seen = new Set();
  while (typeof reference === 'string' && reference.startsWith('#')) {
    const key = reference.slice(1);
    if (seen.has(key)) throw new Error(`贴图引用循环：#${key}`);
    seen.add(key);
    if (!own(textures, key)) throw new UnsupportedPreview(`模型缺少贴图绑定：#${key}`);
    reference = textures[key];
  }
  return resourceKey(reference);
}

export function faceData(element, direction, face) {
  const [x1, y1, z1] = element.from, [x2, y2, z2] = element.to;
  const definitions = {
    down: { points: [[x1,y1,z2],[x1,y1,z1],[x2,y1,z1],[x2,y1,z2]], uv: [x1,16-z2,x2,16-z1], shade: .5 },
    up: { points: [[x1,y2,z1],[x1,y2,z2],[x2,y2,z2],[x2,y2,z1]], uv: [x1,z1,x2,z2], shade: 1 },
    north: { points: [[x2,y2,z1],[x2,y1,z1],[x1,y1,z1],[x1,y2,z1]], uv: [16-x2,16-y2,16-x1,16-y1], shade: .8 },
    south: { points: [[x1,y2,z2],[x1,y1,z2],[x2,y1,z2],[x2,y2,z2]], uv: [x1,16-y2,x2,16-y1], shade: .8 },
    west: { points: [[x1,y2,z1],[x1,y1,z1],[x1,y1,z2],[x1,y2,z2]], uv: [z1,16-y2,z2,16-y1], shade: .6 },
    east: { points: [[x2,y2,z2],[x2,y1,z2],[x2,y1,z1],[x2,y2,z1]], uv: [16-z2,16-y2,16-z1,16-y1], shade: .6 },
  };
  const spec = definitions[direction];
  if (!spec) throw new Error(`未知模型面：${direction}`);
  const uv = face.uv || spec.uv;
  if (!Array.isArray(uv) || uv.length !== 4 || !uv.every(Number.isFinite)) throw new Error('模型面 UV 无效');
  const rotation = face.rotation || 0;
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('模型面旋转必须是 0/90/180/270');
  const corners = [[uv[0],uv[1]], [uv[0],uv[3]], [uv[2],uv[3]], [uv[2],uv[1]]];
  return { positions: spec.points.flat(), uv: corners.map((_, i) => corners[(i + rotation / 90) % 4]).flatMap(([u,v]) => [u / 16, 1 - v / 16]), shade: element.shade === false ? 1 : spec.shade };
}

function validTriplet(value) { return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite); }

export async function createMCPreview(scope, row) {
  const loadedJSON = new Map();
  const readJSON = async asset => {
    if (!loadedJSON.has(asset)) loadedJSON.set(asset, assetText(scope, asset).then(text => JSON.parse(text)));
    const result = await loadedJSON.get(asset); scope.check(); return result;
  };
  const model = await resolveModel(row, scope.context, readJSON); scope.check();
  const hasElements = Array.isArray(model.elements) && model.elements.length > 0;
  const generated = !hasElements && model.builtin === 'builtin/generated';
  if (!hasElements && !generated) throw new UnsupportedPreview(model.builtin === 'builtin/entity' ? '此模型由游戏实体渲染器提供几何；这里保留原定义，不绘制替代立方体' : '此定义没有可预览的 elements 或 generated 图层');
  const textureAssets = new Map();
  const textureFor = reference => {
    const key = resolveTexture(reference, model.textures), asset = lookup(scope.context.textures, key);
    if (!asset) throw new UnsupportedPreview(`贴图未收录：${key}`);
    textureAssets.set(key, asset); return key;
  };
  const layers = [];
  if (generated) {
    for (let layer = 0; layer < 5; layer++) {
      if (!own(model.textures, `layer${layer}`)) break;
      layers.push(textureFor(`#layer${layer}`));
    }
    if (!layers.length) throw new UnsupportedPreview('generated 模型没有 layer0 真实贴图');
  } else {
    for (const element of model.elements) {
      if (!validTriplet(element.from) || !validTriplet(element.to)) throw new Error('模型元素的 from/to 无效');
      for (const face of Object.values(element.faces || {})) textureFor(face.texture);
    }
  }
  if (!textureAssets.size) throw new UnsupportedPreview('此模型没有可见贴图面');
  const images = new Map();
  // Only this active model's textures are decoded; there is no whole-library cache.
  const queue = [...textureAssets]; let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (next < queue.length) {
      const [key, asset] = queue[next++];
      images.set(key, await assetImage(scope, asset)); scope.check();
    }
  }));
  scope.check();
  const stage = useStage(scope);
  const textures = new Map(), materials = new Map();
  const geometries = new Set();
  scope.own(() => { for (const geometry of geometries) geometry.dispose(); for (const material of materials.values()) material.dispose(); for (const texture of textures.values()) texture.dispose(); images.clear(); loadedJSON.clear(); });
  let strips = false, tinted = false;
  for (const [key, image] of images) {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    // Vanilla animated strips use a square first tile. Their independent texture
    // player remains the authoritative mcmeta consumer; model inspection is static.
    if (image.height > image.width && image.height % image.width === 0) {
      texture.repeat.y = image.width / image.height; texture.offset.y = 1 - texture.repeat.y; strips = true;
    }
    texture.needsUpdate = true; textures.set(key, texture);
    materials.set(key, new THREE.MeshBasicMaterial({ map: texture, vertexColors: !generated, side: generated ? THREE.DoubleSide : THREE.FrontSide, transparent: generated, alphaTest: .05, depthWrite: !generated }));
  }
  const scene = new THREE.Scene(), object = new THREE.Group(); scene.add(object);
  if (generated) {
    layers.forEach((key, index) => {
      const geometry = new THREE.PlaneGeometry(16, 16); geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, materials.get(key)); mesh.position.set(8, 8, 8 + index * .015); mesh.renderOrder = index; object.add(mesh);
    });
  } else {
    for (const element of model.elements) {
      const group = new THREE.Group(); object.add(group);
      let origin = [0, 0, 0];
      if (element.rotation) {
        const rotation = element.rotation;
        if (!validTriplet(rotation.origin) || !['x','y','z'].includes(rotation.axis) || !Number.isFinite(rotation.angle) || Math.abs(rotation.angle) >= 90) throw new Error('元素旋转定义无效');
        origin = rotation.origin; group.position.fromArray(origin); group.rotation[rotation.axis] = radians(rotation.angle);
        if (rotation.rescale) {
          const factor = 1 / Math.cos(radians(rotation.angle));
          for (const axis of ['x','y','z']) if (axis !== rotation.axis) group.scale[axis] = factor;
        }
      }
      for (const [direction, face] of Object.entries(element.faces || {})) {
        const definition = faceData(element, direction, face), key = resolveTexture(face.texture, model.textures);
        const positions = definition.positions.map((value, index) => value - origin[index % 3]);
        const geometry = new THREE.BufferGeometry(); geometries.add(geometry);
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(definition.uv, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array(12).fill(definition.shade), 3));
        geometry.setIndex([0,1,2,0,2,3]); geometry.computeVertexNormals();
        if (Number.isInteger(face.tintindex) && face.tintindex >= 0) tinted = true;
        group.add(new THREE.Mesh(geometry, materials.get(key)));
      }
    }
  }
  const bounds = new THREE.Box3().setFromObject(object), size = new THREE.Vector3(), center = new THREE.Vector3();
  bounds.getSize(size); bounds.getCenter(center);
  if (!Number.isFinite(size.length()) || size.length() <= 0) throw new UnsupportedPreview('模型没有有限可见几何');
  const camera = new THREE.OrthographicCamera(-1,1,1,-1,.01,10000);
  let yaw = generated ? 0 : Math.PI / 4, pitch = generated ? 0 : .5, zoom = 1;
  const resetView = () => { yaw = generated ? 0 : Math.PI / 4; pitch = generated ? 0 : .5; zoom = 1; stage.invalidate(); return true; };
  bindDrag(scope, { drag(dx,dy) { yaw += dx * .01; pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * .01)); stage.invalidate(); }, zoom(factor) { zoom = Math.max(.2, Math.min(8, zoom * factor)); stage.invalidate(); } });
  registerView(scope, stage, {
    draw(shared, { rect }) {
      const aspect = rect.width / rect.height, diameter = size.length() * 1.12;
      const halfHeight = diameter / 2 / zoom * Math.max(1, 1 / aspect);
      camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight;
      const distance = Math.max(100, diameter * 3);
      camera.position.set(center.x + Math.sin(yaw) * Math.cos(pitch) * distance, center.y + Math.sin(pitch) * distance, center.z + Math.cos(yaw) * Math.cos(pitch) * distance);
      camera.lookAt(center); camera.updateProjectionMatrix(); shared.renderer.render(scene, camera);
    },
  });
  const note = [generated ? `${layers.length} 层真实物品贴图` : `${model.elements.length} 个模型元素`, strips ? '动画贴图显示首帧' : '', tinted ? '贴图原色，未指定生物群系染色' : ''].filter(Boolean).join('；');
  scope.status('ready', note);
  return { animations: [], skins: [], time: 0, duration: 0, playing: false, play: () => false, pause: () => true, seek: () => false, setSpeed: () => false, resetView };
}
