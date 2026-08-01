"use strict";

// Protection SSRF (prototype RF-N5 bis / RF-S8) : résout le DNS une seule
// fois, valide chaque IP retournée, puis renvoie une IP "épinglée" à
// utiliser pour la connexion — évite qu'une seconde résolution DNS (DNS
// rebinding) contourne la validation entre le contrôle et la connexion.

const dns = require("node:dns").promises;
const net = require("node:net");

const PRIVATE_IPV4_RANGES = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (inclut les endpoints metadata cloud, ex. 169.254.169.254)
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // réservé
];

function ipv4ToLong(ip) {
  return (
    ip
      .split(".")
      .reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
  );
}

function isIpv4InRange(ip, rangeIp, prefixLength) {
  const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(rangeIp) & mask);
}

function isPrivateIpv4(ip) {
  return PRIVATE_IPV4_RANGES.some(([rangeIp, prefix]) => isIpv4InRange(ip, rangeIp, prefix));
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (fc00::/7)
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]); // IPv4-mapped IPv6
  return false;
}

function isPrivateIp(ip) {
  return net.isIPv4(ip) ? isPrivateIpv4(ip) : isPrivateIpv6(ip);
}

/**
 * Distincte d'une erreur réseau ordinaire (domaine mort, timeout...) :
 * un blocage SSRF signifie que la protection a fonctionné, pas que la
 * cible est injoignable. capture.js doit compter ça séparément du taux
 * de mortalité (un domaine parqué qui résout vers une IP privée n'est
 * pas "mort", il est "bloqué" — deux causes différentes, deux statuts
 * différents).
 */
class SsrfBlockedError extends Error {}

/**
 * Résout `hostname`, rejette si une IP retournée est privée/réservée,
 * et renvoie une IP validée à utiliser directement pour la connexion.
 */
async function resolveAndValidate(hostname) {
  if (net.isIP(hostname)) {
    // L'appelant a fourni une IP littérale plutôt qu'un nom de domaine.
    if (isPrivateIp(hostname)) {
      throw new SsrfBlockedError(`SSRF bloqué : adresse IP privée/réservée fournie directement (${hostname})`);
    }
    return hostname;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    // Échec de résolution DNS (NXDOMAIN, etc.) : ce n'est pas un blocage
    // SSRF, c'est un domaine injoignable — reste une erreur générique,
    // mais on conserve le code d'erreur Node (ENOTFOUND, EAI_AGAIN...)
    // pour distinguer, dans le rapport, un domaine qui n'existe vraiment
    // plus d'un problème réseau ponctuel — cf. la note sur bybit.com,
    // potentiellement géobloqué plutôt que mort.
    const wrapped = new Error(`Résolution DNS échouée pour ${hostname} : ${error.message}`);
    wrapped.code = error.code || "DNS_ERROR";
    throw wrapped;
  }
  if (addresses.length === 0) {
    const noRecords = new Error(`Aucun enregistrement DNS pour ${hostname}`);
    noRecords.code = "NO_DNS_RECORDS";
    throw noRecords;
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new SsrfBlockedError(`SSRF bloqué : ${hostname} résout vers une adresse privée/réservée (${address})`);
    }
  }
  return addresses[0].address;
}

module.exports = { resolveAndValidate, isPrivateIp, SsrfBlockedError };
