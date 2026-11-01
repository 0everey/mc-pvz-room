// Delivery encoding changes transport only. Consumers receive the full original schema.
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const ref = (values, index) => {
  if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) throw Error('目录引用无效，请重试完整目录。');
  return values[index];
};

export function decodePacked(input) {
  if (input?.schema !== 'mc-pvz.packed.v1' || !record(input.header) || !Array.isArray(input.assets) || !Array.isArray(input.items) || !Array.isArray(input.hierarchy?.nodes)) throw Error('目录传输格式不支持。');
  const ids = input.assets.map(value => {
    if (!Array.isArray(value) || value.length !== 6 || typeof value[0] !== 'string' || !/^[a-f0-9]{64}$/.test(value[1]) || !Number.isSafeInteger(value[2]) || value[2] < 0 || typeof value[3] !== 'string' || typeof value[4] !== 'string' || !/^\.[a-z0-9]+$/i.test(value[5])) throw Error('目录原件描述无效。');
    return value[0];
  });
  if (new Set(ids).size !== ids.length) throw Error('目录原件身份重复。');
  const assets = Object.fromEntries(input.assets.map(value => [value[0], {url: 'media/' + value[1] + value[5], sha256: value[1], bytes: value[2], name: value[3], sourceRelative: value[4]}]));
  const names = input.hierarchy.nodes.map(value => {
    if (!Array.isArray(value) || value.length !== 7 || typeof value[0] !== 'string') throw Error('目录分组描述无效。');
    return value[0];
  });
  if (new Set(names).size !== names.length) throw Error('目录分组身份重复。');
  const items = input.items;
  for (const row of items) {
    if (!record(row)) throw Error('目录资源记录无效。');
    row.asset = ref(ids, row.asset);
    if (!own(row, 'id')) row.id = 'r-' + row.asset;
    if (!own(row, 'sha256')) row.sha256 = assets[row.asset].sha256;
    row.files = row.files.map(index => ref(ids, index));
    for (const key of ['semanticGroup', 'directoryGroup']) row[key] = ref(names, row[key]);
    if (row.preview && own(row.preview, 'asset')) row.preview.asset = ref(ids, row.preview.asset);
    if (row.spine) {
      row.spine.skeleton = ref(ids, row.spine.skeleton);
      row.spine.atlas = ref(ids, row.spine.atlas);
      row.spine.pages = Object.fromEntries(Object.entries(row.spine.pages).map(([key, index]) => [key, ref(ids, index)]));
    }
    if (row.event) row.event.files = row.event.files.map(index => ref(ids, index));
  }
  const nodes = Object.fromEntries(input.hierarchy.nodes.map(value => [value[0], {
    id: value[0], parentId: value[1] === null ? null : ref(names, value[1]), label: value[2], kind: value[3],
    children: value[4].map(index => ref(names, index)), directItems: value[5].map(index => ref(items, index).id), count: value[6]
  }]));
  const models = Object.fromEntries(Object.entries(input.models).map(([key, index]) => [key, ref(ids, index)]));
  const textures = Object.fromEntries(Object.entries(input.textures).map(([key, index]) => [key, ref(ids, index)]));
  const mcItems = input.mcItems;
  for (const item of Object.values(mcItems)) if (own(item, 'asset') && item.asset !== '' && item.asset !== null) item.asset = ref(ids, item.asset);
  return {...input.header, items, assets, models, textures, mcItems, hierarchy: {
    nodes, roots: Object.fromEntries(Object.entries(input.hierarchy.roots).map(([key, index]) => [key, ref(names, index)])),
    aliases: Object.fromEntries(Object.entries(input.hierarchy.aliases).map(([key, index]) => [key, ref(names, index)]))
  }};
}

function completeSchema(catalog) {
  if (catalog?.schema !== 'mc-pvz.catalog.v1' || !catalog.libraryId || !catalog.revision || !Array.isArray(catalog.items) || !record(catalog.assets) || !record(catalog.hierarchy?.nodes)) throw Error('页面与完整目录版本不一致。');
  return catalog;
}

