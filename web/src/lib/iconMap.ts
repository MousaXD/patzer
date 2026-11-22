import type { ComponentType } from 'react';
import {
  Award,
  BookOpen,
  Compass,
  Crosshair,
  FileText,
  Flame,
  GraduationCap,
  Play,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';

export type DynamicIcon = ComponentType<{ className?: string }>;

// Explicit map for server-referenced icon names (achievements & study plan).
// Avoids `import * as Icons from 'lucide-react'`, which defeats tree-shaking
// and pulls the entire ~725 kB icon library into the browser bundle.
const ICON_MAP: Record<string, DynamicIcon> = {
  Award,
  BookOpen,
  Compass,
  Crosshair,
  FileText,
  Flame,
  GraduationCap,
  Play,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Zap,
};

export function resolveDynamicIcon(name: string, fallback: DynamicIcon = Award): DynamicIcon {
  return ICON_MAP[name] ?? fallback;
}
