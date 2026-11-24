/**
 * Runs before the app's own code in the browser. Zod probes for eval support (`Function("")`)
 * when the first schema is defined, to compile faster parsers. The Content-Security-Policy
 * (src/proxy.ts) forbids eval, so the probe would only produce a violation report: switch it
 * off before any schema exists and use the interpreted path.
 */
import { z } from 'zod';

z.config({ jitless: true });
