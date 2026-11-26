'use client';
/**
 * A market-making game in the quant report (`QuantQuestionReview.game`, built by the engine after
 * the pad ended): the only place the fair value appears. Laid out as the four things it teaches:
 * the P&L split into the expected edge (the decisions) and the realised P&L (the decisions plus
 * the dice and an informed counterparty), the risk taken, the quality of each market, and how
 * the market moved on each component shown.
 */
import type { QuantGameReview } from '@ipp/contracts';
import { ArrowDownLeftIcon, ArrowUpRightIcon, CheckIcon, MinusIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toneText } from '@/components/domain';
import { Badge } from '@/components/ui/badge';
import {
  lots,
  marketText,
  num,
  positionLabel,
  signed,
  tradeText,
} from '@/features/quant-game/logic';
import { ComponentTiles } from '@/features/quant-game/tiles';
import { cn } from '@/lib/utils';
import type { Tone } from '@/lib/verdict';
import {
  FAIR_SIDE_LABEL,
  pnlParts,
  quoteRows,
  quoteSummary,
  REVEAL_TONE,
  revealRows,
  signTone,
} from './quant-logic';

const BADGE_TONE: Record<Tone, 'ok' | 'bad' | 'warn' | 'neutral'> = {
  ok: 'ok',
  bad: 'bad',
  warn: 'warn',
  neutral: 'neutral',
};

