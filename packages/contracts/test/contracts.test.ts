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

describe('limits', () => {
  it('scales by language', () => {
    expect(limitsForTests('python', { timeMs: 1000, memoryMb: 256 }).runMs).toBe(4000);
    expect(limitsForTests('cpp', { timeMs: 1000, memoryMb: 256 }).runMs).toBe(1000);
  });
});

describe('AI key requests', () => {
  it('accepts Anthropic-looking keys (trimmed) and refuses anything else', async () => {
    const { SaveAiKeyRequest } = await import('../src');
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz_0123456789-ABCD';
    expect(SaveAiKeyRequest.parse({ apiKey: ` ${key}\n` })).toEqual({ apiKey: key });
    for (const bad of [
      '',
      'sk-ant-',
      'sk-proj-abcdefghijklmnopqrstuvwxyz',
      `${key} x`,
      'x'.repeat(300),
    ])
      expect(SaveAiKeyRequest.safeParse({ apiKey: bad }).success).toBe(false);
  });
});
