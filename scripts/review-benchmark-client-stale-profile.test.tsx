// @vitest-environment happy-dom
/**
 * Independent Agent D React consumer test against a detached Agent C source.
 * The component receives an SSE `done` event that is structurally valid but
 * stamped for an old language/audience. We must not assume the client checks
 * profile provenance just because it checks JSON completeness.
 *
 * This is diagnostic; a successful hostile test is evidence of acceptance,
 * NOT proof that the full release or user learning experience is correct.
 */
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import GameReportPanel, {type GameReviewProse} from '../qa/review-excellence/results/worktree-product-latest/web/src/components/GameReportPanel';

// Controlled Spanish-locale test environment. The actual Game Report panel
// has no audience prop and cannot distinguish the current profile here.
vi.mock('react-i18next', () => ({
 useTranslation: () => ({
  i18n:{language:'es'},
  t:(key:string,options?:{defaultValue?:string})=>key==='review.generateReport'
   ? 'Escribir informe' : options?.defaultValue??key,
 }),
}));
vi.mock('../qa/review-excellence/results/worktree-product-latest/web/src/lib/markdown',()=>({
 renderMarkdown:(value:string)=>value,stripReasoning:(value:string)=>value,
}));

function fakeResponse(review:GameReviewProse){
 const bytes=new TextEncoder().encode('event: progress\ndata: {"step":"summary","done":1,"total":1}\n\n'
  +'event: done\ndata: '+JSON.stringify({review})+'\n\n');
 const cancel=vi.fn().mockResolvedValue(undefined);
 const reader={read:vi.fn().mockResolvedValueOnce({done:false,value:bytes})
  .mockImplementation(()=>new Promise(()=>undefined)),cancel};
 return {ok:true,body:{getReader:()=>reader}};
}
function report(language:'en'|'es',audience:'beginner'|'advanced',summary:string):GameReviewProse{
 return {version:9,language,audience,opening:null,summary,
  skill_assessment:'One game does not prove a rating.',
  phases:{opening:null,middlegame:null,endgame:null},key_moments:[]};
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});

describe('Agent D — real GameReportPanel response provenance',()=>{
 it('renders a completed old-English beginner response despite Spanish UI context',async()=>{
  const stale=report('en','beginner','QA_STALE_BEGINNER_ENGLISH_REVIEW');
  const onGenerated=vi.fn();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(fakeResponse(stale)));
  render(<GameReportPanel gameId={41} initial={null} onGenerated={onGenerated}/>);
  fireEvent.click(screen.getByRole('button',{name:'Escribir informe'}));
  await waitFor(()=>expect(screen.getByText(stale.summary)).toBeTruthy());
  expect(onGenerated).toHaveBeenCalledExactlyOnceWith(stale);
  expect(screen.queryByRole('alert')).toBeNull();
 });

 it('also renders a matching Spanish advanced response as a positive control',async()=>{
  const fresh=report('es','advanced','QA_FRESH_SPANISH_ADVANCED_REVIEW');
  const onGenerated=vi.fn();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(fakeResponse(fresh)));
  render(<GameReportPanel gameId={42} initial={null} onGenerated={onGenerated}/>);
  fireEvent.click(screen.getByRole('button',{name:'Escribir informe'}));
  await waitFor(()=>expect(screen.getByText(fresh.summary)).toBeTruthy());
  expect(onGenerated).toHaveBeenCalledExactlyOnceWith(fresh);
  expect(screen.queryByRole('alert')).toBeNull();
 });

 it('rejects malformed done payloads rather than falsely calling them completed',async()=>{
  const broken={...report('en','beginner','QA_MALFORMED_REVIEW'),phases:null} as unknown as GameReviewProse;
  const onGenerated=vi.fn();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(fakeResponse(broken)));
  render(<GameReportPanel gameId={43} initial={null} onGenerated={onGenerated}/>);
  fireEvent.click(screen.getByRole('button',{name:'Escribir informe'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('invalid result'));
  expect(onGenerated).not.toHaveBeenCalled();
  expect(screen.queryByText('QA_MALFORMED_REVIEW')).toBeNull();
 });
});
