import { QuizAttempt, QuizQuestion, type QuizRoadmapNode, QuizRoadmapTopic } from '@ipp/contracts';
import { quizAttempts, quizQuestions, quizStandaloneAnswers, quizTopics } from '@ipp/db';
import { arrayOverlaps, eq, inArray } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, flushRedis, type Harness, startApi } from './helpers/harness';

let h: Harness;

const TOPIC = 'rm-topic';
const area = (
  id: string,
  title: string,
  subtopics: string[],
  requires: string[] = [],
  related: string[] = [],
): QuizRoadmapNode => ({ id, title, description: 'd', subtopics, requires, related });
const ROADMAP: QuizRoadmapNode[] = [
  area('rm-basics', 'Basics', ['one', 'two'], [], ['other-topic-area']),
  area('rm-next', 'Next', ['three'], ['rm-basics']),
  // On the roadmap but without questions (the seed tolerates it; the content check does not).
  area('rm-empty', 'Empty', ['none'], ['rm-next']),
  // Stored before `related` existed: served as having none.
  (({ related: _, ...old }) => old)(area('rm-old', 'Old', ['none-either'])) as QuizRoadmapNode,
];

const q = (id: string, subtopic: string, type: 'single' | 'short' = 'single') =>
  QuizQuestion.parse(
    type === 'single'
      ? {
          id,
          topic: TOPIC,
          subtopic,
          difficulty: 'easy',
          type,
          prompt: `Prompt ${id}`,
          explanation: `EXPLAIN-${id}`,
          choices: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          answer: 'a',
        }
      : {
          id,
          topic: TOPIC,
          subtopic,
          difficulty: 'easy',
          type,
          prompt: `Prompt ${id}`,
          explanation: `EXPLAIN-${id}`,
          reference: 'REFERENCE',
          keyPoints: ['k'],
        },
  );
const QUESTIONS = [
  q('rq-1', 'one'),
  q('rq-2', 'one', 'short'),
  q('rq-3', 'two'),
  q('rq-4', 'three'),
  q('rq-5', 'three'),
  // A subtopic on no node: counts for the topic, not for any node.
  q('rq-6', 'stray'),
];
const RETIRED = q('rq-retired', 'one');
const IDS = [...QUESTIONS, RETIRED].map((x) => x.id);

beforeAll(async () => {
  await flushRedis();
  h = await startApi();
  const { db } = h.api.ctx;
  // Before the fixture topic in study order.
  await db.insert(quizTopics).values({
    slug: TOPIC,
    title: 'Roadmap topic',
    description: 'For the roadmap tests',
    position: -1,
    roadmap: ROADMAP,
  });
  await db.insert(quizQuestions).values(
    [...QUESTIONS, RETIRED].map((x) => ({
      id: x.id,
      topic: x.topic,
      subtopic: x.subtopic,
      difficulty: x.difficulty,
      type: x.type,
      data: x,
      active: x.id !== RETIRED.id,
    })),
  );
});
afterAll(async () => {
  const db = h?.api.ctx.db;
  if (db) {
    await db.delete(quizAttempts).where(arrayOverlaps(quizAttempts.topics, [TOPIC]));
    await db.delete(quizStandaloneAnswers).where(inArray(quizStandaloneAnswers.questionId, IDS));
    await db.delete(quizQuestions).where(inArray(quizQuestions.id, IDS));
    await db.delete(quizTopics).where(eq(quizTopics.slug, TOPIC));
  }
  await h?.stop();
});

async function user(name: string) {
  const c = new Client(h.base, `100.100.1.${Math.floor(Math.random() * 250)}`);
  await c.signUp(name);
  return c;
}

const roadmapOf = async (c: Client) => {
  const res = await c.get('/api/quiz/roadmap');
  expect(res.status).toBe(200);
  return QuizRoadmapTopic.array().parse(res.json);
};

