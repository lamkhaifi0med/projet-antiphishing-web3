# Spécification de `score_features_URL`

Document uniquement — **aucune implémentation ici**. Figé au plus tard
J16 (Phase 3, §8.6 du cahier des charges complet), en même temps que le
gel des templates de prompts.

## Contexte

§8.6 fixe la formule et la pondération globale du score final :

```
score_final = 0.7 × confidence_LLM + 0.3 × score_features_URL
```

**Cette pondération 0.7/0.3 ne change pas.** Le cahier des charges détaille
le terme `confidence_LLM` (sortie du module IA, §8.3) mais ne détaille pas
la composition de `score_features_URL` au-delà de RF-N6 (« features URL :
domaine, TLD, âge whois, homoglyphes, nb de sous-domaines »). Ce document
comble ce vide : il définit les features retenues, leur pondération
interne (somme = 1) et la méthode de normalisation de chacune vers [0, 1],
de sorte que `score_features_URL` soit lui-même toujours dans [0, 1].

`score_features_URL` est un score **heuristique, indépendant du LLM** —
il ne dépend d'aucun appel réseau au module IA et reste calculable même
si l'analyse LLM échoue ou est court-circuitée (Approche B, contenu
inexploitable). C'est un signal complémentaire à RF-A1 (qui évalue aussi
qualitativement le typosquatting/les homoglyphes), pas un doublon : ici,
c'est un calcul déterministe et reproductible, pas un jugement du modèle.

## Features retenues et pondération

| # | Feature | Poids |
|---|---|---:|
| 1 | Domaine / TLD suspect | 0,30 |
| 2 | Âge du domaine (WHOIS) | 0,25 |
| 3 | Homoglyphes / punycode | 0,20 |
| 4 | Nombre de sous-domaines | 0,15 |
| 5 | Raccourcisseur d'URL connu | 0,10 |
| | **Somme** | **1,00** |

```
score_features_URL = 0,30 × score_tld
                    + 0,25 × score_whois_age
                    + 0,20 × score_homoglyphes
                    + 0,15 × score_sous_domaines
                    + 0,10 × score_raccourcisseur
```

Justification de l'ordre de priorité : l'âge WHOIS et le TLD suspect sont
les signaux les plus corrélés au phishing dans la littérature (domaine
neuf + TLD bon marché), les homoglyphes sont un signal fort mais plus
étroit (ne s'applique qu'aux cas de typosquatting visuel), le nombre de
sous-domaines est bruyant (de nombreux sites légitimes en ont beaucoup),
et le raccourcisseur est un signal binaire peu fréquent mais fiable
quand présent.

### 1. Domaine / TLD suspect (poids 0,30)

- Liste fermée et documentée de TLD statistiquement associés au phishing
  (ex. `.xyz`, `.top`, `.support`, `.click`, `.online`, `.site`, `.club`,
  `.info`, `.live`, `.fun`, `.pw` — indicative, à réviser périodiquement,
  cohérente avec la liste indicative de `ai/prompts/url-analysis.md`).
- **Normalisation** : `score_tld = 1.0` si le TLD du domaine enregistrable
  appartient à la liste ; `0.0` sinon. Déjà dans [0, 1], aucune
  interpolation nécessaire.

### 2. Âge du domaine — WHOIS/RDAP (poids 0,25)

- Récupérer la date de création du domaine via une requête WHOIS/RDAP sur
  le domaine enregistrable (eTLD+1).
- **Normalisation** (décroissance linéaire plafonnée) :
  - domaine créé il y a ≤ 7 jours → `score_whois_age = 1.0`
  - domaine créé il y a ≥ 365 jours → `score_whois_age = 0.0`
  - entre les deux : `score_whois_age = 1 - (âge_jours - 7) / (365 - 7)`,
    plafonné à [0, 1].
- **Absence de donnée** (requête WHOIS en échec, timeout, ou TLD sans champ
  de date de création exploitable) → `score_whois_age = 0.5` (valeur
  neutre documentée : ne pénalise ni n'avantage un domaine faute de
  donnée). Ce cas doit être journalisé distinctement dans le futur module
  d'implémentation (Phase 3), pour ne pas être confondu avec un domaine
  réellement "d'âge moyen".

### 3. Homoglyphes / punycode (poids 0,20)

- Détection de caractères Unicode visuellement proches de caractères latins
  standards (table de confusion documentée : ex. cyrillique а/е/о/р vs
  latin a/e/o/p) et de domaines encodés en punycode (`xn--`).
- **Normalisation** : `score_homoglyphes = 1.0` si le domaine contient un
  caractère de la table de confusion ou commence par `xn--` ; `0.0` sinon.

### 4. Nombre de sous-domaines (poids 0,15)

- Compter les labels du nom d'hôte situés avant le domaine enregistrable
  (eTLD+1) — ex. `a.b.exemple.com` → 2 sous-domaines.
- **Normalisation** par paliers (pas d'interpolation continue : un excès de
  sous-domaines est un signal de structure d'URL inhabituelle, pas un
  gradient fiable) :
  - 0 ou 1 sous-domaine → `score_sous_domaines = 0.0`
  - 2 sous-domaines → `score_sous_domaines = 0.5`
  - 3 sous-domaines ou plus → `score_sous_domaines = 1.0`

### 5. Raccourcisseur d'URL connu (poids 0,10)

- Liste fermée de domaines de raccourcisseurs connus (ex. `bit.ly`,
  `tinyurl.com`, `t.co`, `cutt.ly`, `is.gd`, `ow.ly`, `buff.ly`,
  `rebrand.ly`).
- **Normalisation** : `score_raccourcisseur = 1.0` si le domaine d'origine
  (avant toute redirection) correspond à un raccourcisseur connu ; `0.0`
  sinon. Si une redirection a déjà été résolue par `ai/tools/capture-pages/`
  (`finalUrl` du cache, jusqu'à 3 sauts revalidés SSRF — RF-N5 bis), la
  future implémentation réutilise cette information déjà capturée plutôt
  que de refaire un appel réseau dédié.

## Récapitulatif du calcul

Chaque `score_x` étant déjà dans [0, 1] et les poids sommant à 1,
`score_features_URL` est garanti dans [0, 1] par construction — aucun
clamp supplémentaire nécessaire côté implémentation.

## Hors périmètre de ce document

- L'implémentation effective (Phase 3/5, `n8n/fetch-service/` ou un module
  dédié) : ce document ne fixe que la spécification, pas le code.
- La pondération globale `0,7 confidence_LLM / 0,3 score_features_URL`
  (§8.6, déjà figée, non modifiée ici).
- Toute méthode d'évaluation statistique de ces poids (ex. régression sur
  le dataset) : les poids ci-dessus sont fixés par jugement d'expert pour
  la Phase 3, pas appris — à documenter comme piste d'évolution dans le
  rapport final si le temps le permet.
