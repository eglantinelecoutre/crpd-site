# crpd-site

Site statique de consultation des documents de préparation au CRPD 2027.

Il ne contient **aucune donnée** : il lit le dépôt privé [`eglantinelecoutre/crpd`](https://github.com/eglantinelecoutre/crpd) via l'API GitHub, avec une clé d'accès (jeton) saisie dans le navigateur et stockée dans `localStorage`. Les conventions des documents (arborescence, frontmatter) sont décrites dans le README de `crpd`.

Adresse une fois GitHub Pages activé : **https://eglantinelecoutre.github.io/crpd-site/**

## Mise en service

### 1. Activer GitHub Pages

*Settings → Pages → Build and deployment* : Source **Deploy from a branch**, branche **main**, dossier **/ (root)**. Le fichier `.nojekyll` désactive Jekyll : les fichiers sont servis tels quels.

### 2. Créer la clé d'accès

Le jeton doit être créé **depuis le compte `eglantinelecoutre`** : un jeton à granularité fine ne donne accès qu'aux dépôts de son propriétaire, pas à ceux où l'on est seulement collaborateur.

*Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token* :

| Champ | Valeur |
|---|---|
| Token name | `crpd-site lecture` |
| Resource owner | `eglantinelecoutre` |
| Expiration | Custom, **2027-06-30** |
| Repository access | **Only select repositories** → `crpd` |
| Permissions → Repository | **Contents : Read-only** (Metadata : Read-only est ajouté d'office) |

Aucune autre permission.

### 3. Saisir la clé sur chaque appareil

Ouvrir le site, coller le jeton dans « Clé d'accès », se connecter. Il reste enregistré jusqu'au clic sur « Se déconnecter », qui l'efface ainsi que le cache des documents.

En cas de perte d'un appareil : révoquer le jeton sur GitHub, en créer un nouveau, le ressaisir sur les autres appareils.

## Adresses (liens depuis le tableau de bord)

| Page | Adresse |
|---|---|
| Accueil | `#/` |
| Entraînement | `#/entrainements/<id>` — ex. `#/entrainements/e01` |
| Document | `#/doc/<id du frontmatter>` — ex. `#/doc/e01-correction` |
| Thème | `#/theme/<slug>` |

## Fonctionnement

- Au chargement : un appel à l'API des arbres Git (`git/trees/main?recursive=1`), puis lecture de chaque `.md` hors `originaux/` et hors racine (en parallèle, 6 à la fois). Le contenu est mis en cache dans `sessionStorage` par SHA de blob : un fichier inchangé n'est pas rechargé pendant la session.
- **Actualisation** : la liste des fichiers est rechargée à l'ouverture, au bouton « Actualiser » et automatiquement quand on revient sur l'onglet (événements `visibilitychange`, `focus`, `pageshow`) si le dernier chargement date de plus de 2 minutes. Le rafraîchissement automatique est silencieux : un appel à l'API des arbres, puis seuls les fichiers dont le SHA a changé sont téléchargés ; la page n'est redessinée (position de lecture conservée, message « Documents mis à jour ») que si quelque chose a changé. En cas d'erreur réseau, l'affichage reste tel quel ; en cas de jeton expiré, retour à l'écran de connexion.
- Le frontmatter (YAML, schéma *core*, les dates restent des chaînes) construit les index : entraînements regroupés par `entrainement`, fiches, méthode, textes officiels, thèmes.
- Les originaux sont téléchargés via l'API des contenus avec `Accept: application/vnd.github.raw` (jusqu'à 100 Mo), puis enregistrés depuis le navigateur.
- Les images référencées en relatif dans un `.md` sont chargées de la même façon et affichées en `blob:`. Les images externes ne sont pas affichées.
- Les liens relatifs vers un autre `.md` deviennent des liens internes ; vers un autre fichier du dépôt, des téléchargements.

## Sécurité

- **Le jeton est le seul secret.** Lecture seule, un seul dépôt, expiration limitée.
- **CSP stricte** (balise `meta`) : scripts et styles uniquement depuis le site, connexions uniquement vers `api.github.com`, aucun script inline, aucune ressource tierce (polices système, pas d'analytics).
- **Markdown assaini** : rendu par marked puis DOMPurify (balises de formulaire, `iframe`, `style`, attributs `style`/`class`/`id` interdits).
- `noindex` et `no-referrer`.
- Limites assumées : un script qui s'exécuterait sur la page pourrait lire le jeton dans `localStorage` ; c'est ce que la CSP et l'assainissement empêchent. Un appareil compromis expose le jeton jusqu'à sa révocation.

## Bibliothèques (versionnées dans `vendor/`)

| Bibliothèque | Version | Licence |
|---|---|---|
| [marked](https://github.com/markedjs/marked) | 4.3.0 | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.1.6 | Apache-2.0 / MPL-2.0 |
| [js-yaml](https://github.com/nodeca/js-yaml) | 4.1.0 | MIT |

Pas d'étape de build, pas de dépendance npm.

## Développement local

```sh
python3 -m http.server 8000
# puis http://localhost:8000 avec un vrai jeton
```
