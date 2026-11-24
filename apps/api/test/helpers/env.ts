export const TEST_DATABASE_URL =
  process.env.API_TEST_DATABASE_URL ?? 'postgres://ipp:ipp@127.0.0.1:5432/ipp_test';
/** Redis DB 15 so tests never touch the development streams in DB 0. */
export const TEST_REDIS_URL = process.env.API_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';
export const TEST_WEB_ORIGIN = 'http://web.test:3000';
