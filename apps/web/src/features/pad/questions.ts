/**
 * A quant round's questions as they appear in the conversation: the server posts each one as an
 * interviewer message with intent `question` and the bank's exact prompt (Markdown with LaTeX).
 */
import type { Message } from '@ipp/contracts';

/** Each `question` message's number in the round: the first one posed is 1. */
export function questionNumbers(messages: readonly Message[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const m of messages) if (m.intent === 'question') numbers.set(m.id, numbers.size + 1);
  return numbers;
}

/**
 * What voice mode says for an interviewer message. A posed question is not read out: its LaTeX
 * spoken symbol by symbol is useless, so it is pointed to instead ("Question 2 is on your
 * screen."). Everything else is spoken as written.
 */
export function spokenText(m: Message, messages: readonly Message[]): string {
  if (m.intent !== 'question') return m.text;
  const n = questionNumbers(messages).get(m.id);
  return n ? `Question ${n} is on your screen.` : 'The next question is on your screen.';
}
