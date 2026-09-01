-- Panini Ruilportaal — Migratie: kinderen & stickers
-- Voer dit script uit in de Supabase SQL Editor (na sql/schema.sql)
--
-- LET OP — DESTRUCTIEF: dit script verwijdert eerst een eventueel bestaande
-- 'kinderen'/'stickers'-tabel (en alle rijen erin, via CASCADE) voordat het
-- ze opnieuw aanmaakt. Enkel uitvoeren als bestaande testdata weg mag.

DROP TABLE IF EXISTS public.stickers CASCADE;
DROP TABLE IF EXISTS public.kinderen CASCADE;

CREATE TABLE public.kinderen (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    voornaam       TEXT NOT NULL,
    familienaam    TEXT NOT NULL,
    geboortejaar   INTEGER CHECK (geboortejaar IS NULL OR geboortejaar BETWEEN 1900 AND 2100),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kinderen_user_id ON public.kinderen (user_id);

CREATE TABLE public.stickers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind_id     UUID NOT NULL REFERENCES public.kinderen(id) ON DELETE CASCADE,
    nummer      TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('HEEFT', 'ZOEKT', 'RUILT')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stickers_kind_id ON public.stickers (kind_id);
CREATE INDEX idx_stickers_nummer ON public.stickers (nummer);

ALTER TABLE public.kinderen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;

-- kinderen: een gebruiker beheert uitsluitend zijn eigen kinderen
CREATE POLICY kinderen_select
    ON public.kinderen FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY kinderen_insert
    ON public.kinderen FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY kinderen_update
    ON public.kinderen FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY kinderen_delete
    ON public.kinderen FOR DELETE
    USING (auth.uid() = user_id);

-- stickers hebben zelf geen user_id: toegang loopt via het gekoppelde kind
CREATE POLICY stickers_select
    ON public.stickers FOR SELECT
    USING (
        EXISTS (SELECT 1 FROM public.kinderen k WHERE k.id = stickers.kind_id AND k.user_id = auth.uid())
    );

CREATE POLICY stickers_insert
    ON public.stickers FOR INSERT
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.kinderen k WHERE k.id = stickers.kind_id AND k.user_id = auth.uid())
    );

CREATE POLICY stickers_update
    ON public.stickers FOR UPDATE
    USING (
        EXISTS (SELECT 1 FROM public.kinderen k WHERE k.id = stickers.kind_id AND k.user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.kinderen k WHERE k.id = stickers.kind_id AND k.user_id = auth.uid())
    );

CREATE POLICY stickers_delete
    ON public.stickers FOR DELETE
    USING (
        EXISTS (SELECT 1 FROM public.kinderen k WHERE k.id = stickers.kind_id AND k.user_id = auth.uid())
    );

-- De oude tabel 'formulieren' (sql/schema.sql) wordt niet langer gebruikt
-- door de frontend. Niet automatisch verwijderd door deze migratie --
-- verwijder desgewenst handmatig na controle of de data niet meer nodig is:
-- DROP TABLE IF EXISTS public.formulieren;
