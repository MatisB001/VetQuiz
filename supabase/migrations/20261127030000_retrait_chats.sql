-- Retrait de 4 chats de la série 1 (rejouable) : Angora turc, Mau égyptien, Tonkinois, Van turc.
-- Décision de Seb du 27/11/2026, « pour le moment » : ces races n'ont pas de nouveau dessin sur ses planches.
-- À exécuter AVANT le lancement : seuls des comptes d'essai peuvent alors avoir ces cartes. Après le lancement, il
-- faudrait seulement les exclure des sachets, sans les supprimer, pour ne pas vider les classeurs des joueurs.
-- Ensuite, exécuter supabase/seed_cards.sql (252 cartes) : il met à jour la rareté des chats restants
-- (règle 5/15/30/50 % recalculée sur 38 chats : le Korat passe de rare à commune).
update public.quiz_runs set card_id = null where card_id in ('angora', 'egyptianmau', 'tonkinese', 'turkishvan');
delete from public.cards_owned where card_id in ('angora', 'egyptianmau', 'tonkinese', 'turkishvan');
delete from public.cards where id in ('angora', 'egyptianmau', 'tonkinese', 'turkishvan');
