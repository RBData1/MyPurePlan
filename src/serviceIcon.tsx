import { Wrench } from 'lucide-react';

const RULES: { test: RegExp; color: string }[] = [
  { test: /solar/i, color: '#ea580c' },
  { test: /gutter|rynna/i, color: '#0f766e' },
  { test: /pressure|jet\s*wash|power\s*wash/i, color: '#7c3aed' },
  { test: /window|glass|conservatory|okn/i, color: '#1d4ed8' },
  { test: /note|notat/i, color: '#ca8a04' },
  { test: /roof|fascia|soffit|dach/i, color: '#b45309' },
  { test: /clean|wash|mycie/i, color: '#db2777' },
];

export function serviceColor(name: string) {
  return RULES.find(rule => rule.test.test(name))?.color ?? '#0e7490';
}

export function ServiceMark({ name, size = 15, onColor = false }: { name: string; size?: number; onColor?: boolean }) {
  return <Wrench size={size} color={onColor ? '#fff' : serviceColor(name)} strokeWidth={2.6} aria-hidden />;
}