function sameGeneration(full, manifest) {
  if (full.libraryId !== manifest.libraryId || full.revision !== manifest.revision) {
    const error = Error('资源目录已更新，请重试以取得当前版本。'); error.reloadBootstrap = true; throw error;
  }
  const rows = new Map(full.items.map(row => [row.id, row]));
  for (const row of manifest.catalog.items) {
    if (rows.get(row.id)?.downloadFingerprint !== row.downloadFingerprint) throw Error('启动资源与完整目录不一致。');
  }
  for (const [id, item] of Object.entries(manifest.catalog.assets)) {
    const expected = full.assets[id];
    if (!expected || ['url', 'sha256', 'bytes', 'name', 'sourceRelative'].some(key => item[key] !== expected[key])) throw Error('启动预览与完整目录不一致。');
  }
}

export function createCatalogLoader() {
  let starting = null, completing = null, current = null;
  const controller = new AbortController(), signal = controller.signal;
  const check = () => { if (signal.aborted) throw new DOMException('目录载入已取消', 'AbortError'); };
  const start = () => {
    if (starting) return starting;
    starting = (async () => {
      check();
      const address = new URL('./data/bootstrap.json', import.meta.url);
      const immutableShell = /\/shell\/[a-f0-9]{64}\//.test(address.pathname);
      const response = await fetch(address, {cache: immutableShell ? 'default' : 'no-cache', priority: 'high', signal});
      if (response.status === 404 && !immutableShell) {
        const legacy = await fetch('data/catalog.json', {cache: 'no-store', signal});
        if (!legacy.ok) throw Error('资源目录暂时无法读取，请重试。');
        const catalog = completeSchema(await legacy.json());
        current = {catalog, ready: true}; return current;
      }
      if (!response.ok) throw Error('首批资源暂时无法读取，请重试。');
      const manifest = await response.json(), catalog = manifest.catalog;
      if (manifest.schema !== 'mc-pvz.bootstrap.v1' || catalog?.schema !== 'mc-pvz.catalog.v1' || !Array.isArray(catalog.items) || !record(catalog.assets) || manifest.libraryId !== catalog.libraryId || manifest.revision !== catalog.revision || !record(manifest.complete)) throw Error('首批资源格式无效，请重试。');
      current = {catalog, manifest, ready: false}; return current;
    })().catch(error => { starting = null; throw error; });
    return starting;
  };
  const complete = () => {
    if (completing) return completing;
    completing = (async () => {
      const initial = await start();
      if (initial.ready) return initial.catalog;
      const {manifest} = initial, source = manifest.complete;
      const url = new URL(source.url, document.baseURI);
      if (url.origin !== location.origin || !['catalog', 'packed'].includes(source.format)) throw Error('完整目录入口无效。');
      const response = await fetch(url, {cache: source.format === 'packed' ? 'default' : 'no-store', priority: 'auto', signal});
      if (!response.ok) throw Error('完整目录暂未载入，可重试；首批资源仍可用。');
      let full;
      if (source.format === 'packed') {
        const raw = await response.arrayBuffer(); check();
        if (typeof Worker === 'function') {
          full = await new Promise((resolve, reject) => {
            const worker = new Worker(new URL('./catalog-worker.js', import.meta.url), {type: 'module'});
            const finish = (error, value) => { worker.terminate(); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
            const abort = () => finish(new DOMException('目录载入已取消', 'AbortError'));
            signal.addEventListener('abort', abort, {once: true});
            worker.onmessage = event => { try { finish(event.data.error ? Error(event.data.error) : null, event.data.error ? null : JSON.parse(event.data.json)); } catch (error) { finish(error); } };
            worker.onerror = event => { event.preventDefault(); finish(Error(event.message || '完整目录解析失败，可重试。')); };
            worker.postMessage({raw, bytes: source.bytes, sha256: source.sha256}, [raw]);
          });
        } else {
          if (raw.byteLength !== source.bytes) throw Error('完整目录大小不一致，请重试。');
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), value => value.toString(16).padStart(2, '0')).join('');
          if (digest !== source.sha256) throw Error('完整目录内容不一致，请重试。');
          full = decodePacked(JSON.parse(new TextDecoder().decode(raw)));
        }
      } else full = await response.json();
      check(); completeSchema(full); sameGeneration(full, manifest);
      return full;
    })().catch(error => { completing = null; if (error.reloadBootstrap) { starting = null; current = null; } throw error; });
    return completing;
  };
  return {start, complete, dispose: () => controller.abort(), get current() { return current; }};
}
