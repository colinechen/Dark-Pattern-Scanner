// analyse.js – läuft NICHT im Panel, sondern in der Website (und in jedem iframe).
// Der Wert am Ende dieser Datei wird an das Panel zurückgeschickt.
// „async“, weil das Tool kurz wartet, um zu prüfen, ob ein Timer herunterzählt.
(async () => {
  // ============================================================
  // Einstellungen: Suchmuster für Bedienelemente und Cookie-Banner
  // ============================================================
  const SELEKTOR = 'button, a[href], [role="button"], input[type="submit"], input[type="button"]';

  // Hinweise im Code, dass ein Bereich ein Cookie-Banner ist
  const BANNER_HINWEIS = /cookie|consent|gdpr|(^|[-_ ])cmp|privacy|datenschutz|usercentrics|onetrust|didomi|cookiebot|sp_message/i;
  // Wörter im Text eines Cookie-Banners
  const BANNER_TEXT = /cookie|einwillig|zustimm|datenschutz|tracking|consent|privacy/i;

  // Beschriftungen der Optionen (Ablehnen wird zuerst geprüft, weil z. B.
  // „Nur notwendige akzeptieren“ eine Ablehnung ist, obwohl „akzeptieren“ darin steht)
  const ABLEHNEN = /ablehn|verweiger|nur (notwendige|erforderliche|essenzielle|technisch)|ohne (zustimmung|einwilligung)|nicht zustimmen|reject|decline|deny|refuse|necessary only|only necessary|essential only|continue without/i;
  const ZUSTIMMEN = /akzeptier|annehm|zustimm|einwillig|einverstanden|geht klar|alles klar|klingt gut|ja,? gerne|los geht|got it|sounds good|zulassen|erlauben|accept|agree|allow|^ok$|^okay$|verstanden/i;
  // Option, bei der man statt zuzustimmen bezahlt („Pay or OK“)
  const BEZAHLEN = /abonnier|\babo\b|pur-abo|werbefrei|kostenpflichtig|subscribe/i;
  // Ablehnung, die nur für einen einzelnen Anbieter gilt (z. B. „für Utiq jetzt ablehnen“)
  const EINZELN = /\bfür\b|\bfor\b/i;
  // Hinweise auf eine Einstellungsebene (zweite Ebene) statt des ersten Banners
  const AUSWAHL_SPEICHERN = /ausgewählt\w* (zustimm|speicher|akzeptier|bestätig)|auswahl (speichern|bestätigen|übernehmen)|einstellungen (speichern|anwenden|übernehmen)|^speichern$|save (my )?(choices|preferences|settings|selection)|confirm (my )?choices|accept selected/i;
  const EINSTELLUNGEN = /einstellung|anpassen|optionen|auswahl|verwalten|individuell|details|settings|manage|customi|preferences|options/i;

  // --- Preselection (Codebuch Abschnitt 1) ---
  // Einwilligungen und Zusatzleistungen, die nicht vorausgewählt sein sollten
  const EINWILLIGUNG = /newsletter|werbung|marketing|angebot|partner|personalis|einwillig|zustimm|e-?mail|benachrichtig|tracking|analyse|statistik|drittanbieter|weitergabe|berechtigtes interesse|versicherung|garantie|schutzbrief|premium|upgrade|spende|zusatz|extra|consent|legitimate interest|offers|promotion|subscribe|insurance/i;
  // Abgrenzung: Voreinstellungen, die notwendig sind oder nur den Nutzer:innen dienen
  const AUSNAHME = /notwendig|erforderlich|essenziell|essentiell|technisch nötig|rechnungsadresse|lieferadresse|angemeldet bleiben|merken|remember me|strictly necessary/i;

  // --- Countdown / Limited-time Message (Codebuch Abschnitt 4) ---
  // Uhrzeit-ähnliche Zahlen wie 00:14:59 oder 14:59 (Kandidaten für einen Timer)
  const TIMER = /\b\d{1,2}\s?:\s?\d{2}(\s?:\s?\d{2})?\b|\b\d+\s?(std|h)\.?\s?\d+\s?(min|m)\b/i;
  // Vage Zeitdruck-Formulierungen ohne konkrete Frist
  const ZEITDRUCK = /nur (noch )?heute|nur für kurze zeit|endet bald|läuft bald ab|letzte chance|zeitlich begrenzt|nur noch kurz|angebot endet|endet in|limited time|ends soon|last chance|today only|ends in|while it lasts/i;
  // Abgrenzung: konkretes Datum (z. B. „bis 30.11.“ oder „bis 30. November“)
  const KONKRETES_DATUM = /\b\d{1,2}\.\s?\d{1,2}\.(\d{2,4})?|\b\d{1,2}\.\s?(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)/i;
  // Abgrenzung: Liefer-Countdowns
  const LIEFERUNG = /liefer|zustell|versand|versendet|delivery|shipping|dispatch/i;

  // ============================================================
  // Hilfsfunktionen
  // ============================================================

  // Shadow-DOM eines Elements holen – auch ein geschlossenes. Normale Skripte sehen nur
  // offene Shadow-DOMs; Erweiterungen dürfen über chrome.dom auch in geschlossene schauen.
  function schattenVon(el) {
    if (el.shadowRoot) return el.shadowRoot;
    try {
      return globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el) || null;
    } catch {
      return null;
    }
  }

  // Alle Elemente der Seite, auch die in Shadow-DOMs (viele Cookie-Tools nutzen sie)
  function alleElemente(wurzel) {
    const ergebnis = [];
    for (const el of wurzel.querySelectorAll('*')) {
      ergebnis.push(el);
      const schatten = schattenVon(el);
      if (schatten) ergebnis.push(...alleElemente(schatten));
    }
    return ergebnis;
  }

  // Liegt ein Element innerhalb eines anderen? (funktioniert auch über Shadow-DOM-Grenzen)
  function liegtIn(behaelter, el) {
    let knoten = el;
    while (knoten) {
      if (knoten === behaelter) return true;
      knoten = knoten.parentNode || knoten.host;
    }
    return false;
  }

  // Zerlegt eine CSS-Farbe wie „rgba(0, 0, 0, 0.5)“ in [Rot, Grün, Blau, Deckkraft]
  function farbwerte(farbe) {
    if (!farbe || farbe === 'transparent') return null;
    const zahlen = (farbe.match(/[\d.]+/g) || []).map(Number);
    if (zahlen.length < 3) return null;
    return [zahlen[0], zahlen[1], zahlen[2], zahlen.length >= 4 ? zahlen[3] : 1];
  }

  // Helligkeit einer Farbe von 0 (schwarz) bis 1 (weiß)
  function helligkeit(werte) {
    const [r, g, b] = werte.slice(0, 3).map((wert) => {
      const anteil = wert / 255;
      return anteil <= 0.03928 ? anteil / 12.92 : Math.pow((anteil + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Hintergrundfarbe der Umgebung: die erste deckende Farbe der umliegenden Elemente
  function umgebungsfarbe(el) {
    let knoten = el.parentNode;
    while (knoten) {
      if (knoten.nodeType === 11) knoten = knoten.host; // aus einem Shadow-DOM heraus
      if (!knoten || knoten.nodeType !== 1) break;
      const werte = farbwerte(getComputedStyle(knoten).backgroundColor);
      if (werte && werte[3] > 0.5) return werte;
      knoten = knoten.parentNode;
    }
    return [255, 255, 255, 1]; // nichts gefunden: weißer Seitenhintergrund
  }

  // Legt eine (teilweise durchsichtige) Farbe über die Umgebungsfarbe:
  // So sieht die Farbe für das Auge tatsächlich aus.
  function mischen(oben, unten) {
    const d = oben[3];
    return [0, 1, 2].map((i) => Math.round(oben[i] * d + unten[i] * (1 - d))).concat(1);
  }

  // Ist ein Element sichtbar (hat Größe, ist nicht ausgeblendet)?
  function istSichtbar(el) {
    const rahmen = el.getBoundingClientRect();
    return (
      rahmen.width > 0 &&
      rahmen.height > 0 &&
      el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    );
  }

  // Sieht ein Element gefüllt oder umrandet aus? Prüft auch Innenelemente,
  // die mindestens 80 % der Fläche ausfüllen (z. B. <a><div class="button">…</div></a>),
  // und das umgebende Element, wenn es kaum größer ist (Rahmen sitzt manchmal außen).
  // „Gefüllt“ heißt: Die Hintergrundfarbe hebt sich sichtbar von der Umgebung ab.
  function aussehenPruefen(el, rahmen) {
    const umgebung = umgebungsfarbe(el);
    const kandidaten = [el, ...Array.from(el.querySelectorAll('*')).slice(0, 20)];
    if (el.parentElement) kandidaten.push(el.parentElement);
    const flaeche = rahmen.width * rahmen.height;
    for (const kandidat of kandidaten) {
      const r = kandidat.getBoundingClientRect();
      const kFlaeche = r.width * r.height;
      if (kFlaeche < flaeche * 0.8 || kFlaeche > flaeche * 1.3) continue;
      const s = getComputedStyle(kandidat);

      const hintergrund = farbwerte(s.backgroundColor);
      let gefuellt = false;
      let effektiv = umgebung;
      if (hintergrund && hintergrund[3] > 0.02) {
        effektiv = mischen(hintergrund, umgebung);
        gefuellt = Math.abs(helligkeit(effektiv) - helligkeit(umgebung)) >= 0.03;
      }

      // Rahmen: als „border“ oder als Schatten-Linie („box-shadow“) gezeichnet
      const rand = farbwerte(s.borderTopColor);
      const schattenFarbe = s.boxShadow.match(/rgba?\([^)]*\)/); // nur die Farbe aus dem Schatten
      const schatten = schattenFarbe ? farbwerte(schattenFarbe[0]) : null;
      const umrandet =
        // > 0 statt >= 1: Bei Bildschirm-Skalierung (z. B. 125 % unter Windows) meldet Chrome
        // einen 1-Pixel-Rahmen als 0,8 Pixel
        (parseFloat(s.borderTopWidth) > 0 &&
          s.borderTopStyle !== 'none' &&
          rand !== null &&
          rand[3] > 0.1) ||
        (s.boxShadow !== 'none' && schatten !== null && schatten[3] > 0.1);

      if (gefuellt || umrandet) {
        return {
          gefuellt,
          umrandet,
          hintergrund: `rgb(${effektiv[0]}, ${effektiv[1]}, ${effektiv[2]})`,
          helligkeit: helligkeit(effektiv)
        };
      }
    }
    return { gefuellt: false, umrandet: false, hintergrund: 'transparent', helligkeit: helligkeit(umgebung) };
  }

  // Text, der direkt in einem Element steht (ohne den Text seiner Unterelemente)
  function eigenerText(el) {
    let text = '';
    for (const knoten of el.childNodes) {
      if (knoten.nodeType === 3) text += knoten.textContent;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  // Beschriftung eines Häkchens oder Schalters finden
  function beschriftungVon(el) {
    const label = (el.labels && el.labels[0]) || el.closest('label');
    const text =
      (label && label.innerText) ||
      el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') &&
        document.getElementById(el.getAttribute('aria-labelledby'))?.innerText) ||
      (el.parentElement && el.parentElement.innerText) ||
      '';
    return { text: text.replace(/\s+/g, ' ').trim().slice(0, 200), label };
  }

  // Text der näheren Umgebung: bis zu zwei Ebenen nach oben, solange der Text kurz bleibt
  // (sonst würde z. B. der Text der ganzen Seite als „Umgebung“ zählen)
  function umgebungsText(el) {
    let text = el.innerText || '';
    let knoten = el.parentElement;
    for (let ebene = 0; ebene < 2 && knoten; ebene++) {
      const t = knoten.innerText || '';
      if (t.length > 300) break;
      text = t;
      knoten = knoten.parentElement;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  // Grober Kontext aus der Adresse der Seite
  function seitenKontext() {
    const adresse = location.href.toLowerCase();
    if (/checkout|kasse|warenkorb|cart|basket|payment|bezahl|bestell|booking|buchung/.test(adresse)) return 'Checkout / Buchung';
    if (/login|anmeld|registr|signup|sign-up|account|konto/.test(adresse)) return 'Anmeldung / Konto';
    return 'Seite';
  }

  // ============================================================
  // Markierungen auf der Seite
  // ============================================================

  // Alte Markierungen vom letzten Scan entfernen
  for (const markierung of window.__dpMarkierungen || []) {
    markierung.element.style.outline = markierung.alterRahmen;
    markierung.etikett.remove();
  }
  window.__dpMarkierungen = [];

  function markieren(el, beschriftung, farbe, gestrichelt) {
    const rahmen = el.getBoundingClientRect();
    const etikett = document.createElement('div');
    etikett.textContent = beschriftung;
    etikett.style.cssText =
      `position:absolute;left:${rahmen.left + scrollX}px;top:${Math.max(0, rahmen.top + scrollY - 20)}px;` +
      `background:${farbe};color:#fff;font:bold 11px/18px sans-serif;padding:0 6px;` +
      'border-radius:3px;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(etikett);
    window.__dpMarkierungen.push({ element: el, alterRahmen: el.style.outline, etikett });
    el.style.outline = `3px ${gestrichelt ? 'dashed' : 'solid'} ${farbe}`;
  }

  // ============================================================
  // 1. Alle sichtbaren Bedienelemente sammeln (wie in Etappe 4)
  // ============================================================
  const alle = alleElemente(document);
  const bedienelemente = []; // { el, daten }
  let versteckt = 0;

  for (const el of alle) {
    if (!el.matches(SELEKTOR)) continue;
    if (el.parentElement && el.parentElement.closest(SELEKTOR)) continue;

    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;

    if (!istSichtbar(el)) {
      versteckt++;
      continue;
    }

    const rahmen = el.getBoundingClientRect();
    const stil = getComputedStyle(el);
    const aussehen = aussehenPruefen(el, rahmen);

    bedienelemente.push({
      el,
      daten: {
        text: text.slice(0, 80),
        codeTyp: el.tagName.toLowerCase(),
        wirktWie: aussehen.gefuellt || aussehen.umrandet ? 'Button' : 'Text',
        gefuellt: aussehen.gefuellt,
        umrandet: aussehen.umrandet,
        breite: Math.round(rahmen.width),
        hoehe: Math.round(rahmen.height),
        hintergrund: aussehen.hintergrund,
        helligkeit: aussehen.helligkeit,
        schriftgroesse: stil.fontSize,
        quelle: location.hostname,
        eingebettet: window !== window.top
      }
    });
  }

  // ============================================================
  // 2. Cookie-Banner finden
  // ============================================================
  let banner = [];

  for (const el of alle) {
    const signatur = `${el.id} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute('aria-label') || ''}`;
    const position = getComputedStyle(el).position;
    const istKandidat =
      BANNER_HINWEIS.test(signatur) ||
      el.getAttribute('role') === 'dialog' ||
      el.getAttribute('aria-modal') === 'true' ||
      position === 'fixed' ||
      position === 'sticky';
    if (!istKandidat || !istSichtbar(el)) continue;

    const text = el.innerText || '';
    if (text.length > 4000 || !BANNER_TEXT.test(text)) continue;

    // Ein Cookie-Banner muss eine Zustimmungs- oder Ablehnungs-Option enthalten
    const enthaeltOption = bedienelemente.some(
      (b) => liegtIn(el, b.el) && (ZUSTIMMEN.test(b.daten.text) || ABLEHNEN.test(b.daten.text))
    );
    if (enthaeltOption) banner.push(el);
  }
  // Nur die äußersten Kandidaten behalten (sonst würde dasselbe Banner mehrfach gezählt)
  banner = banner.filter((b) => !banner.some((anderer) => anderer !== b && liegtIn(anderer, b)));

  // Sonderfall: Das Cookie-Banner ist ein eigenes iframe (typisch für Cookie-Anbieter).
  // Dann ist die ganze eingebettete Seite das Banner – auch wenn darin schon ein
  // Teilbereich gefunden wurde, der vielleicht nicht alle Optionen enthält.
  if (window !== window.top && document.body) {
    const enthaeltOption = bedienelemente.some(
      (b) => ZUSTIMMEN.test(b.daten.text) || ABLEHNEN.test(b.daten.text)
    );
    const text = document.body.innerText || '';
    if (enthaeltOption && BANNER_TEXT.test(text) && text.length < 8000) banner = [document.body];
  }

  // ============================================================
  // 3. Visual Interference nach Codebuch prüfen
  // ============================================================
  const befunde = [];

  for (const b of banner.slice(0, 3)) {
    const optionen = bedienelemente.filter((x) => liegtIn(b, x.el));
    // Allgemeine Ablehnung – Ablehnungen für einzelne Anbieter zählen nicht
    const ablehnen = optionen.find((x) => ABLEHNEN.test(x.daten.text) && !EINZELN.test(x.daten.text));
    const teilAblehnung = optionen.find((x) => ABLEHNEN.test(x.daten.text) && EINZELN.test(x.daten.text));
    let zustimmen = optionen.find((x) => !ABLEHNEN.test(x.daten.text) && ZUSTIMMEN.test(x.daten.text));
    let zustimmenUeberGestaltung = false;
    // Unbekannte Beschriftung (z. B. „Geht klar“)? Dann gilt die auffälligste gefüllte Option,
    // die weder Ablehnen noch Einstellungen noch Abo ist, als Zustimmen.
    if (!zustimmen) {
      const uebrige = optionen.filter(
        (x) =>
          x.daten.gefuellt &&
          !ABLEHNEN.test(x.daten.text) &&
          !EINSTELLUNGEN.test(x.daten.text) &&
          !BEZAHLEN.test(x.daten.text)
      );
      uebrige.sort((a, b) => b.daten.breite * b.daten.hoehe - a.daten.breite * a.daten.hoehe);
      zustimmen = uebrige[0];
      zustimmenUeberGestaltung = Boolean(zustimmen);
    }
    if (!zustimmen) continue; // ohne Zustimmen-Option keine Prüfung möglich
    const bezahlen = optionen.find(
      (x) => x !== ablehnen && x !== teilAblehnung && x !== zustimmen && BEZAHLEN.test(x.daten.text)
    );
    const einstellungen = optionen.find(
      (x) => x !== ablehnen && x !== zustimmen && x !== bezahlen && EINSTELLUNGEN.test(x.daten.text)
    );

    // Einstellungsebene erkennen: viele einzelne Zustimmen/Ablehnen-Knöpfe, Schalter
    // oder ein Knopf zum Speichern der Auswahl. Dort passen die vier Merkmale (noch) nicht.
    const zweckKnoepfe = optionen.filter((x) => ZUSTIMMEN.test(x.daten.text) || ABLEHNEN.test(x.daten.text));
    const schalter = alle.filter(
      (x) => liegtIn(b, x) && x.matches('input[type="checkbox"], [role="switch"], [role="checkbox"]')
    );
    const istEinstellungsebene =
      zweckKnoepfe.length >= 4 || schalter.length >= 2 || optionen.some((x) => AUSWAHL_SPEICHERN.test(x.daten.text));
    if (istEinstellungsebene) {
      befunde.push({
        typ: 'Visual Interference',
        kontext: 'Cookie-Einstellungen (2. Ebene)',
        status: 'nicht bewertet',
        merkmale: [],
        hinweise: [
          'Einstellungsebene erkannt – die automatische Prüfung ist für die erste Ebene gebaut. Bitte von Hand prüfen (geplant für eine spätere Ausbaustufe).'
        ],
        quelle: location.hostname,
        eingebettet: window !== window.top
      });
      continue;
    }

    const merkmale = []; // erfüllte Merkmale aus dem Codebuch
    const hinweise = []; // Grenzfälle und Beobachtungen
    let grenzfall = false;
    if (zustimmenUeberGestaltung) {
      hinweise.push(`Zustimmen-Option an der Gestaltung erkannt (Beschriftung „${zustimmen.daten.text}“ ist nicht in der Wortliste) – bitte prüfen`);
    }

    // Womit wird „Zustimmen“ verglichen? Mit „Ablehnen“ – oder, wenn es das nicht gibt,
    // mit der Abo-Option („Pay or OK“: Statt abzulehnen, bezahlt man).
    const alternative = ablehnen || bezahlen;
    const name = ablehnen ? 'Ablehnen' : 'Abo-Option';

    if (!ablehnen && teilAblehnung) {
      const versteckt = teilAblehnung.el.getBoundingClientRect().top > innerHeight ? ', erst nach Scrollen sichtbar' : '';
      hinweise.push(`Nur Teil-Ablehnung für einen einzelnen Anbieter gefunden: „${teilAblehnung.daten.text}“${versteckt}`);
    }
    if (!ablehnen && bezahlen) {
      hinweise.push('Pay or OK: Statt Ablehnen steht auf der ersten Ebene ein kostenpflichtiges Abo (laut Codebuch als Grenzfall notieren).');
    }

    if (alternative) {
      const z = zustimmen.daten;
      const a = alternative.daten;
      // Merkmal 1: Button gegenüber Textlink
      if (z.wirktWie === 'Button' && a.wirktWie === 'Text') {
        merkmale.push(`(1) Zustimmen wirkt wie Button, ${name} wie Text`);
      }
      // Merkmal 2: nur eine Option farbig gefüllt
      if (z.gefuellt && !a.gefuellt) {
        merkmale.push('(2) Nur Zustimmen ist farbig gefüllt');
      }
      // Merkmal 3: mindestens doppelt so groß
      const verhaeltnis = (z.breite * z.hoehe) / Math.max(1, a.breite * a.hoehe);
      if (verhaeltnis >= 2) {
        merkmale.push(`(3) Zustimmen ist ${verhaeltnis.toFixed(1)}-mal so groß wie ${name}`);
      }
      // Merkmal 4: Alternative erst nach Scrollen sichtbar
      const altRahmen = alternative.el.getBoundingClientRect();
      const zustimmenRahmen = zustimmen.el.getBoundingClientRect();
      if (altRahmen.top > innerHeight && zustimmenRahmen.top < innerHeight) {
        merkmale.push(`(4) ${name} ist erst nach Scrollen sichtbar`);
      }
      // Grenzfall: starker Kontrastunterschied (im Codebuch noch nicht entschieden)
      if (merkmale.length === 0 && z.gefuellt && a.gefuellt && Math.abs(z.helligkeit - a.helligkeit) >= 0.5) {
        grenzfall = true;
        hinweise.push(`Starker Kontrastunterschied zwischen Zustimmen und ${name} (Kontrast ist im Codebuch noch kein Merkmal)`);
      }
    }

    // Merkmal 4: keine kostenlose Ablehnen-Option auf der ersten Ebene –
    // gilt auch dann, wenn stattdessen ein Abo angeboten wird (Pay or OK)
    if (!ablehnen) {
      merkmale.push(
        '(4) Keine kostenlose Ablehnen-Option auf der ersten Ebene' +
          (einstellungen ? ` – nur über „${einstellungen.daten.text}“` : '')
      );
    }

    const status = merkmale.length > 0 ? 'Befund' : grenzfall ? 'Grenzfall' : 'kein Befund';

    const farbe = status === 'Befund' ? '#e5007d' : '#e08a00';
    if (status !== 'kein Befund') {
      markieren(zustimmen.el, status === 'Befund' ? 'DP: Visual Interference' : 'Grenzfall: Visual Interference', farbe, false);
      if (alternative) markieren(alternative.el, name, farbe, true);
    }

    befunde.push({
      typ: 'Visual Interference',
      kontext: 'Cookie-Banner',
      status,
      merkmale,
      hinweise,
      zustimmen: zustimmen.daten.text,
      ablehnen: ablehnen ? ablehnen.daten.text : null,
      abo: bezahlen ? bezahlen.daten.text : null,
      einstellungen: einstellungen ? einstellungen.daten.text : null,
      mechanismus: 'Cognitive Ease',
      quelle: location.hostname,
      eingebettet: window !== window.top
    });
  }

  // ============================================================
  // 4. Preselection: vorausgewählte Einwilligungen und Zusatzleistungen
  // ============================================================
  const schonGemeldet = new Set();
  for (const el of alle) {
    const istHaekchen = el.matches('input[type="checkbox"], input[type="radio"]') && el.checked;
    const istSchalter =
      el.matches('[role="switch"], [role="checkbox"]') && el.getAttribute('aria-checked') === 'true';
    if (!istHaekchen && !istSchalter) continue;

    // Abgrenzung: nicht abwählbar (deaktiviert) = notwendig
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;

    const { text, label } = beschriftungVon(el);
    if (!EINWILLIGUNG.test(text) || AUSNAHME.test(text)) continue;
    if (schonGemeldet.has(text)) continue;

    // Was sieht man? Echte Häkchen sind oft versteckt und durch ein gestaltetes Label ersetzt.
    const sichtbaresElement = istSichtbar(el) ? el : label && istSichtbar(label) ? label : null;
    if (!sichtbaresElement) continue;
    schonGemeldet.add(text);

    const imBanner = banner.some((b) => liegtIn(b, el));
    markieren(sichtbaresElement, 'DP: Preselection', '#e5007d', false);
    befunde.push({
      typ: 'Preselection',
      kontext: imBanner ? 'Cookie-Banner' : seitenKontext(),
      status: 'Befund',
      merkmale: [
        `${istSchalter ? 'Schalter' : el.type === 'radio' ? 'Auswahlpunkt' : 'Häkchen'} ist beim Laden bereits aktiviert`,
        'Betrifft eine Einwilligung oder Zusatzleistung'
      ],
      hinweise: [],
      beleg: text,
      mechanismus: 'Default-Effekt',
      quelle: location.hostname,
      eingebettet: window !== window.top
    });
    if (schonGemeldet.size >= 15) break;
  }

  // ============================================================
  // 5. Countdown / Limited-time Message
  // ============================================================
  // Kandidaten: sichtbare Elemente, deren eigener Text uhrzeit-ähnlich ist oder Zeitdruck ausdrückt
  const timerKandidaten = [];
  const zeitdruckKandidaten = [];
  for (const el of alle) {
    const text = eigenerText(el);
    if (!text || text.length > 200) continue;
    if (TIMER.test(text)) timerKandidaten.push({ el, vorher: el.innerText });
    else if (ZEITDRUCK.test(text)) zeitdruckKandidaten.push(el);
  }

  // Kurz warten und prüfen, welche Uhrzeiten sich verändert haben: Das sind laufende Timer.
  if (timerKandidaten.length > 0) await new Promise((fertig) => setTimeout(fertig, 1500));

  let anzahlTimer = 0;
  const gefundeneTimer = [];
  for (const { el, vorher } of timerKandidaten) {
    if (el.innerText === vorher || !istSichtbar(el)) continue; // unverändert = normale Uhrzeit
    const umgebung = umgebungsText(el);
    if (LIEFERUNG.test(umgebung)) continue; // Abgrenzung: Liefer-Countdown
    gefundeneTimer.push(el);
    // Beleg mit Beschriftung vor dem Timer, z. B. „Endet in 01:19:59“
    const davor = [eigenerText(el.parentElement || el), el.previousElementSibling?.innerText || '']
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .find((t) => t && t.length <= 40) || '';
    const beleg = umgebung.length > el.innerText.length + 3 ? umgebung : `${davor} ${el.innerText}`.trim();
    markieren(el, 'DP: Countdown', '#e5007d', false);
    befunde.push({
      typ: 'Countdown / Limited-time',
      kontext: seitenKontext(),
      status: 'Befund',
      merkmale: ['Timer zählt sichtbar herunter (in 1,5 Sekunden gemessen)'],
      hinweise: ['Echtheit nicht überprüfbar'],
      beleg: beleg.replace(/([A-Za-zÄÖÜäöüß])(\d)/g, '$1 $2').slice(0, 150), // „in01:19“ → „in 01:19“
      mechanismus: 'Verlustaversion',
      quelle: location.hostname,
      eingebettet: window !== window.top
    });
    if (++anzahlTimer >= 5) break;
  }

  let anzahlZeitdruck = 0;
  for (const el of zeitdruckKandidaten) {
    if (!istSichtbar(el)) continue;
    const umgebung = umgebungsText(el);
    if (KONKRETES_DATUM.test(umgebung) || LIEFERUNG.test(umgebung)) continue; // Abgrenzung
    // Gehört der Text zu einem schon gefundenen Timer („Angebot endet in 00:14:59“)? Dann nicht doppelt zählen.
    const eltern = el.parentElement;
    const behaelter = eltern && (eltern.innerText || '').length <= 300 ? eltern : el;
    if (gefundeneTimer.some((timer) => liegtIn(behaelter, timer))) continue;
    markieren(el, 'DP: Limited-time Message', '#e5007d', false);
    befunde.push({
      typ: 'Countdown / Limited-time',
      kontext: seitenKontext(),
      status: 'Befund',
      merkmale: ['Zeitdruck-Formulierung ohne konkrete Frist'],
      hinweise: ['Echtheit nicht überprüfbar'],
      beleg: umgebung.slice(0, 150),
      mechanismus: 'Verlustaversion',
      quelle: location.hostname,
      eingebettet: window !== window.top
    });
    if (++anzahlZeitdruck >= 5) break;
  }

  // ============================================================
  // Ergebnis an das Panel zurückgeben
  // ============================================================
  return {
    elemente: bedienelemente.map((b) => b.daten),
    versteckt,
    befunde,
    bannerGefunden: banner.length > 0
  };
})();