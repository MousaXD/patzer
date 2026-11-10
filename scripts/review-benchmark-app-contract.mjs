#!/usr/bin/env node
// Independent black-box metamorphic probes against actual baseline modules.
// Run through: node --import tsx scripts/review-benchmark-app-contract.mjs
import assert from 'node:assert/strict';
import { cpToWinPct, moveAccuracy, classifyByWpDrop, SCORING_VERSION } from '../server/src/chess/classifier.ts';
import { gameAccuracy } from '../server/src/chess/accuracy.ts';

let count = 0;
const check = (condition, text) => { assert(condition, text); count++; };
for (let cp = -2000; cp <= 2000; cp += 20) {
  const value = cpToWinPct(cp);
  check(Number.isFinite(value) && value >= 0 && value <= 100, 'win percentage range ' + cp);
  check(Math.abs(cpToWinPct(-cp) + value - 100) < 1e-8, 'side symmetry ' + cp);
  if (cp < 2000) check(cpToWinPct(cp + 20) >= value, 'win percentage monotonicity');
}
for (let before = 0; before <= 100; before += 5) {
  let previous = 101;
  for (let after = before; after >= 0; after -= 5) {
    const acc = moveAccuracy(before, after);
    check(Number.isFinite(acc) && acc >= 0 && acc <= 100, 'accuracy range');
    check(acc <= previous + 1e-9, 'accuracy worsens with drop');
    previous = acc;
  }
}
for (const [drop, loss, best, expected] of [
  [0, 0, true, 'best'], [1, 20, false, 'excellent'],
  [4, 60, false, 'good'], [8, 110, false, 'inaccuracy'],
  [15, 200, false, 'mistake'], [25, 400, false, 'blunder']
]) check(classifyByWpDrop(drop, loss, best) === expected, 'classification example: ' + expected);
const points = [
  { acc: 99, winPct: 70, isBook: false },
  { acc: 78, winPct: 55, isBook: false },
  { acc: 25, winPct: 25, isBook: false },
  { acc: 97, winPct: 75, isBook: false }
];
const baseline = gameAccuracy(points);
check(Number.isFinite(baseline) && baseline >= 0 && baseline <= 100, 'game accuracy bounded');
check(Math.abs(gameAccuracy([...points, { acc: 0, winPct: 0, isBook: true }]) - baseline) < 1e-9, 'book excluded');
for (const value of [0, 10, 50, 90, 100]) {
  const synthetic = Array.from({ length: 10 }, () => ({ acc: value, winPct: 50, isBook: false }));
  check(Number.isFinite(gameAccuracy(synthetic)), 'uniform score finite');
}
console.log(JSON.stringify({ verdict: 'pass', scoring_version: SCORING_VERSION, assertions: count, illustrative_game_accuracy: baseline }));
