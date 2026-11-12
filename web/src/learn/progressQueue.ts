export type ProgressSaveStatus = 'idle' | 'saving' | 'error';

/**
 * Save a player's lesson steps in order. Progress writes are snapshots, so
 * overlapping requests can restore an older step after a newer one. A failed
 * request stays at the front of the queue until the player retries; dropping
 * it could silently lose a finished lesson or an earned star result.
 *
 * The queue belongs to one mounted lesson/player. Disposing prevents later
 * requests and callbacks when the player navigates or switches accounts.
 */
export class LessonProgressQueue<T extends object> {
  private readonly pending: T[] = [];
  private active = false;
  private blocked = false;
  private disposed = false;

  constructor(
    private readonly persist: (payload: T) => Promise<unknown>,
    private readonly onStatus: (status: ProgressSaveStatus) => void,
    private readonly onSaved: () => void,
  ) {}

  enqueue(payload: T): void {
    if (this.disposed) return;
    this.pending.push(payload);
    if (!this.blocked) void this.flush();
  }

  retry(): void {
    if (this.disposed) return;
    this.blocked = false;
    void this.flush();
  }

  dispose(): void {
    this.disposed = true;
    this.pending.length = 0;
  }

  private async flush(): Promise<void> {
    if (this.active || this.disposed || this.blocked || !this.pending.length) return;
    this.active = true;
    this.onStatus('saving');
    while (!this.disposed && this.pending.length) {
      try {
        await this.persist(this.pending[0]!);
      } catch {
        if (!this.disposed) {
          this.blocked = true;
          this.onStatus('error');
        }
        break;
      }
      if (!this.disposed) {
        this.pending.shift();
        this.onSaved();
      }
    }
    this.active = false;
    if (!this.disposed && !this.blocked) this.onStatus('idle');
  }
}
