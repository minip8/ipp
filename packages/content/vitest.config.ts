import { defineConfig } from 'vitest/config';

// Loading and validating the whole library takes a few seconds on a small CI runner.
export default defineConfig({ test: { testTimeout: 60_000 } });
