import type { LucideIcon } from 'lucide-react';
import { AppWindow, Droplets, Home, Sparkles, SprayCan, StickyNote, SunMedium, Waves } from 'lucide-react';

const RULES: { test: RegExp; icon: LucideIcon }[] = [
  { test: /solar/i, icon: SunMedium },
  { test: /gutter|rynna/i, icon: Waves },
  { test: /pressure|jet\s*wash|power\s*wash/i, icon: SprayCan },
  { test: /window|glass|conservatory|okn/i, icon: AppWindow },
  { test: /note|notat/i, icon: StickyNote },
  { test: /roof|fascia|soffit|dach/i, icon: Home },
  { test: /clean|wash|mycie/i, icon: Sparkles },
];

export function serviceIcon(name: string): LucideIcon {
  return RULES.find(rule => rule.test.test(name))?.icon ?? Droplets;
}

export function ServiceMark({ name, size = 15 }: { name: string; size?: number }) {
  const Icon = serviceIcon(name);
  return <Icon size={size} aria-hidden />;
}
