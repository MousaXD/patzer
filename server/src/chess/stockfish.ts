import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chess.js';
import { config } from '../config.js';
import { getSetting } from '../db.js';

function discoverStockfishPath(): string | null {
  // Only well-known absolute paths and the explicit user hint are accepted.
  // We deliberately do NOT fall back to a bare "stockfish" PATH lookup — on a
  // host where someone has put a malicious `stockfish` earlier in $PATH, that
  // would silently launch attacker code with the server's privileges. If the
  // binary isn't in one of these locations, the operator must set
  // STOCKFISH_PATH (env) or stockfish_path (Admin → System).
  const candidates = [
    config.stockfishPathHint,
    getSetting('stockfish_path') || undefined,
    resolve(config.projectRoot, 'bin', process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'),
    '/usr/games/stockfish',
    '/usr/bin/stockfish',
    '/usr/local/bin/stockfish',
    '/opt/homebrew/bin/stockfish',
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// UCI commands are line-delimited. Any FEN or move string that smuggles a
// newline could inject arbitrary commands at the engine. chess.js never
// produces these today, but we assert at the boundary so a future caller
// can't regress us into the bug.
function assertNoNewline(s: string, label: string): void {
  if (/[\r\n]/.test(s)) throw new Error(`stockfish: ${label} contains newline`);
}

const UCI_MOVE_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

// Engine PVs are advisory until legally replayed. A truncated UCI iteration
// can contain an impossible continuation, and an illegal rank-two first move
// must never be mistaken for evidence that rank one is uniquely good.
function legalPvPrefix(fen: string, pv: readonly string[]): string[] {
  const board = new Chess(fen);
  const accepted: string[] = [];
  for (const uci of pv) {
    if (!UCI_MOVE_RE.test(uci)) break;
    try {
      const move = board.move({
        from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4],
      });
      if (!move || (move.promotion ?? '') !== (uci[4] ?? '')) break;
      accepted.push(uci);
    } catch { break; }
  }
  return accepted;
}

export interface EngineEval {
  cp: number | null; // centipawns from side-to-move's perspective
  mate: number | null; // moves to mate (positive = side-to-move mates)
  bestMoveUci: string | null;
  pv: string[]; // principal variation in UCI
  depth: number;
}

// One MultiPV candidate (line). cp/mate are from side-to-move's perspective —
// same convention as EngineEval — so callers can compare candidates directly.
export interface PvCandidate {
  cp: number | null;
  mate: number | null;
  pv: string[]; // UCI moves, first entry is the candidate move itself
  multipv: number; // 1-based rank
}

export interface EngineMultiEval extends EngineEval {
  candidates: PvCandidate[]; // sorted by multipv ascending; index 0 == best
}

export class StockfishEngine {
  readonly kind = 'local' as const;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private waiters: ((line: string) => void)[] = [];
  // Reject callbacks for in-flight evaluate()/bestMove() promises. quit() walks
  // this set so callers never deadlock when the engine dies mid-search.
  private deathHandlers = new Set<(err: Error) => void>();
  private readonly path: string;
  private ready = false;
  // One UCI process has a single stdin/stdout command stream. Overlapping
  // searches would consume the same bestmove and corrupt both results.
  private searchActive = false;
  // Command/ready handshakes must also be exclusive. A search started while
  // ucinewgame/isready or setoption is awaiting its write would otherwise
  // interleave UCI commands even though the search guard itself is held.
  private controlActive = false;
  private static readonly SEARCH_TIMEOUT_MS = 120_000;
  private static readonly HANDSHAKE_TIMEOUT_MS = 10_000;

  constructor(path?: string) {
    const p = path ?? discoverStockfishPath();
    if (!p) throw new Error('Stockfish binary not found. Run setup.ps1 or set STOCKFISH_PATH.');
    this.path = p;
  }

  static async test(path?: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    let e: StockfishEngine | null = null;
    try {
      e = new StockfishEngine(path);
      await e.start();
      const name = await e.name();
      return { ok: true, name };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (e) await e.quit();
    }
  }

  async start(): Promise<void> {
    if (this.proc) throw new Error('stockfish: already started');
    const proc = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      if (this.proc === proc) this.onData(chunk);
    });
    proc.stderr.resume(); // Never block an engine that writes diagnostics.
    proc.stdin.on('error', (err) => {
      if (this.proc === proc) this.failWaiters(new Error(`stockfish: ${err.message}`));
    });
    proc.on('error', (err) => {
      if (this.proc === proc) this.failWaiters(new Error(`stockfish: ${err.message}`));
    });
    proc.on('exit', () => {
      if (this.proc !== proc) return; // An old child must not reject a restarted engine.
      this.proc = null;
      this.failWaiters(new Error('engine_terminated'));
    });
    try {
      await this.sendAndWait('uci', (line) => line === 'uciok', StockfishEngine.HANDSHAKE_TIMEOUT_MS);
      this.ready = true;
    } catch (error) {
      await this.quit();
      throw error;
    }
  }

  private failWaiters(error: Error): void {
    this.ready = false;
    const handlers = Array.from(this.deathHandlers);
    this.deathHandlers.clear();
    this.waiters = [];
    for (const reject of handlers) reject(error);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) w(line);
    }
    // Only the un-terminated remainder is bounded; normal batches of many
    // short UCI lines can exceed this size without being malformed.
    if (this.buffer.length > 65_536) {
      this.failWaiters(new Error('stockfish: oversized output line'));
      void this.quit();
    }
  }

  private send(cmd: string): Promise<void> {
    return new Promise((resolveSend, rejectSend) => {
      const proc = this.proc;
      if (!proc || !proc.stdin.writable) return rejectSend(new Error('engine not started'));
      proc.stdin.write(cmd + '\n', (err) => (err ? rejectSend(err) : resolveSend()));
    });
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolveLine, rejectLine) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== handler);
        this.deathHandlers.delete(onDeath);
      };
      const onDeath = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectLine(error);
      };
      const handler = (line: string) => {
        if (settled) return;
        if (predicate(line)) {
          settled = true;
          cleanup();
          resolveLine(line);
        } else {
          this.waiters.push(handler);
        }
      };
      const timer = setTimeout(() => onDeath(new Error('engine_timeout')), timeoutMs);
      this.deathHandlers.add(onDeath);
      this.waiters.push(handler);
    });
  }

  private async sendAndWait(
    cmd: string,
    predicate: (line: string) => boolean,
    timeoutMs = StockfishEngine.HANDSHAKE_TIMEOUT_MS,
  ): Promise<string> {
    // Register BEFORE writing: fast fake engines can reply inside write().
    const response = this.waitFor(predicate, timeoutMs);
    void response.catch(() => undefined); // handled if the write itself fails
    try {
      await this.send(cmd);
      return await response;
    } catch (error) {
      // A failed write makes the session unreliable. Remove the registered
      // waiter immediately rather than leaving it behind for ten seconds.
      await this.quit();
      throw error;
    }
  }

  private awaitBestmove(onInfo: (line: string) => void): Promise<string | null> {
    return new Promise((resolveMove, rejectMove) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== handler);
        this.deathHandlers.delete(onDeath);
      };
      const finish = (error?: Error, move?: string | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) rejectMove(error);
        else resolveMove(move ?? null);
      };
      const onDeath = (error: Error) => finish(error);
      const handler = (line: string) => {
        if (settled) return;
        if (line.startsWith('bestmove')) {
          const move = line.split(' ')[1];
          finish(undefined, move === '(none)' ? null : (move ?? null));
          return;
        }
        try {
          if (line.startsWith('info ')) onInfo(line);
          this.waiters.push(handler);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          void this.quit();
        }
      };
      const timer = setTimeout(() => {
        finish(new Error('engine_timeout'));
        void this.quit();
      }, StockfishEngine.SEARCH_TIMEOUT_MS);
      this.deathHandlers.add(onDeath);
      this.waiters.push(handler);
    });
  }

  private async runSearch(cmd: string, onInfo: (line: string) => void): Promise<string | null> {
    const result = this.awaitBestmove(onInfo);
    void result.catch(() => undefined);
    try {
      await this.send(cmd);
      return await result;
    } catch (error) {
      await this.quit();
      throw error;
    }
  }

  private assertIdle(): void {
    if (this.searchActive || this.controlActive) throw new Error('engine_busy');
  }

  private async withControl<T>(work: () => Promise<T>): Promise<T> {
    this.assertIdle();
    if (!this.proc || !this.ready) throw new Error('engine_not_ready');
    this.controlActive = true;
    try {
      return await work();
    } finally {
      this.controlActive = false;
    }
  }

  private async withSearch<T>(work: () => Promise<T>): Promise<T> {
    this.assertIdle();
    if (!this.proc || !this.ready) throw new Error('engine_not_ready');
    this.searchActive = true; // acquire synchronously, before any awaited write
    try {
      return await work();
    } finally {
      this.searchActive = false;
    }
  }

  private async sendOption(name: string, value: string | number): Promise<void> {
    assertNoNewline(name, 'option name');
    assertNoNewline(String(value), 'option value');
    await this.send(`setoption name ${name} value ${value}`);
  }

  async setOption(name: string, value: string | number): Promise<void> {
    return this.withControl(() => this.sendOption(name, value));
  }

  async newGame(): Promise<void> {
    return this.withControl(async () => {
      await this.send('ucinewgame');
      await this.sendAndWait('isready', (l) => l === 'readyok');
    });
  }

  async name(): Promise<string> {
    return this.withControl(async () => {
      const line = await this.sendAndWait('uci', (l) => l.startsWith('id name') || l === 'uciok');
      if (line.startsWith('id name')) return line.replace('id name ', '');
      return 'Stockfish';
    });
  }

  async evaluate(fen: string, depth: number): Promise<EngineEval> {
    assertNoNewline(fen, 'fen');
    return this.withSearch(async () => {
      await this.send(`position fen ${fen}`);

      let lastInfo: { cp: number | null; mate: number | null; pv: string[]; depth: number; seldepth: number } = {
        cp: null, mate: null, pv: [], depth: 0, seldepth: 0,
      };
      const bestMove = await this.runSearch(`go depth ${depth}`, (line) => {
        const parsed = parseInfoLine(line);
        if (parsed
            && (parsed.cp !== null || parsed.mate !== null)
            && !parsed.bound
            && (parsed.depth > lastInfo.depth
                || (parsed.depth === lastInfo.depth && parsed.seldepth >= lastInfo.seldepth))) {
          lastInfo = parsed;
        }
      });
      const legalPv = legalPvPrefix(fen, lastInfo.pv);
      return {
        cp: lastInfo.cp, mate: lastInfo.mate, bestMoveUci: bestMove,
        pv: legalPv[0] === bestMove ? legalPv : [], depth: lastInfo.depth,
      };
    });
  }

  // MultiPV evaluation: returns the engine's top-N candidate moves at the
  // requested depth. Required for "Great" (only-good-move detection) and for
  // gap-aware Brilliant gating. Tracks per-multipv lastInfo so a deeper line
  // for rank 2 doesn't overwrite a shallower line for rank 1.
  async evaluateMulti(fen: string, depth: number, n: number): Promise<EngineMultiEval> {
    assertNoNewline(fen, 'fen');
    return this.withSearch(async () => {
      const numLines = Math.max(1, Math.min(8, n));
      await this.sendOption('MultiPV', numLines);
      try {
        await this.send(`position fen ${fen}`);
        const perRank = new Map<number, { cp: number | null; mate: number | null; pv: string[]; depth: number; seldepth: number }>();
        const bestMove = await this.runSearch(`go depth ${depth}`, (line) => {
          const parsed = parseInfoLine(line);
          if (!parsed || (parsed.cp === null && parsed.mate === null) || parsed.bound) return;
          const rank = parsed.multipv;
          if (rank < 1 || rank > numLines) return;
          const prev = perRank.get(rank);
          if (!prev || parsed.depth > prev.depth
              || (parsed.depth === prev.depth && parsed.seldepth >= prev.seldepth)) {
            perRank.set(rank, parsed);
          }
        });

        // Only compare candidates at the same completed iteration as rank one.
        // Mixed-depth rankings can manufacture a false "only good move" verdict.
        const top = perRank.get(1);
        const topPv = top ? legalPvPrefix(fen, top.pv) : [];
        // A final bestmove that differs from the last rank-one PV proves the
        // candidate snapshot is incomplete/inconsistent. Keep the root score,
        // but do not expose candidate gaps as "only good move" evidence.
        const candidates: PvCandidate[] = [];
        if (bestMove !== null && topPv[0] === bestMove) {
          const seenMoves = new Set<string>();
          let expectedRank = 1;
          for (const [rank, info] of [...perRank.entries()].sort(([a], [b]) => a - b)) {
            // Rank 3 cannot stand in for an absent or invalid rank 2. The
            // classifier consumes these as ordered alternatives for a gap.
            if (rank !== expectedRank || (rank !== 1 && info.depth !== top!.depth)) break;
            const pv = rank === 1 ? topPv : legalPvPrefix(fen, info.pv);
            if (!pv[0] || seenMoves.has(pv[0])) break;
            seenMoves.add(pv[0]);
            candidates.push({ cp: info.cp, mate: info.mate, pv, multipv: rank });
            expectedRank++;
          }
        }
        return {
          cp: top?.cp ?? null,
          mate: top?.mate ?? null,
          bestMoveUci: bestMove,
          pv: candidates[0]?.pv ?? [],
          depth: top?.depth ?? 0,
          candidates,
        };
      } finally {
        if (this.ready) await this.sendOption('MultiPV', 1);
      }
    });
  }

  async bestMove(fen: string, opts: { depth?: number; movetimeMs?: number; skill?: number }): Promise<string | null> {
    assertNoNewline(fen, 'fen');
    return this.withSearch(async () => {
      if (opts.skill !== undefined) await this.sendOption('Skill Level', opts.skill);
      await this.send(`position fen ${fen}`);
      return this.runSearch(
        opts.movetimeMs !== undefined ? `go movetime ${opts.movetimeMs}` : `go depth ${opts.depth ?? 12}`,
        () => undefined,
      );
    });
  }

  // Async, idempotent shutdown. Reject waiters immediately, ask the child to
  // stop and quit, then force-kill after a bounded grace period.
  async quit(): Promise<void> {
    const proc = this.proc;
    if (!proc) {
      this.failWaiters(new Error('engine_terminated'));
      return;
    }
    this.proc = null;
    this.failWaiters(new Error('engine_terminated'));
    try { proc.stdin.write('stop\nquit\n'); } catch { /* ignore */ }

    const exited = new Promise<void>((resolveExit) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolveExit();
      proc.once('exit', () => resolveExit());
    });
    let killer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        exited,
        new Promise<void>((resolveKill) => {
          killer = setTimeout(() => {
            if (proc.exitCode === null && proc.signalCode === null) {
              try { proc.kill('SIGKILL'); } catch { /* ignore */ }
            }
            resolveKill();
          }, 500);
        }),
      ]);
    } finally {
      if (killer) clearTimeout(killer);
      this.buffer = '';
    }
  }

  isReady(): boolean { return this.ready; }
}

