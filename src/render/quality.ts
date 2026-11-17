/** Hysteresis only changes display quality. It cannot touch particle count, solver mesh or Run. */
export class QualityGovernor {
  slow = 0;
  fast = 0;
  degraded = false;
  average = 1 / 60;
  sample(seconds: number, active: boolean) {
    if (!active || seconds > 0.5 || seconds <= 0) return;
    this.average = this.average * 0.96 + seconds * 0.04;
    if (this.average > 1 / 35) {
      this.slow++;
      this.fast = 0;
    } else if (this.average < 1 / 55) {
      this.fast++;
      this.slow = 0;
    } else {
      this.slow = Math.max(0, this.slow - 1);
      this.fast = 0;
    }
    if (this.slow > 20) this.degraded = true;
    if (this.fast > 240) this.degraded = false;
  }
}
