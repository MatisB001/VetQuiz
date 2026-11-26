-- Correctifs après mise en service (26/11/2026). Fichier rejouable sans erreur.
-- 1. Un joueur qui crée son profil depuis le navigateur évalue la valeur par défaut du code ami,
--    donc la fonction random_code : il doit pouvoir l'exécuter (elle ne lit ni n'écrit aucune donnée).
grant execute on function public.random_code(int) to authenticated;
-- 2. Les fonctions de réglage de la partie sont lisibles par tous (aucune donnée) ; on le dit explicitement.
grant execute on function public.quiz_limit(), public.quiz_max_tries(), public.quiz_reveal() to anon, authenticated;
