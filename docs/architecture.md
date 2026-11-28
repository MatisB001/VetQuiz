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
- Invités : session anonyme Supabase, qui devient un compte quand on y lie un e-mail. Sessions anonymes sans partie depuis 90 jours supprimées par `purge_anonymous_sessions()` (durée choisie par Seb le 26/11/2026), chaque nuit à 02 h 30 GMT par pg_cron (`20261128000000_purge_planifiee.sql`). Bouton « Effacer mes données » dans Règles : `delete_my_account()` avec la session de l'invité (cascade : partie, scores, cartes), puis vidage du stockage local.
- Statistiques des réponses : compteurs sans identifiant ni date (`answer_stats`), à la place d'un journal daté qu'on pouvait recouper avec les parties (avis du fil RGPD). Un essai refusé contenant « @ » ou au moins 8 chiffres n'est pas compté ; pour l'analyse, la vue `answer_stats_review` ne montre un essai refusé qu'à partir de 5 occurrences, ou s'il a été signalé.
- Rotation des questions : ordre de `questions.json`, 7 par jour depuis le 26/11/2026, comme la maquette. Une question retirée garde une position négative.
- **Mêmes 7 questions pour tous chaque jour** (choix de Seb) : la série est enregistrée au premier appel du jour (`quiz_days`) et ne change plus, même si l'on ajoute des questions dans la journée.
- À régler : avec 25 questions, une question revient tous les 3 à 4 jours alors que ses réponses sont montrées le lendemain. Il faut une base plus grande ou un délai minimal avant le retour d'une question.

## Reconnaissance des réponses (27/11/2026)

