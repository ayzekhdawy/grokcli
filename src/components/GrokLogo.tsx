import { IconGrokMark } from "@/components/icons";

/**
 * App brand mark — Grok glyph with fill=currentColor.
 * Inherits text color from parent so dark/light themes invert automatically.
 */
export function GrokLogo({ size = 22 }: { size?: number }) {
  return <IconGrokMark size={size} className="grok-logo" title="Grok" />;
}