describe('GET /api/quiz/roadmap', () => {
  it('needs an account', async () => {
    const anon = new Client(h.base, '100.100.1.251');
    expect((await anon.get('/api/quiz/roadmap')).status).toBe(401);

    const host = new Client(h.base, '100.100.1.252');
    await host.signUp('Host');
    const room = await host.post('/api/pads', {
      kind: 'room',
      language: 'python',
      problemSlug: 'two-sum',
    });
    const guest = new Client(h.base, '100.100.1.253');
    await guest.post('/api/pads/join-guest', { shareToken: room.json.shareToken, name: 'Casey' });
    const res = await guest.get('/api/quiz/roadmap');
    expect([res.status, res.json?.error?.code]).toEqual([403, 'account_required']);
  });

  it('lists topics in study order with their nodes, starting at zero', async () => {
    const c = await user('Fresh');
    const topics = await roadmapOf(c);
    expect(topics.map((t) => t.slug)).toEqual([TOPIC, 'test-topic']);
    const [t, fixture] = topics;
    // The fixture topic has no roadmap.
    expect(fixture?.nodes).toEqual([]);
    expect(t).toMatchObject({
      title: 'Roadmap topic',
      questionCount: 6,
      shortCount: 1,
      answered: 0,
      correct: 0,
      accuracy: null,
    });
    expect(t?.nodes.map((n) => [n.id, n.questionCount, n.requires, n.related])).toEqual([
      ['rm-basics', 3, [], ['other-topic-area']],
      ['rm-next', 2, ['rm-basics'], []],
      ['rm-empty', 0, ['rm-next'], []],
      ['rm-old', 0, [], []],
    ]);
    expect(t?.nodes[0]?.subtopics).toEqual([
      { subtopic: 'one', questionCount: 2, shortCount: 1, answered: 0, correct: 0, accuracy: null },
      { subtopic: 'two', questionCount: 1, shortCount: 0, answered: 0, correct: 0, accuracy: null },
    ]);
    // Nothing that answers a question.
    expect(JSON.stringify(topics)).not.toMatch(/EXPLAIN-|REFERENCE|"answer"/);
  });

  it('counts the latest graded answer per question, like the topic stats', async () => {
    const c = await user('Progress');
    const answer = (id: string, choice: string) =>
      c.post(`/api/quiz/questions/${id}/answers`, { response: { type: 'single', choice } });
    expect((await answer('rq-1', 'b')).status).toBe(200);
    expect((await answer('rq-1', 'a')).status).toBe(200); // the latest one counts
    expect((await answer('rq-3', 'b')).status).toBe(200);
    expect((await answer('rq-4', 'a')).status).toBe(200);
    expect((await answer('rq-6', 'a')).status).toBe(200);
    // Waiting for a self-grade (no key): not counted.
    expect(
      (await c.post('/api/quiz/questions/rq-2/answers', { response: { type: 'short', text: 'x' } }))
        .status,
    ).toBe(200);

    const [t] = await roadmapOf(c);
    expect(t).toMatchObject({ answered: 4, correct: 3, accuracy: 0.75 });
    const [basics, next] = t?.nodes ?? [];
    expect(basics).toMatchObject({ questionCount: 3, answered: 2, correct: 1, accuracy: 0.5 });
    expect(basics?.subtopics.map((s) => [s.subtopic, s.answered, s.correct])).toEqual([
      ['one', 1, 1],
      ['two', 1, 0],
    ]);
    expect(next).toMatchObject({ questionCount: 2, answered: 1, correct: 1, accuracy: 1 });

    // A practice attempt answer counts too.
    const a = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: [TOPIC], nodes: ['rm-next'], count: 5 })).json,
    );
    await c.post(`/api/quiz/attempts/${a.id}/answers`, {
      questionId: 'rq-5',
      response: { type: 'single', choice: 'a' },
    });
    const [after] = await roadmapOf(c);
    expect(after?.nodes[1]).toMatchObject({ answered: 2, correct: 2, accuracy: 1 });
  });
});

describe('POST /api/quiz/attempts with nodes', () => {
  it('draws only on the nodes’ subtopics', async () => {
    const c = await user('Nodes');
    const start = (body: object) => c.post('/api/quiz/attempts', { topics: [TOPIC], ...body });

    const basics = QuizAttempt.parse((await start({ nodes: ['rm-basics'], count: 10 })).json);
    // Practice leaves the open question out, as for a whole topic.
    expect(basics.questions.map((x) => x.id).sort()).toEqual(['rq-1', 'rq-3']);
    expect(basics.topics).toEqual([TOPIC]);

    const both = QuizAttempt.parse((await start({ nodes: ['rm-basics', 'rm-next'] })).json);
    expect(both.questions.map((x) => x.id).sort()).toEqual(['rq-1', 'rq-3', 'rq-4', 'rq-5']);

    const talk = QuizAttempt.parse(
      (await start({ nodes: ['rm-basics'], mode: 'discussion', count: 3 })).json,
    );
    expect(talk.questions.map((x) => x.id)).toEqual(['rq-2']);

    // Without nodes: the whole topic, the stray subtopic included.
    const whole = QuizAttempt.parse((await start({ count: 50 })).json);
    expect(whole.questions.map((x) => x.id).sort()).toEqual([
      'rq-1',
      'rq-3',
      'rq-4',
      'rq-5',
      'rq-6',
    ]);
  });

  it('narrows only the topics the nodes are on', async () => {
    const c = await user('Mixed');
    const res = await c.post('/api/quiz/attempts', {
      topics: [TOPIC, 'test-topic'],
      nodes: ['rm-next'],
      count: 50,
    });
    const a = QuizAttempt.parse(res.json);
    expect(a.questions.map((x) => x.id).sort()).toEqual([
      'rq-4',
      'rq-5',
      'tq-multiple',
      'tq-output',
      'tq-single',
    ]);
  });

  it('prefers the questions missed or not seen within the node', async () => {
    const c = await user('Weak');
    await c.post('/api/quiz/questions/rq-4/answers', { response: { type: 'single', choice: 'a' } });
    const a = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: [TOPIC], nodes: ['rm-next'], count: 1 })).json,
    );
    expect(a.questions.map((x) => x.id)).toEqual(['rq-5']);
  });

  it('rejects nodes that are not on the requested topics, and empty nodes', async () => {
    const c = await user('Bad');
    for (const body of [
      { topics: [TOPIC], nodes: ['nope'] },
      { topics: ['test-topic'], nodes: ['rm-basics'] },
      { topics: [TOPIC], nodes: [] },
      { topics: [TOPIC], nodes: ['Not A Slug'] },
    ]) {
      const res = await c.post('/api/quiz/attempts', body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
    }
    const unknown = await c.post('/api/quiz/attempts', { topics: [TOPIC], nodes: ['nope'] });
    expect(unknown.json?.error?.code).toBe('unknown_node');
    // A node with no questions has nothing to draw on.
    expect(
      (await c.post('/api/quiz/attempts', { topics: [TOPIC], nodes: ['rm-empty'] })).status,
    ).toBe(404);
  });
});
