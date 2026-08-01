"use strict";

// Fetch one-shot sécurisé (prototype RF-N5/RF-N5 bis/RF-S8) : timeout,
// taille max, lecture en flux, pas de JS, UA générique, protection SSRF
// avec IP épinglée, redirections revalidées à chaque saut.

const http = require("node:http");
const https = require("node:https");
const { resolveAndValidate } = require("./ssrfGuard");

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 Mo (RF-N5)
const MAX_REDIRECTS = 3; // RF-N5 bis
const USER_AGENT = "AntiPhishingWeb3ResearchBot/1.0 (+projet de recherche defensive, usage educatif)";

// Réponse HTTP reçue mais explicitement refusée (403, 451) : distinct
// d'un échec réseau/DNS. Un géoblocage (ex. 451, ou un edge/CDN qui
// renvoie 403 par région) n'est pas une "mortalité" — capture.js le
// classe en "refused", jamais en "dead".
const REFUSED_STATUS_CODES = new Set([403, 451]);

function fetchOnce(targetUrl) {
  return resolveAndValidate(new URL(targetUrl).hostname).then(
    (pinnedIp) =>
      new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          const err = new Error(`Protocole non supporté : ${parsed.protocol}`);
          err.code = "UNSUPPORTED_PROTOCOL";
          reject(err);
          return;
        }
        const client = parsed.protocol === "https:" ? https : http;

        // Délai absolu (AbortController), pas seulement un timeout
        // d'inactivité socket : un serveur qui envoie des données au
        // compte-goutte réinitialiserait un simple timeout d'inactivité
        // et ferait tenir la requête indéfiniment (constaté en pratique :
        // une capture bloquée bien au-delà de 10 s sur un serveur lent).
        const controller = new AbortController();
        const hardDeadline = setTimeout(() => {
          const timeoutError = new Error(`Timeout absolu après ${TIMEOUT_MS} ms`);
          timeoutError.code = "TIMEOUT";
          controller.abort(timeoutError);
        }, TIMEOUT_MS);
        const settle = (fn, value) => {
          clearTimeout(hardDeadline);
          fn(value);
        };

        const req = client.request(
          {
            hostname: pinnedIp, // connexion sur l'IP déjà validée (pas de second lookup DNS)
            servername: parsed.hostname, // SNI/validation de certificat sur le vrai nom d'hôte
            port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path: `${parsed.pathname}${parsed.search}`,
            method: "GET",
            headers: {
              Host: parsed.hostname,
              "User-Agent": USER_AGENT,
              Accept: "text/html",
            },
            signal: controller.signal,
          },
          (res) => {
            const status = res.statusCode;
            const contentType = res.headers["content-type"] || "";

            if (REFUSED_STATUS_CODES.has(status)) {
              // Réponse reçue mais refus explicite (403/451) : ne pas lire
              // le corps, ne jamais confondre avec un échec réseau/DNS.
              res.resume();
              settle(resolve, { refused: true, httpStatus: status });
              return;
            }

            if (status >= 300 && status < 400 && res.headers.location) {
              res.resume();
              settle(resolve, { redirect: new URL(res.headers.location, targetUrl).toString(), httpStatus: status });
              return;
            }

            if (!contentType.toLowerCase().includes("text/html")) {
              res.resume();
              settle(resolve, { skipped: `content-type non-HTML (${contentType || "inconnu"})`, httpStatus: status });
              return;
            }

            const chunks = [];
            let bytes = 0;
            let truncated = false;
            res.on("data", (chunk) => {
              if (truncated) return;
              bytes += chunk.length;
              if (bytes > MAX_BYTES) {
                truncated = true;
                chunks.push(chunk.subarray(0, chunk.length - (bytes - MAX_BYTES)));
                res.destroy(); // arrêt de lecture dès la limite dépassée (RF-N5)
                // res.destroy() sans erreur n'émet ni 'end' ni 'error' de
                // façon fiable : résoudre ICI, pas attendre un événement
                // qui peut ne jamais arriver (bug constaté en pratique —
                // capture bloquée indéfiniment sur une page dépassant
                // 2 Mo, ex. lido.fi).
                settle(resolve, { html: Buffer.concat(chunks).toString("utf8"), httpStatus: status, truncated: true });
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () => {
              settle(resolve, { html: Buffer.concat(chunks).toString("utf8"), httpStatus: status, truncated });
            });
            res.on("error", (error) => settle(reject, error));
          },
        );

        req.on("error", (error) => {
          if (error.name === "AbortError") {
            // controller.abort(timeoutError) : le "reason" d'origine (avec
            // son code TIMEOUT) est perdu par Node dans l'AbortError final,
            // on le reconstruit explicitement plutôt que de le redemander.
            const timeoutError = new Error(`Timeout absolu après ${TIMEOUT_MS} ms`);
            timeoutError.code = "TIMEOUT";
            settle(reject, timeoutError);
          } else {
            // Erreurs réseau natives (ECONNREFUSED, ECONNRESET, ETIMEDOUT...)
            // : error.code est déjà renseigné par Node, conservé tel quel
            // pour distinguer les causes dans le rapport (RF-N... §4 dead
            // vs blocage réseau/géoblocage plausible).
            settle(reject, error);
          }
        });
        req.end();
      }),
  );
}

/**
 * Capture une URL avec revalidation SSRF à chaque redirection (max
 * MAX_REDIRECTS). Ne redonne jamais le contrôle à un hop déjà validé sans
 * repasser par resolveAndValidate.
 */
async function captureUrl(originalUrl) {
  let currentUrl = originalUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const result = await fetchOnce(currentUrl);
    if (result.redirect) {
      if (hop === MAX_REDIRECTS) {
        const err = new Error(`Trop de redirections (> ${MAX_REDIRECTS}) depuis ${originalUrl}`);
        err.code = "TOO_MANY_REDIRECTS";
        throw err;
      }
      currentUrl = result.redirect;
      continue;
    }
    return { ...result, finalUrl: currentUrl };
  }
  const err = new Error(`Trop de redirections (> ${MAX_REDIRECTS}) depuis ${originalUrl}`);
  err.code = "TOO_MANY_REDIRECTS";
  throw err;
}

module.exports = { captureUrl, MAX_BYTES, MAX_REDIRECTS, TIMEOUT_MS, USER_AGENT };
