import { chatStream, llmConfigured } from "./llm.js";
import { momentEvidence, screenCoachProse, screenHintProse } from "./claims.js";
import { systemPrompt } from "./locales.js";
import { correctionNote, explainMovePrompt, hintPrompt } from "./facts.js";
import { contradiction, explainCoaching, fallbackText, hintCoaching, type CoachAction } from "./coaching.js";
import type { Audience, Classification, Language } from "../types.js";

// The coach's two jobs end to end, shared by the /api/coach routes and the
// in-game auto-coach on the play socket, so both give the same answer.
//
// The explanation is generated in full and checked against the engine's
// verdict before anyone sees it: a model that praises a blunder (#37) gets
// one retry with a correction, and if it does it again the player gets a
// plain answer built from the facts instead. A coach that contradicts the
// engine is worse than no coach.

export interface ExplainParams {
  fen: string;
  player: "White" | "Black";
  played_san: string;
  best_san: string | null;
  classification: Classification;
  cp_loss: number;
  eval_before_cp?: number | null;
  eval_after_cp?: number | null;
  pv_san?: string[];
  history?: string[];
  user_perspective?: boolean;
}

export interface CoachAnswer {
  text: string;
  actions: CoachAction[];
  /** How the text came about — for logs and tests. */
  source: "llm" | "llm_retry" | "fallback";
}

interface RunOpts { signal?: AbortSignal; numPredict?: number; temperature?: number }

async function generate(sys: string, usr: string, opts: RunOpts): Promise<string> {
  let acc = "";
  await chatStream(
    [{ role: "system", content: sys }, { role: "user", content: usr }],
    (t) => { acc += t; },
    { temperature: opts.temperature ?? 0.15, numPredict: opts.numPredict ?? 360, signal: opts.signal },
  );
  return acc.trim();
}

/** Strip a reasoning model's <think> block, which isn't part of the answer. */
const clean = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

export async function coachExplain(
  params: ExplainParams,
  userId: number,
  lang: Language,
  aud: Audience,
  opts: RunOpts = {},
): Promise<CoachAnswer> {
  opts.signal?.throwIfAborted();
  // Validate the recorded position, move, and actual mover *before* invoking
  // Stockfish, reading player history, or prompting a model. Otherwise even
  // an impossible move can produce an authoritative-sounding fallback.
  const evidence = momentEvidence(params.fen, params.played_san, params.best_san, params.pv_san ?? []);
  if (evidence.status !== 'verified' || params.player.toLowerCase() !== evidence.actor) {
    const unverified: Record<Language, string> = {
      en: 'I cannot verify this move from the supplied position. Check whose turn it is and the recorded move.',
      bg: 'Не мога да проверя този ход в посочената позиция. Провери кой е на ход и записания ход.',
      es: 'No puedo verificar esta jugada en la posición indicada. Comprueba a quién le toca mover y la jugada registrada.',
      de: 'Ich kann diesen Zug in der angegebenen Stellung nicht bestätigen. Prüfe, wer am Zug ist und welcher Zug aufgezeichnet wurde.',
      ru: 'Не могу проверить этот ход в указанной позиции. Проверь, чья очередь ходить и какой ход записан.',
    };
    return { text: unverified[lang], actions: [], source: 'fallback' };
  }
  // The move is the user's own when they're the one asking about their game
  // (Play), or in Game Review when the move belongs to their colour.
  const coaching = await explainCoaching({
    fen: params.fen,
    played_san: params.played_san,
    best_san: params.best_san,
    classification: params.classification,
    userId,
    ownMove: params.user_perspective ?? false,
  }, lang, aud);
  opts.signal?.throwIfAborted();
  const mate = evidence.claims.find((c) => c.evidence_type === 'reply_mate_in_one')?.variation_san?.[0];
  const better = evidence.legal_best_san && evidence.legal_best_san !== params.played_san ? evidence.legal_best_san : null;
  const verdict = String(coaching.facts.verdict ?? '').trim();
  const verdictIntro = verdict ? verdict.charAt(0).toUpperCase() + verdict.slice(1) + '.' : '';
  const qualified: Record<Language, string> = {
    en: [verdictIntro, mate ? `After ${params.played_san}, the opponent can give checkmate at once with ${mate}.` : 'The available facts do not prove a specific tactical explanation.', better ? `The recorded alternative ${better} is legal; compare the resulting positions.` : 'Examine the legal opponent replies before drawing a conclusion.'].join(' '),
    bg: [verdictIntro, mate ? `След ${params.played_san} противникът може веднага да даде мат с ${mate}.` : 'Наличните факти не доказват конкретна тактика.', better ? `Записаната алтернатива ${better} е допустима; сравни позициите.` : 'Провери допустимите отговори.'].join(' '),
    es: [verdictIntro, mate ? `Después de ${params.played_san}, el rival puede dar jaque mate con ${mate}.` : 'Los datos disponibles no demuestran una táctica concreta.', better ? `La alternativa registrada ${better} es legal; compara las posiciones.` : 'Examina las respuestas legales.'].join(' '),
    de: [verdictIntro, mate ? `Nach ${params.played_san} kann der Gegner mit ${mate} sofort Schachmatt setzen.` : 'Die vorhandenen Fakten beweisen keine konkrete Taktik.', better ? `Die gespeicherte Alternative ${better} ist legal; vergleiche die Stellungen.` : 'Prüfe die legalen Antworten.'].join(' '),
    ru: [verdictIntro, mate ? `После ${params.played_san} соперник может поставить мат ходом ${mate}.` : 'Имеющиеся данные не доказывают конкретную тактику.', better ? `Записанная альтернатива ${better} допустима; сравни позиции.` : 'Проверь допустимые ответы.'].join(' '),
  };
  const deterministic = fallbackText(coaching.facts, lang);
  const safeFallback = evidence.status === 'verified' && screenCoachProse(deterministic, evidence, lang).accepted
    ? deterministic : qualified[lang];
  const fallback = (): CoachAnswer => ({ text: safeFallback, actions: coaching.actions, source: 'fallback' });
  if (!llmConfigured()) return fallback();

  const input = {
    ...params,
    // Request-supplied scores can be stale, inverted, or fabricated. Only
    // the independently obtained engine scores for this FEN are licensed
    // to appear as win percentages in the LLM's FACTS. When unavailable,
    // keep the value unknown rather than falling back to client numbers.
    eval_before_cp: coaching.eval_before_cp,
    eval_after_cp: coaching.eval_after_cp,
  };
  const sys = systemPrompt(aud, lang);
  const usr = explainMovePrompt(input, lang, aud, coaching.facts);

  const valid = (text: string) => !contradiction(text, params.classification, lang)
    && screenCoachProse(text, evidence, lang).accepted;
  let first: string;
  try { first = clean(await generate(sys, usr, opts)); }
  catch (err) { if (opts.signal?.aborted) throw err; return fallback(); }
  if (first && valid(first)) {
    return { text: first, actions: coaching.actions, source: "llm" };
  }
  console.warn(`[coach] answer contradicted the verdict (${params.classification}); retrying`);
  const retryPrompt = explainMovePrompt(input, lang, aud, coaching.facts, correctionNote(lang, verdict));
  let second: string;
  try { second = clean(await generate(sys, retryPrompt, { ...opts, temperature: 0.05 })); }
  catch (err) { if (opts.signal?.aborted) throw err; return fallback(); }
  if (second && valid(second)) {
    return { text: second, actions: coaching.actions, source: "llm_retry" };
  }
  console.warn(`[coach] retry contradicted the verdict too; using the facts-only answer`);
  return fallback();
}

