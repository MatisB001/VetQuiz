# VetQuiz

Quiz quotidien de médecine vétérinaire (chien et chat) : 7 questions ouvertes par jour, un sachet de carte à collectionner selon le score, des amis, des ligues et un championnat des écoles vétérinaires.

- Site test (maquette sans serveur) : https://claude.ai/artifact/JEoNBvh5aBtQ7vb6k9D1HF
- Architecture : [docs/architecture.md](docs/architecture.md)

## Organisation du dépôt

| Dossier | Contenu |
| --- | --- |
| `supabase/migrations/` | Schéma de la base (tables, règles d'accès, fonctions de classement) |
| `supabase/seed.sql` | Liste des 73 écoles vétérinaires proposées, avec leurs sources |
| `supabase/tests/` | Tests des règles d'accès, lancés sur un PostgreSQL local |
| `scripts/test-db.sh` | Lance ces tests |

## Règle de sécurité

Aucune clé secrète dans ce dépôt (clé `service_role` de Supabase, clés d'envoi d'e-mails…). Elles vont dans les variables d'environnement de l'hébergeur. Seule la clé publique `anon` de Supabase peut apparaître dans le code du site.
