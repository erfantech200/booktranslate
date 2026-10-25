// "The Lantern Keeper": a short invented text written for Bookbridge's tests. It is not from
// any real book. Pages 41–50: a paragraph split across 41→42, a footnote on 42, a two-page
// spread (43/44), a chapter opener (45), and pages for the PDF fixtures.

export interface FixtureBlock {
  type: 'heading' | 'paragraph' | 'footnote';
  text: string;
  marker?: string;
  noIndent?: boolean;
  /** Rendered after the text (e.g. a hyphenated word fragment at the page bottom). */
  hyphenTail?: string;
  startsMid?: boolean;
  endsMid?: boolean;
}

export interface FixturePage {
  number: number;
  runningHeader?: string;
  blocks: FixtureBlock[];
}

export const FIXTURE_PAGES: FixturePage[] = [
  {
    number: 41, runningHeader: 'THE LANTERN KEEPER',
    blocks: [
      { type: 'paragraph', text: 'The keeper’s house stood at the end of the causeway, where the road gave up and the sea began. Ilse Varga had lived there for eleven winters, long enough to know every sound the building made when the wind came from the north.' },
      { type: 'paragraph', text: 'On the night the letter arrived, the lamp had been burning since four in the afternoon, and the clouds above Harrowgate Light were moving faster than', endsMid: true },
    ],
  },
  {
    number: 42, runningHeader: 'THE LANTERN KEEPER',
    blocks: [
      { type: 'paragraph', text: 'any boat could hope to. She read the letter twice by the window.[^1] The handwriting was her brother’s, though he had not written to her in nine years.', noIndent: true, startsMid: true },
      { type: 'paragraph', text: '“Come before the ice,” it said. Nothing else.' },
      { type: 'footnote', marker: '1', text: 'The window faced east, toward the old harbour.' },
    ],
  },
  {
    number: 43, runningHeader: 'THE LANTERN KEEPER',
    blocks: [
      { type: 'paragraph', text: 'She packed one bag. The keys to the lamp room went into her coat pocket, where they would knock against her hip all the way to the mainland.' },
    ],
  },
  {
    number: 44, runningHeader: 'THE LANTERN KEEPER',
    blocks: [
      { type: 'paragraph', text: 'At the ferry office a clerk with ink on his fingers sold her a ticket for the morning crossing and told her, without being asked, that the weather would hold.' },
    ],
  },
  {
    number: 45,
    blocks: [
      { type: 'heading', text: 'Chapter Four: The Crossing' },
      { type: 'paragraph', text: 'The ferry left at seven. Ilse stood at the rail and watched Harrowgate Light grow small behind her until it was only a white mark on the grey line of the coast.', noIndent: true },
    ],
  },
  {
    number: 46, runningHeader: 'THE LANTERN KEEPER',
    blocks: [
      { type: 'paragraph', text: 'By noon the wind had turned, and the captain came down from the bridge to say that they would put in at Selby instead.' },
    ],
  },
  {
    number: 47, runningHeader: 'THE LANTERN KEEPER',
    blocks: [
      { type: 'paragraph', text: 'Selby was a town of slate roofs and shut doors. Ilse found a room above a bakery and slept with the window open, the way she always had.' },
    ],
  },
  {
    number: 48, runningHeader: 'THE LANTERN KEEPER',
    blocks: [
      { type: 'paragraph', text: 'In the morning the baker’s daughter brought up bread and a newspaper three days old, and asked whether it was true that she kept a lighthouse.' },
    ],
  },
  {
    number: 49, runningHeader: 'THE LANTERN KEEPER',
    blocks: [
      { type: 'paragraph', text: '“Not a lighthouse,” Ilse said. “A light. There is a difference, though nobody believes me when I explain it.”' },
    ],
  },
  {
    number: 50, runningHeader: 'THE LANTERN KEEPER',
    blocks: [
      { type: 'paragraph', text: 'The girl considered this seriously, then asked what the difference was, and Ilse found that for once she did not mind explaining.' },
    ],
  },
];

export const FIXTURE_GLOSSARY = [
  { source_term: 'Ilse Varga', target_term: 'ایلزه وارگا', kind: 'character' as const, notes: 'woman, the keeper' },
  { source_term: 'Ilse', target_term: 'ایلزه', kind: 'character' as const, notes: null },
  { source_term: 'Harrowgate Light', target_term: 'چراغ هرو‌گیت', kind: 'place' as const, notes: null },
  { source_term: 'Selby', target_term: 'سلبی', kind: 'place' as const, notes: null },
];
