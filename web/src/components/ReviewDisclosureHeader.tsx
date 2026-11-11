import { ChevronDown, type LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  label: string;
  expanded: boolean;
  controlsId: string;
  title: string;
  onToggle: () => void;
}

/** Shared, full-width disclosure control for the optional Game Review tools.
 *  The underlying engine/remote requests remain owned by each panel. */
export default function ReviewDisclosureHeader({ icon: Icon, label, expanded, controlsId, title, onToggle }: Props) {
  return (
    <button type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controlsId}
      title={title}
      className={`flex min-h-11 w-full items-center gap-2 bg-chesscom-50/40 px-3 py-2 text-left transition-colors hover:bg-chesscom-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold-500 dark:bg-chesscom-900/40 dark:hover:bg-chesscom-700/50 ${expanded ? 'border-b border-chesscom-100 dark:border-chesscom-700' : ''}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-chesscom-500 dark:text-chesscom-300" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wider text-chesscom-500 dark:text-chesscom-300">
        {label}
      </span>
      <ChevronDown className={`h-4 w-4 shrink-0 text-chesscom-500 transition-transform motion-reduce:transition-none dark:text-chesscom-300 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
  );
}
