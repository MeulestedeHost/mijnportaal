-- MijnPortaal — Supabase Schema
-- Voer dit script uit in de Supabase SQL Editor

CREATE TABLE IF NOT EXISTS formulieren (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    voornaam                TEXT NOT NULL,
    naam                    TEXT NOT NULL,
    email                   TEXT NOT NULL,
    telefoon                TEXT DEFAULT '',
    opmerkingen             TEXT DEFAULT '',
    datum_laatste_wijziging  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_formulieren_user_id ON formulieren (user_id);

ALTER TABLE formulieren ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Gebruikers zien eigen formulieren" ON formulieren FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Gebruikers maken eigen formulieren" ON formulieren FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Gebruikers bewerken eigen formulieren" ON formulieren FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Gebruikers verwijderen eigen formulieren" ON formulieren FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_datum_laatste_wijziging()
RETURNS TRIGGER AS $$
BEGIN
    NEW.datum_laatste_wijziging = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_formulieren_updated_at
    BEFORE UPDATE ON formulieren
    FOR EACH ROW EXECUTE FUNCTION update_datum_laatste_wijziging();

-- Voorbeeldgegevens (vervang JOUW-USER-UUID door een echte user.id uit auth.users)
-- INSERT INTO formulieren (user_id, voornaam, naam, email, telefoon, opmerkingen) VALUES
--   ('JOUW-USER-UUID', 'Jan', 'Janssens', 'jan@voorbeeld.nl', '+32 9 123 45 67', 'Test 1'),
--   ('JOUW-USER-UUID', 'Marie', 'Peeters', 'marie@voorbeeld.nl', '+32 470 12 34 56', 'Test 2');