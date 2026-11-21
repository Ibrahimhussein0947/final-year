import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Full-colour pictures for the kinds of work, so people who find icons easier than words can recognise them at a glance.
 * They are emoji, drawn in colour by the phone or computer itself, on a tile tinted with one colour per category.
 */
const PICTURES: Record<string, [emoji: string, hue: number]> = {
  construction: ['👷', 38], automotive: ['🚗', 215], agriculture: ['🌱', 130], hospitality: ['🍳', 20], ict: ['💻', 225],
  healthcare: ['🩺', 350], education: ['🎓', 260], business: ['💼', 30], manufacturing: ['🏭', 200], transport: ['🚚', 195],
  domestic: ['🏠', 25], sales: ['🛍️', 320], security: ['🛡️', 220], 'general-labor': ['🧰', 15], 'media-creative': ['🎬', 285],
  legal: ['⚖️', 240], engineering: ['📐', 205], 'beauty-care': ['💇', 330], 'social-services': ['🤝', 340], tourism: ['🧭', 175],
  'banking-finance': ['🏦', 160], 'real-estate': ['🏢', 45], telecom: ['📡', 210], 'mining-energy': ['⛏️', 50], aviation: ['✈️', 200],
  'import-export': ['🚢', 190], 'food-processing': ['🥫', 10], 'textile-leather': ['🧵', 300], 'arts-entertainment': ['🎨', 270],
  'sports-fitness': ['🏋️', 145], veterinary: ['🐄', 100], 'environment-natural': ['🌳', 140], 'water-waste': ['💧', 200],
  'research-science': ['🔬', 250], 'crafts-artisan': ['🏺', 28], 'repair-services': ['🔧', 215], 'childcare-eldercare': ['🧸', 335],
  'public-administration': ['🏛️', 230], 'procurement-supply': ['📦', 35], 'marketing-pr': ['📣', 345], 'language-interpretation': ['🗣️', 185],
  'delivery-courier': ['🛵', 5], 'human-resources': ['👥', 255], 'data-analytics': ['📊', 170],
  'printing-publishing': ['🖨️', 210], 'funeral-services': ['🕯️', 260], 'event-management': ['🎪', 330], 'interior-landscape': ['🪴', 120],
  'quality-assurance': ['✅', 150], 'compliance-audit': ['📋', 235], 'robotics-automation': ['🦾', 200], 'blockchain-digital': ['⛓️', 245],
  'gaming-interactive': ['🎮', 280], 'heritage-culture': ['🗿', 40], 'personal-assistance': ['🗂️', 55], 'occupational-safety': ['🦺', 30],
  'cybersecurity-services': ['🔐', 220], 'space-satellite': ['🛰️', 225], ecommerce: ['🛒', 315], 'digital-content': ['📱', 290],
};

export function CategoryIcon({ slug, fallback: Fallback, size = 'md', className }: { slug: string; fallback: LucideIcon; size?: 'md' | 'lg'; className?: string }) {
  const pic = PICTURES[slug];
  const box = size === 'lg' ? 'h-14 w-14 text-3xl' : 'h-12 w-12 text-2xl';
  if (!pic) return <span className={cn('flex shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent', box, className)}><Fallback className="h-6 w-6" aria-hidden /></span>;
  const [emoji, hue] = pic;
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-xl leading-none', box, className)}
      style={{ backgroundColor: `hsl(${hue} 75% 55% / 0.2)`, boxShadow: `inset 0 0 0 1px hsl(${hue} 75% 55% / 0.35)` }}
    >
      <span style={{ fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif' }}>{emoji}</span>
    </span>
  );
}
