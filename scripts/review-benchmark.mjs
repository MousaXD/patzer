#!/usr/bin/env node
// Agent D independent, offline chess-evidence benchmark. No database, network or service access.
import { readFile, mkdir, writeFile, realpath, lstat, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Chess } from 'chess.js';

const root = resolve(import.meta.dirname, '..');
const base = join(root, 'qa/review-excellence');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf('=');
  return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const sha = x => createHash('sha256').update(x).digest('hex');
const fail = (id, reason) => ({ fixture_id: id, reason });
const main = async () => {
  const start = performance.now();
  const manifestPath = resolve(args.manifest || join(base, 'manifests/manifest-v1.jsonl'));
  const manifestBytes = await readFile(manifestPath);
  const entries = manifestBytes.toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  // An empty selection must never look like a successfully certified split.
  // In particular, HOLDOUT has not been curated yet; zero tested examples
  // are not evidence of a green held-out review benchmark.
  const requestedSplit = args.split ?? 'all';
  const allowedSplits = new Set(['dev', 'holdout', 'stress']);
  const selected = entries.filter(e => requestedSplit === 'all' || requestedSplit === e.split);
  const errors = [];
  const cases = [];
  const seen = new Set();
  if (requestedSplit !== 'all' && !allowedSplits.has(requestedSplit)) {
    errors.push(fail('__selection__', 'invalid_requested_split'));
  }
  if (selected.length === 0) errors.push(fail('__selection__', 'empty_requested_split'));
  const allowedKinds = new Set(['completed_game', 'position', 'explanation_case', 'malformed_input']);
  const fixtureRoot = await realpath(join(base, 'fixtures'));
  for (const e of entries) {
    if (!e.fixture_id || seen.has(e.fixture_id)) errors.push(fail(e.fixture_id, 'duplicate_or_missing_id'));
    seen.add(e.fixture_id);
    if (e.schema_version !== 1 || !allowedSplits.has(e.split) || !allowedKinds.has(e.kind) || e.variant !== 'standard') errors.push(fail(e.fixture_id, 'invalid_manifest_schema'));
    if (e.source_kind !== 'synthetic' || e.license !== 'self-authored' || e.consent_reference !== 'not-applicable') errors.push(fail(e.fixture_id, 'unapproved_provenance'));
    if (!Array.isArray(e.tags) || !Array.isArray(e.verified_by) || e.verified_by.length === 0) errors.push(fail(e.fixture_id, 'missing_verification_metadata'));
    if (!/^[a-f0-9]{64}$/.test(e.pgn_sha256 || '')) errors.push(fail(e.fixture_id, 'invalid_sha256'));
    if (typeof e.pgn_file !== 'string' || isAbsolute(e.pgn_file) || e.pgn_file.split('/').includes('..')) errors.push(fail(e.fixture_id, 'unsafe_fixture_path'));
  }
  for (const e of selected) {
    const before = errors.length;
    try {
      if (typeof e.pgn_file !== 'string' || isAbsolute(e.pgn_file) || e.pgn_file.split('/').includes('..')) throw Error('unsafe_fixture_path');
      const path = resolve(base, 'fixtures', e.pgn_file);
      if (!relative(join(base, 'fixtures'), path) || relative(join(base, 'fixtures'), path).startsWith('..')) throw Error('unsafe_fixture_path');
      // Prevent a symlink inside the fixture directory from redirecting the
      // runner into private files or an active database outside the QA corpus.
      const resolvedFixture = await realpath(path);
      const inside = relative(fixtureRoot, resolvedFixture);
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw Error('unsafe_fixture_path');
      // Read the resolved, verified target, not a symlink that could be
      // retargeted between containment validation and opening the file.
      const contents = await readFile(resolvedFixture, 'utf8');
      if (sha(contents) !== e.pgn_sha256) throw Error('fixture_digest_mismatch');
      if (e.kind === 'completed_game') {
        const chess = new Chess();
        chess.loadPgn(contents, { strict: true });
        if (!chess.history().length) throw Error('empty_game');
        if (e.result !== (chess.header().Result || 'unknown')) throw Error('result_mismatch');
        if (e.start_fen && e.start_fen !== (chess.header().FEN || new Chess().fen())) throw Error('start_fen_mismatch');
        cases.push({ id: e.fixture_id, checks: ['hash', 'strict_pgn', 'result'], plies: chess.history().length });
      } else {
        const data = JSON.parse(contents);
        const issues = validateEvidence(data);
        for (const issue of issues) errors.push(fail(e.fixture_id, issue));
        cases.push({ id: e.fixture_id, checks: ['hash', 'evidence'], issues });
      }
    } catch (err) { errors.push(fail(e.fixture_id, String(err.message || err))); }
    if (errors.length === before && !cases.some(c => c.id === e.fixture_id)) errors.push(fail(e.fixture_id, 'case_not_executed'));
  }
  const elapsed = Math.round(performance.now() - start);
  const result = {
    schema_version: 1, timestamp_utc: new Date().toISOString(),
    repo_sha: git('rev-parse', 'HEAD'), source_fixture_manifest_sha256: sha(manifestBytes),
    engine_sha256: null, engine_options: null, scoring_model_version: 'not_assessed',
    node_version: process.version,
    os_cpu_summary: { platform: platform(), release: release(), model: cpus()[0]?.model, logical_cpus: cpus().length, total_memory_bytes: totalmem() },
    split: requestedSplit, fixture_count: selected.length, manifest_count: entries.length, skipped_count_and_reasons: [],
    elapsed_ms: elapsed, cpu_usage_us: process.cpuUsage(), max_rss_bytes: process.resourceUsage().maxRSS * 1024,
    metrics: { checks_passed: Math.max(0, selected.length - new Set(errors.filter(e => selected.some(x => x.fixture_id === e.fixture_id)).map(e => e.fixture_id)).size), failed_checks: errors.length, game_plies: cases.reduce((n, c) => n + (c.plies || 0), 0) },
    uncertainty: 'Synthetic deterministic checks only; not an engine-strength, human-helpfulness, or accuracy-calibration benchmark',
    failures: errors, cases
  };
  if (args.out) {
    const path = resolve(args.out);
    const outputRoot = join(base, 'results');
    const rel = relative(outputRoot, path);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
      throw Error('unsafe_output_path');
    }
    await mkdir(outputRoot, { recursive: true });
    const outputRootStat = await lstat(outputRoot);
    if (!outputRootStat.isDirectory() || outputRootStat.isSymbolicLink()) throw Error('unsafe_output_path');
    const outputRootReal = await realpath(outputRoot);
    let parent = outputRoot;
    const parts = rel.split(sep);
    for (const component of parts.slice(0, -1)) {
      parent = join(parent, component);
      try { await mkdir(parent); }
      catch (err) { if (err.code !== 'EEXIST') throw err; }
      const stat = await lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('unsafe_output_path');
    }
    const parentReal = await realpath(dirname(path));
    const parentRel = relative(outputRootReal, parentReal);
    if (parentRel === '..' || parentRel.startsWith('..' + sep) || isAbsolute(parentRel)) {
      throw Error('unsafe_output_path');
    }
    try {
      const existing = await lstat(path);
      if (!existing.isFile() || existing.isSymbolicLink()) throw Error('unsafe_output_path');
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
    // Atomic rename never follows an existing destination hard link and never
    // truncates the target of an output symlink. Reject symlinks explicitly,
    // and create the temporary file exclusively within the checked parent.
    const pending = join(parentReal, '.benchmark-' + randomUUID() + '.tmp');
    try {
      await writeFile(pending, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(pending, path);
    } finally { await rm(pending, { force: true }); }
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = errors.length ? 1 : 0;
};
function git(...v) { try { return execFileSync('git', v, { cwd: root, encoding: 'utf8' }).trim(); } catch { return 'unavailable'; } }
export function validateEvidence(d) {
  const errors = [];
  let game;
  try { game = new Chess(d.fen); } catch { return ['invalid_fen']; }
  if (d.request_fen && d.request_fen !== d.fen) errors.push('stale_analysis_fen');
  if (d.request_id && d.response_request_id !== d.request_id) errors.push('stale_analysis_request');
  if (d.actor && d.actor !== game.turn()) errors.push('wrong_actor');
  if (d.best_move) {
    try { if (!new Chess(d.fen).move(uci(d.best_move))) errors.push('illegal_best_move'); } catch { errors.push('illegal_best_move'); }
  }
  if (Array.isArray(d.pv)) {
    const pvGame = new Chess(d.fen);
    for (const move of d.pv) {
      try { if (!pvGame.move(uci(move))) { errors.push('illegal_pv'); break; } }
      catch { errors.push('illegal_pv'); break; }
    }
    if (d.mate_claim && !pvGame.isCheckmate()) errors.push('unsupported_mate_claim');
    if (d.mate_claim && d.mate_claim.winner && pvGame.isCheckmate() && d.mate_claim.winner !== (pvGame.turn() === 'w' ? 'b' : 'w')) errors.push('wrong_mate_winner');
  } else if (d.mate_claim) errors.push('mate_claim_without_pv');
  if (d.eval_cp_white !== undefined && d.eval_cp_actor !== undefined) {
    if (!Number.isFinite(d.eval_cp_white) || !Number.isFinite(d.eval_cp_actor) || d.eval_cp_actor !== d.eval_cp_white * (game.turn() === 'w' ? 1 : -1)) errors.push('eval_perspective_mismatch');
  }
  if (d.classification) {
    if (!Number.isFinite(d.win_pct_drop) || !Number.isFinite(d.cp_loss) || d.win_pct_drop < 0 || d.cp_loss < 0) errors.push('classification_missing_evidence');
    else {
      const expected = d.is_best ? 'best' : d.win_pct_drop < 2 && d.cp_loss < 50 ? 'excellent' : d.win_pct_drop < 5 && d.cp_loss < 100 ? 'good' : d.win_pct_drop < 10 ? 'inaccuracy' : d.win_pct_drop < 20 ? 'mistake' : 'blunder';
      if (d.classification !== expected) errors.push('classification_evidence_mismatch');
    }
  }
  for (const claim of d.claims || []) {
    if (claim.type === 'legal_move') {
      const c = new Chess(d.fen);
      try { if (!c.move(uci(claim.uci))) errors.push('false_legal_move_claim'); } catch { errors.push('false_legal_move_claim'); }
    } else if (claim.type === 'piece_on_square') {
      const piece = game.get(claim.square);
      if (!piece || piece.type !== claim.piece || piece.color !== claim.color) errors.push('false_piece_claim');
    } else if (claim.type === 'checkmate_now' && !game.isCheckmate()) errors.push('false_checkmate_claim');
    else if (!['legal_move', 'piece_on_square', 'checkmate_now'].includes(claim.type)) errors.push('unsupported_claim_type');
  }
  return [...new Set(errors)];
}
function uci(v) {
  if (typeof v !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(v)) throw Error('invalid_uci');
  return { from: v.slice(0, 2), to: v.slice(2, 4), ...(v.length === 5 ? { promotion: v[4] } : {}) };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main().catch(e => { console.error(e); process.exitCode = 2; });
