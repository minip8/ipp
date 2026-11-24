/**
 * Pad event channel: one WebSocket per open pad at  <WS_URL>/ws/pads/<padId>?ticket=<ticket>
 * (ticket from POST /api/ws-ticket; single use, 30 s). JSON text frames, one event per frame.
 * The collaborative editor uses a separate Hocuspocus socket at <WS_URL>/collab.
 */
import { z } from 'zod';
import { AiKeyState, InterviewerModel } from './ai';
import { Id, Language } from './common';
import { JudgeProgress } from './judge';
import { Message, Pad } from './pad';
import { Run } from './run';

export const ServerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run.created'), run: Run }),
  z.object({ type: z.literal('run.progress'), runId: Id, event: JudgeProgress.shape.event }),
  z.object({ type: z.literal('run.finished'), run: Run }),
  /** A complete message (candidate echo to other participants, or a proactive interviewer message). */
  z.object({ type: z.literal('message.created'), message: Message }),
  /** Streaming interviewer reply: zero or more deltas, then message.created with the same id. */
  z.object({ type: z.literal('message.delta'), messageId: Id, delta: z.string() }),
  z.object({ type: z.literal('interviewer.thinking'), active: z.boolean() }),
  /** The pad owner's API key changed state (saved, deleted, expired, rejected by its provider). */
  z.object({
    type: z.literal('interviewer.status'),
    key: AiKeyState,
    /** The model the interviewer now runs on (absent from older servers). */
    model: InterviewerModel.nullable().optional(),
  }),
  z.object({ type: z.literal('pad.updated'), pad: Pad }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ type: z.literal('pong') }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;

export const ClientEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat.send'),
    text: z.string().min(1),
    via: z.enum(['text', 'voice']).default('text'),
  }),
  /** Editor telemetry that the interviewer and the timeline care about. */
  z.object({
    type: z.literal('telemetry'),
    kind: z.enum(['paste', 'blur']),
    chars: z.int().optional(),
    ms: z.int().optional(),
  }),
  z.object({ type: z.literal('language'), language: Language }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

export const WsTicketRequest = z.object({ padId: Id });
export const WsTicketResponse = z.object({ ticket: z.string(), expiresInSec: z.int() });
