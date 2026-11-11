#!/usr/bin/env node
/**
 * Hostile, independent CLI tests for Agent D's own original fixture gate.
 * A zero-fixture selection is NOT a passing holdout or benchmark. Never read
 * fixture symlinks that resolve outside the curated QA corpus.
 *
 * The symlink's external target is a disposable COPY of a self-authored PGN,
 * NOT a production file. The test removes both immediately in finally.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,linkSync,mkdtempSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence');
const manifestPath=join(qa,'manifests/manifest-v2.jsonl');
const original=readFileSync(manifestPath);
const entries=original.toString('utf8').trim().split('\n').map(JSON.parse);
const sha=data=>createHash('sha256').update(data).digest('hex');
const expectedManifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
assert.equal(sha(original),expectedManifestSha,'manifest v2 has changed; independently re-review selection labels');
assert.equal(entries.filter(e=>e.split==='holdout').length,0,
 'a real holdout now exists; do not run the old empty-holdout negative control');
const scratch=mkdtempSync(join(qa,'results/selection-negative-'));
const outside=mkdtempSync(join(tmpdir(),'qa-output-negative-'));
const fixtureRoot=join(qa,'fixtures');
const proof=[];

function run({name,manifest=manifestPath,split='all',bareSplit=false,expectExit,expectReason,nonempty=false,out}){
 const args=['scripts/review-benchmark.mjs','--manifest='+manifest,
  bareSplit?'--split':'--split='+split,...(out?['--out='+out]:[])];
 const p=spawnSync(process.execPath,args,{
  cwd:root,encoding:'utf8',timeout:8000,maxBuffer:2*1024*1024,
 });
 assert.ifError(p.error);
 assert.equal(p.status,expectExit,name+': unexpected benchmark exit; stderr='+p.stderr);
 const parsed=JSON.parse(p.stdout);
 assert.equal(parsed.source_fixture_manifest_sha256,sha(readFileSync(manifest)),
  name+': benchmark reported a different manifest');
 assert(Array.isArray(parsed.failures));
 assert(Number.isInteger(parsed.metrics.checks_passed)&&parsed.metrics.checks_passed>=0,
  name+': fixture count must never become negative');
 if(expectReason){
  assert(parsed.failures.some(e=>e.reason===expectReason),
   name+': failed to detect '+expectReason);
  if(expectReason==='empty_requested_split'){
   assert.equal(parsed.fixture_count,0);
   assert.equal(parsed.metrics.checks_passed,0);
  }
 }else{
  assert.deepEqual(parsed.failures,[],name+': unexpected failures');
 }
 if(nonempty){
  assert(parsed.fixture_count>0,name+': positive control has zero tests');
  assert.equal(parsed.metrics.checks_passed,parsed.fixture_count,name+': nonempty positive control not certified');
 }
 if(out){
  const written=JSON.parse(readFileSync(out,'utf8'));
  assert.deepEqual(written,parsed,name+': output differs from stdout evidence');
 }
 const row={name,expected_exit:expectExit,observed_exit:p.status,
  fixture_count:parsed.fixture_count,checks_passed:parsed.metrics.checks_passed,
  error_reasons:parsed.failures.map(x=>x.reason)};
 proof.push(row);
 console.log(JSON.stringify(row));
 return parsed;
}

function rejectUnsafeOutput(name,path){
 const p=spawnSync(process.execPath,['scripts/review-benchmark.mjs',
  '--manifest='+manifestPath,'--split=dev','--out='+path],{
  cwd:root,encoding:'utf8',timeout:8000,maxBuffer:2*1024*1024,
 });
 assert.ifError(p.error);
 assert.equal(p.status,2,name+': untrusted destination unexpectedly accepted');
 assert(p.stderr.includes('unsafe_output_path'),
  name+': rejection must be for unsafe path rather than an unrelated crash');
 const row={name,expected_exit:2,observed_exit:p.status,error_reasons:['unsafe_output_path']};
 proof.push(row);console.log(JSON.stringify(row));
}

try{
 // The historical bug was a 0-exit, zero-case "green" holdout report.
 run({name:'empty_holdout_must_fail',split:'holdout',expectExit:1,expectReason:'empty_requested_split'});
 run({name:'unknown_split_must_fail',split:'not-a-real-split',expectExit:1,expectReason:'invalid_requested_split'});
 run({name:'unvalued_split_must_fail',bareSplit:true,expectExit:1,expectReason:'invalid_requested_split'});
 run({name:'development_cases_must_run',split:'dev',expectExit:0,nonempty:true});
 run({name:'stress_cases_must_run',split:'stress',expectExit:0,nonempty:true});
 run({name:'all_cases_must_run',split:'all',expectExit:0,nonempty:true});
 run({name:'nested_output_inside_results_allowed',split:'dev',expectExit:0,
  nonempty:true,out:join(scratch,'nested','report.json')});

 // An in-repo path's *lexical* components can look safe while its symlink
 // targets files outside the QA fixture directory. Probe with a public PGN
 // duplicate so this test cannot accidentally expose real user data.
 const source=entries.find(e=>e.fixture_id==='SYN-GAME-FOOLS-MATE');
 assert(source?.kind==='completed_game'&&source?.source_kind==='synthetic');
 const outsideFixturePgn=join(scratch,'outside-self-authored-game.pgn');
 copyFileSync(join(fixtureRoot,source.pgn_file),outsideFixturePgn);
 const filename='qa-selection-symlink-'+process.pid+'-'+Date.now()+'.pgn';
 const symbolic=join(fixtureRoot,filename);
 try{
  symlinkSync(outsideFixturePgn,symbolic);
  const attack={...source,fixture_id:'QA-TEST-SYMLINK-ESCAPE',pgn_file:basename(symbolic)};
  const attackManifest=join(scratch,'synthetic-path-attack.jsonl');
  writeFileSync(attackManifest,JSON.stringify(attack)+'\n');
  run({name:'fixture_symlink_outside_corpus_must_fail',manifest:attackManifest,
   split:'all',expectExit:1,expectReason:'unsafe_fixture_path'});
 }finally{
  unlinkSync(symbolic);
 }
 // Two distinct output attacks: a symlink file and a symlink directory.
 // Both redirect to an EXCLUSIVELY CREATED synthetic temporary directory,
 // not any real customer record. A rejected run must not touch either.
 const canary=join(outside,'canary.txt');
 const marker='QA_CANARY_MUST_STAY_UNCHANGED';
 writeFileSync(canary,marker);
 const outputLink=join(qa,'results','qa-output-link-'+process.pid+'.json');
 try{
  symlinkSync(canary,outputLink);
  rejectUnsafeOutput('output_file_symlink_must_not_overwrite_canary',outputLink);
  assert.equal(readFileSync(canary,'utf8'),marker,'output path overwrote an external canary');
 }finally{unlinkSync(outputLink);}

 const directoryLink=join(qa,'results','qa-output-dir-link-'+process.pid);
 try{
  symlinkSync(outside,directoryLink,'dir');
  rejectUnsafeOutput('output_parent_symlink_must_not_escape',join(directoryLink,'report.json'));
  assert.equal(existsSync(join(outside,'report.json')),false,
   'output path escaped via parent directory symlink');
 }finally{unlinkSync(directoryLink);}

 // Even a regular-looking output file can be a hard link to another file.
 // The runner should atomically replace the destination directory entry,
 // not truncate the external canary through the shared inode.
 const externalHardlinkCanary=join(fixtureRoot,'qa-hardlink-canary-'+process.pid+'.txt');
 const hardlinkOutput=join(qa,'results','qa-hardlink-output-'+process.pid+'.json');
 try{
  writeFileSync(externalHardlinkCanary,marker);
  linkSync(externalHardlinkCanary,hardlinkOutput);
  run({name:'existing_output_hardlink_must_not_overwrite_source',
   split:'dev',expectExit:0,nonempty:true,out:hardlinkOutput});
  assert.equal(readFileSync(externalHardlinkCanary,'utf8'),marker,
   'benchmark output overwrote the external canary through a hard link');
 }finally{
  try{unlinkSync(hardlinkOutput);}catch{}
  try{unlinkSync(externalHardlinkCanary);}catch{}
 }
}finally{
 rmSync(scratch,{recursive:true,force:true});
 rmSync(outside,{recursive:true,force:true});
}

const packet={schema_version:1,created_utc:new Date().toISOString(),
 benchmark_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 fixture_manifest_sha256:expectedManifestSha,
 scope:'benchmark selection fail-closed and synthetic input/output symlink containment',
 controls:proof,valid_positive_splits:4,adversarial_inputs_rejected:6,
 safe_existing_hardlink_replacement_verified:true,
 user_data_used:false,holdout_curated:false,release_certified:false};
 const destination=join(qa,'results/selection-negative-controls.json');
 writeFileSync(destination,JSON.stringify(packet,null,2)+'\n');
 console.log(JSON.stringify({result:destination,valid_positive_splits:4,
  adversarial_inputs_rejected:6,safe_hardlink_replacement:true,
  benchmark_release_certified:false},null,2));
