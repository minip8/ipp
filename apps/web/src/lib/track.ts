/**
 * The site tracks in URLs: which track and tab a path is, where the header's links and switch
 * go, and where the old pages (`/dashboard`, `/new`, `/quiz`) send someone. Pure, so tested
 * beside it; the hooks that read the remembered track are in `track-hooks.ts`.
 *
 *   /{track}/interviews   /{track}/practice   /{track}/roadmap   /quant/practice/drill
 *
 * Leaf pages (a pad, its report, a quiz, a question bank, settings) name no track: the header
 * shows the remembered one there.
 */
import { homeTrack, type QuizTrack, TRACKS, type Track, topicInTrack } from '@ipp/contracts';

export const TABS = ['interviews', 'practice', 'roadmap'] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABEL: Record<Tab, string> = {
  interviews: 'Interviews',
  practice: 'Practice',
  roadmap: 'Roadmap',
};

/** The mental math drill, on the Quant track's Practice tab. */
export const DRILL_HREF = '/quant/practice/drill';

/** The Roadmap tab's views, in `?view=` (the study path is the default and leaves it out). */
export const ROADMAP_VIEWS = ['path', 'maps'] as const;
export type RoadmapView = (typeof ROADMAP_VIEWS)[number];

/**
 * The Practice tab's views, in `?view=` (the quizzes are the default and leave it out). Software
 * also lists the problem library there; a session on one problem starts from its row.
 */
export const PRACTICE_VIEWS = {
  software: ['start', 'problems', 'history'],
  quant: ['start', 'history'],
} as const satisfies Record<Track, readonly [string, ...string[]]>;
export type PracticeView = (typeof PRACTICE_VIEWS)[Track][number];

/** The Interviews tab's views, in `?view=` (starting one is the default). */
export const INTERVIEW_VIEWS = ['start', 'history'] as const;

const isTrack = (s: string | undefined): s is Track => TRACKS.includes(s as Track);

/** The track a path names (`/quant/roadmap` is quant), or null for a page of no track. */
export function trackFromPath(pathname: string): Track | null {
  const first = pathname.split('/')[1];
  return isTrack(first) ? first : null;
}

/**
 * The header tab a page belongs to, for its highlight: a track page's own; a quiz or question
 * bank is Practice; a pad and its report (and the old home) Interviews. Null for anything else.
 */
export function tabFromPath(pathname: string): Tab | null {
  const [, first, second] = pathname.split('/');
  if (isTrack(first)) return TABS.find((t) => t === second) ?? null;
  if (first === 'quiz') return 'practice';
  if (first === 'pads' || first === 'dashboard' || first === 'new') return 'interviews';
  return null;
}

export const tabHref = (track: Track, tab: Tab) => `/${track}/${tab}`;

const withQuery = (path: string, q: URLSearchParams) => {
  const s = q.toString();
  return s ? `${path}?${s}` : path;
};

/** A track's Practice tab, optionally with a topic preselected or on another view. */
export function practiceHref(
  track: Track,
  opts: { topic?: string; view?: Exclude<PracticeView, 'start'> } = {},
): string {
  const q = new URLSearchParams();
  if (opts.topic) q.set('topic', opts.topic);
  if (opts.view) q.set('view', opts.view);
  return withQuery(tabHref(track, 'practice'), q);
}

/**
 * A track's Interviews tab: on hosting (`?mode=host`), its history, or (Software) with a problem
 * chosen in the setup.
 */
export function interviewsHref(
  track: Track,
  opts: { problem?: string; host?: boolean; view?: 'history' } = {},
): string {
  const q = new URLSearchParams();
  if (opts.host) q.set('mode', 'host');
  if (opts.problem) q.set('problem', opts.problem);
  if (opts.view) q.set('view', opts.view);
  return withQuery(tabHref(track, 'interviews'), q);
}

/** The Roadmap's search params for the topic maps (`QuizRoadmap` reads them). */
export const ROADMAP_TOPIC_PARAM = 'roadmap';
export const ROADMAP_NODE_PARAM = 'node';

/** A track's Roadmap: the study path (on a quant path), or the topic maps on a topic and area. */
export function roadmapHref(
  track: Track,
  opts: { view?: RoadmapView; path?: string; topic?: string; node?: string } = {},
): string {
  const q = new URLSearchParams();
  const maps = opts.view === 'maps' || opts.topic !== undefined || opts.node !== undefined;
  if (maps) q.set('view', 'maps');
  else if (opts.path) q.set('path', opts.path);
  if (opts.topic) q.set(ROADMAP_TOPIC_PARAM, opts.topic);
  if (opts.node) q.set(ROADMAP_NODE_PARAM, opts.node);
  return withQuery(tabHref(track, 'roadmap'), q);
}

