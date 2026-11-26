'use client';
/**
 * A market-making game in the quant pad (ARCHITECTURE §8.3): the hidden components, the live
 * market and what became of the last one, the quote form, the candidate's position and cash, the
 * blotter, and the settlement once the question closes. Read only from `QuantQuestionView.game`,
 * which has no hidden value, fair value or mark-to-market figure; nothing here works one out.
 * Everyone in the pad sees the same panel and may quote (a practice pad).
 */
import type { QuantGameView } from '@ipp/contracts';
import { ArrowDownLeftIcon, ArrowUpRightIcon, EyeIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  announcement,
  blotter,
  lots,
  marketText,
  newlyShown,
  num,
  payoffLine,
  positionLabel,
  quoteStatus,
  revealText,
  rulesLine,
  settlementParts,
  signed,
  tradeText,
} from './logic';
import { QuoteForm } from './quote-form';
import { ComponentTiles } from './tiles';

/** How long a newly shown component stays marked. */
const FRESH_MS = 4000;

/** The components just shown, marked for a few seconds (none on the first look). */
function useFresh(components: QuantGameView['components']): Set<number> {
  const prev = useRef<QuantGameView['components'] | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const shown = newlyShown(prev.current, components);
    prev.current = components;
    if (shown.length === 0) return;
    setFresh(new Set(shown));
    const t = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => clearTimeout(t);
  }, [components]);
  return fresh;
}

/** Tells a screen reader what the interviewer did since the panel last looked. */
function useAnnouncement(game: QuantGameView): string {
  const seen = useRef(game.log.length);
  const [text, setText] = useState('');
  useEffect(() => {
    const said = announcement(game, seen.current);
    seen.current = game.log.length;
    if (said) setText(said);
  }, [game]);
  return text;
}

function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', className)} />;
}

function QuoteStatusLine({ game }: { game: QuantGameView }) {
  const s = quoteStatus(game);
  const body = (() => {
    switch (s.kind) {
      case 'none':
        return {
          tag: 'No market yet',
          tone: 'text-fg-muted',
          dot: 'bg-fg-subtle/50',
          text: 'Post a bid, an offer and a size.',
        };
      case 'working':
        return {
          tag: 'Live',
          tone: 'text-accent-text',
          dot: 'bg-accent animate-pulse-dot',
          text: `${marketText(s.quote)} for ${lots(s.quote.size)}. Waiting for the interviewer.`,
        };
      case 'traded':
        return {
          tag: 'Traded',
          tone: 'text-ok-text',
          dot: 'bg-ok',
          text: `${tradeText(s.trade)}.${s.revealAfter ? ` Then ${revealText(s.revealAfter)}.` : ''} Make a new market.`,
        };
      case 'withdrawn':
        return {
          tag: 'Withdrawn',
          tone: 'text-warn-text',
          dot: 'bg-warn',
          text: `${revealText(s.reveal)}, so your market was pulled. Make a new one.`,
        };
      case 'settled':
        return null;
    }
  })();
  if (!body) return null;
  return (
    <p
      className="flex items-start gap-2 text-sm leading-snug"
      data-testid="quote-status"
      data-state={s.kind}
    >
      <Dot className={cn('mt-1.5', body.dot)} />
      <span>
        <span className={cn('font-semibold', body.tone)}>{body.tag}</span>
        <span className="text-fg-muted"> · {body.text}</span>
      </span>
    </p>
  );
}

