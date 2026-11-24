/** Pure helpers for interview rooms (a pad whose owner hosts; whoever joins is a candidate). */
import {
  GUEST_NAME_MAX,
  type Message,
  type PadMember,
  type Run,
  type SolutionReview,
} from '@ipp/contracts';

/** A name as the room will show it: one line, trimmed, within the limit. */
export function cleanGuestName(raw: string): string {
  return (
    raw
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, GUEST_NAME_MAX)
  );
}

export const candidatesOf = (members: PadMember[]) => members.filter((m) => m.role !== 'owner');
export const hostOf = (members: PadMember[]) => members.find((m) => m.role === 'owner');

/** Who wrote a message, for the people chat. A member who has left keeps a role-based name. */
export function authorName(m: Pick<Message, 'role' | 'userId'>, members: PadMember[]): string {
  const known = m.userId ? members.find((x) => x.userId === m.userId) : undefined;
  if (known) return known.name;
  return m.role === 'interviewer' ? 'Interviewer' : 'Candidate';
}

/** "Casey", "Casey and Sam", "Casey, Sam and 2 others". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/** Who else is in the room, as the chat header says it to the host or to a candidate. */
export function roomSubtitle(members: PadMember[], me: string): string {
  const host = hostOf(members);
  const others = candidatesOf(members).filter((m) => m.userId !== me);
  if (host?.userId === me)
    return others.length
      ? `with ${nameList(others.map((m) => m.name))}`
      : 'waiting for your candidate';
  return host ? `with ${nameList([host.name, ...others.map((m) => m.name)])}` : '';
}

type Tone = 'ok' | 'bad' | 'warn' | 'neutral';
export const REVIEW_VERDICT: Record<SolutionReview['verdict'], { label: string; tone: Tone }> = {
  correct: { label: 'Looks correct', tone: 'ok' },
  incorrect: { label: 'Has a problem', tone: 'bad' },
  incomplete: { label: 'Not finished', tone: 'warn' },
  unclear: { label: 'Cannot tell', tone: 'neutral' },
};

/**
 * The runs made on the pad's current problem. A room's host can change the problem; results of
 * the one before would be read against the wrong statement. Runs from before rooms existed
 * carry no problem and always count.
 */
export function runsForProblem(runs: Run[], problemSlug: string | null): Run[] {
  return runs.filter((r) => r.problemSlug === undefined || (r.problemSlug ?? null) === problemSlug);
}
