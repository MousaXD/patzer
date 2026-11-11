#!/usr/bin/env node
/**
 * Hostile evidence compiler for NONSTREAMING JSON completion-status claims.
 * A validated QA proof is evidence that Patzer accepted an unsafe finish
 * reason, not evidence that the application is safe or releasable.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { Chess } from 'chess.js';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const candidate='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const summaryText='Black won the game.';
const momentText='Review every move before choosing your next move.';

export function validateCompletionEvidence(report) {
 assert.equal(report.schema_version,1,'schema drift');
 assert.equal(report.candidate_sha,candidate,'wrong frozen app source');
 assert.equal(report.engine_sha256,engine,'unexpected engine identity');
 assert.equal(report.manifest_sha256,sha(join(qa,'manifests/manifest-v2.jsonl')),'fixture manifest changed');
 assert.equal(report.fixture,'SYN-GAME-FOOLS-MATE');
 assert.equal(report.source,'self-authored synthetic');
 assert.equal(report.depth,8);
 assert.equal(report.provider,'localhost QA vLLM facade');
 assert.equal(report.release_approved,false);
 assert.equal(report.product_completion_certified,false);
 const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8')
  .trim().split('\n').map(JSON.parse);
 const metadata=manifest.find(x=>x.fixture_id===report.fixture);
 assert(metadata && metadata.license==='self-authored' && metadata.source_kind==='synthetic');
 const path=join(qa,'fixtures',metadata.pgn_file);
 assert.equal(sha(path),metadata.pgn_sha256);
 const board=new Chess();board.loadPgn(readFileSync(path,'utf8'),{strict:true});
 assert.equal(board.header().Result,'0-1');
 assert(board.isCheckmate() && board.turn()==='w','independently proven Black mate');
 assert.equal(report.total_requests,9,'not all real model calls exercised');
 assert(Array.isArray(report.cases) && report.cases.length===3);
 for(const [index,status] of ['stop','length','content_filter'].entries()){
  const row=report.cases[index];
  assert.equal(row.provider_finish_reason,status,'wrong provider termination status');
  assert.equal(row.prompt_count,3,'missed real Game Review calls');
  assert.equal(row.produced_summary,summaryText,'real summary did not accept the injected JSON');
  assert.equal(row.produced_moment,momentText,'real moment did not accept injected JSON');
  assert.equal(row.ai_summary_survived,true,'incomplete response may have been blocked');
  assert.equal(row.ai_moment_survived,true,'incomplete key moment may have been blocked');
  assert.equal(row.fully_approved,false,'test must not claim certification');
 }
 assert.equal(report.length_accepted_by_real_review,true);
 assert.equal(report.content_filter_accepted_by_real_review,true);
 return {completed_positive_accepted:1,unsafe_terminations_accepted:2,real_model_calls:9,
  candidate_completion_certified:false};
}

if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)){
 const raw=JSON.parse(readFileSync(join(results,'coach-completion-real-pipeline.json'),'utf8'));
 const checks=validateCompletionEvidence(raw);
 const upstreamUnitLog=readFileSync(join(results,'completion-upstream-unit.log'),'utf8');
 assert(/Tests\s+44 passed \(44\)/.test(upstreamUnitLog),
  'Pinned candidate LLM-provider unit suite did not demonstrate 44 passing checks');
 const output={
  schema_version:1,at_utc:new Date().toISOString(),
  parent_benchmark_commit:'2db0a31c1cb2a76d50f86c885cb66b4adb053525',
  current_qa_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  qa_branch:'agent/review-benchmark-20261111',
  frozen_candidate_sha:candidate,
  manifest_v2_sha256:raw.manifest_sha256,
  verified_stockfish_sha256:engine,engine_version:'Stockfish 16',analysis_depth:8,
  fixture_id:raw.fixture,fixture_rights:'self-authored synthetic; no user data',
  model_source:'localhost controlled vLLM-compatible JSON, not a live external LLM',
  experiment:checks,
  candidate_existing_llm_provider_unit_tests_passed:44,
  observed_escape:{
   nonstream_length_accepted:true,
   nonstream_content_filter_accepted:true,
   valid_json_can_outlive_untrusted_termination:true,
   real_written_summary_and_key_moment_affected:true
  },
  verdict:{qa_attack_reproduced:true,product_json_completion_certified:false,
    release_approved:false,integration_approved:false},
  source_sha256:{
   experiment:sha(join(root,'scripts/review-benchmark-coach-completion-faults.mjs')),
   verifier:sha(join(root,'scripts/review-benchmark-coach-completion-proof.mjs'))
  },
  limits:[
   'Mock returned valid JSON despite deliberately incompatible finish reasons; this does not measure natural model errors',
   'Only one synthetic short game and vLLM-compatible non-streaming provider; not proof about every provider',
   'The streaming path already rejects length termination and is not accused by this finding',
   'No real LLM, credentials, customer games or production database used',
   'Agent B owns any protocol/client remediation; Agent D changes only independent QA'
  ]
 };
 const out=join(qa,'certification-summary-checkpoint9.json');
 writeFileSync(out,JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({report:out,...checks,product_approved:false},null,2));
}