function Books({ game }: { game: QuantGameView }) {
  const trades = game.log.filter((e) => e.kind === 'trade').length;
  return (
    <dl className="grid grid-cols-3 divide-x divide-border text-center" data-testid="game-books">
      <div className="px-2 py-2">
        <dt className="text-2xs text-fg-subtle">Position</dt>
        <dd className="font-mono text-sm font-semibold tabular" data-testid="game-position">
          {positionLabel(game.position)}
        </dd>
      </div>
      <div className="px-2 py-2">
        <dt className="text-2xs text-fg-subtle">Cash</dt>
        <dd className="font-mono text-sm font-semibold tabular" data-testid="game-cash">
          {signed(game.cash)}
        </dd>
      </div>
      <div className="px-2 py-2">
        <dt className="text-2xs text-fg-subtle">Trades</dt>
        <dd className="font-mono text-sm font-semibold tabular">{trades}</dd>
      </div>
    </dl>
  );
}

function Blotter({ game }: { game: QuantGameView }) {
  const rows = blotter(game);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Trades" className="px-3 pt-2 pb-3">
      <h4 className="mb-1.5 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
        Blotter
      </h4>
      <ol className="space-y-px text-sm" data-testid="game-blotter">
        {rows.map((r) =>
          r.kind === 'trade' ? (
            <li
              key={r.key}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 odd:bg-surface-2/60"
              data-testid="blotter-trade"
            >
              {r.side === 'buy' ? (
                <ArrowDownLeftIcon className="size-3.5 shrink-0 text-ok-text" aria-hidden />
              ) : (
                <ArrowUpRightIcon className="size-3.5 shrink-0 text-bad-text" aria-hidden />
              )}
              <span className="font-medium tabular">{r.text}</span>
              <span className="ml-auto text-xs text-fg-subtle tabular">
                {positionLabel(r.position).toLowerCase()}
              </span>
            </li>
          ) : (
            <li
              key={r.key}
              className="flex items-center gap-2 px-1.5 py-1 text-xs text-fg-muted"
              data-testid="blotter-reveal"
            >
              <EyeIcon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
              {r.text}
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

function Settlement({ game }: { game: QuantGameView }) {
  const s = settlementParts(game);
  if (!s) return null;
  return (
    <div
      className="flex flex-wrap items-end gap-x-6 gap-y-2 border-t border-border px-3 py-3"
      data-testid="game-settlement"
    >
      <div>
        <p className="text-2xs text-fg-subtle">Settled at</p>
        <p className="font-mono text-xl font-semibold tabular" data-testid="settlement-value">
          {num(s.value)}
        </p>
      </div>
      <div>
        <p className="text-2xs text-fg-subtle">Your P&amp;L</p>
        <p
          className={cn(
            'font-mono text-xl font-semibold tabular',
            s.pnl > 0 ? 'text-ok-text' : s.pnl < 0 ? 'text-bad-text' : 'text-fg',
          )}
          data-testid="settlement-pnl"
        >
          {signed(s.pnl)}
        </p>
      </div>
      <p className="basis-full text-xs text-fg-muted tabular">
        {s.working}. The report shows what each trade was worth when you made it.
      </p>
    </div>
  );
}

/**
 * The game of the question that closed last, settled: every component shown, the value and the
 * P&L. The next question is posed as the game closes, so this keeps the outcome in view.
 */
export function SettledGame({ index, game }: { index: number; game: QuantGameView }) {
  return (
    <section
      aria-labelledby="settled-game-heading"
      className="mx-5 mb-4 animate-pop-in overflow-hidden rounded-lg border border-border bg-surface max-lg:mx-4"
      data-testid="settled-game"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 border-b border-border bg-surface-2/60 px-3 py-2">
        <h3 id="settled-game-heading" className="text-sm font-semibold">
          {game.title} settled
        </h3>
        <span className="ml-auto text-2xs text-fg-subtle">Question {index + 1}</span>
      </header>
      <div className="px-3 pt-3 pb-1">
        <ComponentTiles components={game.components} label="Every value, shown" />
      </div>
      <Settlement game={game} />
    </section>
  );
}

/** The current question's game, in full. `canQuote` is false once the pad has ended. */
export function GamePanel({
  index,
  game,
  canQuote,
}: {
  index: number;
  game: QuantGameView;
  canQuote: boolean;
}) {
  const fresh = useFresh(game.components);
  const said = useAnnouncement(game);
  const settled = game.settlement !== null;
  return (
    <section
      aria-labelledby="game-heading"
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-[0_1px_2px_oklch(0_0_0/0.04)]"
      data-testid="game-panel"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border bg-surface-2/60 px-3 py-2">
        <h3 id="game-heading" className="text-sm font-semibold">
          {game.title}
        </h3>
        <span className="ml-auto text-2xs text-fg-subtle tabular">{rulesLine(game)}</span>
      </header>
      <div className="space-y-2 px-3 pt-3 pb-2.5">
        <ComponentTiles components={game.components} fresh={fresh} />
        <p className="text-xs text-fg-muted" data-testid="game-payoff">
          {payoffLine(game)}
        </p>
      </div>
      {settled ? (
        <Settlement game={game} />
      ) : (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <QuoteStatusLine game={game} />
          {canQuote && <QuoteForm index={index} game={game} />}
        </div>
      )}
      <div className="border-t border-border">
        <Books game={game} />
      </div>
      <div className="border-t border-border empty:hidden">
        <Blotter game={game} />
      </div>
      <p aria-live="polite" className="sr-only" data-testid="game-announcement">
        {said}
      </p>
    </section>
  );
}

/** An earlier question's game, read only: how it settled. */
export function GameSummary({ game }: { game: QuantGameView }) {
  const trades = game.log.filter((e) => e.kind === 'trade').length;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="game-summary">
      <ComponentTiles components={game.components} size="sm" />
      <p className="text-xs text-fg-muted tabular">
        {game.settlement ? (
          <>
            Settled at <span className="font-medium text-fg">{num(game.settlement.value)}</span> ·
            P&amp;L{' '}
            <span
              className={cn(
                'font-medium',
                game.settlement.pnl > 0
                  ? 'text-ok-text'
                  : game.settlement.pnl < 0
                    ? 'text-bad-text'
                    : 'text-fg',
              )}
            >
              {signed(game.settlement.pnl)}
            </span>{' '}
            · {trades === 1 ? '1 trade' : `${trades} trades`}
          </>
        ) : (
          `${positionLabel(game.position)} · ${trades === 1 ? '1 trade' : `${trades} trades`}`
        )}
      </p>
    </div>
  );
}

/** One line for the phone layout's strip above the chat: the market and the books. */
export function GameStripLine({ game }: { game: QuantGameView }) {
  const s = quoteStatus(game);
  const market =
    s.kind === 'working'
      ? `Live ${marketText(s.quote)} × ${s.quote.size}`
      : s.kind === 'traded'
        ? 'Traded: quote again'
        : s.kind === 'withdrawn'
          ? 'Withdrawn: quote again'
          : s.kind === 'settled'
            ? `Settled at ${num(s.settlement.value)}`
            : 'No market yet';
  return (
    <span className="mt-1 flex items-center gap-2 text-[13px]" data-testid="game-strip">
      {/* Phrasing content only: the strip is a button. */}
      <span className="flex shrink-0 gap-1" aria-hidden>
        {game.components.map((c, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: components are fixed for a game
            key={i}
            className={cn(
              'flex h-5 min-w-5 items-center justify-center rounded-[4px] border px-1 font-mono text-[11px] font-semibold tabular',
              c.value === null
                ? 'border-dashed border-border-strong text-fg-subtle'
                : 'border-border-strong bg-surface text-fg',
            )}
          >
            {c.value === null ? '?' : num(c.value)}
          </span>
        ))}
      </span>
      <span className="min-w-0 truncate">
        <span className={cn('font-medium', s.kind === 'working' ? 'text-accent-text' : 'text-fg')}>
          {market}
        </span>
        <span className="text-fg-muted">
          {' '}
          · {positionLabel(game.position)} · cash {signed(game.cash)}
        </span>
      </span>
    </span>
  );
}
