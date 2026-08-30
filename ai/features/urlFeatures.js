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
      tld: 0,
      whoisAge: scoreAge(null),
      homoglyph: 0,
      subdomains: 0,
      shortener: 0,
    };
    const score =
      0.3 * components.tld +
      0.25 * components.whoisAge +
      0.2 * components.homoglyph +
      0.15 * components.subdomains +
      0.1 * components.shortener;
    return {
      score: Number(score.toFixed(4)),
      domain,
      tld: null,
      subdomainCount: 0,
      whoisAgeDays: null,
      whoisSource: "not_applicable_ip",
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

  const components = {
    tld: freeHosting || SUSPICIOUS_TLDS.has(tld) ? 1 : 0,
    whoisAge: scoreAge(age.ageDays),
    homoglyph: hasHomoglyphEvidence(labels) ? 1 : 0,
    subdomains: subdomainCount >= 3 ? 1 : subdomainCount === 2 ? 0.5 : 0,
    shortener: SHORTENERS.has(registeredDomain(shortenerHostname)) ? 1 : 0,
  };
  const score =
    0.3 * components.tld +
    0.25 * components.whoisAge +
    0.2 * components.homoglyph +
    0.15 * components.subdomains +
    0.1 * components.shortener;

  return {
    score: Number(score.toFixed(4)),
    domain,
    tld,
    subdomainCount,
    whoisAgeDays: Number.isFinite(age.ageDays) ? Math.floor(age.ageDays) : null,
    whoisSource: age.source,
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
};
