import type { Message, QuantQuestionView, QuantRoundView } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { questionNumber, spokenText } from './questions';

const id = (n: string) => `00000000-0000-4000-8000-00000000000${n}`;

const m = (n: string, intent: Message['intent'], text = 'text'): Message => ({
  id: id(n),
  padId: '00000000-0000-4000-8000-000000000001',
  role: 'interviewer',
  kind: 'proactive',
  intent,
  text,
  via: 'text',
  userId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const posed = (index: number, messageId: string): QuantQuestionView => ({
  index,
  topic: 'probability',
  topicTitle: 'Probability',
  difficulty: 'easy',
  prompt: 'p',
  unit: null,
  posedAt: '2026-01-01T00:00:00.000Z',
  budgetSec: 300,
  closedAt: null,
  closedBy: null,
  hintsGiven: 0,
  posedMessageId: messageId,
});

const round = (questions: QuantQuestionView[], phase: QuantRoundView['phase'] = 'asking') => ({
  total: 4,
  phase,
  questions,
});

describe('a quant round in the conversation', () => {
  // Message ids out of step with the order: numbering by position would get them wrong.
  const view = round([posed(0, id('1')), posed(1, id('4')), posed(2, id('2'))]);

  it('numbers a question message by its id in the round, not by its place in the list', () => {
    expect(questionNumber(view, id('2'))).toBe(3);
    expect(questionNumber(view, id('4'))).toBe(2);
    expect(questionNumber(null, id('2'))).toBeNull();
  });

  it('a question message the round has not named yet is the next one', () => {
    expect(questionNumber(view, id('9'))).toBe(4);
    expect(questionNumber(round([posed(0, id('1'))], 'finished'), id('9'))).toBeNull();
    const all = round([0, 1, 2, 3].map((i) => posed(i, id(String(i + 1)))));
    expect(questionNumber(all, id('9'))).toBeNull();
  });

  it('points to a question instead of reading its LaTeX, and reads everything else', () => {
    expect(spokenText(m('2', 'question', 'What is $P(X > \\tfrac{3}{2})$?'), view)).toBe(
      'Question 3 is on your screen.',
    );
    expect(spokenText(m('3', 'greeting', 'Hi'), view)).toBe('Hi');
    expect(spokenText(m('9', 'question'), null)).toBe('The next question is on your screen.');
  });
});
