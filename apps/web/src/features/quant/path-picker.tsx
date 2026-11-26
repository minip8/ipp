'use client';
import { QUANT_PATH_INFO, type QuantPath } from '@ipp/contracts';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { PATHS } from './logic';

/**
 * The Trader | Researcher choice, kept in `?path=`: the same control on the Quant track's
 * Interviews tab (filling its setup panel, as the panel's other choices do) and on its Roadmap's
 * study path.
 */
export function QuantPathPicker({
  value,
  onValueChange,
  className,
}: {
  value: QuantPath;
  onValueChange: (p: QuantPath) => void;
  className?: string;
}) {
  return (
    <Segmented
      aria-label="Path"
      className={cn('max-sm:flex max-sm:w-full max-sm:[&>*]:h-9', className)}
      value={value}
      onValueChange={onValueChange}
      options={PATHS.map((p) => ({ value: p, label: QUANT_PATH_INFO[p].label }))}
    />
  );
}