- **Lexique commun** `data/lexique.json` : groupes de termes strictement équivalents (abréviations, noms anglais, éponymes : IRC = MRC = CKD). `scripts/lexique.mjs` ajoute aux synonymes de chaque réponse les variantes obtenues en remplaçant un terme par ses équivalents ; `gen-questions-sql.mjs` l'applique, le moteur de correction ne change pas. Règles : jamais un terme plus large ou plus étroit, jamais un mot courant ni une abréviation à deux sens (PAM, MCT, OCD retirés pour cette raison). Rédigé par Claude, à relire par un vétérinaire.
- **« Ma réponse était bonne »** : après une question, un bouton par essai refusé. L'action `contest` de la fonction Edge appelle `quiz_contest()` : seulement pour une question terminée de la partie du jour, seulement un texte déjà compté comme refusé (on ne peut pas créer de ligne), au plus 10 par joueur et par jour (`quiz_contest_max()`, provisoire). Le signalement est un compteur `answer_stats.contested`, sans joueur ni date ; la partie ne garde que leur nombre (`quiz_runs.contests`).
- **Liste de revue** : vue `answer_review` (Table Editor ou SQL Editor de Supabase), essais refusés signalés au moins une fois ou tapés au moins 5 fois, les plus signalés d'abord, avec le texte de la question. Pour accepter un essai : l'ajouter à `synonyms.json` (cette question) ou au lexique (toutes les questions), relancer `gen-questions-sql.mjs` et coller le SQL produit.
- Démo dans Claude (appelée bêta jusqu'au 27/11) : `node scripts/build-demo.mjs <maquette/src> <cartes/build> <questions.json> <synonyms.json> <sortie.html>` assemble le même gabarit, corrigé dans la page, avec 7 questions d'essai et `web/demo.js` ; une page Claude ne peut rien enregistrer pour un visiteur extérieur, les retours restent dans le navigateur et se copient depuis l'écran de score. Seule la démo permet de rejouer (exception expliquée aux joueurs).

## Fin de partie et accueil (27/11/2026)

Dans le gabarit partagé, donc identique sur le site, le site test et la démo :
- après la 7e question, la barre de progression s'affiche en grand et se remplit point par point (paliers commun, rare, épique, légendaire), puis « Ouvrir mon sachet » ; le résumé du score ne vient qu'après l'ouverture (« Voir mon résumé ») ;
- l'accueil explique la journée en trois cases : 7 questions, votre score choisit la rareté du sachet, 1 sachet par jour ;
- une fois le sachet ouvert, « Revenez demain ! » avec le temps restant (accueil, scène du sachet, résumé) ;
- le compte à rebours vise minuit **heure de Paris**, comme le serveur (`paris_today()`), et non minuit de l'appareil.

## Part des joueurs (27/11/2026)

- Décision de Seb : les niveaux restent fixés par expert (pas de recalcul par fréquence). Après une réponse acceptée, le site affiche la part des joueurs du jour qui ont donné la même réponse (« 25 % des joueurs du jour ont donné cette réponse (3 sur 12) »), comme Zebra.
- `quiz_share(uid, qi)` (migration `20261127020000_part_reponses.sql`, rejouable) compte sur les parties du jour (`quiz_runs`) et ne renvoie que deux nombres et un pourcentage. Réservée au serveur. La fonction Edge l'appelle après `quiz_answer` ; si elle manque ou échoue, la réponse passe quand même, sans pourcentage.

## Nouveaux dessins des chats et retrait de 4 chats (27/11/2026)
- Seb a fourni de nouvelles planches. Les dessins sont recopiés tels quels (seul le liseré mêlé au fond magenta est rendu transparent), puis choisis par Seb ; voir `cartes/dessins-v3` dans le dossier du projet et `assemble.py` de la série de cartes.
- Ils pèsent 100 à 240 Kio chacun : ils ne sont plus dans la page mais dans `public/dessins/<id>.png`, chargés quand une carte s'affiche ; le classeur charge une vignette (`public/dessins/mini/<id>.png`, 120 px au plus, réduction Lanczos). `IMG[id]` donne le sprite ou la vignette, `IMGHD[id]` le grand dessin.
- Retirés « pour le moment » (pas de nouveau dessin) : Angora turc, Mau égyptien, Tonkinois, Van turc. Migration `20261127030000_retrait_chats.sql` (rejouable, à passer avant le lancement), puis `seed_cards.sql`.
- Chiens : 94 races reçoivent le dessin choisi par Seb (planches V21 à V26). 13 nouvelles cartes avec leur dessin (11 chiens, Savannah et Peterbald) : la série passe à 265 cartes (225 chiens, 40 chats) ; raretés recalculées par espèce (Épagneul breton légendaire → épique, Entlebuch et PBGV rare → commune ; le Korat reste rare).
- Retirés ensuite « pour le moment » (décision de Seb, 27/11, 21 h 30) : Basset des Alpes, Braque de Weimar, Braque hongrois à poil court, Chien du pharaon, Poméranien, Saint-Bernard, Shiba, Welsh corgi Pembroke et Caniche (robe rose, absente du standard FCI n° 172). Migration `20261127040000_retrait_chiens.sql` (rejouable), puis `seed_cards.sql` : 256 cartes (216 chiens, 40 chats).

## Mise en service (dans l'ordre)

1. SQL Editor : `supabase/migrations/20261126000000_players.sql`, puis `supabase/seed.sql`.
2. SQL Editor : `supabase/migrations/20261126010000_quiz.sql`, puis `supabase/seed_cards.sql`, puis `supabase/migrations/20261126020000_inscription.sql`.
3. SQL Editor : les questions, produites par `node scripts/gen-questions-sql.mjs questions.json synonyms.json sortie.sql`. **Ce fichier contient les réponses : jamais dans le dépôt.** À relancer quand la base de questions change.
4. Fonction Edge : `supabase functions deploy quiz` (CLI), ou un seul fichier produit par `node scripts/bundle-quiz.mjs quiz.ts` à coller dans Edge Functions > Deploy a new function > Via Editor. Secret facultatif `QUIZ_ORIGINS` : adresse(s) du site.
5. SQL Editor : `supabase/migrations/20261126030000_themes.sql` (thèmes du jour à l'accueil), puis `20261126040000_jour_fige.sql` (série du jour figée), puis `20261127010000_contestations.sql` (signalements et liste de revue), puis `20261127020000_part_reponses.sql` (part des joueurs), puis `20261127030000_retrait_chats.sql`, `20261127040000_retrait_chiens.sql` et `supabase/seed_cards.sql` (dessins des chats), puis `20261128000000_purge_planifiee.sql` (purge nocturne des invités ; si l'extension ne s'active pas, l'activer dans Database > Extensions > pg_cron et relancer) ; tous rejouables (`test-db.sh` les rejoue une 2e fois).
6. Authentication : activer les connexions anonymes (limite Supabase : 30 par heure et par adresse IP, réglable).
7. Cloudflare Pages : projet relié au dépôt, sans commande de build, dossier de sortie `public`.

## Site de production

Pages juridiques (Mentions légales, Confidentialité, CGU, pied de page de toutes les vues sauf partie et sachet) : texte tiré de `juridique/*.md` du dossier partagé et copié dans le gabarit par `node scripts/sync-legal.mjs <juridique> <maquette/src/site.tpl.html>`, qui retire les notes internes, remplace les crochets tranchés par le code (clés de stockage local, durée de session) et liste ceux qui restent. Relancer après chaque modification des Markdown, puis les builds.

`public/` est construit par `node scripts/build-web.mjs <maquette/src> <cartes/build>` à partir du gabarit partagé de la maquette, de la série de cartes et de `web/live.js` (branchement sur Supabase), puis servi tel quel par Cloudflare Pages.

- La page ne contient aucune question ni réponse (le script échoue sinon) et ne charge rien d'un autre site : supabase-js 2.118.0 est copié dans `web/vendor/` (licence MIT), la police est intégrée.
- `web/config.json` : adresse du projet et clé publishable (publique, faite pour le navigateur). Jamais la clé secrète.
- `public/_headers` : politique de sécurité du contenu (connexions vers le seul projet Supabase), pas de référent, pas de caméra ni de micro.
- Aucune session n'est créée à la simple visite : la session invitée naît au premier clic sur « Jouer ».
- Relancer le build quand la maquette ou les cartes changent, puis pousser `public/`.
- Test dans Chromium contre un faux Supabase (vraie base locale, vraie fonction de correction) : `web/tests/e2e.test.mjs`, lancé par `scripts/test-db.sh` si les fichiers de la maquette sont présents.

Tests : `scripts/test-db.sh` (PostgreSQL 16 et Node 22, sans dépendance à installer). Sur le vrai projet : coller `supabase/tests/verify_live.sql` dans le SQL Editor ; il annule tout ce qu'il fait et affiche le résultat dans un message d'erreur volontaire (« VÉRIFICATION … : 42/42 ok » sur Supabase une fois toutes les migrations passées, dont la purge planifiée ; 41/41 en local, sans pg_cron).

## Droits RGPD

- `export_my_data()` : accès et portabilité (art. 15 et 20).
- `delete_my_account()` : effacement immédiat (art. 17) ; la ligue d'un administrateur qui part passe au membre le plus ancien.
- `purge_inactive_accounts()` : suppression après 2 ans sans connexion, à planifier ; l'e-mail d'avertissement un mois avant reste à faire.

## Reste à faire

1. Comptes sur le site : connexion par code e-mail, profil, amis, ligues, écoles (la partie du jour en invité et la liste des réponses de la veille sont faites).
2. Planifier `purge_inactive_accounts()` et écrire l'e-mail d'avertissement un mois avant, à l'ouverture des comptes (`purge_anonymous_sessions()` est planifiée depuis le 27/11/2026).
3. Configurer l'envoi d'e-mails dans Supabase : Scaleway Transactional Email (choix de Seb, 26/11/2026), une fois le nom de domaine acheté.
