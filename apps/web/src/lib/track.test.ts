import { describe, expect, it } from 'vitest';
import {
  currentTrack,
  homeTarget,
  misplacedTopic,
  practiceHref,
  quizTarget,
  roadmapHref,
  switchHref,
  tabFromPath,
  tabHref,
  topicsOf,
  trackForTopic,
  trackFromPath,
} from './track';

const TOPICS = [
  { slug: 'cpp', track: 'fundamentals', also: [] },
  { slug: 'python', track: 'fundamentals', also: ['quant'] },
  { slug: 'probability', track: 'quant', also: [] },
] as const;

describe('where a path is', () => {
  it('reads the track from the first segment only', () => {
    expect(trackFromPath('/software/practice')).toBe('software');
    expect(trackFromPath('/quant')).toBe('quant');
    expect(trackFromPath('/quant/practice/drill')).toBe('quant');
    expect(trackFromPath('/quiz/topics/probability')).toBeNull();
    expect(trackFromPath('/pads/x/report')).toBeNull();
    expect(trackFromPath('/')).toBeNull();
    expect(trackFromPath('/quantum')).toBeNull();
  });

  it('puts leaf pages under the tab they belong to', () => {
    expect(tabFromPath('/software/interviews')).toBe('interviews');
    expect(tabFromPath('/quant/practice/drill')).toBe('practice');
    expect(tabFromPath('/quant/roadmap')).toBe('roadmap');
    expect(tabFromPath('/quiz/abc')).toBe('practice');
    expect(tabFromPath('/quiz/topics/python')).toBe('practice');
    expect(tabFromPath('/pads/abc/report')).toBe('interviews');
    expect(tabFromPath('/dashboard')).toBe('interviews');
    expect(tabFromPath('/settings/ai-key')).toBeNull();
    expect(tabFromPath('/')).toBeNull();
  });

  it("takes the URL's track, else the remembered one, else software", () => {
    expect(currentTrack('/quant/roadmap', 'software')).toBe('quant');
    expect(currentTrack('/quiz/abc', 'quant')).toBe('quant');
    expect(currentTrack('/quiz/abc', null)).toBe('software');
    expect(currentTrack('/settings/ai-key', undefined)).toBe('software');
  });
});

describe('links', () => {
  it('builds the tabs and their options', () => {
    expect(tabHref('quant', 'interviews')).toBe('/quant/interviews');
    expect(practiceHref('software')).toBe('/software/practice');
    expect(practiceHref('quant', { topic: 'python' })).toBe('/quant/practice?topic=python');
    expect(practiceHref('software', { view: 'history' })).toBe('/software/practice?view=history');
    expect(roadmapHref('quant')).toBe('/quant/roadmap');
    expect(roadmapHref('quant', { path: 'researcher' })).toBe('/quant/roadmap?path=researcher');
    expect(roadmapHref('software', { view: 'maps' })).toBe('/software/roadmap?view=maps');
    expect(roadmapHref('software', { topic: 'cpp', node: 'cpp-move' })).toBe(
      '/software/roadmap?view=maps&roadmap=cpp&node=cpp-move',
    );
  });

  it('switches to the same tab of the other track, keeping only the view', () => {
    expect(switchHref('/software/practice', '', 'quant')).toBe('/quant/practice');
    expect(switchHref('/software/practice', 'view=history&topic=cpp', 'quant')).toBe(
      '/quant/practice?view=history',
    );
    expect(switchHref('/quant/roadmap', 'view=maps&roadmap=probability&node=x', 'software')).toBe(
      '/software/roadmap?view=maps',
    );
    expect(switchHref('/quant/roadmap', 'path=researcher', 'software')).toBe('/software/roadmap');
    expect(switchHref('/software/interviews', 'view=history&mode=host', 'quant')).toBe(
      '/quant/interviews',
    );
    expect(switchHref('/quant/practice/drill', 'seed=4', 'software')).toBe('/software/practice');
  });

  it('switches from a leaf page to the tab it belongs to', () => {
    expect(switchHref('/quiz/abc', '', 'quant')).toBe('/quant/practice');
    expect(switchHref('/quiz/topics/python', 'question=q1', 'quant')).toBe('/quant/practice');
    expect(switchHref('/pads/abc/report', '', 'software')).toBe('/software/interviews');
    expect(switchHref('/settings/ai-key', '', 'quant')).toBe('/quant/interviews');
    expect(switchHref('/', '', 'quant')).toBe('/quant/interviews');
  });
});

describe('the old pages', () => {
  it("sends the home to the remembered track's Interviews with the query", () => {
    expect(homeTarget('', 'quant')).toBe('/quant/interviews');
    expect(homeTarget('view=history', 'software')).toBe('/software/interviews?view=history');
    expect(homeTarget('mode=host&view=history', 'quant')).toBe(
      '/quant/interviews?mode=host&view=history',
    );
  });

  it('asks first when nothing is remembered and the query does not decide', () => {
    expect(homeTarget('', null)).toBeNull();
    expect(homeTarget('view=history', null)).toBeNull();
  });

  it('keeps a coding problem in the software track whatever was remembered', () => {
    expect(homeTarget('problem=two-sum', 'quant')).toBe('/software/interviews?problem=two-sum');
    expect(homeTarget('difficulty=medium&random=1', null)).toBe(
      '/software/interviews?difficulty=medium&random=1',
    );
    expect(homeTarget('category=dsa', 'quant')).toBe('/software/interviews?category=dsa');
  });

  it('sends the quizzes page to Practice, or its roadmap view to the topic maps', () => {
    expect(quizTarget('', 'quant')).toBe('/quant/practice');
    expect(quizTarget('topic=networking', 'software')).toBe('/software/practice?topic=networking');
    expect(quizTarget('view=history', 'quant')).toBe('/quant/practice?view=history');
    expect(quizTarget('view=roadmap', 'software')).toBe('/software/roadmap?view=maps');
    expect(quizTarget('view=roadmap&roadmap=cpp&node=cpp-move', 'software')).toBe(
      '/software/roadmap?view=maps&roadmap=cpp&node=cpp-move',
    );
  });
});

describe('topics and tracks', () => {
  it('keeps a track to its topics, a shared one in both, in the order given', () => {
    expect(topicsOf(TOPICS, 'software').map((t) => t.slug)).toEqual(['cpp', 'python']);
    expect(topicsOf(TOPICS, 'quant').map((t) => t.slug)).toEqual(['python', 'probability']);
  });

  it("shows a topic in the current track when it is there, else in its home's", () => {
    expect(trackForTopic(TOPICS[1], 'quant')).toBe('quant');
    expect(trackForTopic(TOPICS[1], 'software')).toBe('software');
    expect(trackForTopic(TOPICS[0], 'quant')).toBe('software');
    expect(trackForTopic(TOPICS[2], 'software')).toBe('quant');
  });

  it('names the other track only for a topic that is not in this one', () => {
    expect(misplacedTopic('probability', TOPICS, 'software')).toBe('quant');
    expect(misplacedTopic('cpp', TOPICS, 'quant')).toBe('software');
    expect(misplacedTopic('python', TOPICS, 'quant')).toBeNull();
    expect(misplacedTopic('python', TOPICS, 'software')).toBeNull();
    expect(misplacedTopic('nope', TOPICS, 'software')).toBeNull();
    expect(misplacedTopic(null, TOPICS, 'software')).toBeNull();
  });
});
