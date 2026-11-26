import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  generateScaffold,
  JudgeJob,
  JudgeProgress,
  JudgeResult,
  limitsForTests,
  ProblemContent,
} from '../src';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('fixtures match the schemas (the Rust judge parses the same files)', () => {
  it.each(['judge-job-tests', 'judge-job-file'])('%s', (name) => {
    expect(() => JudgeJob.parse(fixture(name))).not.toThrow();
  });
  it.each(['judge-result-tests', 'judge-result-file', 'judge-result-failures'])('%s', (name) => {
    expect(() => JudgeResult.parse(fixture(name))).not.toThrow();
  });
  it('judge-progress', () => {
    for (const p of fixture('judge-progress')) expect(() => JudgeProgress.parse(p)).not.toThrow();
  });
  it.each(['problem-two-sum', 'problem-lru-cache'])('%s', (name) => {
    expect(() => ProblemContent.parse(fixture(name))).not.toThrow();
  });
});

describe('scaffolds', () => {
  const twoSum = ProblemContent.parse(fixture('problem-two-sum')).signature;
  const lru = ProblemContent.parse(fixture('problem-lru-cache')).signature;

  it('function problem', () => {
    expect(generateScaffold(twoSum, 'cpp')).toContain(
      'vector<int> twoSum(vector<int>& nums, int target) {',
    );
    expect(generateScaffold(twoSum, 'java')).toContain(
      'public int[] twoSum(int[] nums, int target) {',
    );
    expect(generateScaffold(twoSum, 'python')).toContain(
      'def twoSum(self, nums: list[int], target: int) -> list[int]:',
    );
  });
  it('design problem', () => {
    expect(generateScaffold(lru, 'cpp')).toContain('LRUCache(int capacity) {');
    expect(generateScaffold(lru, 'cpp')).toContain('void put(int key, int value) {');
    expect(generateScaffold(lru, 'java')).toContain('public LRUCache(int capacity) {');
    expect(generateScaffold(lru, 'python')).toContain('def __init__(self, capacity: int) -> None:');
  });
  it('rejects a function problem with two methods', () => {
    const bad = { ...twoSum, methods: [...twoSum.methods, ...twoSum.methods] };
    expect(ProblemContent.shape.signature.safeParse(bad).success).toBe(false);
  });
});

describe('question bank', () => {
  it('carries feedback exactly when a response is recorded', async () => {
    const { QuizBankQuestion, QuizBankItem } = await import('../src');
    const item = {
      question: {
        id: 'q-1',
        topic: 'os',
        subtopic: 'Paging',
        difficulty: 'easy',
        type: 'single',
        prompt: 'Pick one',
        choices: [{ id: 'a', text: 'A' }],
        code: null,
        unit: null,
      },
      status: 'unanswered',
      score: null,
      answeredAt: null,
    };
    expect(QuizBankItem.parse(item)).toEqual(item);
    // The public projection has no answer field to leak.
    expect(
      QuizBankItem.parse({ ...item, question: { ...item.question, answer: 'a' } }).question,
    ).not.toHaveProperty('answer');
    expect(QuizBankQuestion.safeParse({ ...item, response: null, feedback: null }).success).toBe(
      true,
    );
    const feedback = {
      questionId: 'q-1',
      score: 1,
      correct: true,
      correctAnswer: 'a',
      explanation: 'why',
      feedback: null,
      gradedBy: 'auto',
      needsSelfGrade: false,
    };
    expect(QuizBankQuestion.safeParse({ ...item, response: null, feedback }).success).toBe(false);
    expect(
      QuizBankQuestion.safeParse({
        ...item,
        status: 'correct',
        response: { type: 'single', choice: 'a' },
        feedback,
      }).success,
    ).toBe(true);
  });
});

describe('limits', () => {
  it('scales by language', () => {
    expect(limitsForTests('python', { timeMs: 1000, memoryMb: 256 }).runMs).toBe(4000);
    expect(limitsForTests('cpp', { timeMs: 1000, memoryMb: 256 }).runMs).toBe(1000);
  });
});

