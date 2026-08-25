// Marginalia for the book skin: the small figures a manuscript puts in its
// margins, which have nothing to do with the text and sit wherever there is
// room. Here they perch on the brackets — a tree gets its drolleries as it is
// built, one arriving with roughly every third connection.
//
// Three people and a goose, which is about the right proportion for a margin.
//
// Each is drawn in a 24×24 box standing on y=24, so BracketLayer places one by
// putting that baseline on the line it is to stand on. They are decoration and
// nothing else: the whole layer is inert, and no gesture ever reaches them.

/** How many figures there are to choose between. */
export const DROLLERY_COUNT = 4;

const CORAL = '#d98070';
const CORAL_DARK = '#ad5847';
const BLUE = '#6f93c6';
const BLUE_DARK = '#3f639a';
const GREEN = '#7fa356';
const GREEN_DARK = '#4d7132';
const GOLD = '#c9a227';
const GOLD_DARK = '#8a6a18';
const INK = '#3a2e1f';
const VELLUM = '#f3e7de';
const FEATHER = '#f4efe4';
const FEATHER_DARK = '#b09c7c';

export default function DrolleryDefs() {
  return (
    <>
      {/* 0 — a hooded drollery, blowing a horn */}
      <g id="datool-drollery-0" strokeLinejoin="round" strokeLinecap="round">
        <path d="M8,22 L8,24 M14,22 L14,24" stroke={CORAL_DARK} strokeWidth="1.2" />
        <path d="M5,23 C4.6,15.6 8,13 11,13 C14,13 17,15.6 16.6,23 Z" fill={CORAL} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M6,18.4 L16,18.4" stroke={GOLD} strokeWidth="1.3" />
        <path d="M6,8.6 C6,4.6 8.4,2.6 11,2.6 C13.6,2.6 16,4.6 16,8.6 C16,11.6 13.6,13.4 11,13.4 C8.4,13.4 6,11.6 6,8.6 Z" fill={BLUE} stroke={BLUE_DARK} strokeWidth="0.8" />
        <path d="M8.4,9.2 C9.6,11.6 12.4,11.6 13.6,9.2 C13.6,6.8 8.4,6.8 8.4,9.2 Z" fill={VELLUM} stroke={BLUE_DARK} strokeWidth="0.6" />
        <circle cx="10" cy="8.2" r="0.75" fill={INK} />
        <path d="M13.6,9.6 L17.4,7" stroke={CORAL_DARK} strokeWidth="1.5" />
        <path d="M16.6,8.8 L24,2.4 L23,9 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth="0.7" />
      </g>

      {/* 1 — a knight, with a sword he has no quarrel for */}
      <g id="datool-drollery-1" strokeLinejoin="round" strokeLinecap="round">
        <path d="M8.6,21 L8,24 M13.6,21 L14.2,24" stroke={CORAL_DARK} strokeWidth="1.3" />
        <path d="M17.4,10.6 L23.4,3.2" stroke="#c3cad2" strokeWidth="2" />
        <path d="M15.6,8.4 L19.6,11.6" stroke={GOLD} strokeWidth="1.6" />
        <path d="M5.6,22.6 C5.6,14.4 16.6,14.4 16.6,22.6 Z" fill={CORAL} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M6.4,18.6 L16,18.6" stroke={GOLD} strokeWidth="1.4" />
        <path d="M14.4,15.2 L17.8,11" stroke={CORAL_DARK} strokeWidth="1.6" />
        <circle cx="11.1" cy="7.6" r="4.1" fill={BLUE} stroke={BLUE_DARK} strokeWidth="0.9" />
        <path d="M7.4,7.4 L14.8,7.4" stroke={BLUE_DARK} strokeWidth="1.4" />
        <path d="M11.1,3.6 L11.1,11.6" stroke={BLUE_DARK} strokeWidth="1" />
        <path d="M1.6,11.4 L8.2,10.2 L8.2,17.4 C8.2,20.6 4.9,22.2 4.9,22.2 C4.9,22.2 1.6,20.6 1.6,17.4 Z" fill={BLUE} stroke={BLUE_DARK} strokeWidth="0.9" />
        <path d="M4.9,10.8 L4.9,21.2 M1.9,14.6 L7.9,13.5" stroke={GOLD} strokeWidth="1.1" />
      </g>

      {/* 2 — a monk, reading something else */}
      <g id="datool-drollery-2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M4.6,23 C4.6,13.2 17.4,13.2 17.4,23 Z" fill={GREEN} stroke={GREEN_DARK} strokeWidth="0.8" />
        <path d="M6,7.8 C6,3.8 8.4,1.8 11,1.8 C13.6,1.8 16,3.8 16,7.8 C16,10.4 14.8,12.6 13.2,13.6 L8.8,13.6 C7.2,12.6 6,10.4 6,7.8 Z" fill={GREEN} stroke={GREEN_DARK} strokeWidth="0.8" />
        <ellipse cx="11" cy="8.4" rx="2.9" ry="3.3" fill={VELLUM} stroke={GREEN_DARK} strokeWidth="0.6" />
        <circle cx="10" cy="7.8" r="0.7" fill={INK} />
        <circle cx="12.4" cy="7.8" r="0.7" fill={INK} />
        <path d="M6.4,15.6 L11,14.6 L11,20.6 L6.4,21.6 Z" fill={VELLUM} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M15.6,15.6 L11,14.6 L11,20.6 L15.6,21.6 Z" fill={VELLUM} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M7.6,17.2 L9.9,16.8 M7.6,19 L9.9,18.6 M12.1,16.8 L14.4,17.2 M12.1,18.6 L14.4,19" stroke={CORAL_DARK} strokeWidth="0.5" />
      </g>

      {/* 3 — a goose, entirely unbothered */}
      <g id="datool-drollery-3" strokeLinejoin="round" strokeLinecap="round">
        <path d="M9.4,20.6 L8.4,24 M13,20.6 L13.8,24" stroke="#e2a13a" strokeWidth="1.4" />
        <path d="M13.6,15.6 C16.9,12.6 16.2,7.8 15.3,5" stroke={FEATHER_DARK} strokeWidth="6.2" fill="none" />
        <path d="M13.6,15.6 C16.9,12.6 16.2,7.8 15.3,5" stroke={FEATHER} strokeWidth="4.8" fill="none" />
        <path d="M2.8,14 L0,11.2 L2.6,17.6 Z" fill={FEATHER} stroke={FEATHER_DARK} strokeWidth="0.8" />
        <ellipse cx="9.6" cy="16.6" rx="7.4" ry="5.3" fill={FEATHER} stroke={FEATHER_DARK} strokeWidth="0.9" />
        <path d="M5.4,15 C8,13 11.4,13.4 13.2,15.8 C11,17.8 7.4,17.6 5.4,15 Z" fill="#e8dfcd" stroke={FEATHER_DARK} strokeWidth="0.7" />
        <circle cx="15.6" cy="3.7" r="2.8" fill={FEATHER} stroke={FEATHER_DARK} strokeWidth="0.9" />
        <path d="M18.1,2.7 L23.4,4 L18.1,5.3 Z" fill="#e2a13a" stroke="#a9761d" strokeWidth="0.6" />
        <circle cx="16.4" cy="3" r="0.75" fill={INK} />
      </g>
    </>
  );
}
