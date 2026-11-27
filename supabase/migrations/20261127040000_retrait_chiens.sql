-- Retrait de 9 chiens de la série 1 (rejouable) : Basset des Alpes, Braque de Weimar, Braque hongrois à poil court,
-- Chien du pharaon, Poméranien, Saint-Bernard, Shiba, Welsh corgi Pembroke et Caniche.
-- Décision de Seb du 27/11/2026, « pour le moment » : dessin à refaire (Caniche : robe rose, absente du standard FCI n° 172).
-- À exécuter AVANT le lancement, comme 20261127030000_retrait_chats.sql. Ensuite, exécuter supabase/seed_cards.sql
-- (raretés recalculées par espèce).
update public.quiz_runs set card_id = null
 where card_id in ('dachsbracke', 'weimaraner', 'vizsla', 'pharaoh', 'pom', 'stbernard', 'shiba', 'corgi', 'poodle');
delete from public.cards_owned
 where card_id in ('dachsbracke', 'weimaraner', 'vizsla', 'pharaoh', 'pom', 'stbernard', 'shiba', 'corgi', 'poodle');
delete from public.cards
 where id in ('dachsbracke', 'weimaraner', 'vizsla', 'pharaoh', 'pom', 'stbernard', 'shiba', 'corgi', 'poodle');
