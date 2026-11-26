import type { Db } from '@ipp/db';
import { sql } from '@ipp/db/orm';

/**
 * The database's clock as it is now (`clock_timestamp()`: inside a transaction, not its start),
 * rounded up to the millisecond, so a row stamped with it never sorts before one Postgres
 * stamped (`now()`, microseconds) a moment earlier. A quant round's steps stamp their messages
 * and the round's times with it, so they share one clock with every message Postgres stamps and
 * with `pads.started_at`, wherever the API runs (`Ctx.dbNow`).
 */
export async function readDbClock(q: Pick<Db, 'execute'>): Promise<Date> {
  const rows = await q.execute<{ ms: number }>(
    sql`select ceil(extract(epoch from clock_timestamp()) * 1000)::float8 as ms`,
  );
  const ms = Number(rows[0]?.ms);
  if (!Number.isFinite(ms)) throw new Error('could not read the database clock');
  return new Date(ms);
}

/**
 * Postgres error checks. Drizzle wraps driver errors (DrizzleQueryError), so the SQLSTATE can
 * sit on the error itself or further down its `cause` chain.
 */
function sqlState(err: unknown): string | null {
  let e = err;
  for (let depth = 0; depth < 5 && e && typeof e === 'object'; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * A write referenced a row that no longer exists. For pad-scoped writes this means the pad was
 * deleted while the write was in flight (a late judge result, a debounced editor save, an
 * assessment that finished after the delete): the write is moot, not an error.
 */
export const isForeignKeyViolation = (err: unknown) => sqlState(err) === '23503';
