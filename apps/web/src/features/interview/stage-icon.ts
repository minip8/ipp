import type { StageKind } from '@ipp/contracts';
import { CodeXmlIcon, type LucideIcon, MessagesSquareIcon, TrendingUpIcon } from 'lucide-react';

/** Each kind of stage's icon, wherever stages are shown (the builder, the lists, the pages). */
export const STAGE_ICON: Record<StageKind, LucideIcon> = {
  coding: CodeXmlIcon,
  questions: MessagesSquareIcon,
  game: TrendingUpIcon,
};
