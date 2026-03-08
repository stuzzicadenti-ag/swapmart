import { randomBytes } from 'crypto';

export function generateSlug(title) {
  const base = title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  const suffix = randomBytes(5).toString('hex'); // 10-char random hex
  return `${base}-${suffix}`;
}
