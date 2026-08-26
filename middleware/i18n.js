const en = require('../locales/en.json');
const fr = require('../locales/fr.json');
const ar = require('../locales/ar.json');

const LOCALES = { en, fr, ar };
const SUPPORTED = ['en', 'fr', 'ar'];
const RTL_LOCALES = ['ar'];

// Picks the best supported language from a browser's Accept-Language header,
// e.g. "fr-FR,fr;q=0.9,en;q=0.8" -> "fr".
function detectFromHeader(header) {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim().split(';')[0].toLowerCase());
  for (const tag of parts) {
    const short = tag.split('-')[0];
    if (SUPPORTED.includes(short)) return short;
  }
  return null;
}

function i18n(req, res, next) {
  let lang = req.cookies && req.cookies.lang;
  if (!lang || !SUPPORTED.includes(lang)) {
    // Default to Arabic when there's no saved preference and the visitor's
    // browser language isn't one we support (English/French/Arabic).
    lang = detectFromHeader(req.headers['accept-language']) || 'ar';
  }
  const dict = LOCALES[lang] || LOCALES.en;

  req.lang = lang;
  res.locals.lang = lang;
  res.locals.dir = RTL_LOCALES.includes(lang) ? 'rtl' : 'ltr';
  res.locals.supportedLocales = SUPPORTED;
  res.locals.t = (key) => (dict[key] !== undefined ? dict[key] : LOCALES.en[key] || key);
  next();
}

module.exports = { i18n, SUPPORTED };
