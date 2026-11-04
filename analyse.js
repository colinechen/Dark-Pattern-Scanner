// analyse.js – läuft NICHT im Panel, sondern in der Website (und in jedem iframe).
// Der Wert am Ende dieser Datei wird an das Panel zurückgeschickt.
(() => {
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
  const ZUSTIMMEN = /akzeptier|annehm|zustimm|einwillig|einverstanden|zulassen|erlauben|accept|agree|allow|^ok$|^okay$|verstanden/i;
  // Option, bei der man statt zuzustimmen bezahlt („Pay or OK“)
  const BEZAHLEN = /abonnier|\babo\b|pur-abo|werbefrei|kostenpflichtig|subscribe/i;
  // Ablehnung, die nur für einen einzelnen Anbieter gilt (z. B. „für Utiq jetzt ablehnen“)
  const EINZELN = /\bfür\b|\bfor\b/i;
  const EINSTELLUNGEN = /einstellung|anpassen|optionen|auswahl|verwalten|individuell|details|settings|manage|customi|preferences|options/i;

  // ============================================================
  // Hilfsfunktionen
  // ============================================================

  // Alle Elemente der Seite, auch die in offenen Shadow-DOMs (viele Cookie-Tools nutzen sie)
  function alleElemente(wurzel) {
    const ergebnis = [];
    for (const el of wurzel.querySelectorAll('*')) {
      ergebnis.push(el);
      if (el.shadowRoot) ergebnis.push(...alleElemente(el.shadowRoot));
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

    // Ein Cookie-Banner muss eine Zustimmungs-Option enthalten
    const enthaeltZustimmung = bedienelemente.some(
      (b) => liegtIn(el, b.el) && ZUSTIMMEN.test(b.daten.text) && !ABLEHNEN.test(b.daten.text)
    );
    if (enthaeltZustimmung) banner.push(el);
  }
  // Nur die äußersten Kandidaten behalten (sonst würde dasselbe Banner mehrfach gezählt)
  banner = banner.filter((b) => !banner.some((anderer) => anderer !== b && liegtIn(anderer, b)));

  // Sonderfall: Das Cookie-Banner ist ein eigenes iframe (typisch für Cookie-Anbieter).
  // Dann ist die ganze eingebettete Seite das Banner – auch wenn darin schon ein
  // Teilbereich gefunden wurde, der vielleicht nicht alle Optionen enthält.
  if (window !== window.top && document.body) {
    const enthaeltZustimmung = bedienelemente.some(
      (b) => ZUSTIMMEN.test(b.daten.text) && !ABLEHNEN.test(b.daten.text)
    );
    const text = document.body.innerText || '';
    if (enthaeltZustimmung && BANNER_TEXT.test(text) && text.length < 8000) banner = [document.body];
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
    const zustimmen = optionen.find((x) => !ABLEHNEN.test(x.daten.text) && ZUSTIMMEN.test(x.daten.text));
    const bezahlen = optionen.find(
      (x) => x !== ablehnen && x !== teilAblehnung && x !== zustimmen && BEZAHLEN.test(x.daten.text)
    );
    const einstellungen = optionen.find(
      (x) => x !== ablehnen && x !== zustimmen && x !== bezahlen && EINSTELLUNGEN.test(x.daten.text)
    );

    const merkmale = []; // erfüllte Merkmale aus dem Codebuch
    const hinweise = []; // Grenzfälle und Beobachtungen
    let grenzfall = false;

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
  // Ergebnis an das Panel zurückgeben
  // ============================================================
  return {
    elemente: bedienelemente.map((b) => b.daten),
    versteckt,
    befunde
  };
})();