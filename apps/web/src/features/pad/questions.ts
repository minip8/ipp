/**
 * A quant round's questions as they appear in the conversation: the server posts each one as an
 * interviewer message with intent `question` and the bank's exact prompt (Markdown with LaTeX).
 */
import type { Message, QuantRoundView } from '@ipp/contracts';

type RoundLike = Pick<QuantRoundView, 'questions' | 'total' | 'phase'>;

/**
 * A `question` message's number in the round (the first one posed is 1), found by the message's
 * id in the round view rather than by counting messages, which goes wrong once a transcript is
 * paged or capped. The message arrives just before the `round.updated` that names it; until
 * then it is the next question to be posed. null outside a round, or for an id the round cannot
 * place.
 */
export function questionNumber(round: RoundLike | null, messageId: string): number | null {
  if (!round) return null;
  const q = round.questions.find((x) => x.posedMessageId === messageId);
  if (q) return q.index + 1;
  if (round.phase === 'finished' || round.questions.length >= round.total) return null;
  return round.questions.length + 1;
}

/**
 * What voice mode says for an interviewer message. A posed question is not read out: its LaTeX
 * spoken symbol by symbol is useless, so it is pointed to instead ("Question 2 is on your
 * screen."). Everything else is spoken as written.
 */
export function spokenText(m: Message, round: RoundLike | null): string {
  if (m.intent !== 'question') return m.text;
  const n = questionNumber(round, m.id);
  return n ? `Question ${n} is on your screen.` : 'The next question is on your screen.';
}
