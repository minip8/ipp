import { QuizQuestion } from '@ipp/contracts';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { loadQuizQuestions, loadQuizTopics } from '../src';
import { markdownMathErrors, quizMarkdownFields, quizMathErrors } from '../src/math';

describe('the authored quiz Markdown', () => {
  it('has no stray math in fundamentals and typesets every formula in quant', () => {
    const trackOf = new Map(loadQuizTopics().map((t) => [t.slug, t.track]));
    expect(quizMathErrors(loadQuizQuestions(), trackOf)).toEqual([]);
  });
});

describe('markdownMathErrors', () => {
  it('accepts plain text, escaped dollars and dollars in code in either track', () => {
    for (const track of ['fundamentals', 'quant'] as const) {
      expect(markdownMathErrors('It costs \\$5, or \\$10 with tax.', track)).toEqual([]);
      expect(markdownMathErrors('Run `echo $HOME`, then:\n\n```sh\n$ ls $PWD\n```', track)).toEqual(
        [],
      );
      expect(markdownMathErrors('No dollars here.', track)).toEqual([]);
    }
  });
  it('an escaped dollar is shown as a plain dollar', () => {
    const tree = unified().use(remarkParse).use(remarkMath).parse('is "\\$MAX \\$PERIOD": the');
    expect(JSON.stringify(tree)).toContain('"value":"is \\"$MAX $PERIOD\\": the"');
    expect(JSON.stringify(tree)).not.toContain('inlineMath');
  });
  it('rejects any formula in a fundamentals topic', () => {
    const errors = markdownMathErrors('It costs $5 and $10 with tax.', 'fundamentals');
    expect(errors).toEqual([expect.stringContaining('"5 and " is read as mathematics')]);
    expect(markdownMathErrors('$x^2$', 'fundamentals')).toHaveLength(1);
    expect(markdownMathErrors('$$\n\\frac12\n$$', 'fundamentals')).toHaveLength(1);
  });
  it('rejects a bare dollar in a fundamentals topic', () => {
    expect(markdownMathErrors('It costs $5.', 'fundamentals')).toEqual([
      expect.stringContaining('bare $'),
    ]);
  });
  it('typesets good LaTeX in a quant topic, inline and display', () => {
    expect(
      markdownMathErrors(
        'The chance is $\\frac{5}{36}$, about $0.139$; it costs \\$5.\n\n$$\nE[X] = \\sum_{k=1}^{n} \\frac{1}{k}\n$$',
        'quant',
      ),
    ).toEqual([]);
  });
  it('rejects LaTeX that KaTeX cannot typeset', () => {
    expect(markdownMathErrors('Then $\\frac{1}{$ follows.', 'quant')).toEqual([
      expect.stringContaining('does not typeset'),
    ]);
    expect(markdownMathErrors('$\\notacommand{x}$', 'quant')).toEqual([
      expect.stringContaining('does not typeset'),
    ]);
    expect(markdownMathErrors('$$\n\\left( x\n$$', 'quant')).toEqual([
      expect.stringContaining('does not typeset'),
    ]);
  });
  it('rejects a pair of dollars the site would show as plain text', () => {
    expect(markdownMathErrors('Let $ x $ be the total.', 'quant').join()).toMatch(/plain text/);
    expect(markdownMathErrors('Worth $x$5 more.', 'quant').join()).toMatch(/plain text/);
    expect(markdownMathErrors('Let $x$ be the total, $$ x^2 $$ its square.', 'quant')).toEqual([]);
  });

  it('rejects an unbalanced dollar in a quant topic', () => {
    expect(markdownMathErrors('The answer is $\\frac{1}{2} and no more.', 'quant')).toEqual([
      expect.stringContaining('unmatched $'),
    ]);
    // One formula is fine; the third dollar is left over.
    expect(markdownMathErrors('$p$ is the chance and $q = 1 - p', 'quant')).toEqual([
      expect.stringContaining('unmatched $'),
    ]);
  });
  it('treats an escaped backslash before a dollar as no escape', () => {
    expect(markdownMathErrors('A path C:\\\\$x', 'fundamentals')).toEqual([
      expect.stringContaining('bare $'),
    ]);
  });
});

describe('quizMathErrors', () => {
  const base = { topic: 't', subtopic: 's', difficulty: 'easy', explanation: 'e' } as const;
  const questions = [
    QuizQuestion.parse({
      ...base,
      id: 'q-single',
      type: 'single',
      prompt: 'p',
      choices: [
        { id: 'a', text: '$\\frac{1}{2}$' },
        { id: 'b', text: 'a $ bare' },
      ],
      answer: 'a',
    }),
    QuizQuestion.parse({
      ...base,
      id: 'q-short',
      type: 'short',
      prompt: 'p',
      reference: 'r',
      keyPoints: ['fine', '$\\badmacro$'],
      hints: ['$ not rendered, not checked'],
    }),
    QuizQuestion.parse({
      ...base,
      id: 'q-numeric',
      type: 'numeric',
      prompt: 'p',
      answer: '0.3679',
      answerText: '$1/e \\approx 0.368$',
    }),
  ];

  it('checks every rendered field, in the track of the topic', () => {
    expect(quizMarkdownFields(questions[1] as QuizQuestion).map((f) => f.field)).toEqual([
      'prompt',
      'explanation',
      'reference',
      'keyPoints.0',
      'keyPoints.1',
    ]);
    expect(quizMathErrors(questions, new Map([['t', 'quant']]))).toEqual([
      expect.stringMatching(/^q-single choices\.b: unmatched \$/),
      expect.stringMatching(/^q-short keyPoints\.1: .* does not typeset/),
    ]);
    const fundamentals = quizMathErrors(questions, new Map());
    expect(fundamentals).toEqual([
      expect.stringMatching(/^q-single choices\.a: .* is read as mathematics/),
      expect.stringMatching(/^q-single choices\.b: bare \$/),
      expect.stringMatching(/^q-short keyPoints\.1: .* is read as mathematics/),
      expect.stringMatching(/^q-numeric answerText: .* is read as mathematics/),
    ]);
  });
});
