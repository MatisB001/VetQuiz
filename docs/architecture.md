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
| `answer_log` | réponses normalisées, sans aucun identifiant | serveur uniquement |

Les scores et les cartes ne sont **jamais écrits par le navigateur** : sinon n'importe qui pourrait s'attribuer 35 points. Ils seront écrits par une fonction serveur qui corrige les réponses (étape suivante).

## Droits RGPD

- `export_my_data()` : accès et portabilité (art. 15 et 20).
- `delete_my_account()` : effacement immédiat (art. 17) ; la ligue d'un administrateur qui part passe au membre le plus ancien.
- `purge_inactive_accounts()` : suppression après 2 ans sans connexion, à planifier ; l'e-mail d'avertissement un mois avant reste à faire.

## Reste à faire

1. Fonction serveur de correction (questions du jour sans réponses côté navigateur, chronomètre côté serveur, écriture des scores, des cartes et de `answer_log`).
2. Brancher le site sur Supabase (connexion, profil, amis, ligues, écoles).
3. Choisir le prestataire d'e-mails (UE, avec DPA) et le configurer dans Supabase.
4. Vérifier le DPA de Supabase et la base du transfert vers les États-Unis.
