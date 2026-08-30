"use strict";

const tldts = require("tldts");
const { domainToUnicode } = require("node:url");

const SUSPICIOUS_TLDS = new Set([
  "xyz",
  "top",
  "support",
  "click",
  "online",
  "site",
  "club",
  "info",
  "live",
  "fun",
  "pw",
  // TLD a forte concentration de phishing observes en 2025-2026
  // (campagnes allegro/*.sbs, *.lol, kits low-cost) :
  "sbs",
  "lol",
  "cfd",
  "icu",
  "rest",
  "bond",
  "shop",
  "cyou",
]);
const SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "cutt.ly",
  "is.gd",
  "ow.ly",
  "buff.ly",
  "rebrand.ly",
]);
const RDAP_TIMEOUT_MS = 4_000;

// Marques Web3 les plus usurpees, associees a leurs domaines officiels
// (domaine enregistrable). Liste fermee et deterministe : le signal
// brand-proximity vaut 1 quand un hostname NON officiel contient le nom de
// la marque ou un token a distance d'edition <= 2 (typosquat), et 0 pour le
// domaine officiel lui-meme. Aucun nom < 6 caracteres pour limiter les
// collisions accidentelles. Ce signal ne publie jamais seul : le verdict LLM
// `malicious` reste obligatoire avant toute ecriture on-chain.
const BRANDS = new Map([
  ["metamask", ["metamask.io"]],
  ["pancakeswap", ["pancakeswap.finance"]],
  ["uniswap", ["uniswap.org"]],
  ["opensea", ["opensea.io"]],
  ["coinbase", ["coinbase.com"]],
  ["binance", ["binance.com"]],
  ["kraken", ["kraken.com"]],
  ["ledger", ["ledger.com"]],
  ["trezor", ["trezor.io"]],
  ["trustwallet", ["trustwallet.com"]],
  ["phantom", ["phantom.app", "phantom.com"]],
  ["exodus", ["exodus.com", "exodus.io"]],
  ["sushiswap", ["sushi.com", "sushiswap.com"]],
  ["aave", []],
  ["lido", []],
  ["polygon", ["polygon.technology"]],
  ["arbitrum", ["arbitrum.io", "arbitrum.foundation"]],
  ["solana", ["solana.com"]],
  ["chainlink", ["chain.link", "chainlinklabs.com"]],
  ["etherscan", ["etherscan.io"]],
  ["blockchain", ["blockchain.com"]],
  ["robinhood", ["robinhood.com"]],
]);
const OFFICIAL_BRAND_DOMAINS = new Set(
  [...BRANDS.values()].flat().concat(["aave.com", "lido.fi"]),
);
// Les marques trop courtes ne participent qu'au test de sous-chaine exact,
// jamais a la distance d'edition (trop de faux positifs).
const MIN_BRAND_LENGTH_FOR_DISTANCE = 6;

// Caracteres confusables (homoglyphes) documentes, cibles sur les lettres
// latines les plus imitees en typosquatting Web3 (ex. binance -> Ьinance,
// coinbase -> coinЬase). Volontairement non exhaustif : couvre les lettres
// cyrilliques et grecques visuellement quasi identiques a a/c/e/i/o/p/s/x/y
// en minuscule. Une detection Unicode confusables complete suivrait UTS #39
// (Unicode Security Mechanisms) ; ce n'est pas ce dont ce signal a besoin.
const CONFUSABLE_CHARS = new Set([
  "а",
  "е",
  "о",
  "р",
  "с",
  "х",
  "у",
  "і",
  "ѕ",
  "ј", // cyrillique
  "α",
  "ο",
  "ρ",
  "χ",
  "υ", // grec
]);

/**
 * tldts.parse une seule fois, avec les options adaptees a la detection de
 * phishing plutot qu'a un usage generique :
 * - allowPrivateDomains: true - un hebergement generique comme
 *   *.vercel.app, *.pages.dev ou *.github.io est traite comme son propre
 *   domaine enregistrable (ex. "phishing-site.vercel.app"), pas reduit a
 *   "vercel.app" : n'importe qui obtient un sous-domaine gratuit sur ces
 *   plateformes, la partie qui compte pour la reputation est celle
 *   effectivement controlee par l'attaquant.
 * - detectIp: true - un hote IP-litteral (v4 ou v6) est identifie comme
 *   tel plutot que d'etre decoupe en labels comme s'il s'agissait d'un
 *   nom de domaine.
 */
function parseHostname(hostname) {
  return tldts.parse(hostname, { allowPrivateDomains: true, detectIp: true });
}

