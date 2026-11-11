#!/usr/bin/env node
/** Fresh separately executed Hono, auth and disposable SQLite source test.
 * Bind run UUID from stdout to raw HTTP bodies; try one forged release green. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifyPgnReadEvidence} from './review-benchmark-coach-pgn-read-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const runId=randomUUID();
const call=spawnSync(process.execPath,
 ['--import','tsx','scripts/review-benchmark-coach-pgn-read-race.mjs','--run-id='+runId],
 {cwd:root,encoding:'utf8',timeout:12000,maxBuffer:2*1024*1024});
assert.ifError(call.error);
assert.equal(call.status,0,'real Hono/SQLite test failed: '+call.stderr.slice(-1200));
let output;
try{output=JSON.parse(call.stdout);}catch{
 throw Error('source route runner output not JSON: '+call.stdout.slice(-500));
}
assert.equal(output.run_id,runId,'reused prior stdout not tied to fresh test run');
const raw=JSON.parse(readFileSync(join(results,'coach-pgn-read-freshness.json'),'utf8'));
assert.equal(raw.run_id,runId,'reused prior raw HTTP evidence instead of current test');
assert.deepEqual(output.observations,raw.observations);
assert.equal(output.release_approved,false);
const checked=verifyPgnReadEvidence(raw);
assert.equal(checked.stale_unmarked_read_reproduced,true);
const forged=structuredClone(raw);
forged.http_evidence.after_pgn_edit_review.body={review:null,stale:true};
forged.observations.previous_unmarked_cache_escaped_after_pgn_change=false;
forged.observations.changed_pgn_get_stale=true;
assert.throws(()=>verifyPgnReadEvidence(forged),undefined,
 'false green falsely certified changed PGN read despite unchanged owner route');
console.log(JSON.stringify({fresh_run_id:runId,
  real_authenticated_routes_and_disposable_sqlite_exercised:true,
  different_legally_replayed_game_sources:true,
  old_review_served_after_PGN_edit:true,
  owner_game_detail_still_shows_old_analysis:true,
  CAS_guard_still_blocks_outdated_writes:true,
  altered_falsely_green_read_packet_rejected:true,
  release_approved:false},null,2));
