/**
 * Global process budget for agent OS processes across all projects.
 */

export class ProcessBudget {
  private inUse = 0;
  private readonly max: number;

  constructor(maxAgentProcesses = 8) {
    this.max = Math.max(1, maxAgentProcesses);
  }

  get maxProcesses(): number {
    return this.max;
  }

  get used(): number {
    return this.inUse;
  }

  tryAcquire(): boolean {
    if (this.inUse >= this.max) return false;
    this.inUse++;
    return true;
  }

  release(): void {
    if (this.inUse > 0) this.inUse--;
  }

  /** For tests: force set */
  _setUsed(n: number): void {
    this.inUse = Math.max(0, n);
  }
}