describe('AI key requests', () => {
  const ANT = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz_0123456789-ABCD';
  const OAI = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
  const GEM = 'AIzaSyAbcdefghijklmnopqrstuvwxyz0123456';
  const GEM_AQ = 'AQ.Ab8RN6abcdefghijklmnopqrstuvwxyz';
  const ORT = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab';

  it('accepts Anthropic-looking keys (trimmed) without a provider, for older clients', async () => {
    const { SaveAiKeyRequest } = await import('../src');
    expect(SaveAiKeyRequest.parse({ apiKey: ` ${ANT}\n` })).toEqual({
      provider: 'anthropic',
      apiKey: ANT,
    });
    for (const bad of [
      '',
      'sk-ant-',
      `${ANT} x`,
      'x'.repeat(300),
      'hello',
      'sk-admin-abcdefghijklmnopqrstuvwxyz',
    ])
      expect(SaveAiKeyRequest.safeParse({ apiKey: bad }).success).toBe(false);
  });

  it('infers the provider from the shape, and refuses a key that does not fit the chosen one', async () => {
    const { SaveAiKeyRequest, inferAiProvider } = await import('../src');
    expect(inferAiProvider(OAI)).toBe('openai');
    expect(inferAiProvider(GEM)).toBe('gemini');
    expect(inferAiProvider(GEM_AQ)).toBe('gemini');
    expect(inferAiProvider(ORT)).toBe('openrouter');
    expect(inferAiProvider('nope')).toBeNull();
    for (const [provider, apiKey] of [
      ['openai', OAI],
      ['gemini', GEM],
      ['gemini', GEM_AQ],
      ['openrouter', ORT],
      ['anthropic', ANT],
    ] as const)
      expect(SaveAiKeyRequest.parse({ provider, apiKey })).toEqual({ provider, apiKey });
    const r = SaveAiKeyRequest.safeParse({ provider: 'anthropic', apiKey: OAI });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(
      /looks like an OpenAI key, but Anthropic is selected/,
    );
    expect(SaveAiKeyRequest.safeParse({ provider: 'openai', apiKey: ORT }).success).toBe(false);
    expect(SaveAiKeyRequest.safeParse({ provider: 'gemini', apiKey: 'AIzashort' }).success).toBe(
      false,
    );
    expect(SaveAiKeyRequest.safeParse({ provider: 'other', apiKey: OAI }).success).toBe(false);
  });

  it('model choices and the effective model', async () => {
    const { InterviewerSettings, effectiveModel, AiModelId, AiKeyStatus } = await import('../src');
    const base = { enabled: true, style: 'neutral', proactivity: 'normal', voice: false };
    expect(InterviewerSettings.parse(base).model).toBeUndefined();
    expect(
      InterviewerSettings.parse({ ...base, model: { provider: 'openrouter', id: 'vendor/m:free' } })
        .model,
    ).toEqual({ provider: 'openrouter', id: 'vendor/m:free' });
    expect(InterviewerSettings.parse({ ...base, model: null }).model).toBeNull();
    for (const bad of ['', 'a b', '<script>', 'x'.repeat(201), '/abs'])
      expect(AiModelId.safeParse(bad).success).toBe(false);
    const choice = { provider: 'openai' as const, id: 'gpt-x' };
    expect(effectiveModel(choice, 'openai', 'gpt-d')).toEqual({
      provider: 'openai',
      id: 'gpt-x',
      chosen: true,
      defaultModel: 'gpt-d',
    });
    expect(effectiveModel(choice, 'anthropic', 'claude-d')).toEqual({
      provider: 'anthropic',
      id: 'claude-d',
      chosen: false,
      defaultModel: 'claude-d',
    });
    expect(effectiveModel(null, 'gemini', 'g').chosen).toBe(false);
    // Status from an older server (no provider) still parses.
    expect(
      AiKeyStatus.parse({
        state: 'missing',
        last4: null,
        expiresAt: null,
        problem: null,
        model: 'claude-opus-5-5',
        ttlHours: 24,
      }).provider,
    ).toBeNull();
  });
});

describe('quiz roadmap', () => {
  it('authoring: requires defaults to none, titles stay short', async () => {
    const { QuizRoadmapFile, QuizRoadmapNode, ROADMAP_TITLE_MAX } = await import('../src');
    const n = QuizRoadmapNode.parse({
      id: 'cpp-move-semantics',
      title: 'Move semantics',
      description: 'd',
      subtopics: ['Value categories and move semantics'],
    });
    expect(n.requires).toEqual([]);
    const long = { ...n, title: 'x'.repeat(ROADMAP_TITLE_MAX + 1) };
    expect(QuizRoadmapNode.safeParse(long).success).toBe(false);
    expect(QuizRoadmapNode.safeParse({ ...n, subtopics: [] }).success).toBe(false);
    expect(QuizRoadmapNode.safeParse({ ...n, id: 'Not a slug' }).success).toBe(false);
    expect(QuizRoadmapFile.safeParse({ cpp: [n] }).success).toBe(true);
    expect(QuizRoadmapFile.safeParse({ cpp: [] }).success).toBe(false);
  });

  it('the API shape: progress on the topic, each node and each subtopic', async () => {
    const { QuizRoadmapTopic } = await import('../src');
    const progress = { questionCount: 4, shortCount: 1, answered: 2, correct: 1, accuracy: 0.5 };
    const topic = {
      slug: 'cpp',
      title: 'C++',
      description: 'd',
      track: 'fundamentals',
      ...progress,
      nodes: [
        {
          id: 'cpp-a',
          title: 'A',
          description: 'd',
          requires: [],
          related: ['cc-b'],
          subtopics: [{ subtopic: 's', ...progress }],
          ...progress,
        },
      ],
    };
    expect(QuizRoadmapTopic.parse(topic)).toEqual(topic);
    const { accuracy: _, ...noAccuracy } = progress;
    expect(
      QuizRoadmapTopic.safeParse({ ...topic, ...noAccuracy, accuracy: undefined }).success,
    ).toBe(false);
  });

  it('an attempt may be narrowed to roadmap nodes', async () => {
    const { CreateAttemptRequest } = await import('../src');
    expect(CreateAttemptRequest.parse({ topics: ['cpp'], nodes: ['cpp-a'] }).nodes).toEqual([
      'cpp-a',
    ]);
    expect(CreateAttemptRequest.parse({ topics: ['cpp'] }).nodes).toBeUndefined();
    expect(CreateAttemptRequest.safeParse({ topics: ['cpp'], nodes: [] }).success).toBe(false);
  });
});

describe('quant paths', () => {
  it('name each topic once, as a slug, with a label and a description', async () => {
    const { QUANT_PATHS, QUANT_PATH_INFO, Slug } = await import('../src');
    for (const path of QUANT_PATHS) {
      const info = QUANT_PATH_INFO[path];
      expect(info.label).not.toBe('');
      expect(info.description).not.toBe('');
      expect(info.topics.length).toBeGreaterThan(0);
      expect(new Set(info.topics).size).toBe(info.topics.length);
      for (const t of info.topics) expect(() => Slug.parse(t)).not.toThrow();
    }
  });
});
