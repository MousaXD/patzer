#!/usr/bin/env node
/** Regression: a timed-out Chrome polling condition must STOP polling.
 * A Promise.race over an infinite loop previously leaked a live timer after
 * timeout, keeping failed QA subprocesses alive indefinitely.
 */
import assert from 'node:assert/strict';
import {until} from './review-benchmark-cdp.mjs';

let polls=0;
await assert.rejects(until(()=>{polls++;return false;},'bounded_negative_poll',85),
 /bounded_negative_poll_timeout_85/);
const atRejection=polls;
assert(atRejection>=1&&atRejection<=5,'poll loop exceeded bounded deadline');
await new Promise(resolve=>setTimeout(resolve,230));
assert.equal(polls,atRejection,'CDP poll loop survived its timeout');
const result=await until(()=>++polls>=atRejection+2,'bounded_success_poll',250);
assert(result,'a bounded successful CDP poll incorrectly timed out');
console.log(JSON.stringify({timeout_detected:true,
 polls_at_timeout:atRejection,polls_after_timeout:atRejection,
 subsequent_bounded_poll_passed:true,orphaned_polling_loop:false}));