function registeredDomain(hostname) {
  const parsed = parseHostname(hostname);
  if (parsed.isIp) return parsed.hostname;
  return parsed.domain || parsed.hostname;
}

function scoreAge(ageDays) {
  if (!Number.isFinite(ageDays)) return 0.5;
  if (ageDays <= 7) return 1;
  if (ageDays >= 365) return 0;
  return 1 - (ageDays - 7) / 358;
}

// Distance de Levenshtein classique, bornee : on s'arrete des que la
// distance minimale possible depasse `max` (2 ici), ce qui suffit pour un
// test de typosquat et reste O(n*m) sur des tokens courts.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

// Signal brand-proximity deterministe. Regles, dans l'ordre :
// 1. domaine officiel de la marque -> 0 (jamais penalise) ;
// 2. le hostname (hors suffixe public) contient le nom d'une marque en
//    sous-chaine -> 1 (ex. pancakeswapo.finance, kraken188.net,
//    www-ledger-com-live-app.woasp3.top) ;
// 3. un token du hostname (split sur . - _) est a distance d'edition 1-2
//    d'une marque -> 1 (ex. poncakeswap, begin-metamsk).
function scoreBrandProximity(hostname, domain) {
  if (OFFICIAL_BRAND_DOMAINS.has(domain)) return { score: 0, brand: null };
  const parsed = parseHostname(hostname);
  const suffix = parsed.publicSuffix ? `.${parsed.publicSuffix}` : "";
  const head =
    suffix && hostname.toLowerCase().endsWith(suffix)
      ? hostname.toLowerCase().slice(0, -suffix.length)
      : hostname.toLowerCase();
  const tokens = head.split(/[.\-_]/).filter(Boolean);
  for (const [brand] of BRANDS) {
    if (head.includes(brand)) return { score: 1, brand };
    if (brand.length < MIN_BRAND_LENGTH_FOR_DISTANCE) continue;
    for (const token of tokens) {
      const distance = editDistance(token, brand, 2);
      if (distance >= 1 && distance <= 2) return { score: 1, brand };
    }
  }
  return { score: 0, brand: null };
}

function containsConfusableChar(text) {
  for (const ch of text) {
    if (CONFUSABLE_CHARS.has(ch)) return true;
  }
  return false;
}

// Un label punycode (xn--...) est une preuve *potentielle* d'homoglyphe,
// pas une preuve en soi : la grande majorite des noms de domaine
// internationalises (japonais, arabe, chinois...) sont legitimes et n'ont
// aucun rapport avec un homoglyphe latin. On ne compte le signal que si le
// contenu decode contient reellement un caractere confusable documente.
// Un echec de decodage (label malforme) est traite comme suspect : un
// punycode qui ne decode meme pas correctement est en soi anormal.
function hasHomoglyphEvidence(labels) {
  return labels.some((label) => {
    if (!label.startsWith("xn--")) return false;
    try {
      return containsConfusableChar(domainToUnicode(label));
    } catch {
      return true;
    }
  });
}

