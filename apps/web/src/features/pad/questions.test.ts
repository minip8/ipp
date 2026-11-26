import type { Message } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { questionNumbers, spokenText } from './questions';

const m = (id: string, intent: Message['intent'], text = 'text'): Message => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  padId: '00000000-0000-4000-8000-000000000001',
  role: 'interviewer',
  kind: 'proactive',
  intent,
  text,
  via: 'text',
  userId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('a quant round in the conversation', () => {
  const messages = [
    m('1', 'greeting', 'Hi'),
    m('2', 'question', 'What is $P(X > \\tfrac{3}{2})$?'),
    m('3', 'feedback', 'Right, $\\frac{1}{8}$.'),
    m('4', 'question', 'Find $E[N]$.'),
  ];

  it('numbers the posed questions in order', () => {
    const n = questionNumbers(messages);
    expect([...n.values()]).toEqual([1, 2]);
    expect(n.get(messages[3]?.id ?? '')).toBe(2);
  });

  it('points to a question instead of reading its LaTeX, and reads everything else', () => {
    expect(spokenText(messages[1] as Message, messages)).toBe('Question 1 is on your screen.');
    expect(spokenText(messages[3] as Message, messages)).toBe('Question 2 is on your screen.');
    expect(spokenText(messages[0] as Message, messages)).toBe('Hi');
    // A question not (yet) in the list it is counted in.
    expect(spokenText(m('9', 'question'), [])).toBe('The next question is on your screen.');
  });
});
