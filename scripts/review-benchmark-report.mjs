#!/usr/bin/env node
// Compile a publishable, synthetic-only certification packet from ignored raw reports.
// Fail closed on mismatched fixture manifests or engine identities.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const data=join(qa,'results');
const sha=x=>createHash('sha256').update(x).digest('hex');
const read=path=>JSON.parse(readFileSync(join(data,path),'utf8'));
const v1=sha(readFileSync(join(qa,'manifests/manifest-v1.jsonl')));
const v2=sha(readFileSync(join(qa,'manifests/manifest-v2.jsonl')));
const cases=['main','engine','coach','product','v10'];
const results=Object.fromEntries(cases.map(name=>[name,read('compare-v2-'+name+'.json')]));
const baseline=results.main,baseIds=JSON.stringify(baseline.dataset);
for(const [name,r] of Object.entries(results)){
 if(r.manifest_sha256!==v2 || JSON.stringify(r.dataset)!==baseIds)throw Error('Fixture manifest/workload mismatch: '+name);
 if(r.engine.sha256!==baseline.engine.sha256 || r.reference_engine.sha256!==baseline.reference_engine.sha256)throw Error('Engine hash mismatch: '+name);
 if(r.engine.requested_depth!==baseline.engine.requested_depth || r.engine.threads!==baseline.engine.threads || r.engine.multipv!==baseline.engine.multipv) throw Error('Search budget mismatch: '+name);
 if(r.summary.errors || r.summary.negative_rejections!==r.summary.negative_total || r.summary.unverified_controls) throw Error('Uncertified fixture/control: '+name);
}
const mainScore=Object.fromEntries(baseline.fixtures.map(x=>[x.fixture,[x.accuracy_white,x.accuracy_black]]));
const comparisons=Object.fromEntries(cases.map(name=>{
 const x=results[name];
 return [name,{
  source_sha:x.repo_sha,scoring_version:x.scoring_version,engine_sha256:x.engine.sha256,
  checked_games:x.summary.games,checked_plies:x.summary.plies,
  validation_failures:x.summary.errors,negative_controls_rejected:x.summary.negative_rejections,
  wall_ms:x.perf.elapsed_ms,
  game_scores:x.fixtures.map(f=>({id:f.fixture,accuracy_white:f.accuracy_white,accuracy_black:f.accuracy_black,
   delta_vs_main_white:Math.round((f.accuracy_white-mainScore[f.fixture][0])*10)/10,
   delta_vs_main_black:Math.round((f.accuracy_black-mainScore[f.fixture][1])*10)/10}))
 }];
}));
const uci=read('uci-reference-depth12.json');
const life=read('lifecycle.json');
const long=read('long-96-ply.json');
const faults=read('fault-engine-summary.json');
if(faults.reference_sha256!==baseline.reference_engine.sha256 || faults.controls!==3 || faults.rejected!==3 || faults.results.some(c=>!c.verified))throw Error('Fake UCI evidence missing or mismatched');
const report={
 schema_version:1, report_type:'synthetic_offline_certification_snapshot',
 manifest_v1_sha256:v1,manifest_v2_sha256:v2,
 fixture_total:readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8').trim().split('\n').length,
 holdout:{exists:false,certified:false},
 baseline:baseline.repo_sha,
 reference_engine:{name:baseline.reference_engine.name,binary_sha256:baseline.reference_engine.sha256,
  thread_count:1,hash_mib:16,multipv:3,game_analysis_depth:8},
 app_comparisons:comparisons,
 uci_experiment:{
  sha256:uci.engine_sha256,name:uci.engine_name,depth:uci.engine_config.depth,trial_count:uci.searches.length,
  summary:uci.summary,
  samples:uci.searches.map(s=>({id:s.id,trial:s.trial,depth:s.lines[0]?.depth,nodes:s.lines[0]?.nodes,
   score_kind:s.lines[0]?.score_kind,score:s.lines[0]?.score,
   elapsed_ms:s.elapsed_ms,engine_cpu_ms:s.engine_cpu_ms,engine_peak_rss_bytes:s.engine_peak_rss_bytes}))
 },
 lifecycle:{successful:life.cases.filter(c=>c.ok).length,failed:life.failures.length,cases:life.cases.map(c=>({name:c.name,ok:c.ok,ms:c.ms,detail:c.detail||null}))},
 long_game:{source_sha:long.repo_sha,plies:long.summary.plies,app_elapsed_ms:long.fixtures[0].app_elapsed_ms,
   reference_elapsed_ms:long.fixtures[0].reference_elapsed_ms,failures:long.summary.errors},
 adversarial_engine_faults:{reference_sha256:faults.reference_sha256,controls:faults.controls,rejected:faults.rejected,results:faults.results,
   evidence_method:'scripts/review-benchmark-engine-fault-controls.mjs: external fake UCI vs separately pinned real UCI'},
 release_readiness:false,
 why_not_certified:['No sealed holdout','No human adjudicated calibration labels','Coach natural-language truth not evaluated',
 'Game Review browser task success not independently measured','No HTTP authentication/CSRF or admission/load certification',
 'Single-machine short budget and synthetic corpus; engine 16 does not establish Stockfish 17 equivalence']
};
const path=join(qa,'certification-summary-batch2.json');
writeFileSync(path,JSON.stringify(report,null,2)+'\n');
console.log('Wrote '+path+'; manifests '+v1+' / '+v2+'; comparison SHAs '+cases.map(c=>c+':'+results[c].repo_sha.slice(0,8)).join(','));