async function lookupDomainAge(domain, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      {
        headers: { accept: "application/rdap+json, application/json" },
        signal: controller.signal,
      },
    );
    if (!response.ok) return { ageDays: null, source: "unavailable" };
    const data = await response.json();
    const event = data.events?.find(
      (item) => item.eventAction === "registration",
    );
    const createdAt = event?.eventDate
      ? Date.parse(event.eventDate)
      : Number.NaN;
    if (!Number.isFinite(createdAt))
      return { ageDays: null, source: "unavailable" };
    return {
      ageDays: Math.max(0, (Date.now() - createdAt) / 86_400_000),
      source: "rdap",
    };
  } catch {
    return { ageDays: null, source: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

// Ponderation des composantes. Contraintes de calibration (rejeu hors ligne
// du run Gemini v2.2 gele, ai/eval) :
// 1. typosquat de marque a confiance LLM 0.95 avec RDAP indisponible
//    (whoisAge neutre 0.5) doit publier : 0.7*0.95 + 0.3*(0.35 + 0.5*0.22)
//    = 0.8033 >= 0.80 ;
// 2. phishing non-marque sur TLD suspect + domaine tres recent (les cas
//    deja publies en v2.2) doit continuer a publier : tld 0.25 + age 0.22 ;
// 3. aucune entree legitime du jeu gele ne doit atteindre 0.80.
function combineComponents(components) {
  const score =
    0.35 * components.brand +
    0.25 * components.tld +
    0.22 * components.whoisAge +
    0.08 * components.homoglyph +
    0.07 * components.subdomains +
    0.03 * components.shortener;
  return Number(score.toFixed(4));
}

// Score les features d'un hostname donne. `shortenerHostname` reste celui de
// l'URL originale : c'est la que le raccourcisseur apparait, pas apres
// redirection.
async function scoreHostname(hostname, shortenerHostname, options) {
  const parsed = parseHostname(hostname);
  const domain = registeredDomain(hostname);
  const labels = hostname.toLowerCase().split(".").filter(Boolean);

  if (parsed.isIp) {
    // Pas de notion de TLD, de sous-domaine ou d'homoglyphe pour une IP
    // litterale ; whoisAge reste neutre (RDAP ne s'applique pas a une IP
    // ici - un lookup ARIN/RIPE distinct serait une amelioration future
    // hors perimetre de ce correctif).
    const components = {
      brand: 0,
      tld: 0,
      whoisAge: scoreAge(null),
      homoglyph: 0,
      subdomains: 0,
      shortener: 0,
    };
    const score = combineComponents(components);
    return {
      score,
      domain,
      tld: null,
      subdomainCount: 0,
      whoisAgeDays: null,
      whoisSource: "not_applicable_ip",
      brandDetected: null,
      components,
    };
  }

  const subdomainCount = parsed.subdomain
    ? parsed.subdomain.split(".").filter(Boolean).length
    : 0;
  const tld = parsed.publicSuffix
    ? parsed.publicSuffix.split(".").pop()
    : labels.at(-1) || "";
  // Hebergement gratuit jetable (suffixe prive de la PSL : vercel.app,
  // netlify.app, pages.dev, github.io, blogspot.com, typedream.app...).
  // Le "domaine" est un sous-domaine cree par l'attaquant : gratuit,
  // instantane, anonyme, age zero. RDAP ne sait pas le dater (il daterait la
  // plateforme, pas le sous-domaine). On le traite donc comme l'equivalent
  // d'un TLD suspect + domaine tout neuf, ce qui reflete la realite du
  // signal. Un site legitime sur ces plateformes reste protege : le verdict
  // LLM `legitimate` court-circuite toujours la publication.
  const freeHosting = parsed.isPrivate === true;
  const age = freeHosting
    ? { ageDays: 0, source: "free_hosting_subdomain" }
    : await (options.lookupDomainAge || lookupDomainAge)(domain);

  const brandProximity = scoreBrandProximity(hostname.toLowerCase(), domain);
  const components = {
    brand: brandProximity.score,
    tld: freeHosting || SUSPICIOUS_TLDS.has(tld) ? 1 : 0,
    whoisAge: scoreAge(age.ageDays),
    homoglyph: hasHomoglyphEvidence(labels) ? 1 : 0,
    subdomains: subdomainCount >= 3 ? 1 : subdomainCount === 2 ? 0.5 : 0,
    shortener: SHORTENERS.has(registeredDomain(shortenerHostname)) ? 1 : 0,
  };
  const score = combineComponents(components);

  return {
    score,
    domain,
    tld,
    subdomainCount,
    whoisAgeDays: Number.isFinite(age.ageDays) ? Math.floor(age.ageDays) : null,
    whoisSource: age.source,
    brandDetected: brandProximity.brand,
    components,
  };
}

// Anti-cloaking : un kit de phishing peut rediriger les visiteurs non cibles
// vers le site legitime de la marque usurpee (ex. allegro.*.sbs ->
// allegrolokalnie.pl). Scorer uniquement l'URL finale permettrait a
// l'attaquant d'annuler tout le signal deterministe. On score donc l'URL
// originale ET l'URL resolue, et on garde le pire (max) : une redirection ne
// peut qu'aggraver le score, jamais le blanchir.
async function calculateUrlFeatures(
  originalUrl,
  finalUrl = originalUrl,
  options = {},
) {
  const original = new URL(originalUrl);
  const resolved = new URL(finalUrl);
  const originalScored = await scoreHostname(
    original.hostname,
    original.hostname,
    options,
  );
  if (registeredDomain(resolved.hostname) === originalScored.domain) {
    return originalScored;
  }
  const resolvedScored = await scoreHostname(
    resolved.hostname,
    original.hostname,
    options,
  );
  return resolvedScored.score > originalScored.score
    ? resolvedScored
    : originalScored;
}

module.exports = {
  calculateUrlFeatures,
  lookupDomainAge,
  registeredDomain,
  scoreAge,
  hasHomoglyphEvidence,
  scoreBrandProximity,
  editDistance,
};
