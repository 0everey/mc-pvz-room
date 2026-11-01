// A user gesture starts audio; list animation controls never start it.
let activePlayer = null;

export function createAudioPlayer(host, {src, label, signal, preload = 'none'}) {
  const wrap = document.createElement('div');
  wrap.className = 'audio-preview';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'audio-toggle';
  const waveform = document.createElement('span');
  waveform.className = 'audio-wave'; waveform.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 18; i++) { const bar = document.createElement('i'); bar.style.setProperty('--bar', String(20 + ((i * 17) % 60))); waveform.append(bar); }
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = preload;
  const status = document.createElement('span');
  status.className = 'audio-status';
  status.setAttribute('role', 'status');
  wrap.append(toggle, waveform, audio, status);
  host.append(wrap);
  let disposed = false, generation = 0, currentLabel = label;

  function update() {
    if (disposed) return;
    toggle.textContent = audio.paused ? '▶' : 'Ⅱ';
    toggle.setAttribute('aria-label', (audio.paused ? '试听 ' : '暂停试听 ') + currentLabel);
    audio.setAttribute('aria-label', currentLabel + ' 音频控制');
    let state;
    if (audio.error) {
      state = 'error';
      status.textContent = {1:'播放已中止，可重试', 2:'音效读取失败，请重试', 3:'音效解码失败，可下载原件', 4:'当前浏览器无法播放此音效，可下载原件'}[audio.error.code] || '音效暂不可播放';
    } else if (audio.ended) {
      state = 'ended'; status.textContent = '播放结束 · 可再次试听';
    } else if (!audio.paused) {
      state = audio.readyState >= 3 ? 'playing' : 'loading';
      status.textContent = state === 'playing' ? '正在试听' : '正在缓冲音效…';
    } else {
      state = audio.readyState ? 'paused' : 'loading';
      status.textContent = audio.currentTime > 0 ? '已暂停 · 点击继续' : audio.readyState ? '点卡片任意空白处试听' : '点击卡片试听';
    }
    wrap.dataset.audioState = state;
  }

  const controller = {
    mediaKind: 'audio',
    get playing() { return !disposed && !audio.paused; },
    get time() { return disposed ? 0 : audio.currentTime || 0; },
    seek(value) { if (disposed || !Number.isFinite(value)) return false; try { audio.currentTime = Math.max(0, value); update(); return true; } catch { return false; } },
    toggle() { return audio.paused ? controller.play() : controller.pause(); },
    async play() {
      if (disposed || signal.aborted) return false;
      const ticket = generation;
      try {
        if (audio.error) audio.load();
        await audio.play();
        return !disposed && ticket === generation && !audio.paused;
      } catch (error) {
        if (!disposed && ticket === generation) {
          update();
          if (error.name !== 'AbortError') {
            wrap.dataset.audioState = 'error';
            status.textContent = error.name === 'NotAllowedError' ? '浏览器阻止了播放，请再次点击试听' : '暂时无法播放，请重试或下载原件';
          }
        }
        return false;
      }
    },
    pause() { generation++; audio.pause(); update(); return true; },
    setSource(nextURL, nextLabel = label) {
      if (disposed) return false;
      generation++; audio.pause(); currentLabel = nextLabel;
      audio.src = nextURL; audio.load(); update(); return true;
    },
    dispose() {
      if (disposed) return true;
      disposed = true; generation++;
      if (activePlayer === controller) activePlayer = null;
      for (const type of events) audio.removeEventListener(type, update);
      audio.removeEventListener('play', takeOwnership);
      signal.removeEventListener('abort', abort);
      audio.pause(); audio.removeAttribute('src'); audio.load(); wrap.remove();
      return true;
    }
  };
  function takeOwnership() {
    if (disposed) return;
    if (activePlayer && activePlayer !== controller) activePlayer.pause();
    activePlayer = controller;
    update();
  }
  const events = ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'pause', 'ended', 'error', 'volumechange', 'emptied'];
  for (const type of events) audio.addEventListener(type, update);
  audio.addEventListener('play', takeOwnership);
  wrap.addEventListener('click', event => {
    event.stopPropagation();
    if (!event.target.closest('button,audio,input,select,label,a')) void controller.toggle();
  });
  toggle.addEventListener('click', () => void controller.toggle());
  const abort = () => controller.dispose();
  signal.addEventListener('abort', abort, {once: true});
  audio.src = src;
  update();
  if (signal.aborted) controller.dispose();
  return controller;
}
