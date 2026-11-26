# Architecture : comptes, amis, ligues

Document de référence complet, avec comparatif et sources : https://claude.ai/artifact/XAs972JKd3obtDrvwbJmvt

## Choix validés (26/11/2026)

- **Hébergement** : Supabase, région Paris (eu-west-3), offre gratuite, pour l'authentification et la base. Site statique sur Cloudflare Pages (gratuit).
- **Connexion** : code à 6 chiffres envoyé par e-mail, valable 10 minutes, 5 essais, sans mot de passe. Pas de lien magique : la CNIL recommande qu'un jeton de confirmation ne connecte pas automatiquement.
- **Anti-abus** : limites d'envoi de codes par IP et par e-mail côté serveur. Pas de CAPTCHA tiers par défaut.
- **Championnat des écoles** : score hebdomadaire d'une école = moyenne des 10 meilleurs totaux de ses joueurs ; école classée à partir de 5 joueurs ayant joué dans la semaine.

## Données (minimisation)

| Table | Contenu | Qui lit |
| --- | --- | --- |
| `auth.users` (Supabase) | e-mail | le joueur seul |
| `profiles` | pseudo, école facultative, case « 15 ans ou plus », dernière connexion | le joueur ; pseudo et école via les classements |
| `daily_results` | score et niveaux du jour | le joueur ; totaux via les classements |
| `cards_owned` | cartes obtenues | le joueur |
| `friendships`, `leagues`, `league_members` | relations | les personnes concernées |
| `reports` | signalements | modération (clé serveur) |
| `answer_stats` | compteurs par réponse (acceptée ou refusée), sans identifiant ni date | serveur uniquement |
| `questions` | questions et réponses acceptées | serveur uniquement |
| `cards` | série de cartes (identifiant, rareté, espèce) | tout le monde |
| `quiz_runs` | partie du jour : questions tirées, niveau et réponse retenue par question, carte gagnée | le joueur |

Les scores et les cartes ne sont **jamais écrits par le navigateur** : sinon n'importe qui pourrait s'attribuer 35 points. Ils sont écrits par la fonction serveur qui corrige les réponses.

## Partie du jour corrigée par le serveur

Migration `20261126010000_quiz.sql` et fonction Edge `supabase/functions/quiz` (validées le 26/11/2026).

- Le navigateur ne reçoit le texte d'une question qu'au moment où il la démarre, et jamais ses réponses acceptées.
- Chronomètre tenu par le serveur : 30 secondes, plus 3 secondes de marge pour le réseau. Recharger la page ne le remet pas à zéro ; une question abandonnée vaut 0.
- Chaque essai est corrigé par le même moteur que la maquette (`matcher.js`, copié par `scripts/sync-matcher.mjs`). Le premier essai accepté termine la question ; au plus 20 essais par question.
- À la 7e question : score du jour, carte tirée sans doublon (seuils et probabilités de la maquette), fin de partie.
- **Liste des réponses acceptées : le lendemain** (choix de Seb). Tout le monde a les mêmes 7 questions : les montrer le jour même permettrait de les récupérer avec un second compte invité avant de jouer. Réglage : `quiz_reveal()`.
- Invités : session anonyme Supabase, qui devient un compte quand on y lie un e-mail. Sessions anonymes sans partie depuis 90 jours supprimées par `purge_anonymous_sessions()` (durée choisie par Seb le 26/11/2026 ; à planifier).
- Statistiques des réponses : compteurs sans identifiant ni date (`answer_stats`), à la place d'un journal daté qu'on pouvait recouper avec les parties (avis du fil RGPD). Un essai refusé contenant « @ » ou au moins 8 chiffres n'est pas compté ; pour l'analyse, la vue `answer_stats_review` ne montre un essai refusé qu'à partir de 5 occurrences.
- Rotation des questions : ordre de `questions.json`, 7 par jour depuis le 26/11/2026, comme la maquette. Une question retirée garde une position négative.

## Mise en service (dans l'ordre)

1. SQL Editor : `supabase/migrations/20261126000000_players.sql`, puis `supabase/seed.sql`.
2. SQL Editor : `supabase/migrations/20261126010000_quiz.sql`, puis `supabase/seed_cards.sql`, puis `supabase/migrations/20261126020000_inscription.sql`.
3. SQL Editor : les questions, produites par `node scripts/gen-questions-sql.mjs questions.json synonyms.json sortie.sql`. **Ce fichier contient les réponses : jamais dans le dépôt.** À relancer quand la base de questions change.
4. Fonction Edge : `supabase functions deploy quiz` (CLI), ou un seul fichier produit par `node scripts/bundle-quiz.mjs quiz.ts` à coller dans Edge Functions > Deploy a new function > Via Editor. Secret facultatif `QUIZ_ORIGINS` : adresse(s) du site.
5. SQL Editor : `supabase/migrations/20261126030000_themes.sql` (thèmes du jour à l'accueil ; rejouable).
6. Authentication : activer les connexions anonymes (limite Supabase : 30 par heure et par adresse IP, réglable).
7. Cloudflare Pages : projet relié au dépôt, sans commande de build, dossier de sortie `public`.

## Site de production

`public/` est construit par `node scripts/build-web.mjs <maquette/src> <cartes/build>` à partir du gabarit partagé de la maquette, de la série de cartes et de `web/live.js` (branchement sur Supabase), puis servi tel quel par Cloudflare Pages.

- La page ne contient aucune question ni réponse (le script échoue sinon) et ne charge rien d'un autre site : supabase-js 2.118.0 est copié dans `web/vendor/` (licence MIT), la police est intégrée.
- `web/config.json` : adresse du projet et clé publishable (publique, faite pour le navigateur). Jamais la clé secrète.
- `public/_headers` : politique de sécurité du contenu (connexions vers le seul projet Supabase), pas de référent, pas de caméra ni de micro.
- Aucune session n'est créée à la simple visite : la session invitée naît au premier clic sur « Jouer ».
- Relancer le build quand la maquette ou les cartes changent, puis pousser `public/`.
- Test dans Chromium contre un faux Supabase (vraie base locale, vraie fonction de correction) : `web/tests/e2e.test.mjs`, lancé par `scripts/test-db.sh` si les fichiers de la maquette sont présents.

Tests : `scripts/test-db.sh` (PostgreSQL 16 et Node 22, sans dépendance à installer). Sur le vrai projet : coller `supabase/tests/verify_live.sql` dans le SQL Editor ; il annule tout ce qu'il fait et affiche le résultat dans un message d'erreur volontaire (« VÉRIFICATION … : 29/29 ok »).

## Droits RGPD

- `export_my_data()` : accès et portabilité (art. 15 et 20).
- `delete_my_account()` : effacement immédiat (art. 17) ; la ligue d'un administrateur qui part passe au membre le plus ancien.
- `purge_inactive_accounts()` : suppression après 2 ans sans connexion, à planifier ; l'e-mail d'avertissement un mois avant reste à faire.

## Reste à faire

1. Comptes sur le site : connexion par code e-mail, profil, amis, ligues, écoles (la partie du jour en invité et la liste des réponses de la veille sont faites).
2. Planifier `purge_inactive_accounts()` et `purge_anonymous_sessions()`.
3. Configurer l'envoi d'e-mails dans Supabase : Scaleway Transactional Email (choix de Seb, 26/11/2026), une fois le nom de domaine acheté.
