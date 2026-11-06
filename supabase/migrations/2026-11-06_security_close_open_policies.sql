-- ordini: la policy "allow all" (ALL, public, true) annullava ordini_socio,
-- rendendo leggibili/modificabili da chiunque tutti gli ordini.
drop policy if exists "allow all" on public.ordini;

-- suppliers: tabella non usata dall'app (sostituita da fornitori), lasciata
-- con accesso completo per anon/authenticated. Senza policy resta accessibile
-- solo alla service_role.
drop policy if exists "anon full access" on public.suppliers;
drop policy if exists "anon_all_suppliers" on public.suppliers;

-- otp_codes: tutti i codici scaduti sono inutili e contengono i chat id.
delete from public.otp_codes where expires_at < now() - interval '1 day';
