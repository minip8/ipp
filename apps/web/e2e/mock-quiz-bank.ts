/**
 * Mock of the question-bank endpoints, kept apart from mock-api.ts (which delegates here):
 *   GET  /api/quiz/topics/:slug/questions   QuizBank
 *   GET  /api/quiz/questions/:id            QuizBankQuestion
 *   POST /api/quiz/questions/:id/answers    AnswerFeedback (latest answer per question)
 */
import {
  type AnswerFeedback,
  QuizBank,
  type QuizBankItem,
  QuizBankQuestion,
  type QuizQuestionStatus,
  type QuizResponse,
  type QuizTopic,
  SubmitStandaloneAnswerRequest,
} from '@ipp/contracts';
import {
  QUIZ_BANK_FEEDBACK,
  QUIZ_BANK_PRIOR,
  QUIZ_BANK_QUESTIONS,
  QUIZ_BANK_TOPIC,
} from './fixtures-quiz-bank';
import { QUANT_FEEDBACK, QUANT_QUESTIONS, QUANT_TOPIC } from './fixtures-quiz-quant';

type Recorded = { response: QuizResponse; feedback: AnswerFeedback; at: string };

const statusOf = (f: AnswerFeedback | undefined): QuizQuestionStatus =>
  !f
    ? 'unanswered'
    : f.needsSelfGrade
      ? 'pending'
      : f.correct
        ? 'correct'
        : f.score > 0
          ? 'partial'
          : 'incorrect';

export class MockQuizBank {
  /** The questions of QUIZ_BANK_TOPIC, in the order the API returns them. */
  questions = QUIZ_BANK_QUESTIONS;
  /** The questions of the quant topic (QUANT_TOPIC), mostly numeric. */
  quant = QUANT_QUESTIONS;
  /** More questions, of any topic (the quant-room specs make the room's bank the public one). */
  extra: QuizBankItem['question'][] = [];
  /** The user's latest answer per question (seeded with QUIZ_BANK_PRIOR). */
  answers = new Map<string, Recorded>();

  constructor() {
    for (const [id, p] of Object.entries(QUIZ_BANK_PRIOR)) {
      const grade = QUIZ_BANK_FEEDBACK[id];
      if (grade)
        this.answers.set(id, { response: p.response, feedback: grade(p.response), at: p.at });
    }
  }

  private item(id: string): QuizBankItem | null {
    const question = [...this.questions, ...this.quant, ...this.extra].find((q) => q.id === id);
    if (!question) return null;
    const a = this.answers.get(id);
    return {
      question,
      status: statusOf(a?.feedback),
      score: a && !a.feedback.needsSelfGrade ? a.feedback.score : null,
      answeredAt: a?.at ?? null,
    };
  }

  /**
   * Returns a JSON body, a Response for errors, or undefined when the path is not a bank route.
   * `keyActive` mirrors the user's AI key: without one, short answers are self-graded.
   * `topics` is what GET /api/quiz/topics returns.
   */
  handle(
    method: string,
    path: string,
    body: unknown,
    keyActive: boolean,
    topics: QuizTopic[],
  ): unknown {
    const notFound = (what: string) =>
      new Response(JSON.stringify({ error: { code: 'not_found', message: `${what} not found` } }), {
        status: 404,
      });
    let m = path.match(/^\/api\/quiz\/topics\/([^/]+)\/questions$/);
    if (m && method === 'GET') {
      const slug = decodeURIComponent(m[1] ?? '');
      const topic = topics.find((t) => t.slug === slug);
      if (!topic) return notFound('Topic');
      const questions = [
        ...(slug === QUIZ_BANK_TOPIC ? this.questions : slug === QUANT_TOPIC ? this.quant : []),
        ...this.extra.filter((q) => q.topic === slug),
      ];
      return QuizBank.parse({
        topic: {
          slug: topic.slug,
          title: topic.title,
          description: topic.description,
          track: topic.track,
          also: topic.also,
        },
        items: questions.map((q) => this.item(q.id)).filter((i) => i !== null),
      });
    }
    m = path.match(/^\/api\/quiz\/questions\/([^/]+)(\/answers)?$/);
    if (!m) return undefined;
    const id = decodeURIComponent(m[1] ?? '');
    const item = this.item(id);
    if (!item) return notFound('Question');
    if (!m[2] && method === 'GET') {
      const a = this.answers.get(id);
      return QuizBankQuestion.parse({
        ...item,
        response: a?.response ?? null,
        feedback: a?.feedback ?? null,
      });
    }
    if (m[2] && method === 'POST') {
      const { response } = SubmitStandaloneAnswerRequest.parse(body);
      const grade = QUIZ_BANK_FEEDBACK[id] ?? QUANT_FEEDBACK[id];
      if (!grade || response.type !== item.question.type)
        return new Response(
          JSON.stringify({ error: { code: 'bad_request', message: 'Wrong response type.' } }),
          { status: 400 },
        );
      const previous = this.answers.get(id);
      let feedback = grade(response);
      let recorded = response;
      if (response.type === 'short' && !keyActive) {
        const pending = previous?.feedback.needsSelfGrade && previous.response.type === 'short';
        if (response.selfGrade === undefined)
          feedback = {
            ...feedback,
            gradedBy: 'self',
            feedback: null,
            needsSelfGrade: true,
            score: 0,
            correct: false,
          };
        else {
          feedback = {
            ...feedback,
            gradedBy: 'self',
            feedback: null,
            needsSelfGrade: false,
            score: response.selfGrade,
            correct: response.selfGrade >= 0.7,
          };
          // Grading a pending answer keeps the text that was submitted.
          if (pending && previous.response.type === 'short')
            recorded = { ...response, text: previous.response.text };
        }
      }
      this.answers.set(id, { response: recorded, feedback, at: new Date().toISOString() });
      return feedback;
    }
    return undefined;
  }
}
