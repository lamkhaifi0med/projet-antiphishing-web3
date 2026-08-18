# Prompt utilisateur — Analyse d'URL (RF-A1)

À utiliser avec `system.md` comme message système. Autonome (peut être
appelé seul, avant tout fetch) ou combiné avec les deux autres templates
(voir `README.md`).

## Instruction

Analyse l'URL ci-dessous et détecte les signaux de phishing/fraude Web3
liés à sa seule structure, sans supposer quoi que ce soit sur un contenu
que tu n'as pas reçu :

- **Typosquatting** : proximité avec une marque Web3 connue (ex.
  `binance` vs `blnance`/`binnance`/`b1nance`), distance d'édition faible
  avec un nom de marque connu.
- **Homoglyphes** : caractères visuellement proches (`rn` vs `m`, chiffres
  substitués à des lettres, caractères Unicode ressemblants, punycode
  `xn--`).
- **TLD suspects** : extensions rarement utilisées par des services
  légitimes et fréquemment associées au phishing (ex. `.xyz`, `.top`,
  `.support`, `.click` — liste indicative et non exhaustive, le jugement
  prime sur la liste).
- **Sous-domaines trompeurs** : marque connue placée en sous-domaine d'un
  domaine sans rapport (ex. `binance.com.faux-domaine.xyz`).
- **URL shorteners** : service de raccourcissement masquant la
  destination réelle.
- **Hébergement tiers et domaine de marque incohérent** : une marque ou un
  produit Web3 placé dans le sous-domaine ou le chemin d'une plateforme
  générique (`vercel.app`, `pages.dev`, `web.app`, `gitbook.io`,
  `godaddysites.com`, etc.) n'est pas sur le domaine officiel. Si cette
  incohérence imite clairement une marque connue, traite-la comme un
  indicateur fort de phishing, même si la page utilise HTTPS.
- **Chemins trompeurs** : noms de wallet/exchange ou actions sensibles
  (`login`, `verify`, `wallet`, `claim`, `reward`, `earn`, `support`)
  placés dans le chemin d'un domaine sans rapport.

<<<URL>>>
{{url}}
<<<END_URL>>>

Réponds uniquement avec l'objet JSON conforme à `output-schema.json`.
