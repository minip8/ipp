/**
 * The quiz roadmap: quiz/roadmap.yaml maps each topic to its study areas (`QuizRoadmapNode`), each
 * grouping one or more question subtopics, with "learn this first" edges between areas of the
 * same topic and `related` links to areas of other topics.
 *
 * Two levels of checking, as for problem tags:
 *   - loadQuizRoadmap: the structure (schema, known topics, unique ids, prerequisites that exist in
 *     the same topic, related links that exist in another topic, no cycles, no subtopic in two
 *     nodes). The seed needs this to draw a graph.
 *   - roadmapGaps: the fit with the questions (every subtopic in use is on a node, every node
 *     subtopic has questions). The seed tolerates gaps; `check` and the content tests fail on any,
 *     so a question with a new subtopic must be placed on the roadmap before it ships.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type QuizQuestion, QuizRoadmapFile, type QuizRoadmapNode } from '@ipp/contracts';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { CONTENT_ROOT, loadQuizTopics } from './load';

export type QuizRoadmap = Record<string, QuizRoadmapNode[]>;

/** Relative to the content root. */
export const ROADMAP_FILE = 'quiz/roadmap.yaml';

/** Structural problems in a parsed roadmap, as messages (empty when it is sound). */
export function roadmapErrors(roadmap: QuizRoadmap, topics: readonly string[]): string[] {
  const errors: string[] = [];
  const known = new Set(topics);
  const topicOf = new Map<string, string>();
  for (const [topic, nodes] of Object.entries(roadmap)) {
    if (!known.has(topic)) errors.push(`${topic}: not a topic in quiz/topics.yaml`);
    for (const n of nodes) {
      const other = topicOf.get(n.id);
      if (other !== undefined)
        errors.push(
          `${topic} ${n.id}: duplicate node id${other === topic ? '' : ` (also in ${other})`}`,
        );
      else topicOf.set(n.id, topic);
    }
  }
  // "from to" for every related link seen so far, to catch one written on both sides.
  const related = new Set<string>();
  for (const [topic, nodes] of Object.entries(roadmap)) {
    const placed = new Map<string, string>();
    for (const n of nodes) {
      for (const s of n.subtopics) {
        const at = placed.get(s);
        if (at !== undefined)
          errors.push(
            at === n.id
              ? `${topic} ${n.id}: subtopic "${s}" listed twice`
              : `${topic} ${n.id}: subtopic "${s}" is also on ${at}; a subtopic belongs to one node`,
          );
        else placed.set(s, n.id);
      }
      const seen = new Set<string>();
      for (const r of n.requires) {
        if (r === n.id) errors.push(`${topic} ${n.id}: requires itself`);
        else if (seen.has(r)) errors.push(`${topic} ${n.id}: requires "${r}" twice`);
        else if (!topicOf.has(r)) errors.push(`${topic} ${n.id}: requires unknown node "${r}"`);
        else if (topicOf.get(r) !== topic)
          errors.push(`${topic} ${n.id}: requires "${r}" from ${topicOf.get(r)}; stay in ${topic}`);
        seen.add(r);
      }
      const linked = new Set<string>();
      for (const r of n.related) {
        const at = topicOf.get(r);
        if (linked.has(r)) errors.push(`${topic} ${n.id}: related to "${r}" twice`);
        else if (at === undefined) errors.push(`${topic} ${n.id}: related to unknown node "${r}"`);
        else if (at === topic)
          errors.push(
            `${topic} ${n.id}: related to "${r}" of the same topic; related is for other topics (use requires)`,
          );
        else if (related.has(`${r} ${n.id}`))
          errors.push(
            `${topic} ${n.id}: related to "${r}", which already lists it; write a link on one side`,
          );
        linked.add(r);
        related.add(`${n.id} ${r}`);
      }
    }
    const cycle = findCycle(nodes);
    if (cycle) errors.push(`${topic}: prerequisites form a cycle: ${cycle.join(' -> ')}`);
  }
  return errors;
}

/** A cycle through `requires` (as ids, first repeated at the end), or null. */
export function findCycle(nodes: readonly Pick<QuizRoadmapNode, 'id' | 'requires'>[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 'done') return null;
    if (s === 'open') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'open');
    stack.push(id);
    for (const r of byId.get(id)?.requires ?? []) {
      // A node requiring itself is reported on its own.
      if (r === id || !byId.has(r)) continue;
      const found = visit(r);
      if (found) return found;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const n of nodes) {
    const found = visit(n.id);
    if (found) return found;
  }
  return null;
}

/** quiz/roadmap.yaml, validated structurally; an empty roadmap when the file does not exist. */
export function loadQuizRoadmap(root = CONTENT_ROOT): QuizRoadmap {
  const file = join(root, 'quiz', 'roadmap.yaml');
  if (!existsSync(file)) return {};
  const parsed = QuizRoadmapFile.safeParse(parseYaml(readFileSync(file, 'utf8')) ?? {});
  if (!parsed.success) throw new Error(`${ROADMAP_FILE}:\n${z.prettifyError(parsed.error)}`);
  const errors = roadmapErrors(
    parsed.data,
    loadQuizTopics(root).map((t) => t.slug),
  );
  if (errors.length) throw new Error(`${ROADMAP_FILE}:\n${errors.join('\n')}`);
  return parsed.data;
}

/**
 * Where the roadmap and the questions disagree, as messages: a subtopic in use that is on no node
 * of its topic (or a topic with questions and no roadmap), and a node subtopic no question uses.
 */
export function roadmapGaps(
  roadmap: QuizRoadmap,
  questions: readonly Pick<QuizQuestion, 'topic' | 'subtopic'>[],
): string[] {
  const used = new Map<string, Map<string, number>>();
  for (const q of questions) {
    const of = used.get(q.topic) ?? new Map<string, number>();
    of.set(q.subtopic, (of.get(q.subtopic) ?? 0) + 1);
    used.set(q.topic, of);
  }
  const gaps: string[] = [];
  for (const [topic, subtopics] of used) {
    const nodes = roadmap[topic];
    if (!nodes) {
      gaps.push(`${topic}: has questions but no roadmap in ${ROADMAP_FILE}`);
      continue;
    }
    const placed = new Set(nodes.flatMap((n) => n.subtopics));
    for (const [s, n] of subtopics)
      if (!placed.has(s))
        gaps.push(
          `${topic}: subtopic "${s}" (${n} question${n === 1 ? '' : 's'}) is on no roadmap node; add it to one in ${ROADMAP_FILE}`,
        );
  }
  for (const [topic, nodes] of Object.entries(roadmap)) {
    const subtopics = used.get(topic) ?? new Map<string, number>();
    for (const n of nodes)
      for (const s of n.subtopics)
        if (!subtopics.has(s)) gaps.push(`${topic} ${n.id}: subtopic "${s}" has no questions`);
  }
  return gaps;
}
