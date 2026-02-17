import { visibleWidth } from '@mariozechner/pi-tui';

const BORDER_LEAD = 2;
const BORDER_TRAIL = 2;

/** Build a border line with optional left/right labels surrounded by ─ fill. */
export const buildBorderLine = (
  left: string,
  right: string,
  width: number,
  bc: (s: string) => string
): string => {
  const lead = bc('─'.repeat(BORDER_LEAD));
  const trail = bc('─'.repeat(BORDER_TRAIL));
  const usedWidth =
    BORDER_LEAD + visibleWidth(left) + visibleWidth(right) + BORDER_TRAIL;
  const fill = Math.max(0, width - usedWidth);
  return lead + left + bc('─'.repeat(fill)) + right + trail;
};
