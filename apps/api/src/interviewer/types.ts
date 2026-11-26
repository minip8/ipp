/** The interviewer boundary types, owned by packages/interviewer (src/types.ts). */
import type { QuizQuestion } from '@ipp/contracts';

export type {
  AiScope,
  CreateInterviewer,
  DiscussionStep,
  InterviewContext,
  Interviewer,
  InterviewerConfig,
  InterviewerDeps,
  ModelUsage,
  NewMessage,
  QuantClock,
  QuantContext,
  QuantQuestion,
  QuantStep,
  QuantStepResult,
  ResolvedKey,
  ReviewResult,
  RoomContext,
  ShortAnswerGrade,
  Trigger,
} from '@ipp/interviewer';

export type QuizQuestionShort = Extract<QuizQuestion, { type: 'short' }>;
