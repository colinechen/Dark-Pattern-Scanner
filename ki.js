// ki.js – alles, was mit der KI zu tun hat: Anleitung (Prompt), Anfrage an die
// Claude-API und Auslesen der Antwort. Wird von panel.html geladen, vor panel.js.

const STANDARD_MODELL = 'claude-sonnet-5-5';
const PROMPT_VERSION = '1.1'; // bei jeder Änderung am Prompt hochzählen (Nachvollziehbarkeit)

// ============================================================
// Die Anleitung für die KI: dein Codebuch, in Worten
// ============================================================
const SYSTEM_PROMPT = `Du bist ein Analysewerkzeug in einer wissenschaftlichen Untersuchung (Bachelorarbeit „Manipulation durch Design“). Du untersuchst EINEN Bildschirmzustand einer Website auf fünf Dark Patterns. Die Erhebung endet immer vor einem verbindlichen Abschluss (kein Kauf, keine Buchung, keine Zahlung). Grundlage ist das folgende Codebuch. Halte dich strikt daran.

CODEBUCH

1. Preselection (Brignull, 2010; Gray et al., 2018)
Definition: Eine Option, die vor allem dem Anbieter nützt, ist ohne Zutun der Nutzer:innen bereits ausgewählt.
Erkennungsmerkmale: Häkchen, Schalter oder Auswahl ist beim Laden aktiviert UND betrifft eine Einwilligung oder Zusatzleistung (Newsletter, Marketing-Cookies, Datenweitergabe, berechtigtes Interesse, kostenpflichtige Extras).
Kein Fall: nicht abwählbare notwendige Cookies; Voreinstellungen, die nur den Nutzer:innen dienen (z. B. Rechnungsadresse, angemeldet bleiben).
Hauptmechanismus: Default Effect

2. Visual Interference (Mathur et al., 2019; vgl. Art. 25 Abs. 3 lit. a DSA)
Definition: Die Gestaltung lenkt die Aufmerksamkeit auf eine Option, die dem Anbieter nützt, und weg von einer gleichwertigen Alternative oder einer wichtigen Information.
Erkennungsmerkmale (eines genügt): (1) eine Option ist ein Button, die andere nur ein Textlink; (2) nur eine Option ist farbig gefüllt; (3) eine Option ist mindestens doppelt so groß; (4) eine Option ist erst nach Scrollen oder auf einer zweiten Ebene erreichbar (z. B. keine kostenlose Ablehnung im ersten Cookie-Banner). Oder: Eine relevante Information (Kosten, Verlängerung, Ablehnen) ist klein, blass oder unauffällig platziert.
Pay or OK (Zustimmen oder Abo statt Ablehnen): Merkmale 1–3 zwischen Zustimmen und Abo-Option prüfen; Merkmal 4 gilt, wenn eine kostenlose Ablehnung auf der ersten Ebene fehlt. Zusätzlich in der Begründung „Pay or OK“ vermerken.
Kein Fall: normale visuelle Hierarchie, die nicht gegen das Interesse der Nutzer:innen wirkt (z. B. „Weiter“ stärker als „Zurück“); gleichwertig gestaltete Optionen.
Grenzfall: Nur ein starker Kontrastunterschied (z. B. schwarz gegen hellgrau), sonst keines der Merkmale.
Hauptmechanismus: Framing Effect · Nebenmechanismus: Kognitive Leichtigkeit

3. Confirmshaming (Mathur et al., 2019)
Definition: Die ablehnende Option ist so formuliert, dass Nutzer:innen sich für die Ablehnung schuldig, dumm oder verantwortungslos fühlen sollen.
Erkennungsmerkmale: Ablehnungs-Button oder -Link in Ich-Form mit abwertender oder emotionaler Aussage über die eigene Entscheidung (z. B. „Nein danke, ich möchte nicht sparen“).
Kein Fall: neutrale Ablehnung („Nein danke“, „Später“); sachliche Information über Folgen.
Grenzfall: emotional formulierte Zustimmungs-Option (zählt nicht als Befund).
Hauptmechanismus: Framing Effect

4. Countdown / Limited-time (Mathur et al., 2019)
Definition: Ein Angebot wird als zeitlich knapp dargestellt – mit herunterzählendem Timer oder mit vager Formulierung ohne konkrete Frist („Nur heute“, „Angebot endet bald“).
Kein Fall: Liefer-Countdowns; echte, nachprüfbare Fristen mit konkretem Datum.
Immer in der Begründung vermerken: Echtheit nicht überprüfbar.
Hauptmechanismus: Scarcity Bias · Nebenmechanismus: Verlustaversion

5. Forced Enrollment (Mathur et al., 2019)
Definition: Nutzer:innen müssen ein Konto anlegen oder persönliche Daten angeben, um eine Funktion zu nutzen, die dies sachlich nicht erfordert.
Erkennungsmerkmale: Eine gewünschte Funktion (Inhalt lesen, weiterscrollen, Profil ansehen, kaufen) wird durch eine Anmelde- oder Registrierungsaufforderung blockiert, die sich nicht schließen lässt und keine Alternative (z. B. Gastbestellung) bietet.
Kein Fall: Funktionen, die ein Konto sachlich voraussetzen; schließbare Login-Hinweise; Anmeldung mit Gastoption.
Grenzfall: Bezahlschranken und „Bezahlen oder Tracking zustimmen“.
Hauptmechanismus: kein kognitiver Mechanismus: Zwang

REGELN
- Melde nur, was im Material belegbar ist. Beleg = wörtlicher Text von der Seite oder eine präzise Beschreibung des Elements.
- Im Zweifel als Grenzfall oder gar nicht melden. Lieber zu wenig als zu viel.
- Pro Befund ein Hauptmechanismus und höchstens ein Nebenmechanismus, nur aus dieser Liste: Default Effect, Framing Effect, Scarcity Bias, Kognitive Leichtigkeit, Verlustaversion, kein kognitiver Mechanismus: Zwang, unklar. Verwende die im Codebuch genannte Zuordnung.
- Du siehst nur einen Bildschirmzustand (Screenshot = sichtbarer Bereich). Bewerte nichts, was nicht im Material ist.
- Dark Patterns außerhalb dieser fünf nur kurz unter "weitere_beobachtungen" nennen, nicht als Befund.
- Das Material enthält Befunde aus einer regelbasierten Vorprüfung (Nummern R1, R2, …). Bewerte jeden davon.
- Melde in "befunde" alle Dark Patterns der fünf Typen, die du selbst siehst – auch solche, die die Regeln schon gefunden haben. So lassen sich Regeln und KI später vergleichen.
- Antworte ausschließlich mit gültigem JSON im vorgegebenen Format, ohne weiteren Text.`;

