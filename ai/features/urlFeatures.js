"use strict";

const SUSPICIOUS_TLDS = new Set(["xyz", "top", "support", "click", "online", "site", "club", "info", "live", "fun", "pw"]);
const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "cutt.ly", "is.gd", "ow.ly", "buff.ly", "rebrand.ly"]);
const TWO_PART_SUFFIXES = new Set(["co.uk", "org.uk", "com.au", "net.au", "co.jp", "com.br", "com.mx", "co.za"]);
const RDAP_TIMEOUT_MS = 4_000;

function registeredDomain(hostname) {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const suffix = labels.slice(-2).join(".");
  return labels.slice(TWO_PART_SUFFIXES.has(suffix) ? -3 : -2).join(".");
}

function scoreAge(ageDays) {
  if (!Number.isFinite(ageDays)) return 0.5;
  if (ageDays <= 7) return 1;
  if (ageDays >= 365) return 0;
  return 1 - (ageDays - 7) / 358;
}

async function lookupDomainAge(domain, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/rdap+json, application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { ageDays: null, source: "unavailable" };
    const data = await response.json();
    const event = data.events?.find((item) => item.eventAction === "registration");
    const createdAt = event?.eventDate ? Date.parse(event.eventDate) : Number.NaN;
    if (!Number.isFinite(createdAt)) return { ageDays: null, source: "unavailable" };
    return { ageDays: Math.max(0, (Date.now() - createdAt) / 86_400_000), source: "rdap" };
  } catch {
    return { ageDays: null, source: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

async function calculateUrlFeatures(originalUrl, finalUrl = originalUrl, options = {}) {
  const original = new URL(originalUrl);
  const resolved = new URL(finalUrl);
  const domain = registeredDomain(resolved.hostname);
  const labels = resolved.hostname.toLowerCase().split(".").filter(Boolean);
  const domainLabels = domain.split(".").length;
  const subdomainCount = Math.max(0, labels.length - domainLabels);
  const tld = labels.at(-1) || "";
  const age = await (options.lookupDomainAge || lookupDomainAge)(domain);

  const components = {
    tld: SUSPICIOUS_TLDS.has(tld) ? 1 : 0,
    whoisAge: scoreAge(age.ageDays),
    homoglyph: labels.some((label) => label.startsWith("xn--")) ? 1 : 0,
    subdomains: subdomainCount >= 3 ? 1 : subdomainCount === 2 ? 0.5 : 0,
    shortener: SHORTENERS.has(registeredDomain(original.hostname)) ? 1 : 0,
  };
  const score = 0.3 * components.tld + 0.25 * components.whoisAge + 0.2 * components.homoglyph + 0.15 * components.subdomains + 0.1 * components.shortener;

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

module.exports = { calculateUrlFeatures, lookupDomainAge, registeredDomain, scoreAge };