function parseInfoLine(line: string): { cp: number | null; mate: number | null; pv: string[]; depth: number; seldepth: number; bound: boolean; multipv: number } | null {
  // `info string` is human-readable chatter — never carries a score we care about.
  if (line.startsWith('info string')) return null;
  const tokens = line.split(' ');
  let cp: number | null = null;
  let mate: number | null = null;
  let depth = 0;
  let seldepth = 0;
  let pv: string[] = [];
  let bound = false;
  let multipv = 1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth') depth = Number(tokens[++i]);
    else if (t === 'seldepth') seldepth = Number(tokens[++i]);
    else if (t === 'multipv') multipv = Number(tokens[++i]);
    else if (t === 'score') {
      const kind = tokens[++i];
      const val = Number(tokens[++i]);
      if (kind === 'cp') cp = val;
      else if (kind === 'mate') mate = val;
      // Stockfish appends `lowerbound` / `upperbound` after the value when the
      // score is fail-soft. Those snapshots aren't reliable evals.
      const next = tokens[i + 1];
      if (next === 'lowerbound' || next === 'upperbound') { bound = true; i++; }
    } else if (t === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  if (!Number.isInteger(depth) || depth < 0 || !Number.isFinite(seldepth)
      || !Number.isInteger(multipv) || multipv < 1 || multipv > 8
      || (cp !== null && !Number.isFinite(cp))
      || (mate !== null && !Number.isFinite(mate))) return null;
  return { cp, mate, pv, depth, seldepth, bound, multipv };
}
