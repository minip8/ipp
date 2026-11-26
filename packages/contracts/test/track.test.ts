import { describe, expect, it } from 'vitest';
import {
  homeTrack,
  padTrack,
  QuizTopic,
  SetTrackRequest,
  SetTrackResponse,
  TRACK_INFO,
  TRACKS,
  topicInTrack,
  topicTracks,
} from '../src';

describe('site tracks', () => {
  it('maps a topic home to its site track', () => {
    expect(homeTrack('fundamentals')).toBe('software');
    expect(homeTrack('quant')).toBe('quant');
  });

  it('has a label and description for every track', () => {
    expect(TRACKS.map((t) => TRACK_INFO[t].label)).toEqual(['Software', 'Quant']);
  });

  it('lists the home first, then also in TRACKS order, without duplicates', () => {
    expect(topicTracks({ track: 'fundamentals' })).toEqual(['software']);
    expect(topicTracks({ track: 'fundamentals', also: [] })).toEqual(['software']);
    expect(topicTracks({ track: 'fundamentals', also: ['quant'] })).toEqual(['software', 'quant']);
    expect(topicTracks({ track: 'quant', also: ['software'] })).toEqual(['quant', 'software']);
    expect(topicTracks({ track: 'quant', also: ['quant'] })).toEqual(['quant']);
    expect(topicTracks({ track: 'quant', also: ['software', 'quant', 'software'] })).toEqual([
      'quant',
      'software',
    ]);
  });

  it('tells whether a topic shows in a track', () => {
    const python = { track: 'fundamentals', also: ['quant'] } as const;
    expect(topicInTrack(python, 'software')).toBe(true);
    expect(topicInTrack(python, 'quant')).toBe(true);
    expect(topicInTrack({ track: 'quant' }, 'software')).toBe(false);
    expect(topicInTrack({ track: 'fundamentals' }, 'quant')).toBe(false);
  });

  it('gives a topic parsed without also an empty list', () => {
    const topic = QuizTopic.parse({ slug: 'cpp', title: 'C++', description: 'd' });
    expect(topic.also).toEqual([]);
    expect(topic.track).toBe('fundamentals');
    expect(
      QuizTopic.parse({ slug: 'python', title: 'Python', description: 'd', also: ['quant'] }).also,
    ).toEqual(['quant']);
    expect(() =>
      QuizTopic.parse({
        slug: 'python',
        title: 'Python',
        description: 'd',
        also: ['fundamentals'],
      }),
    ).toThrow();
  });

  it('puts a pad in a track by its format', () => {
    expect(padTrack({ format: 'coding' })).toBe('software');
    expect(padTrack({ format: 'quant' })).toBe('quant');
  });

  it('accepts only a known track on PUT /api/me/track', () => {
    expect(SetTrackRequest.parse({ track: 'quant' })).toEqual({ track: 'quant' });
    expect(SetTrackResponse.parse({ track: 'software' })).toEqual({ track: 'software' });
    expect(SetTrackRequest.safeParse({ track: 'fundamentals' }).success).toBe(false);
    expect(SetTrackRequest.safeParse({ track: 'research' }).success).toBe(false);
    expect(SetTrackRequest.safeParse({}).success).toBe(false);
    expect(SetTrackRequest.safeParse({ track: null }).success).toBe(false);
  });
});
