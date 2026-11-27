'use client';
import { QUANT_PATH_INFO, type QuantPath } from '@ipp/contracts';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { PATHS } from './logic';

/**
 * The Trader | Researcher choice of the Quant track's Roadmap study path, kept in `?path=`.
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
