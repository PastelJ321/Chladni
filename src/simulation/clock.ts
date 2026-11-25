/** Absolute display clock: dropped frames do not slow scientific playback. */
export class PlaybackClock {
  time = 0;
  rate = 1;
  playing = false;
  anchor = 0;
  duration = 0;
  sample(now = performance.now()) {
    return Math.min(
      this.duration,
      Math.max(0, this.time + (this.playing ? ((now - this.anchor) / 1000) * this.rate : 0)),
    );
  }
  seek(t: number, now = performance.now()) {
    this.time = Math.max(0, Math.min(this.duration, t));
    this.anchor = now;
  }
  play(now = performance.now()) {
    this.seek(this.sample(now), now);
    this.playing = true;
  }
  pause(now = performance.now()) {
    this.seek(this.sample(now), now);
    this.playing = false;
  }
  speed(rate: number, now = performance.now()) {
    this.seek(this.sample(now), now);
    this.rate = rate;
  }
}
