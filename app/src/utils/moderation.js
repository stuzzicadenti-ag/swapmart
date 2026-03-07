/**
 * Content moderation utility for SwapMart.
 * Scans text for phone numbers, profanity, emails, and URLs.
 */

// Swiss and international phone patterns
const PHONE_PATTERNS = [
  /\+41\s*\d[\d\s\-().]{6,}/g,                    // Swiss +41
  /0\d{2}[\s\-.]?\d{3}[\s\-.]?\d{2}[\s\-.]?\d{2}/g, // Swiss 0xx xxx xx xx
  /\+\d{1,3}[\s\-.]?\d[\d\s\-().]{6,}/g,          // International +xx
  /\b0\d{9,10}\b/g,                                 // Generic 0xxxxxxxxx
  /\b\d{3}[\s\-.]?\d{3}[\s\-.]?\d{4}\b/g,         // US-style xxx-xxx-xxxx
  /\b\d{4}[\s\-.]?\d{3}[\s\-.]?\d{3}\b/g,         // Various intl formats
];

// Email pattern
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// URL pattern
const URL_PATTERN = /(?:https?:\/\/|www\.)[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;

// Profanity word list (IT/EN/DE, 30+ words)
const PROFANITY_LIST = [
  // English
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'crap', 'dick', 'bastard',
  'piss', 'slut', 'whore', 'cunt', 'cock', 'wanker', 'twat', 'bollocks',
  // Italian
  'cazzo', 'minchia', 'stronzo', 'stronza', 'merda', 'vaffanculo', 'puttana',
  'troia', 'coglione', 'porco', 'madonna', 'figa', 'culo',
  // German
  'scheisse', 'scheiße', 'arschloch', 'fotze', 'hurensohn', 'wichser',
  'fick', 'ficken', 'miststück', 'drecksau', 'schwanzlutscher',
];

// Build regex for whole-word matching (case-insensitive)
const PROFANITY_PATTERN = new RegExp(
  '\\b(' + PROFANITY_LIST.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'gi'
);

/**
 * Scans text content for policy violations.
 * @param {string} text - The text to scan
 * @returns {{ clean: boolean, flags: Array<{type: string, detail: string}> }}
 */
export function scanContent(text) {
  if (!text || typeof text !== 'string') {
    return { clean: true, flags: [] };
  }

  const flags = [];

  // Check for phone numbers
  for (const pattern of PHONE_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        // Filter out short numbers that are likely prices or IDs
        const digitsOnly = match.replace(/\D/g, '');
        if (digitsOnly.length >= 8) {
          flags.push({ type: 'auto_phone', detail: `Phone number detected: ${match.trim()}` });
        }
      }
    }
  }

  // Check for profanity
  PROFANITY_PATTERN.lastIndex = 0;
  const profanityMatches = text.match(PROFANITY_PATTERN);
  if (profanityMatches) {
    const unique = [...new Set(profanityMatches.map(m => m.toLowerCase()))];
    for (const word of unique) {
      flags.push({ type: 'auto_profanity', detail: `Profanity detected: ${word}` });
    }
  }

  // Check for email addresses
  EMAIL_PATTERN.lastIndex = 0;
  const emailMatches = text.match(EMAIL_PATTERN);
  if (emailMatches) {
    for (const match of emailMatches) {
      flags.push({ type: 'auto_email', detail: `Email address detected: ${match}` });
    }
  }

  // Check for URLs
  URL_PATTERN.lastIndex = 0;
  const urlMatches = text.match(URL_PATTERN);
  if (urlMatches) {
    for (const match of urlMatches) {
      flags.push({ type: 'auto_url', detail: `URL detected: ${match}` });
    }
  }

  return {
    clean: flags.length === 0,
    flags,
  };
}