export const otherTrack = (t: Track): Track => (t === 'software' ? 'quant' : 'software');

/**
 * Where the header switch goes from this page: the same tab in the other track, keeping the
 * page's view when the other track has it (a history, the topic maps) and Interviews' hosting
 * mode, but nothing about this track's content. From a page of no track: a quiz or bank goes to
 * Practice, anything else to Interviews.
 */
export function switchHref(pathname: string, search: string, to: Track): string {
  const tab = tabFromPath(pathname) ?? 'interviews';
  if (trackFromPath(pathname) === null) return tabHref(to, tab);
  const from = new URLSearchParams(search);
  const view = from.get('view');
  const q = new URLSearchParams();
  if (tab === 'interviews' && from.get('mode') === 'host') q.set('mode', 'host');
  if (tab === 'interviews' && view === 'history') q.set('view', view);
  if (tab === 'practice' && view === 'history') q.set('view', view);
  if (tab === 'roadmap' && view === 'maps') q.set('view', view);
  return withQuery(tabHref(to, tab), q);
}

/**
 * The track a page of no track is in: the remembered one, else software. (A track page's own
 * track always wins; see `currentTrack`.)
 */
export function currentTrack(pathname: string, remembered: Track | null | undefined): Track {
  return trackFromPath(pathname) ?? remembered ?? 'software';
}

/**
 * Choices on the old home's query that only the coding interview setup understands: a link
 * carrying one (a problem from the library, a random pick) means the software track whatever was
 * remembered, or the problem would be lost.
 */
const CODING_PARAMS = ['problem', 'category', 'difficulty', 'random'];

/**
 * Where the app's old home (`/dashboard`, `/new`) sends someone: their track's Interviews, with
 * the query kept. A coding query means Software and `format=quant` (the old way to a quant room,
 * `?mode=host&format=quant`) means Quant, whatever was remembered; `format` itself is dropped.
 * Null while there is no remembered track and the query does not decide it: the first-visit
 * question is asked then.
 */
export function homeTarget(search: string, remembered: Track | null): string | null {
  const q = new URLSearchParams(search);
  const quant = q.get('format') === 'quant';
  q.delete('format');
  const coding = CODING_PARAMS.some((p) => q.has(p));
  const track = quant ? 'quant' : coding ? 'software' : remembered;
  return track ? withQuery(tabHref(track, 'interviews'), q) : null;
}

/**
 * Where the old Quizzes page (`/quiz`, `/quiz/topics`) sends someone: their track's Practice with
 * the query kept, or its Roadmap's topic maps for `?view=roadmap` (keeping `roadmap=` and `node=`).
 */
export function quizTarget(search: string, track: Track): string {
  const q = new URLSearchParams(search);
  if (q.get('view') === 'roadmap') {
    const topic = q.get(ROADMAP_TOPIC_PARAM) ?? undefined;
    const node = q.get(ROADMAP_NODE_PARAM) ?? undefined;
    return roadmapHref(track, { view: 'maps', topic, node });
  }
  return withQuery(tabHref(track, 'practice'), q);
}

type TrackedTopic = { slug: string; track: QuizTrack; also?: readonly Track[] };

/**
 * The track to show a topic in from `track`: this one when the topic is in it, else its home's.
 * For links from pages of no track (a question bank's way back) and for a URL that names a topic
 * of the other track.
 */
export function trackForTopic(topic: Omit<TrackedTopic, 'slug'>, track: Track): Track {
  return topicInTrack(topic, track) ? track : homeTrack(topic.track);
}

/**
 * When a track page's URL names a topic (`?topic=`, `?roadmap=`) that is not in this track but is
 * in the other, the other track (to send the user there); else null, and the page carries on.
 */
export function misplacedTopic(
  slug: string | null,
  topics: readonly TrackedTopic[],
  track: Track,
): Track | null {
  if (!slug) return null;
  const t = topics.find((x) => x.slug === slug);
  if (!t || topicInTrack(t, track)) return null;
  return trackForTopic(t, track);
}

/**
 * The topics of a track: its own (home in it) first, then those shared into it, each in the
 * order given (the server's study order). Every list of a track's topics goes through this.
 */
export function topicsOf<T extends Omit<TrackedTopic, 'slug'>>(
  topics: readonly T[],
  track: Track,
): T[] {
  const own = topics.filter((t) => homeTrack(t.track) === track);
  const shared = topics.filter((t) => homeTrack(t.track) !== track && topicInTrack(t, track));
  return [...own, ...shared];
}