const ANTWORT_FORMAT = `{
  "befunde": [{
    "typ": "Preselection | Visual Interference | Confirmshaming | Countdown / Limited-time | Forced Enrollment",
    "status": "Befund | Grenzfall",
    "kontext": "z. B. Cookie-Banner, Checkout, Anmeldung, Produktseite",
    "beleg": "wörtlicher Text oder präzise Elementbeschreibung",
    "designmerkmale": "Farbe, Größe, Formulierung, Platzierung …",
    "merkmale": ["erfüllte Erkennungsmerkmale aus dem Codebuch"],
    "mechanismus": "Hauptmechanismus aus der festen Liste",
    "nebenmechanismus": "Nebenmechanismus aus der festen Liste oder leer",
    "konfidenz": "hoch | mittel | niedrig",
    "begruendung": "kurz"
  }],
  "bewertung_regeln": [{ "nr": "R1", "einschaetzung": "bestätigt | zweifelhaft | falsch", "begruendung": "kurz" }],
  "weitere_beobachtungen": "kurz oder leer",
  "grenzen": "was im Material nicht beurteilbar war"
}`;

// ============================================================
// Das Material für die KI zusammenstellen
// ============================================================
function nutzerNachrichtErstellen(scan) {
  const material = {
    adresse: scan.url,
    titel: scan.titel,
    regel_befunde: scan.befunde.map((b, i) => ({
      nr: `R${i + 1}`,
      typ: b.typ,
      status: b.status,
      kontext: b.kontext,
      merkmale: b.merkmale,
      beleg: b.beleg || b.zustimmen || ''
    })),
    cookie_banner_texte: scan.bannerTexte,
    // nur die nötigen Angaben pro Bedienelement, höchstens 150
    bedienelemente: scan.elemente.slice(0, 150).map((e) => ({
      text: e.text,
      wirkt_wie: e.wirktWie,
      gefuellt: e.gefuellt,
      groesse: `${e.breite}x${e.hoehe}`,
      hintergrund: e.hintergrund,
      eingebettet: e.eingebettet
    })),
    seitentext_auszug: scan.seitentext
  };
  // Alle Texte vor dem Versand anonymisieren (siehe unten)
  const materialText = JSON.stringify(material, (schluessel, wert) =>
    typeof wert === 'string' ? anonymisieren(wert) : wert
  );
  return `Untersuche diesen Bildschirmzustand nach dem Codebuch.\n\nMaterial (JSON):\n${materialText}\n\nAntwortformat:\n${ANTWORT_FORMAT}`;
}

