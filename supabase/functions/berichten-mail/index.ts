// berichten-mail — mailt ouders over ongelezen berichten in een ruilgesprek
// (migratie 033). Enkel naar ouders: kinderen hebben geen eigen adres in het
// portaal, en de ouder is wie het account beheert.
//
// WAT ERIN STAAT. Enkel de voornaam van de ouder, het aantal nieuwe berichten
// en een link. Nooit de berichten zelf: een mail gaat door andermans servers,
// en wie wil lezen, logt in.
//
// WANNEER. public.mail_meldingen_klaar() beslist: ongelezen berichten van een
// ander gezin, minstens 10 minuten oud (wie actief chat, krijgt geen mail), en
// hoogstens één mail per gezin per 3 uur. Deze functie zelf onthoudt niets.
//
// AANROEPEN. Elke 15 minuten via pg_cron + pg_net (zie supabase/README.md,
// "Mailmeldingen"). Zonder de geheimen hieronder doet ze niets:
//   BERICHTEN_MAIL_GEHEIM — de cron stuurt dit mee in x-cron-geheim. Nodig
//     omdat verify_jwt elke geldige sessie doorlaat, ook die van een ouder.
//   RESEND_API_KEY        — zonder sleutel: geen mail, en niets gemarkeerd.
//   MAIL_AFZENDER         — optioneel, standaard ruilportaal@meulestede.gent
//                           (dat domein moet bij Resend geverifieerd zijn).
//   SITE_URL              — optioneel, standaard https://panini.meulestede.gent
import { createClient } from "jsr:@supabase/supabase-js@2";

type Rij = { gezin: string; email: string; voornaam: string | null; ongelezen: number };

Deno.serve(async (req) => {
  const geheim = Deno.env.get("BERICHTEN_MAIL_GEHEIM");
  if (!geheim || req.headers.get("x-cron-geheim") !== geheim) {
    return new Response("Niet toegelaten", { status: 401 });
  }
  const sleutel = Deno.env.get("RESEND_API_KEY");
  if (!sleutel) {
    return Response.json({ verstuurd: 0, reden: "RESEND_API_KEY ontbreekt: mailmeldingen staan uit" });
  }
  const afzender = Deno.env.get("MAIL_AFZENDER") ?? "Panini Ruilportaal <ruilportaal@meulestede.gent>";
  const site = (Deno.env.get("SITE_URL") ?? "https://panini.meulestede.gent").replace(/\/$/, "");

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await db.rpc("mail_meldingen_klaar");
  if (error) return Response.json({ fout: error.message }, { status: 500 });

  const rijen = (data ?? []) as Rij[];
  const gelukt = new Set<string>();
  const fouten: string[] = [];

  for (const r of rijen) {
    const n = r.ongelezen;
    const aanhef = r.voornaam ? `Dag ${r.voornaam},` : "Dag,";
    const wat = n === 1 ? "1 nieuw bericht" : `${n} nieuwe berichten`;
    const link = `${site}/gesprekken.html`;
    const tekst =
      `${aanhef}\n\nEr ${n === 1 ? "is" : "zijn"} ${wat} in een ruilgesprek van je gezin op het Panini Ruilportaal Meulestede.\n\n` +
      `Lees en antwoord hier: ${link}\n\n` +
      `Je krijgt hoogstens om de drie uur zo'n mail, en enkel voor berichten die je nog niet las.\n\n` +
      `Panini Ruilportaal Meulestede`;
    const html =
      `<p>${aanhef}</p><p>Er ${n === 1 ? "is" : "zijn"} <strong>${wat}</strong> in een ruilgesprek van je gezin op het Panini Ruilportaal Meulestede.</p>` +
      `<p><a href="${link}">Lees en antwoord in het portaal</a></p>` +
      `<p style="color:#5a6577;font-size:13px">Je krijgt hoogstens om de drie uur zo'n mail, en enkel voor berichten die je nog niet las.</p>`;

    const antwoord = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${sleutel}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: afzender, to: [r.email], subject: `💬 ${wat} op het Ruilportaal`, text: tekst, html }),
    });
    if (antwoord.ok) gelukt.add(r.gezin);
    else fouten.push(`${antwoord.status} voor een adres van gezin ${r.gezin}`);
  }

  if (gelukt.size) {
    const { error: markeer } = await db.rpc("mail_meldingen_verstuurd", { p_gezinnen: [...gelukt] });
    if (markeer) fouten.push("markeren: " + markeer.message);
  }
  return Response.json({ verstuurd: gelukt.size, fouten });
});
