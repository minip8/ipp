'use client';
import { QUANT_PATH_INFO, type QuantPath } from '@ipp/contracts';
import { Segmented } from '@/components/ui/segmented';
import { PATHS } from './logic';

/**
 * The Trader | Researcher choice, kept in `?path=`: the same control on the Quant track's
 * Interviews tab and on its Roadmap's study path.
 */
export function QuantPathPicker({
  value,
  onValueChange,
}: {
  value: QuantPath;
  onValueChange: (p: QuantPath) => void;
}) {
  return (
    <Segmented
      aria-label="Path"
      className="max-sm:flex max-sm:w-full max-sm:[&>*]:h-9"
      value={value}
      onValueChange={onValueChange}
      options={PATHS.map((p) => ({ value: p, label: QUANT_PATH_INFO[p].label }))}
    />
  );
}
