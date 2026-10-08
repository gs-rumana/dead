// Party codes avoid look-alike letters (no I, L, O, 0, 1).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export function randomCode(length = 4): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function isValidCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z]{4}$/.test(code);
}
