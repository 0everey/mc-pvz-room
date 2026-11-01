import {decodePacked} from './catalog-loader.js';

self.onmessage = async event => {
  try {
    const {raw, bytes, sha256} = event.data;
    if (raw.byteLength !== bytes) throw Error('完整目录大小不一致，请重试。');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), value => value.toString(16).padStart(2, '0')).join('');
    if (digest !== sha256) throw Error('完整目录内容不一致，请重试。');
    // Native JSON parsing on the page is cheaper than cloning thousands of object graphs.
    self.postMessage({json: JSON.stringify(decodePacked(JSON.parse(new TextDecoder().decode(raw))))});
  } catch (error) { self.postMessage({error: error.message}); }
};