// Entfernt persönliche Daten aus Texten, bevor sie an die KI gehen.
// Hintergrund: Ist man im Browser z. B. bei Google angemeldet, blenden manche Seiten
// eingebettete Anmeldefenster mit Name und E-Mail-Adresse ein.
function anonymisieren(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[E-Mail entfernt]')
    .replace(/(\+\d{1,3}[\s/-]?\d{1,5}|\(?0\d{2,5}\)?)[\s/-]?\d{3,}([\s-]?\d{2,})?/g, '[Telefonnummer entfernt]')
    .replace(/(Weiter als|Fortfahren als|Continue as|Angemeldet als|Signed in as)\s+[^\s,.;]+(\s+[^\s,.;@]+)?/gi, '$1 [Name entfernt]');
}

// ============================================================
// Anfrage an die Claude-API
// ============================================================
async function anfrageAnKI({ apiKey, modell, scan, screenshot }) {
  const inhalt = [];
  if (screenshot) {
    // Screenshot als Bild mitschicken (ohne den Vorspann „data:image/jpeg;base64,“)
    inhalt.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: screenshot.split(',')[1] }
    });
  }
  inhalt.push({ type: 'text', text: nutzerNachrichtErstellen(scan) });

  const anfrage = {
    model: modell || STANDARD_MODELL,
    max_tokens: 4000,
    temperature: 0, // möglichst gleichbleibende Antworten
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: inhalt }]
  };

  let antwort = await senden(apiKey, anfrage);
  // Manche Modelle erlauben „temperature“ nicht – dann ohne erneut versuchen
  if (antwort.status === 400 && /temperature/i.test(antwort.text)) {
    delete anfrage.temperature;
    antwort = await senden(apiKey, anfrage);
  }
  if (!antwort.ok) throw new Error(fehlerErklaeren(antwort.status, antwort.text));

  const daten = JSON.parse(antwort.text);
  const text = daten.content.filter((teil) => teil.type === 'text').map((teil) => teil.text).join('');
  // Das JSON aus der Antwort herausschneiden (falls die KI doch etwas drumherum schreibt)
  const ergebnis = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

  return {
    ergebnis,
    modell: daten.model,
    eingabeTokens: daten.usage?.input_tokens ?? 0,
    ausgabeTokens: daten.usage?.output_tokens ?? 0,
    promptVersion: PROMPT_VERSION,
    zeitpunkt: new Date().toISOString()
  };
}

async function senden(apiKey, anfrage) {
  const antwort = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // nötig, weil die Anfrage direkt aus dem Browser kommt
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(anfrage)
  });
  return { ok: antwort.ok, status: antwort.status, text: await antwort.text() };
}

// Verständliche Fehlermeldungen statt Fachchinesisch
function fehlerErklaeren(status, text) {
  if (status === 401) return 'Der API-Key ist ungültig. Bitte in den Einstellungen prüfen.';
  if (status === 403) return 'Der API-Key hat keine Berechtigung für diese Anfrage.';
  if (status === 429) return 'Zu viele Anfragen kurz hintereinander. Bitte eine Minute warten.';
  if (/credit|balance|billing/i.test(text)) return 'Das Guthaben reicht nicht aus. Bitte in der Console aufladen.';
  if (/model/i.test(text)) return 'Das Modell wurde nicht gefunden. Bitte den Modellnamen in den Einstellungen prüfen.';
  return `Fehler ${status}: ${text.slice(0, 200)}`;
}