// Marginalia for the book skin: the small creatures a manuscript puts in its
// margins, which have nothing to do with the text and sit wherever there is
// room. Here they perch on the brackets — a tree gets its drolleries as it is
// built, one arriving with roughly every third connection.
//
// Each is drawn in a 24×24 box standing on y=24, so BracketLayer places one by
// putting that baseline on the line it is to stand on. They are decoration and
// nothing else: the whole layer is inert, and no gesture ever reaches them.

/** How many creatures there are to choose between. */
export const DROLLERY_COUNT = 4;

const CORAL = '#d98070';
const CORAL_DARK = '#ad5847';
const BLUE = '#6f93c6';
const BLUE_DARK = '#3f639a';
const GREEN = '#7fa356';
const GREEN_DARK = '#4d7132';
const GOLD = '#c9a227';

/**
 * The creatures, as reusable symbols. Rendered once inside the overlay's
 * <defs>; BracketLayer draws them with <use>.
 */
export default function DrolleryDefs() {
  return (
    <>
      {/* 0 — a bird, perched and facing right */}
      <g id="datool-drollery-0" strokeLinejoin="round" strokeLinecap="round">
        <path d="M5,14 L0,10 L2,17 Z" fill={BLUE} stroke={BLUE_DARK} strokeWidth="0.7" />
        <path
          d="M6,19 C4,13 8,8 13,8 C18,8 21,12 20,17 C19,20 16,21.5 12,21.5 C9,21.5 7,21 6,19 Z"
          fill={CORAL}
          stroke={CORAL_DARK}
          strokeWidth="0.8"
        />
        <path d="M10,12 C13,11 17,13 18,16 C15,17.5 11,16 10,12 Z" fill={BLUE} stroke={BLUE_DARK} strokeWidth="0.7" />
        <circle cx="17" cy="7.5" r="3.4" fill={CORAL} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M20,6.4 L24,8 L20,9.4 Z" fill={GOLD} stroke={CORAL_DARK} strokeWidth="0.5" />
        <circle cx="17.8" cy="6.8" r="0.75" fill="#3a2e1f" />
        <path d="M11,21.5 L11,24 M15,21.5 L15,24" stroke={GOLD} strokeWidth="1.1" />
      </g>

      {/* 1 — a hare, sitting up */}
      <g id="datool-drollery-1" strokeLinejoin="round" strokeLinecap="round">
        <path d="M16.5,9 C15,4 16,0.5 18,0.5 C19.6,2.5 19.6,7 18.4,9.4 Z" fill={CORAL} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M13.5,9.6 C11.4,5 12,1.6 14,1.8 C15.6,3.6 16.2,7.6 15.4,10 Z" fill={CORAL} stroke={CORAL_DARK} strokeWidth="0.8" />
        <ellipse cx="11" cy="17" rx="7" ry="6.2" fill={CORAL} stroke={CORAL_DARK} strokeWidth="0.8" />
        <circle cx="4.5" cy="14.5" r="2.4" fill="#f3e7de" stroke={CORAL_DARK} strokeWidth="0.7" />
        <circle cx="16" cy="12.4" r="4.2" fill={CORAL} stroke={CORAL_DARK} strokeWidth="0.8" />
        <circle cx="17.6" cy="11.6" r="0.8" fill="#3a2e1f" />
        <path d="M19.6,13.4 L21.6,13.4" stroke={CORAL_DARK} strokeWidth="0.6" />
        <path d="M7,22.6 L14,22.6" stroke={CORAL_DARK} strokeWidth="1.1" />
      </g>

      {/* 2 — a snail, going nowhere */}
      <g id="datool-drollery-2" strokeLinejoin="round" strokeLinecap="round">
        <path
          d="M3,23 C2.6,19.6 4.6,18 8,18 L18,18 C20.4,18 21.6,20.4 21,23 Z"
          fill={GOLD}
          stroke={CORAL_DARK}
          strokeWidth="0.8"
        />
        <path d="M19,18 C21,15 22.6,13.4 23,10" stroke={CORAL_DARK} strokeWidth="0.9" fill="none" />
        <path d="M16.6,18 C17.4,15 17.6,13.4 17,10.6" stroke={CORAL_DARK} strokeWidth="0.9" fill="none" />
        <circle cx="23.2" cy="9.2" r="1.1" fill="#3a2e1f" />
        <circle cx="16.8" cy="9.8" r="1.1" fill="#3a2e1f" />
        <circle cx="11" cy="12" r="6.6" fill={GREEN} stroke={GREEN_DARK} strokeWidth="0.9" />
        <path
          d="M16,13.6 A5,5 0 1,1 7.4,9.4 A3.2,3.2 0 1,0 13.4,12.6 A1.6,1.6 0 1,1 10.6,12"
          fill="none"
          stroke={GREEN_DARK}
          strokeWidth="0.9"
        />
      </g>

      {/* 3 — a hooded drollery, blowing a horn */}
      <g id="datool-drollery-3" strokeLinejoin="round" strokeLinecap="round">
        <path d="M5,23 C4.6,15.6 8,13 11,13 C14,13 17,15.6 16.6,23 Z" fill={CORAL} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M6,8.6 C6,4.6 8.4,2.6 11,2.6 C13.6,2.6 16,4.6 16,8.6 C16,11.6 13.6,13.4 11,13.4 C8.4,13.4 6,11.6 6,8.6 Z" fill={BLUE} stroke={BLUE_DARK} strokeWidth="0.8" />
        <path d="M8.4,9.4 C9.6,11.6 12.4,11.6 13.6,9.4 C13.6,7 8.4,7 8.4,9.4 Z" fill="#f3e7de" stroke={BLUE_DARK} strokeWidth="0.6" />
        <circle cx="10" cy="8.2" r="0.75" fill="#3a2e1f" />
        <path d="M13.6,9 L18,6.6" stroke={CORAL_DARK} strokeWidth="1.4" fill="none" />
        <path d="M17,8.4 L24,2.6 L23,8.6 Z" fill={GOLD} stroke={CORAL_DARK} strokeWidth="0.7" />
        <path d="M8,23 L8,24 M14,23 L14,24" stroke={CORAL_DARK} strokeWidth="1.1" />
      </g>
    </>
  );
}
