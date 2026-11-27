/**
 * The Quant track's paths in the URL (`?path=`), as the Roadmap's study path chooses between
 * them. A path's steps are the Roadmap's (features/roadmap).
 */
import { QUANT_PATHS, type QuantPath } from '@ipp/contracts';

/** Where the chosen path lives in the URL; the first path is the default and leaves it out. */
export const PATH_PARAM = 'path';

/** The paths in tab order (the first is the default). */
export const PATHS: readonly [QuantPath, ...QuantPath[]] = QUANT_PATHS;
