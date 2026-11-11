#!/usr/bin/env node
// Hostile self-audit of Agent D's multilingual evidence compiler. These are
// test-only mutations to ignored JSON objects; no model or DB access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateI18nEvidence} from './review-benchmark-coach-i18n-proof.mjs';
const good=JSON.parse(readFileSync('qa/review-excellence/results/coach-i18n-real-pipeline.json','utf8'));
assert.deepEqual(validateI18nEvidence(good),{
 languages_proved:5,winner_escapes:5,king_square_escapes:5,model_requests:30,certified:false
});
const variants=[
 ['missing language',r=>r.per_language.pop()],
 ['wrong Gold winner',r=>r.per_language[0].source_truth.winner='white'],
 ['wrong gold square',r=>r.per_language[0].source_truth.white_king_square='e2'],
 ['fabricated source SHA',r=>r.candidate_sha='a'.repeat(40)],
 ['fake engine digest',r=>r.engine_sha256='a'.repeat(64)],
 ['missing API request',r=>r.requests=29],
 ['falsely declared certified',r=>r.product_factuality_certified=true],
 ['silent move changed',r=>r.per_language[0].generated_moment='Neutral output'],
 ['one escaped flaw hidden',r=>r.per_language[1].false_winner_accepted=false],
 ['false benign control',r=>r.per_language[0].true_summary_accepted=false]
];
for(const [label,mutate] of variants){
 const corrupted=structuredClone(good);
 mutate(corrupted);
 assert.throws(()=>validateI18nEvidence(corrupted),undefined,label+' was not detected');
 console.log('REJECTED',label);
}
console.log(JSON.stringify({one_positive_accepted:true,independent_mutations_rejected:variants.length}));