function Block({
  title,
  children,
  note,
}: {
  title: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">{title}</h4>
        {note && <p className="text-xs text-fg-muted tabular">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Figure({
  label,
  value,
  caption,
  testId,
  strong,
  neutral,
}: {
  label: string;
  value: number;
  caption: string;
  testId: string;
  strong?: boolean;
  /** Not the candidate's doing: shown without a good or bad colour. */
  neutral?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2.5',
        strong ? 'border-border-strong bg-surface' : 'border-border bg-surface-2/50',
      )}
      data-testid={testId}
    >
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p
        className={cn(
          'font-mono text-xl font-semibold tabular',
          neutral ? 'text-fg' : toneText[signTone(value)],
        )}
        data-testid={`${testId}-value`}
      >
        {signed(value)}
      </p>
      <p className="mt-0.5 text-xs leading-snug text-fg-muted">{caption}</p>
    </div>
  );
}

const th = 'px-2 py-1.5 text-left text-2xs font-medium text-fg-subtle first:pl-0 last:pr-0';
const td = 'px-2 py-1.5 align-top tabular first:pl-0 last:pr-0';

function Quotes({ game }: { game: QuantGameReview }) {
  const rows = quoteRows(game);
  const sum = quoteSummary(game);
  if (!sum)
    return (
      <Block title="Your markets">
        <p className="text-sm text-fg-muted">No market was posted.</p>
      </Block>
    );
  return (
    <Block
      title="Your markets"
      note={`${sum.inside} of ${sum.count} around fair value · ${sum.traded} traded · mean width ${num(Number(sum.meanWidth.toFixed(2)))}${sum.meanWidthSd !== null ? ` (${num(Number(sum.meanWidthSd.toFixed(2)))} sd)` : ''}`}
    >
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full text-sm" data-testid="review-quotes">
          <thead className="border-b border-border">
            <tr>
              <th className={th} scope="col">
                Market
              </th>
              <th className={th} scope="col">
                Width
              </th>
              <th className={th} scope="col">
                Fair then
              </th>
              <th className={cn(th, 'text-right')} scope="col">
                Traded
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.n} data-testid="review-quote" data-side={r.side}>
                <td className={td}>
                  <span className="font-medium whitespace-nowrap">{marketText(r)}</span>
                  <span className="block text-xs text-fg-subtle">{lots(r.size)}</span>
                </td>
                <td className={td}>
                  {num(r.width)}
                  {r.widthSd !== null && (
                    <span className="block text-xs whitespace-nowrap text-fg-subtle">
                      {num(Number(r.widthSd.toFixed(2)))} sd
                    </span>
                  )}
                </td>
                <td className={td}>
                  {num(r.fair)}
                  <span
                    className={cn(
                      'block text-xs',
                      r.side === 'inside' ? 'text-ok-text' : 'text-bad-text',
                    )}
                  >
                    {FAIR_SIDE_LABEL[r.side]}
                  </span>
                </td>
                <td className={cn(td, 'text-right')}>
                  {r.traded ? (
                    <CheckIcon className="ml-auto size-4 text-fg" aria-label="Traded" />
                  ) : (
                    <MinusIcon className="ml-auto size-4 text-fg-subtle" aria-label="Not traded" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

function Reveals({ game }: { game: QuantGameReview }) {
  const rows = revealRows(game);
  if (rows.length === 0) return null;
  return (
    <Block title="Updating on what was shown">
      <ol className="space-y-2" data-testid="review-reveals">
        {rows.map((r) => (
          <li
            key={r.at}
            className="rounded-md border border-border px-3 py-2"
            data-testid="review-reveal"
            data-verdict={r.verdict}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium">
                {r.label} showed {num(r.value)}
              </span>
              <Badge tone={BADGE_TONE[REVEAL_TONE[r.verdict]]} className="ml-auto">
                {r.verdictLabel}
              </Badge>
            </div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs tabular">
              <dt className="text-fg-subtle">Fair value</dt>
              <dd>
                {num(r.fairBefore)} → {num(r.fairAfter)}{' '}
                <span className="text-fg-muted">({signed(r.fairMove)})</span>
              </dd>
              <dt className="text-fg-subtle">Your mid</dt>
              <dd>
                {r.midBefore === null ? '—' : num(r.midBefore)} →{' '}
                {r.midAfter === null ? '—' : num(r.midAfter)}
                {r.midMove !== null && (
                  <span className="text-fg-muted"> ({signed(r.midMove)})</span>
                )}
              </dd>
            </dl>
          </li>
        ))}
      </ol>
    </Block>
  );
}

function Trades({ game }: { game: QuantGameReview }) {
  if (game.trades.length === 0)
    return (
      <Block title="Trades">
        <p className="text-sm text-fg-muted">The interviewer did not trade.</p>
      </Block>
    );
  return (
    <Block title="Trades" note="Edge: against the fair value when the trade was made">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full text-sm" data-testid="review-trades">
          <thead className="border-b border-border">
            <tr>
              <th className={th} scope="col">
                Trade
              </th>
              <th className={th} scope="col">
                Fair then
              </th>
              <th className={cn(th, 'text-right')} scope="col">
                Edge
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {game.trades.map((t) => (
              <tr key={t.at} data-testid="review-trade">
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    {t.candidateSide === 'buy' ? (
                      <ArrowDownLeftIcon className="size-3.5 text-ok-text" aria-hidden />
                    ) : (
                      <ArrowUpRightIcon className="size-3.5 text-bad-text" aria-hidden />
                    )}
                    {tradeText(t)}
                  </span>
                </td>
                <td className={td}>{num(t.fair)}</td>
                <td className={cn(td, 'text-right')}>
                  <span className={cn('font-medium', toneText[signTone(t.edge)])}>
                    {signed(t.edge)}
                  </span>
                  {t.quantity > 1 && (
                    <span className="block text-xs text-fg-subtle">
                      {signed(t.edgePerContract)} each
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

export function GameReview({ game }: { game: QuantGameReview }) {
  const p = pnlParts(game);
  return (
    <section
      aria-label={`The game: ${game.title}`}
      className="space-y-5 rounded-md border border-border px-4 py-4"
      data-testid="game-review"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <ComponentTiles components={game.components} label="What was hidden" />
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="text-2xs text-fg-subtle">Settled at</dt>
            <dd className="font-mono text-lg font-semibold tabular" data-testid="review-value">
              {num(game.value)}
            </dd>
          </div>
          <div>
            <dt className="text-2xs text-fg-subtle">Fair value at the start</dt>
            <dd className="font-mono text-lg font-semibold tabular">
              {num(game.stats.fair)}
              <span className="ml-1.5 font-sans text-xs font-normal text-fg-muted">
                sd {num(Number(game.stats.sd.toFixed(2)))}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      <Block title="P&L">
        <div className="grid gap-2 sm:grid-cols-3">
          <Figure
            label="Expected edge"
            value={p.expectedEdge}
            caption="Each trade against the fair value when you made it: what your decisions were worth."
            testId="review-edge"
            strong
          />
          <Figure
            label="Realised P&L"
            value={p.pnl}
            caption={`At the true value, ${num(game.value)}: your decisions plus the dice and a counterparty who may know more.`}
            testId="review-pnl"
          />
          <Figure
            label="Luck and information"
            value={p.luck}
            caption="The difference: what the hidden values and an informed counterparty added or took."
            testId="review-luck"
            neutral
          />
        </div>
      </Block>

      <Block title="Risk">
        <p className="text-sm text-fg-muted" data-testid="review-risk">
          Ended{' '}
          <span className="font-medium text-fg">
            {positionLabel(game.finalPosition).toLowerCase()}
          </span>
          {' · '}largest position{' '}
          <span className="font-medium text-fg">{lots(game.maxAbsPosition)}</span>
          {' · '}quotes of up to {lots(game.maxSize)}
        </p>
      </Block>

      <div className="grid gap-5 lg:grid-cols-2">
        <Quotes game={game} />
        <div className="space-y-5">
          <Reveals game={game} />
          <Trades game={game} />
        </div>
      </div>
    </section>
  );
}
