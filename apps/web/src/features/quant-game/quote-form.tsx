'use client';
/**
 * The candidate's market on the current game: bid, offer and size, checked as they type with
 * the contract's own `quoteProblem` (each problem in words under its field), posted with Enter.
 * Arrow keys move a field by one tick (Shift: five), Alt with them moves the whole market; the
 * buttons do the same by touch. After a trade or a reveal the last numbers stay as the starting
 * point, so quoting again is one keystroke away.
 */
import type { QuantGameView } from '@ipp/contracts';
import { ChevronDownIcon, ChevronUpIcon, SendIcon } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { usePad } from '@/features/pad/session';
import { cn } from '@/lib/utils';
import {
  checkDraft,
  draftOf,
  EMPTY_DRAFT,
  FIELD_LABEL,
  lastQuote,
  QUOTE_FIELDS,
  type QuoteDraft,
  type QuoteField,
  quoteErrorMessage,
  quotesLeftWarning,
  shiftMarket,
  stepPrice,
  stepSize,
} from './logic';

function initialDraft(game: QuantGameView): QuoteDraft {
  const q = game.quote ?? lastQuote(game);
  return q ? draftOf(q) : EMPTY_DRAFT;
}

export function QuoteForm({ index, game }: { index: number; game: QuantGameView }) {
  const { postQuote } = usePad();
  const id = useId();
  const spec = { tick: game.tick, maxSize: game.maxSize };
  const [draft, setDraft] = useState<QuoteDraft>(() => initialDraft(game));
  /** Edited since it was last filled from a market: someone else's quote does not overwrite it. */
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<QuoteField, HTMLInputElement | null>>>({});

  // A market posted by someone else in the pad (a collaborator) becomes the starting point too.
  const live = game.quote;
  const liveRef = useRef(live);
  liveRef.current = live;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the live quote's time
  useEffect(() => {
    const q = liveRef.current;
    if (q && !dirty) setDraft(draftOf(q));
  }, [live?.at, dirty]);

  const check = checkDraft(spec, draft);
  const left = game.quotesLeft;
  const warning = quotesLeftWarning(left);
  const shown = (f: QuoteField) => check.errors[f] ?? (tried ? check.missing[f] : undefined);

  const edit = (next: QuoteDraft) => {
    setDraft(next);
    setDirty(true);
    setError(null);
  };

  const onKeyDown = (f: QuoteField) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const steps = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1);
    if (f === 'size') edit({ ...draft, size: stepSize(draft.size, steps, game.maxSize) });
    else if (e.altKey) edit(shiftMarket(draft, steps, game.tick));
    else edit({ ...draft, [f]: stepPrice(draft[f], steps, game.tick) });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const quote = check.quote;
    if (!quote) {
      setTried(true);
      const first = QUOTE_FIELDS.find((f) => check.errors[f] || check.missing[f]);
      if (first) inputs.current[first]?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const round = await postQuote({ index, ...quote });
      // The market as the server keeps it (snapped to the tick), ready to be moved and re-posted.
      const posted = round.questions.find((q) => q.index === index)?.game?.quote;
      if (posted) setDraft(draftOf(posted));
      setDirty(false);
      setTried(false);
    } catch (err) {
      setError(quoteErrorMessage(err, spec));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-label="Your market"
      className="space-y-2.5"
      data-testid="quote-form"
    >
      <fieldset disabled={left === 0} className="min-w-0 space-y-2.5">
        <legend className="sr-only">Your market</legend>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.75fr)] gap-2">
          {QUOTE_FIELDS.map((f) => {
            const err = shown(f);
            return (
              <div key={f} className="min-w-0 space-y-1">
                <Label htmlFor={`${id}-${f}`} className="text-xs text-fg-muted">
                  {FIELD_LABEL[f]}
                </Label>
                <Input
                  id={`${id}-${f}`}
                  ref={(el) => {
                    inputs.current[f] = el;
                  }}
                  value={draft[f]}
                  onChange={(e) => edit({ ...draft, [f]: e.target.value })}
                  onKeyDown={onKeyDown(f)}
                  inputMode={f === 'size' ? 'numeric' : 'decimal'}
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  placeholder={f === 'size' ? `1–${game.maxSize}` : undefined}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? `${id}-${f}-error` : undefined}
                  className="h-9 font-mono tabular max-lg:h-10"
                  data-testid={`quote-${f}`}
                />
                {err && (
                  <p
                    id={`${id}-${f}-error`}
                    className="text-xs leading-snug text-bad-text"
                    data-testid={`quote-${f}-error`}
                  >
                    {err}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          {/* biome-ignore lint/a11y/useSemanticElements: a group of two buttons, not a form part */}
          <div role="group" aria-label="Move the whole market" className="flex gap-1">
            <Button
              size="icon-sm"
              aria-label="Move the market down a tick"
              onClick={() => edit(shiftMarket(draft, -1, game.tick))}
              className="max-lg:size-10"
            >
              <ChevronDownIcon />
            </Button>
            <Button
              size="icon-sm"
              aria-label="Move the market up a tick"
              onClick={() => edit(shiftMarket(draft, 1, game.tick))}
              className="max-lg:size-10"
            >
              <ChevronUpIcon />
            </Button>
          </div>
          <span className="hidden text-2xs leading-tight text-fg-subtle xl:inline pointer-coarse:hidden">
            ↑↓ a tick · Alt moves both
          </span>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="ml-auto max-lg:h-10 max-lg:px-4"
            disabled={pending}
            data-testid="quote-submit"
          >
            {pending ? <Spinner /> : <SendIcon />}
            Post market
            <Kbd
              keys="Enter"
              className="ml-0.5 text-accent-fg/80 max-lg:hidden [&>span]:border-accent-fg/30 [&>span]:bg-transparent [&>span]:shadow-none"
            />
          </Button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm leading-snug text-bad-text" data-testid="quote-error">
          {error}
        </p>
      )}
      {warning && (
        <p
          className={cn('text-xs', left === 0 ? 'text-bad-text' : 'text-warn-text')}
          data-testid="quotes-left"
        >
          {warning}
        </p>
      )}
    </form>
  );
}
