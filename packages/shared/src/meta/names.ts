/**
 * Usernames (§4.12): generated for every guest, changeable, run through a
 * profanity filter. Shared so the client can check before asking the server.
 */

const ADJECTIVES = [
  'Dusty', 'Rusty', 'Lonesome', 'Quiet', 'Rowdy', 'Lucky', 'Grim', 'Bold', 'Weary', 'Swift',
  'Silver', 'Copper', 'Iron', 'Crimson', 'Pale', 'Sly', 'Steady', 'Wild', 'Old', 'Young',
  'Midnight', 'Cinder', 'Prairie', 'Canyon', 'Pine', 'Thunder', 'Gritty', 'Salty', 'Hollow', 'Brave',
];
const NOUNS = [
  'Coyote', 'Drifter', 'Stoker', 'Ranger', 'Mule', 'Rattler', 'Hawk', 'Buzzard', 'Bandit', 'Sheriff',
  'Brakeman', 'Prospector', 'Wrangler', 'Outrider', 'Preacher', 'Gunhand', 'Engineer', 'Tumbleweed',
  'Bison', 'Badger', 'Raven', 'Lantern', 'Spur', 'Boxcar', 'Fireman', 'Scout', 'Marshal', 'Cowpoke',
];

/** A fresh name like "DustyCoyote42" (random; not for the sim). */
export function generateUsername(rand: () => number = Math.random): string {
  const a = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)]!;
  const n = NOUNS[Math.floor(rand() * NOUNS.length)]!;
  return `${a}${n}${10 + Math.floor(rand() * 90)}`;
}

// Blocked word roots, base64 so the source stays readable.
const BLOCKED = atobList(
  'ZnVjaw==,c2hpdA==,Y3VudA==,Yml0Y2g=,bmlnZw==,bmlnZ2E=,ZmFnZw==,bmF6aQ==,aGl0bGVy,cG9ybg==,cHVzc3k=,d2hvcmU=,c2x1dA==,cmV0YXJk,a2lrZQ==,Y2hpbms=,dHdhdA==,cGVuaXM=,dmFnaW5h,YXNzaG9sZQ==,dHJhbm55,ZHlrZQ==,a2lsbHlvdXJzZWxm,bW9sZXN0,Ym9sbG9jaw==,Ymxvd2pvYg==',
);

// Browsers and Node 16+ both have a global atob.
declare const atob: (s: string) => string;

function atobList(s: string): string[] {
  return s.split(',').map((w) => atob(w));
}

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/** Lower case, look-alike characters mapped to letters, everything else dropped. */
export function foldName(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    const c = LEET[ch] ?? ch;
    if (/[a-z]/.test(c)) out += c;
  }
  return out;
}

// Each letter may repeat ("fuuuck"), but doubled letters in a root must stay doubled,
// so short roots don't catch ordinary words.
const PATTERNS = BLOCKED.map((w) => new RegExp(w.split('').map((c) => `${c}+`).join('')));

export function isProfane(s: string): boolean {
  const f = foldName(s);
  return PATTERNS.some((re) => re.test(f));
}

/** Checks a requested username. Returns an error message, or '' if it's fine. */
export function usernameError(name: string): string {
  if (typeof name !== 'string') return 'Pick a name';
  if (name.length < 3) return 'At least 3 characters';
  if (name.length > 16) return 'At most 16 characters';
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Letters, digits and _ only';
  if (isProfane(name)) return 'Pick another name';
  return '';
}