/** Buffer and screen the entire hint before sending even its first token.
 * The prompt asks for no move, but that is not a safety guarantee; streaming
 * unverified chess instructions can leak solutions irreversibly. */
export async function coachHint(
  fen: string,
  history: string[],
  userId: number,
  lang: Language,
  aud: Audience,
  onChunk: (t: string) => void | Promise<void>,
  opts: RunOpts = {},
): Promise<{ actions: CoachAction[] }> {
  opts.signal?.throwIfAborted();
  const fallback: Record<Language, string> = {
    en: 'Before moving, examine the checks and captures available to both sides. What would your opponent play next?',
    bg: 'Преди да направиш ход, провери възможните шахове и вземания за двете страни. Как би отговорил противникът?',
    es: 'Antes de mover, revisa los jaques y las capturas de ambos bandos. ¿Qué podría responder tu rival?',
    de: 'Prüfe vor deinem Zug die möglichen Schachs und Schlagzüge beider Seiten. Wie könnte dein Gegner antworten?',
    ru: 'Перед ходом проверь возможные шахи и взятия обеих сторон. Как может ответить соперник?',
  };
  // An offline generic hint does not need to start Stockfish or query game
  // memory; those facts are only consumed by the optional model prompt.
  if (!llmConfigured()) {
    await onChunk(fallback[lang]);
    return { actions: [] };
  }
  const coaching = await hintCoaching(fen, userId, lang, aud);
  opts.signal?.throwIfAborted();
  let answer = fallback[lang];
  if (llmConfigured()) {
    const sys = systemPrompt(aud, lang);
    const usr = hintPrompt(fen, aud, lang, history, coaching.facts);
    let generated = '';
    try {
      await chatStream(
        [{ role: "system", content: sys }, { role: "user", content: usr }],
        (chunk) => { generated += chunk; if (generated.length > 1800) throw new Error('hint_exceeds_safe_length'); },
        { temperature: opts.temperature ?? 0.3, numPredict: opts.numPredict ?? 220, signal: opts.signal },
      );
      const candidate = clean(generated);
      if (screenHintProse(candidate, lang)) answer = candidate;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      // A partial, failed or overlong model reply must never be revealed.
    }
  }
  opts.signal?.throwIfAborted();
  await onChunk(answer);
  return { actions: coaching.actions };
}
