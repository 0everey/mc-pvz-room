// Visibility starts network work; independent lanes keep slow 3D off the light path.
export class PreviewQueue {
  constructor(root, signal, onError) {
    this.signal = signal; this.onError = onError; this.jobs = new Map();
    this.light = []; this.heavy = []; this.running = [0, 0]; this.scheduled = false;
    this.observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) this.request(entry.target);
    }, {root, rootMargin: '64px 0px', threshold: 0}) : null;
    signal.addEventListener('abort', () => { this.observer?.disconnect(); this.jobs.clear(); this.light.length = 0; this.heavy.length = 0; }, {once: true});
  }
  add(host, load, heavy = false) {
    if (this.signal.aborted) return;
    this.jobs.set(host, {host, load, lane: heavy ? 1 : 0, state: 'waiting'});
    if (this.observer) this.observer.observe(host); else this.request(host);
  }
  request(host) {
    const job = this.jobs.get(host);
    if (!job || job.state !== 'waiting' || this.signal.aborted) return;
    job.state = 'queued'; (job.lane ? this.heavy : this.light).push(job);
    if (!this.scheduled) { this.scheduled = true; queueMicrotask(() => { this.scheduled = false; this.pump(); }); }
  }
  pump() {
    if (this.signal.aborted) return;
    for (const lane of [0, 1]) {
      const queue = lane ? this.heavy : this.light, limit = lane ? 1 : 3;
      while (queue.length && this.running[lane] < limit) {
        const job = queue.shift();
        if (!job.host.isConnected) continue;
        job.state = 'running'; this.running[lane]++;
        Promise.resolve().then(() => { if (!this.signal.aborted) return job.load(); })
          .catch(error => { if (!this.signal.aborted && error.name !== 'AbortError') this.onError(job.host, error); })
          .finally(() => { job.state = 'done'; this.running[lane]--; this.pump(); });
      }
    }
  }
}
