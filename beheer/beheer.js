// Beheerscherm voor het bestuur van de Industriekring Ter Apel.
// Lezen en schrijven gaat via Supabase met de sessie van de beheerder (RLS);
// versturen en goedkeuren via de edge-functie 'beheer'.
(() => {
  const { el, datumLang, tijd } = window.ik;
  const sb = window.supabase.createClient(window.IKTA.supabaseUrl, window.IKTA.publishableKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  const inhoud = document.getElementById("inhoud");
  const tabs = document.getElementById("tabs");
  const statusbalk = document.getElementById("statusbalk");
  let sessie = null;
  let status = null;

  // ------------------------------------------------------------------ hulpjes
  // Meldingen die een herteken van het scherm moeten overleven.
  const bewaard = {};
  const bewaar = (plek, soort, tekst) => { bewaard[plek] = [soort, tekst]; };
  const neem = (plek) => { const m = bewaard[plek]; delete bewaard[plek]; return m ? melding(...m) : null; };
  const melding = (soort, tekst) => el("div", { class: `melding ${soort}`, role: soort === "fout" ? "alert" : "status" }, tekst);
  const kaart = (...k) => el("div", { class: "kaart" }, ...k);
  const pil = (tekst, soort = "") => el("span", { class: `pil ${soort}`, text: tekst });
  const veld = (label, invoer, hint) => el("div", { class: "veld" }, el("label", { for: invoer.id, text: label }), invoer, hint ? el("span", { class: "hint", text: hint }) : null);
  let teller = 0;
  const id = () => `v${++teller}`;
  const tekstInvoer = (waarde, attrs = {}) => el("input", { type: "text", id: id(), value: waarde ?? "", ...attrs });
  const naarLokaal = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const vanLokaal = (v) => (v ? new Date(v).toISOString() : null);
  async function actie(body) {
    const { data: { session } } = await sb.auth.getSession();
    return window.ik.functie("beheer", { method: "POST", body, token: session?.access_token });
  }
  function bezig(knop, fn) {
    return async (...args) => {
      const oud = knop.textContent;
      knop.disabled = true; knop.textContent = "Bezig…";
      try { await fn(...args); } finally { knop.disabled = false; knop.textContent = oud; }
    };
  }
  // Twee keer klikken voor alles wat niet terug te draaien is (geen browserdialoog).
  function bevestigKnop(tekst, vraag, fn, klasse = "knop") {
    const knop = el("button", { type: "button", class: klasse, text: tekst });
    let gewapend = false, timer;
    knop.addEventListener("click", async () => {
      if (!gewapend) {
        gewapend = true; knop.textContent = vraag; knop.classList.add("tweede");
        timer = setTimeout(() => { gewapend = false; knop.textContent = tekst; knop.classList.remove("tweede"); }, 6000);
        return;
      }
      clearTimeout(timer); gewapend = false; knop.classList.remove("tweede");
      await bezig(knop, fn)();
      knop.textContent = tekst;
    });
    return knop;
  }
  function download(naam, tekst, type = "text/csv;charset=utf-8") {
    const a = el("a", { href: URL.createObjectURL(new Blob(["﻿" + tekst], { type })), download: naam });
    document.body.append(a); a.click(); a.remove();
  }
  const csv = (rijen) => rijen.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");

  // ------------------------------------------------------------------ inloggen
  function inlogScherm(boodschap) {
    tabs.classList.add("verborgen");
    statusbalk.replaceChildren();
    const email = el("input", { type: "email", id: "email", autocomplete: "email", required: true });
    const uit = el("div", { "aria-live": "polite" });
    const knop = el("button", { type: "submit", class: "knop", text: "Stuur mij een inloglink" });
    const form = el("form", {}, veld("Je e-mailadres", email), knop, uit);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      uit.replaceChildren();
      await bezig(knop, async () => {
        const adres = email.value.trim().toLowerCase();
        try { await window.ik.functie("inloggen", { method: "POST", body: { email: adres } }); } catch { /* inloglink hieronder geeft de melding */ }
        const { error } = await sb.auth.signInWithOtp({ email: adres, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false } });
        const geenAccount = error && /signups?|not allowed|not found/i.test(error.message);
        uit.append(error ? melding("fout", geenAccount ? "Dit e-mailadres heeft geen toegang. Vraag een bestuurslid om je toe te voegen." : "Versturen lukte niet. Probeer het over een paar minuten opnieuw.") : melding("goed", "Kijk in je mail: je hebt een inloglink gekregen. Open die op dit apparaat."));
      })();
    });
    inhoud.replaceChildren(kaart(el("h1", { text: "Beheer" }), el("p", { text: "Voor het bestuur van de Industriekring. Log in met je e-mailadres; je krijgt een link per mail." }), boodschap ? melding("let", boodschap) : null, form));
  }

  async function start() {
    const { data: { session } } = await sb.auth.getSession();
    sessie = session;
    if (!sessie) return inlogScherm();
    const { data: ik } = await sb.from("beheerders").select("naam").eq("user_id", sessie.user.id).maybeSingle();
    if (!ik) {
      await sb.auth.signOut();
      return inlogScherm("Dit e-mailadres heeft (nog) geen toegang. Vraag een beheerder om je toe te voegen.");
    }
    try { status = await actie({ actie: "status" }); } catch { status = null; }
    const wie = document.getElementById("wie");
    wie.replaceChildren(ik.naam, " · ", el("a", { href: "#", style: "color:inherit", onclick: async (e) => { e.preventDefault(); await sb.auth.signOut(); location.hash = ""; inlogScherm(); }, text: "uitloggen" }));
    tabs.classList.remove("verborgen");
    toonStatus();
    route();
  }

  function toonStatus() {
    const delen = [];
    if (status?.testmodus) delen.push(melding("let", `Testmodus staat aan: mails gaan alleen naar ${status.test_ontvangers.join(", ") || "niemand"}. Uitzetten kan bij Instellingen.`));
    if (status && !status.mail_gekoppeld) delen.push(melding("let", "Mail is nog niet gekoppeld (Brevo). Tot die tijd wordt verzenden alleen gelogd."));
    statusbalk.replaceChildren(...delen.map((d) => el("div", { style: "margin-bottom:10px" }, d)));
  }

  window.addEventListener("hashchange", route);
  function route() {
    if (!sessie) return;
    const [deel, sub] = location.hash.replace(/^#/, "").split("/");
    const actief = `#${deel === "bijeenkomst" || !deel ? "bijeenkomsten" : deel}`;
    for (const a of tabs.querySelectorAll("a")) {
      if (a.getAttribute("href") === actief) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    window.scrollTo(0, 0);
    if (deel === "bijeenkomst") return bijeenkomstScherm(sub);
    if (deel === "leden") return ledenScherm();
    if (deel === "aanvragen") return aanvragenScherm();
    if (deel === "instellingen") return instellingenScherm();
    return bijeenkomstenScherm();
  }

  // ------------------------------------------------------------------ bijeenkomsten
  async function bijeenkomstenScherm() {
    const { data, error } = await sb.from("v_bijeenkomsten").select("*").order("start");
    if (error) return inhoud.replaceChildren(melding("fout", "Bijeenkomsten laden lukte niet."));
    const nu = Date.now();
    const rij = (b) => el("tr", { class: "klik", onclick: () => (location.hash = `bijeenkomst/${b.id}`) },
      el("td", {}, el("strong", { text: b.titel }), el("div", { class: "hint", text: [b.locatie, b.programma].filter(Boolean).join(" · ") })),
      el("td", { text: `${datumLang(b.start)} ${tijd(b.start)}` }),
      el("td", {}, pil(b.status, b.status === "gepubliceerd" ? "goed" : b.status === "geannuleerd" ? "fout" : "")),
      el("td", { text: b.aanmeldwijze === "extern" ? "extern" : `${b.personen} / ${b.uitgenodigd}` }),
      el("td", { text: b.verstuurd ? `${b.verstuurd} verstuurd` : "—" }));
    const komend = (data ?? []).filter((b) => new Date(b.eind ?? b.start).getTime() >= nu);
    const voorbij = (data ?? []).filter((b) => new Date(b.eind ?? b.start).getTime() < nu).reverse();
    const tabel = (lijst) => el("div", { class: "scroll" }, el("table", { class: "tabel" },
      el("thead", {}, el("tr", {}, ["Bijeenkomst", "Wanneer", "Status", "Komen / genodigd", "Mail"].map((h) => el("th", { text: h })))),
      el("tbody", {}, lijst.length ? lijst.map(rij) : el("tr", {}, el("td", { colspan: 5, text: "Geen bijeenkomsten." })))));
    inhoud.replaceChildren(kaart(
      el("div", { class: "balk" }, el("h1", { text: "Bijeenkomsten", style: "margin:0;flex:1" }), el("button", { class: "knop", type: "button", onclick: () => (location.hash = "bijeenkomst/nieuw"), text: "Nieuwe bijeenkomst" })),
      el("h2", { text: "Komend" }), tabel(komend),
      voorbij.length ? el("h2", { text: "Geweest", style: "margin-top:24px" }) : null, voorbij.length ? tabel(voorbij) : null));
  }

  async function bijeenkomstScherm(bid) {
    const nieuw = bid === "nieuw";
    let b = { titel: "", soort: "ledenvergadering", start: null, eind: null, programma: "", locatie: "", adres: "", omschrijving: "", aanmeldwijze: "eigen", externe_link: "", externe_tekst: "", aanmelden_tot: null, max_personen: 2, vraag_eten: false, doelgroep: "leden", status: "concept", afbeelding_url: "" };
    if (!nieuw) {
      const { data } = await sb.from("v_bijeenkomsten").select("*").eq("id", bid).maybeSingle();
      if (!data) return inhoud.replaceChildren(melding("fout", "Bijeenkomst niet gevonden."));
      b = data;
    }
    const f = {
      titel: tekstInvoer(b.titel, { required: true, maxlength: 150 }),
      soort: el("select", { id: id() }, ["ledenvergadering", "bedrijfsbezoek", "sprekersavond", "kerstmarkt", "bestuursvergadering", "overig"].map((s) => el("option", { value: s, text: s, selected: b.soort === s }))),
      start: el("input", { type: "datetime-local", id: id(), value: naarLokaal(b.start), required: true }),
      eind: el("input", { type: "datetime-local", id: id(), value: naarLokaal(b.eind) }),
      programma: tekstInvoer(b.programma, { maxlength: 200, placeholder: "Inloop 16:30 · rondleiding 17:00 · vergadering 18:00" }),
      locatie: tekstInvoer(b.locatie, { maxlength: 120 }),
      adres: tekstInvoer(b.adres, { maxlength: 150 }),
      omschrijving: el("textarea", { id: id(), maxlength: 1500 }, b.omschrijving ?? ""),
      aanmeldwijze: el("select", { id: id() }, [["eigen", "Aanmelden via de kring"], ["extern", "Externe kaartverkoop (bv. Ticket Dog)"], ["geen", "Geen aanmelding nodig"]].map(([v, t]) => el("option", { value: v, text: t, selected: b.aanmeldwijze === v }))),
      externe_link: el("input", { type: "url", id: id(), value: b.externe_link ?? "", placeholder: "https://" }),
      externe_tekst: tekstInvoer(b.externe_tekst, { maxlength: 200, placeholder: "Leden € 12,50 · niet-leden € 17,50" }),
      aanmelden_tot: el("input", { type: "datetime-local", id: id(), value: naarLokaal(b.aanmelden_tot) }),
      max_personen: el("input", { type: "number", id: id(), min: 1, max: 10, value: b.max_personen }),
      vraag_eten: el("select", { id: id() }, [["false", "Nee"], ["true", "Ja, vraag of mensen mee-eten"]].map(([v, t]) => el("option", { value: v, text: t, selected: String(b.vraag_eten) === v }))),
      doelgroep: el("select", { id: id() }, [["leden", "Leden"], ["leden_en_partners", "Leden en partners"], ["iedereen", "Iedereen (ook externen)"]].map(([v, t]) => el("option", { value: v, text: t, selected: b.doelgroep === v }))),
      status: el("select", { id: id() }, [["concept", "Concept (nog niet zichtbaar)"], ["gepubliceerd", "Gepubliceerd"], ["geannuleerd", "Geannuleerd"]].map(([v, t]) => el("option", { value: v, text: t, selected: b.status === v }))),
      afbeelding_url: el("input", { type: "url", id: id(), value: b.afbeelding_url ?? "", placeholder: "https://…" }),
    };
    const vTot = veld("Aanmelden kan tot", f.aanmelden_tot), vMax = veld("Maximaal aantal personen per aanmelding", f.max_personen), vEten = veld("Vragen naar eten", f.vraag_eten);
    const vLink = veld("Link kaartverkoop", f.externe_link), vTekst = veld("Tekst bij de kaartverkoop", f.externe_tekst);
    const wissel = () => {
      const w = f.aanmeldwijze.value;
      for (const v of [vTot, vMax, vEten]) v.classList.toggle("verborgen", w !== "eigen");
      for (const v of [vLink, vTekst]) v.classList.toggle("verborgen", w !== "extern");
    };
    f.aanmeldwijze.addEventListener("change", wissel);
    wissel();
    const uit = el("div", { "aria-live": "polite" }, neem("bijeenkomst"));
    const opslaan = el("button", { type: "submit", class: "knop", text: nieuw ? "Bijeenkomst aanmaken" : "Opslaan" });
    const form = el("form", { novalidate: true },
      el("div", { class: "rooster" },
        el("div", { class: "breed" }, veld("Titel", f.titel)),
        veld("Soort", f.soort), veld("Status", f.status),
        veld("Begin", f.start), veld("Einde (optioneel)", f.eind),
        el("div", { class: "breed" }, veld("Programma", f.programma)),
        veld("Locatie", f.locatie), veld("Adres", f.adres),
        el("div", { class: "breed" }, veld("Omschrijving (komt in de uitnodiging)", f.omschrijving)),
        veld("Aanmelden", f.aanmeldwijze), veld("Voor wie", f.doelgroep),
        vTot, vMax, vEten, vLink, vTekst,
        el("div", { class: "breed" }, veld("Beeld bovenaan de mail en de aanmeldpagina (optioneel)", f.afbeelding_url))),
      el("div", { class: "balk" }, opslaan, nieuw ? el("a", { href: "#bijeenkomsten", text: "Annuleren" }) : null), uit);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      uit.replaceChildren();
      const rij = {
        titel: f.titel.value.trim(), soort: f.soort.value, start: vanLokaal(f.start.value), eind: vanLokaal(f.eind.value),
        programma: f.programma.value.trim() || null, locatie: f.locatie.value.trim() || null, adres: f.adres.value.trim() || null,
        omschrijving: f.omschrijving.value.trim() || null, aanmeldwijze: f.aanmeldwijze.value, externe_link: f.externe_link.value.trim() || null,
        externe_tekst: f.externe_tekst.value.trim() || null, aanmelden_tot: vanLokaal(f.aanmelden_tot.value),
        max_personen: Math.min(10, Math.max(1, Number(f.max_personen.value) || 1)), vraag_eten: f.vraag_eten.value === "true",
        doelgroep: f.doelgroep.value, status: f.status.value, afbeelding_url: f.afbeelding_url.value.trim() || null,
      };
      if (!rij.titel || !rij.start) return uit.append(melding("fout", "Titel en begin zijn verplicht."));
      if (rij.aanmeldwijze === "extern" && !rij.externe_link) return uit.append(melding("fout", "Vul de link van de kaartverkoop in."));
      await bezig(opslaan, async () => {
        const q = nieuw ? sb.from("bijeenkomsten").insert(rij).select("id").single() : sb.from("bijeenkomsten").update(rij).eq("id", b.id).select("id").single();
        const { data, error } = await q;
        if (error) return uit.append(melding("fout", "Opslaan lukte niet."));
        if (nieuw) location.hash = `bijeenkomst/${data.id}`;
        else { bewaar("bijeenkomst", "goed", "Opgeslagen."); bijeenkomstScherm(b.id); }
      })();
    });

    const delen = nieuw
      ? [kaart(el("h1", { text: "Nieuwe bijeenkomst" }), form)]
      : [el("div", {}, el("a", { href: "#bijeenkomsten", text: "← Alle bijeenkomsten" }), el("h1", { text: b.titel, style: "margin:8px 0 2px" }),
          el("p", { class: "hint", style: "margin:0", text: `${datumLang(b.start)}, ${tijd(b.start)} uur${b.locatie ? ` · ${b.locatie}` : ""}` })),
        await uitnodigingenDeel(b),
        kaart(el("h2", { text: "Gegevens van de bijeenkomst" }), form)];
    inhoud.replaceChildren(...delen.map((d) => el("div", { style: "margin-bottom:16px" }, d)));
  }

  async function uitnodigingenDeel(b) {
    const { data: rijen } = await sb.from("v_uitnodigingen").select("*").eq("bijeenkomst_id", b.id).order("organisatie");
    const lijst = rijen ?? [];
    const uit = el("div", { "aria-live": "polite", style: "margin-top:12px" }, neem("uitnodigen"));
    const toon = (soort, tekst) => { uit.replaceChildren(melding(soort, tekst)); };
    const toonEnHerlaad = (soort, tekst) => { bewaar("uitnodigen", soort, tekst); bijeenkomstScherm(b.id); };
    const verslag = (r) => `${r.verzonden} verstuurd, ${r.test} in testmodus gelogd, ${r.overgeslagen} overgeslagen${r.fout ? `, ${r.fout} mislukt (${r.fouten.join("; ")})` : ""}${r.resterend ? `, ${r.resterend} nog te gaan: klik nogmaals` : ""}.`;

    const nogTeVersturen = lijst.filter((r) => !r.verstuurd_op && r.email).length;
    const geenReactie = lijst.filter((r) => r.verstuurd_op && !r.aanmelding && !r.herinnerd_op).length;
    const komt = lijst.filter((r) => r.aanmelding === "komt");
    const cijfers = el("div", { class: "cijfers" },
      [["Genodigd", lijst.length], ["Verstuurd", lijst.filter((r) => r.verstuurd_op).length], ["Komen", komt.length], ["Personen", komt.reduce((s, r) => s + (r.aantal || 1), 0)],
        ["Eten mee", komt.filter((r) => r.eet_mee).reduce((s, r) => s + (r.aantal || 1), 0)], ["Afgemeld", lijst.filter((r) => r.aanmelding === "komt_niet").length], ["Geen reactie", lijst.filter((r) => !r.aanmelding).length]]
        .filter(([k]) => b.aanmeldwijze === "eigen" || ["Genodigd", "Verstuurd"].includes(k))
        .map(([k, v]) => el("div", { class: "cijfer" }, el("b", { text: v }), k)));

    const knopKlaarzetten = el("button", { type: "button", class: "knop tweede", text: "Leden als genodigden klaarzetten" });
    knopKlaarzetten.addEventListener("click", bezig(knopKlaarzetten, async () => {
      try { const r = await actie({ actie: "voorbereiden", bijeenkomst_id: b.id }); toonEnHerlaad("goed", `${r.klaargezet} genodigden klaargezet.`); }
      catch (e) { toon("fout", e.message); }
    }));
    const knopProef = el("button", { type: "button", class: "knop tweede", text: "Proefmail naar mij" });
    knopProef.addEventListener("click", bezig(knopProef, async () => {
      try { const r = await actie({ actie: "proef", bijeenkomst_id: b.id }); toon(r.aan.length ? "goed" : "let", r.aan.length ? `Proefmail verstuurd naar ${r.aan.join(", ")}.` : `Niet verstuurd${r.fouten.length ? `: ${r.fouten.join("; ")}` : " (mail nog niet gekoppeld?)"}.`); }
      catch (e) { toon("fout", e.message); }
    }));
    const knopVersturen = bevestigKnop(`Uitnodiging versturen (${nogTeVersturen})`, `Zeker? Klik nogmaals om ${nogTeVersturen} mails te versturen`, async () => {
      try { const r = await actie({ actie: "versturen", bijeenkomst_id: b.id }); toonEnHerlaad(r.fout ? "let" : "goed", verslag(r)); }
      catch (e) { toon("fout", e.message); }
    });
    if (!nogTeVersturen || b.status !== "gepubliceerd") knopVersturen.disabled = true;
    const knopHerinner = bevestigKnop(`Herinnering (${geenReactie})`, `Zeker? Klik nogmaals voor ${geenReactie} herinneringen`, async () => {
      try { const r = await actie({ actie: "herinneren", bijeenkomst_id: b.id, soort: "herinnering" }); toonEnHerlaad(r.fout ? "let" : "goed", verslag(r)); }
      catch (e) { toon("fout", e.message); }
    }, "knop tweede");
    if (!geenReactie || b.status !== "gepubliceerd") knopHerinner.disabled = true;
    const knopWhatsapp = el("button", { type: "button", class: "knop tweede", text: "WhatsApp-tekst kopiëren" });
    knopWhatsapp.addEventListener("click", bezig(knopWhatsapp, async () => {
      try { const r = await actie({ actie: "whatsapp_tekst", bijeenkomst_id: b.id }); await navigator.clipboard.writeText(r.tekst); toon("goed", "Tekst gekopieerd. Plak hem in de aankondigingsgroep van de community."); }
      catch (e) { toon("fout", e.message.includes("clipboard") ? "Kopiëren lukte niet in deze browser." : e.message); }
    }));

    // Gast toevoegen
    const g = { naam: tekstInvoer("", { maxlength: 120 }), email: el("input", { type: "email", id: id(), maxlength: 200 }), telefoon: el("input", { type: "tel", id: id(), maxlength: 30 }), organisatie: tekstInvoer("", { maxlength: 150 }), meteen: el("input", { type: "checkbox", id: id(), checked: true }) };
    const knopGast = el("button", { type: "submit", class: "knop klein", text: "Gast toevoegen" });
    const gastForm = el("form", { class: "geen-print" },
      el("div", { class: "rooster" }, veld("Naam", g.naam), veld("Organisatie", g.organisatie), veld("E-mail", g.email), veld("Telefoon", g.telefoon)),
      el("label", { style: "display:flex;gap:8px;align-items:center" }, g.meteen, b.status === "gepubliceerd" ? "Meteen een uitnodiging sturen" : "Uitnodiging sturen (kan pas als de bijeenkomst gepubliceerd is)"),
      knopGast);
    gastForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await bezig(knopGast, async () => {
        try {
          const r = await actie({ actie: "gast_toevoegen", bijeenkomst_id: b.id, naam: g.naam.value, email: g.email.value, telefoon: g.telefoon.value, organisatie: g.organisatie.value, versturen: g.meteen.checked });
          toonEnHerlaad("goed", `Gast toegevoegd.${r.verzending ? ` ${verslag(r.verzending)}` : ""}`);
        } catch (err) { toon("fout", err.message); }
      })();
    });

    // Tabel genodigden
    async function zetReactie(r, nieuweStatus) {
      const rij = { uitnodiging_id: r.uitnodiging_id, status: nieuweStatus, aantal: r.aantal || 1, eet_mee: nieuweStatus === "komt" && b.vraag_eten ? (r.eet_mee ?? true) : null, via: "bestuur" };
      const { error } = await sb.from("aanmeldingen").upsert(rij, { onConflict: "uitnodiging_id" });
      if (error) toon("fout", "Opslaan lukte niet."); else bijeenkomstScherm(b.id);
    }
    const reactiePil = (r) => r.aanmelding === "komt" ? pil(`komt${r.aantal > 1 ? ` (${r.aantal})` : ""}${r.eet_mee ? " · eet mee" : ""}`, "goed") : r.aanmelding === "komt_niet" ? pil("komt niet", "fout") : pil(r.verstuurd_op ? "geen reactie" : "nog niet uitgenodigd");
    const tabel = el("div", { class: "scroll" }, el("table", { class: "tabel" },
      el("thead", {}, el("tr", {}, ["Naam", "Organisatie", "Reactie", "Dieet / opmerking", "Mail", ""].map((h) => el("th", { text: h })))),
      el("tbody", {}, lijst.length ? lijst.map((r) => el("tr", {},
        el("td", {}, r.naam || "—", r.soort === "gast" ? [" ", pil("gast", "merk")] : null),
        el("td", { text: r.organisatie || "" }),
        el("td", {}, reactiePil(r)),
        el("td", { text: [r.dieetwensen, r.opmerking].filter(Boolean).join(" · ") }),
        el("td", { text: r.verstuurd_op ? new Date(r.verstuurd_op).toLocaleDateString("nl-NL") : (r.email ? "—" : "geen e-mail") }),
        el("td", { class: "geen-print" }, b.aanmeldwijze === "eigen" ? el("div", { class: "balk", style: "margin:0;gap:6px" },
          el("button", { type: "button", class: "knop klein tweede", onclick: () => zetReactie(r, "komt"), text: "Komt" }),
          el("button", { type: "button", class: "knop klein tweede", onclick: () => zetReactie(r, "komt_niet"), text: "Komt niet" }),
          el("button", { type: "button", class: "knop klein tweede", onclick: async () => { try { await navigator.clipboard.writeText(`${status?.site_url || location.origin}/aanmelden/?t=${r.token}`); toon("goed", `Aanmeldlink van ${r.naam || "deze genodigde"} gekopieerd.`); } catch { toon("fout", "Kopiëren lukte niet."); } }, text: "Link" })) : null))) :
        el("tr", {}, el("td", { colspan: 6, text: "Nog geen genodigden. Klik op 'Leden als genodigden klaarzetten'." })))));

    const exporteer = el("button", { type: "button", class: "knop klein tweede", text: "Lijst downloaden (Excel/CSV)", onclick: () =>
      download(`genodigden-${b.titel.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`, csv([["Naam", "Organisatie", "E-mail", "Telefoon", "Soort", "Reactie", "Aantal", "Eet mee", "Dieet", "Opmerking"],
        ...lijst.map((r) => [r.naam, r.organisatie, r.email, r.telefoon, r.soort, r.aanmelding ?? "geen reactie", r.aantal, r.eet_mee ? "ja" : "", r.dieetwensen, r.opmerking])])) });
    const print = el("button", { type: "button", class: "knop klein tweede", text: "Presentielijst afdrukken", onclick: () => window.print() });

    const { data: log } = await sb.from("verzendlog").select("aangemaakt_op, email, soort, status, fout").eq("bijeenkomst_id", b.id).order("aangemaakt_op", { ascending: false }).limit(25);
    const logTabel = (log ?? []).length ? el("details", { class: "geen-print", style: "margin-top:16px" }, el("summary", { text: "Verzendlog (laatste 25)" }),
      el("div", { class: "scroll" }, el("table", { class: "tabel" }, el("tbody", {}, log.map((l) => el("tr", {},
        el("td", { text: new Date(l.aangemaakt_op).toLocaleString("nl-NL") }), el("td", { text: l.email }), el("td", { text: l.soort }),
        el("td", {}, pil(l.status, l.status === "verzonden" ? "goed" : l.status === "fout" ? "fout" : "")), el("td", { text: l.fout ?? "" }))))))) : null;

    return kaart(
      el("h2", { text: "Uitnodigen en aanmeldingen" }),
      b.status !== "gepubliceerd" ? melding("let", "Deze bijeenkomst is nog een concept. Zet onderaan de status op 'Gepubliceerd' en sla op om uitnodigingen te kunnen versturen. Een proefmail kan altijd.") : null,
      cijfers,
      el("div", { class: "balk geen-print" }, knopKlaarzetten, knopProef, knopVersturen, knopHerinner, knopWhatsapp),
      uit,
      el("h3", { text: "Genodigden", style: "margin-top:16px" }),
      el("div", { class: "balk geen-print" }, exporteer, print),
      tabel,
      el("details", { class: "geen-print", style: "margin-top:16px" }, el("summary", { text: "Gast handmatig uitnodigen (geen lid)" }), el("div", { style: "margin-top:12px" }, gastForm)),
      logTabel);
  }

  // ------------------------------------------------------------------ leden
  async function ledenScherm() {
    const [{ data: bedrijven }, { data: contacten }] = await Promise.all([
      sb.from("bedrijven").select("*").order("naam"),
      sb.from("contactpersonen").select("*").order("naam"),
    ]);
    const perBedrijf = new Map();
    for (const c of contacten ?? []) { if (!perBedrijf.has(c.bedrijf_id)) perBedrijf.set(c.bedrijf_id, []); perBedrijf.get(c.bedrijf_id).push(c); }
    const zoek = el("input", { type: "search", id: id(), placeholder: "Zoek op bedrijf, naam of e-mail" });
    const filter = el("select", { id: id() }, [["lid", "Leden"], ["partner", "Partners"], ["opgezegd", "Opgezegd"], ["ontbreekt", "Ontbrekende gegevens"], ["alle", "Alles"]].map(([v, t]) => el("option", { value: v, text: t })));
    const tbody = el("tbody");
    const dlg = el("dialog");
    document.body.append(dlg);

    function teken() {
      const q = zoek.value.trim().toLowerCase();
      const rijen = [];
      for (const b of bedrijven ?? []) {
        const cs = perBedrijf.get(b.id) ?? [];
        if (filter.value === "ontbreekt") { if (b.status === "opgezegd" || !cs.some((c) => !c.email || !c.telefoon || !c.naam)) continue; }
        else if (filter.value !== "alle" && b.status !== filter.value) continue;
        const tekst = [b.naam, ...cs.flatMap((c) => [c.naam, c.email])].join(" ").toLowerCase();
        if (q && !tekst.includes(q)) continue;
        rijen.push(el("tr", { class: "klik", onclick: () => bewerkBedrijf(b, cs) },
          el("td", {}, el("strong", { text: b.naam }), el("div", { class: "hint", text: [b.adres, b.plaats].filter(Boolean).join(", ") })),
          el("td", {}, cs.map((c) => el("div", {}, c.naam || pil("naam ontbreekt", "let"), c.primair ? null : [" ", pil("geen mail")], c.actief ? null : [" ", pil("inactief")]))),
          el("td", {}, cs.map((c) => el("div", {}, c.email || pil("ontbreekt", "let")))),
          el("td", {}, cs.map((c) => el("div", {}, c.telefoon || pil("ontbreekt", "let")))),
          el("td", {}, pil(b.status, b.status === "lid" ? "goed" : b.status === "opgezegd" ? "fout" : ""))));
      }
      tbody.replaceChildren(...(rijen.length ? rijen : [el("tr", {}, el("td", { colspan: 5, text: "Niets gevonden." }))]));
      telling.textContent = `${rijen.length} bedrijven`;
    }
    const telling = el("span", { class: "hint" });
    zoek.addEventListener("input", teken); filter.addEventListener("change", teken);

    function bewerkBedrijf(b, cs) {
      const isNieuw = !b;
      b = b ?? { naam: "", adres: "", postcode: "", plaats: "Ter Apel", kvk: "", branche: "", website: "", factuur_email: "", lid_sinds: String(new Date().getFullYear()), status: "lid", notitie: "", toon_in_ledenoverzicht: false };
      cs = cs ?? [];
      const f = Object.fromEntries(["naam", "adres", "postcode", "plaats", "kvk", "branche", "website", "factuur_email", "lid_sinds"].map((k) => [k, tekstInvoer(b[k])]));
      f.status = el("select", { id: id() }, ["lid", "partner", "opgezegd"].map((s) => el("option", { value: s, text: s, selected: b.status === s })));
      f.notitie = el("textarea", { id: id() }, b.notitie ?? "");
      const contactRijen = [...cs, ...(isNieuw ? [{ naam: "", email: "", telefoon: "", functie: "", primair: true, actief: true, _nieuw: true }] : [])].map((c) => ({
        c, naam: tekstInvoer(c.naam), email: el("input", { type: "email", id: id(), value: c.email ?? "" }), telefoon: el("input", { type: "tel", id: id(), value: c.telefoon ?? "" }),
        functie: tekstInvoer(c.functie), primair: el("input", { type: "checkbox", id: id(), checked: c.primair }), actief: el("input", { type: "checkbox", id: id(), checked: c.actief }),
      }));
      const contactenDiv = el("div");
      const tekenContacten = () => contactenDiv.replaceChildren(...contactRijen.map((r) => el("fieldset", { style: "border:1px solid var(--lijn);padding:12px;margin:0 0 10px" },
        el("legend", { class: "label", text: r.c._nieuw ? "Nieuwe contactpersoon" : "Contactpersoon" }),
        el("div", { class: "rooster" }, veld("Naam", r.naam), veld("Functie", r.functie), veld("E-mail", r.email), veld("06-nummer", r.telefoon)),
        el("label", { style: "display:flex;gap:8px;align-items:center;margin-top:8px" }, r.primair, "Ontvangt de uitnodigingen"),
        el("label", { style: "display:flex;gap:8px;align-items:center" }, r.actief, "Actief"))));
      tekenContacten();
      const extra = el("button", { type: "button", class: "knop klein tweede", text: "Contactpersoon toevoegen", onclick: () => {
        const c = { naam: "", email: "", telefoon: "", functie: "", primair: true, actief: true, _nieuw: true };
        contactRijen.push({ c, naam: tekstInvoer(""), email: el("input", { type: "email", id: id() }), telefoon: el("input", { type: "tel", id: id() }), functie: tekstInvoer(""), primair: el("input", { type: "checkbox", id: id(), checked: true }), actief: el("input", { type: "checkbox", id: id(), checked: true }) });
        tekenContacten();
      } });
      const uit = el("div");
      const knop = el("button", { type: "submit", class: "knop", text: "Opslaan" });
      const form = el("form", { method: "dialog" },
        el("h2", { text: isNieuw ? "Nieuw lid" : b.naam }),
        el("div", { class: "rooster" }, el("div", { class: "breed" }, veld("Bedrijfsnaam", f.naam)), veld("Adres", f.adres), veld("Postcode", f.postcode), veld("Plaats", f.plaats), veld("Status", f.status),
          veld("KvK", f.kvk), veld("Branche", f.branche), veld("Website", f.website), veld("Factuur-e-mail", f.factuur_email), veld("Lid sinds", f.lid_sinds), el("div", { class: "breed" }, veld("Notitie", f.notitie))),
        el("h3", { text: "Contactpersonen", style: "margin-top:16px" }), contactenDiv, extra,
        el("div", { class: "balk" }, knop, el("button", { type: "button", class: "knop tweede", text: "Annuleren", onclick: () => dlg.close() })), uit);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        uit.replaceChildren();
        await bezig(knop, async () => {
          const rij = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value.trim() || null]));
          rij.status = f.status.value;
          if (!rij.naam) return uit.append(melding("fout", "Bedrijfsnaam is verplicht."));
          if (rij.status === "opgezegd" && b.status !== "opgezegd") rij.opgezegd_op = new Date().toISOString().slice(0, 10);
          const { data: opgeslagen, error } = isNieuw ? await sb.from("bedrijven").insert(rij).select("id").single() : await sb.from("bedrijven").update(rij).eq("id", b.id).select("id").single();
          if (error) return uit.append(melding("fout", "Opslaan lukte niet."));
          for (const r of contactRijen) {
            const c = { naam: r.naam.value.trim(), email: r.email.value.trim().toLowerCase() || null, telefoon: r.telefoon.value.trim() || null, functie: r.functie.value.trim() || null, primair: r.primair.checked, actief: r.actief.checked };
            if (r.c._nieuw && !c.naam && !c.email) continue;
            const { error: e2 } = r.c._nieuw ? await sb.from("contactpersonen").insert({ ...c, bedrijf_id: opgeslagen.id }) : await sb.from("contactpersonen").update(c).eq("id", r.c.id);
            if (e2) return uit.append(melding("fout", `Contactpersoon ${c.naam || c.email} opslaan lukte niet${e2.message?.includes("email_vorm") ? ": e-mailadres klopt niet" : ""}.`));
          }
          dlg.close();
          ledenScherm();
        })();
      });
      dlg.replaceChildren(kaart(form));
      dlg.showModal();
    }

    inhoud.replaceChildren(kaart(
      el("div", { class: "balk" }, el("h1", { text: "Leden", style: "margin:0;flex:1" }),
        el("button", { type: "button", class: "knop tweede klein", text: "Lijst downloaden", onclick: () => download("ledenlijst-industriekring.csv", csv([["Bedrijf", "Status", "Adres", "Postcode", "Plaats", "Lid sinds", "Contactpersoon", "Functie", "E-mail", "06", "Ontvangt uitnodiging"],
          ...(bedrijven ?? []).flatMap((b) => (perBedrijf.get(b.id) ?? [{}]).map((c) => [b.naam, b.status, b.adres, b.postcode, b.plaats, b.lid_sinds, c.naam, c.functie, c.email, c.telefoon, c.primair ? "ja" : "nee"]))])) }),
        el("button", { type: "button", class: "knop klein", text: "Nieuw lid", onclick: () => bewerkBedrijf(null, null) })),
      el("div", { class: "balk" }, zoek, filter, telling),
      el("div", { class: "scroll" }, el("table", { class: "tabel" }, el("thead", {}, el("tr", {}, ["Bedrijf", "Contactpersoon", "E-mail", "06-nummer", "Status"].map((h) => el("th", { text: h })))), tbody))));
    teken();
  }

  // ------------------------------------------------------------------ aanvragen
  async function aanvragenScherm() {
    const { data } = await sb.from("lidmaatschapsaanvragen").select("*").order("aangemaakt_op", { ascending: false }).limit(100);
    const uit = el("div", { "aria-live": "polite" }, neem("aanvragen"));
    const kaartjes = (data ?? []).map((a) => {
      const velden = [["Contactpersoon", `${a.contactpersoon}${a.functie ? ` (${a.functie})` : ""}`], ["E-mail", a.email], ["Telefoon", a.telefoon], ["Adres", [a.adres, a.postcode, a.plaats].filter(Boolean).join(", ")], ["KvK", a.kvk], ["Branche", a.branche], ["Website", a.website], ["Hoe bekend", a.hoe_bekend], ["Opmerking", a.opmerking], ["In ledenoverzicht", a.toestemming_ledenoverzicht ? "ja" : "nee"]].filter(([, v]) => v);
      const knoppen = a.status === "nieuw" ? el("div", { class: "balk" },
        bevestigKnop("Goedkeuren", "Zeker? Klik nogmaals", async () => { try { const r = await actie({ actie: "aanvraag_goedkeuren", aanvraag_id: a.id }); bewaar("aanvragen", "goed", `${a.bedrijfsnaam} is toegevoegd als lid. Welkomstmail: ${({ verzonden: "verstuurd", test: "alleen gelogd (testmodus)", fout: "mislukt" })[r.welkomstmail] ?? r.welkomstmail}.`); aanvragenScherm(); } catch (e) { uit.replaceChildren(melding("fout", e.message)); } }),
        bevestigKnop("Afwijzen", "Zeker? Klik nogmaals", async () => { try { await actie({ actie: "aanvraag_afwijzen", aanvraag_id: a.id }); aanvragenScherm(); } catch (e) { uit.replaceChildren(melding("fout", e.message)); } }, "knop tweede")) : null;
      return kaart(el("div", { class: "balk", style: "margin-top:0" }, el("h2", { text: a.bedrijfsnaam, style: "margin:0;flex:1" }), pil(a.status, a.status === "goedgekeurd" ? "goed" : a.status === "afgewezen" ? "fout" : "let")),
        el("p", { class: "hint", text: `Ontvangen ${new Date(a.aangemaakt_op).toLocaleString("nl-NL")}` }),
        el("table", { class: "tabel" }, el("tbody", {}, velden.map(([k, v]) => el("tr", {}, el("th", { text: k, style: "width:180px;position:static" }), el("td", { text: v }))))), knoppen);
    });
    inhoud.replaceChildren(kaart(el("h1", { text: "Aanmeldingen als lid" }), el("p", { text: "Aanmeldingen via het formulier op de website. Bij goedkeuren wordt het bedrijf lid en krijgt de contactpersoon een welkomstmail." }), uit),
      ...(kaartjes.length ? kaartjes : [kaart(el("p", { text: "Nog geen aanmeldingen." }))]).map((k) => el("div", { style: "margin-top:16px" }, k)));
  }

  // ------------------------------------------------------------------ instellingen
  async function instellingenScherm() {
    const [{ data: rijen }, { data: beheerders }, { data: toegestaan }] = await Promise.all([
      sb.from("instellingen").select("*").order("sleutel"),
      sb.from("beheerders").select("naam, email"),
      sb.from("beheerder_toegestaan").select("naam, email").order("naam"),
    ]);
    const m = Object.fromEntries((rijen ?? []).map((r) => [r.sleutel, r.waarde]));
    const uit = el("div", { "aria-live": "polite" });
    const f = {
      testmodus: el("select", { id: id() }, [["true", "Aan: alleen naar testadressen"], ["false", "Uit: mails gaan naar leden"]].map(([v, t]) => el("option", { value: v, text: t, selected: String(m.testmodus) === v }))),
      test_ontvangers: tekstInvoer((m.test_ontvangers ?? []).join(", ")),
      afzender_naam: tekstInvoer(m.afzender?.naam), afzender_email: el("input", { type: "email", id: id(), value: m.afzender?.email ?? "" }),
      antwoord_aan: el("input", { type: "email", id: id(), value: m.antwoord_aan ?? "" }),
      site_url: el("input", { type: "url", id: id(), value: m.site_url ?? "" }),
      adres_footer: tekstInvoer(m.adres_footer),
      meldingen_bestuur: tekstInvoer((m.meldingen_bestuur ?? []).join(", ")),
      max_per_run: el("input", { type: "number", id: id(), min: 1, max: 300, value: m.max_per_run ?? 120 }),
    };
    const lijst = (s) => s.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const knop = el("button", { type: "submit", class: "knop", text: "Instellingen opslaan" });
    const form = el("form", {},
      el("div", { class: "rooster" },
        el("div", { class: "breed" }, veld("Testmodus", f.testmodus, "Zolang de testmodus aan staat, gaat er niets naar leden.")),
        el("div", { class: "breed" }, veld("Testadressen", f.test_ontvangers, "Gescheiden door komma's. Krijgen in testmodus wel de mails, en altijd de proefmails.")),
        veld("Naam afzender", f.afzender_naam), veld("E-mail afzender", f.afzender_email, "Moet bij Brevo geverifieerd zijn."),
        veld("Antwoorden naar", f.antwoord_aan), veld("Maximaal per verzendronde", f.max_per_run),
        el("div", { class: "breed" }, veld("Adres van deze pagina's", f.site_url)),
        el("div", { class: "breed" }, veld("Afzenderregel onder elke mail", f.adres_footer)),
        el("div", { class: "breed" }, veld("Melding bij nieuwe lidaanvraag naar", f.meldingen_bestuur))),
      el("div", { class: "balk" }, knop), uit);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await bezig(knop, async () => {
        const nieuw = {
          testmodus: f.testmodus.value === "true", test_ontvangers: lijst(f.test_ontvangers.value),
          afzender: { naam: f.afzender_naam.value.trim(), email: f.afzender_email.value.trim().toLowerCase() },
          antwoord_aan: f.antwoord_aan.value.trim().toLowerCase(), site_url: f.site_url.value.trim().replace(/\/+$/, ""),
          adres_footer: f.adres_footer.value.trim(), meldingen_bestuur: lijst(f.meldingen_bestuur.value),
          max_per_run: Math.min(300, Math.max(1, Number(f.max_per_run.value) || 120)),
        };
        for (const [sleutel, waarde] of Object.entries(nieuw)) {
          const { error } = await sb.from("instellingen").update({ waarde }).eq("sleutel", sleutel);
          if (error) return uit.replaceChildren(melding("fout", `Opslaan van ${sleutel} lukte niet.`));
        }
        uit.replaceChildren(melding("goed", "Opgeslagen."));
        try { status = await actie({ actie: "status" }); toonStatus(); } catch { /* laat staan */ }
      })();
    });

    const nieuweNaam = tekstInvoer(""), nieuwEmail = el("input", { type: "email", id: id() });
    const toevoegen = el("button", { type: "submit", class: "knop klein", text: "Toegang geven" });
    const beheerForm = el("form", {}, el("div", { class: "rooster" }, veld("Naam", nieuweNaam), veld("E-mail", nieuwEmail)), toevoegen);
    const beheerUit = el("div", {}, neem("beheerders"));
    beheerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await bezig(toevoegen, async () => {
        try {
          await actie({ actie: "beheerder_toevoegen", naam: nieuweNaam.value.trim(), email: nieuwEmail.value.trim().toLowerCase() });
          bewaar("beheerders", "goed", "Toegevoegd. Diegene kan nu inloggen op deze pagina met dit e-mailadres.");
          instellingenScherm();
        } catch (err) { beheerUit.replaceChildren(melding("fout", err.message)); }
      })();
    });

    inhoud.replaceChildren(
      kaart(el("h1", { text: "Instellingen" }), form),
      el("div", { style: "margin-top:16px" }, kaart(el("h2", { text: "Wie mag beheren" }),
        el("table", { class: "tabel" }, el("tbody", {}, (toegestaan ?? []).map((t) => el("tr", {}, el("td", { text: t.naam }), el("td", { text: t.email }),
          el("td", {}, (beheerders ?? []).some((b) => b.email === t.email) ? pil("heeft ingelogd", "goed") : pil("nog niet ingelogd")),
          el("td", {}, t.email === sessie.user.email?.toLowerCase() ? el("span", { class: "hint", text: "dat ben jij" }) :
            bevestigKnop("Toegang intrekken", "Zeker? Klik nogmaals", async () => {
              const { error } = await sb.from("beheerder_toegestaan").delete().eq("email", t.email);
              if (error) beheerUit.replaceChildren(melding("fout", "Intrekken lukte niet.")); else instellingenScherm();
            }, "knop klein tweede")))))),
        el("h3", { text: "Iemand toegang geven", style: "margin-top:16px" }), beheerForm, beheerUit)));
  }

  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_IN" || event === "SIGNED_OUT") start(); });
  start();
})();
