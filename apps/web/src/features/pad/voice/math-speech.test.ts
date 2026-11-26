import { describe, expect, it } from 'vitest';
import { readMath, speechOf } from './math-speech';

describe('speechOf: an interviewer message as words', () => {
  it('leaves a message already written for speech exactly as it is', () => {
    for (const text of [
      "Five over thirty-six, nice. What's next?",
      'Good. The probability is one sixth, so about 17%. Are you sure (really sure)?',
      'Take a minute; "think out loud" if it helps.\nWhat would you quote?',
      'Ten dollars is fine. 1/6 of the time you win.',
    ])
      expect(speechOf(text)).toBe(text);
  });

  it('reads fractions, binomials, roots and powers', () => {
    expect(speechOf('That gives $\\frac{5}{36}$.')).toBe('That gives 5 over 36.');
    expect(readMath('\\tfrac{1}{2} + \\dfrac{3}{4}')).toBe('1 over 2 plus 3 over 4');
    expect(readMath('\\frac{n-1}{n}')).toBe('n minus 1, all over n,');
    expect(readMath('1/6')).toBe('1 over 6');
    expect(readMath('\\binom{10}{3}')).toBe('10 choose 3');
    expect(readMath('\\sqrt{2}')).toBe('the square root of 2');
    expect(readMath('\\sqrt[3]{x}')).toBe('the cube root of x');
    expect(readMath('x^2 + y^3')).toBe('x squared plus y cubed');
    expect(readMath('2^{10}')).toBe('2 to the power of 10');
    expect(readMath('e^{-\\lambda t}')).toBe('e to the power of minus lambda t');
    expect(readMath('(a+b)^2')).toBe('the quantity a plus b, squared');
    expect(readMath('90^\\circ')).toBe('90 degrees');
  });

  it('reads subscripts, sums, Greek letters and operators', () => {
    expect(readMath('x_1 + x_{2}')).toBe('x 1 plus x 2');
    expect(readMath('\\sum_{i=1}^{n} i')).toBe('the sum from i equals 1 to n of i');
    expect(readMath('\\prod_{k} p_k')).toBe('the product over k of p k');
    expect(readMath('\\lim_{n \\to \\infty} a_n')).toBe('the limit as n goes to infinity of a n');
    expect(readMath('\\mu \\pm 2\\sigma')).toBe('mu plus or minus 2 sigma');
    expect(readMath('\\Delta \\varepsilon')).toBe('capital delta epsilon');
    expect(readMath('3 \\times 4 \\div 2 \\cdot 5')).toBe('3 times 4 divided by 2 times 5');
    expect(readMath('n!')).toBe('n factorial');
    expect(readMath('np')).toBe('n p');
    expect(readMath('\\log_2 n')).toBe('log base 2 n');
  });

  it('reads relations, approximations and percentages', () => {
    expect(readMath('p \\approx 0.17')).toBe('p is approximately 0.17');
    expect(readMath('x \\le 3, y \\geq 4')).toBe('x is at most 3, y is at least 4');
    expect(readMath('a \\neq b < c > d')).toBe(
      'a is not equal to b is less than c is greater than d',
    );
    expect(readMath('50\\%')).toBe('50 percent');
    expect(readMath('X \\sim \\text{Bin}(n, p)')).toBe('X is distributed as Bin n, p');
  });

  it('reads expectation, probability, variance and covariance notation', () => {
    expect(readMath('E[X^2] = \\frac{91}{6}')).toBe(
      'the expected value of X squared equals 91 over 6',
    );
    expect(readMath('\\mathbb{E}[X \\mid Y]')).toBe('the expected value of X given Y');
    expect(readMath('P(X > 3)')).toBe('the probability that X is greater than 3');
    expect(readMath('\\mathbb{P}(A | B)')).toBe('the probability of A given B');
    expect(readMath('\\Pr\\left(H\\right)')).toBe('the probability of H');
    expect(readMath('\\operatorname{Var}(X) = \\sigma^2')).toBe(
      'the variance of X equals sigma squared',
    );
    expect(readMath('\\text{Var}(X)')).toBe('the variance of X');
    expect(readMath('\\mathrm{Cov}(X, Y)')).toBe('the covariance of X and Y');
  });

  it('says dollars as dollars, inside and outside math', () => {
    expect(speechOf('I pay you \\$10 to play.')).toBe('I pay you 10 dollars to play.');
    expect(speechOf('A \\$1.5 million notional, or $10 a ticket.')).toBe(
      'A 1.5 million dollars notional, or 10 dollars a ticket.',
    );
    expect(readMath('2 \\times \\$5')).toBe('2 times 5 dollars');
  });

  it('drops Markdown markup and points to code', () => {
    expect(speechOf('**Good.** Now try the _second_ case.')).toBe('Good. Now try the second case.');
    expect(speechOf('- **one**\n- two')).toBe('one two');
    expect(speechOf('See [the note](https://example.com) and `x + 1`.')).toBe(
      'See the note and x + 1.',
    );
    expect(speechOf('Like this:\n```\nprint(1)\n```')).toBe(
      'Like this: (see the code in the chat)',
    );
    expect(speechOf('A literal \\* star')).toBe('A literal star');
  });

  it('degrades what it does not know to something harmless, never symbol by symbol', () => {
    expect(readMath('\\weirdcommand{x} + 1')).toBe('x plus 1');
    expect(readMath('\\frac{1}{')).toBe('1 over');
    expect(readMath('a & b \\\\ c')).toBe('a b, c');
    expect(readMath('}{)(]')).toBe('');
    const said = speechOf('Hmm, $\\begin{pmatrix} 1 & 0 \\end{pmatrix}$ and $\\frac{1}{2');
    expect(said).toBe('Hmm, 1 0 and 1 over 2');
    expect(speechOf('Write \\frac{1}{2} as \\alpha.')).toBe('Write 1 over 2 as alpha.');
    expect(speechOf('A $x $ pair that is not math, and an open $\\sqrt{2')).toBe(
      'A $x $ pair that is not math, and an open the square root of 2',
    );
  });

  it('mixes prose and math as the chat shows them', () => {
    expect(
      speechOf(
        'Right: $P(\\text{sum} = 7) = \\frac{6}{36} = \\frac{1}{6}$, so about $16.7\\%$. Next?',
      ),
    ).toBe(
      'Right: the probability that sum equals 7 equals 6 over 36 equals 1 over 6, so about 16.7 percent. Next?',
    );
    expect(speechOf('$$E[N] = \\sum_{n \\ge 1} n p^n$$')).toBe(
      'the expected value of N equals the sum over n is at least 1 of n p to the power of n',
    );
  });
});
