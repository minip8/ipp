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
