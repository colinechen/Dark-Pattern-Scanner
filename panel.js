// panel.js – läuft im Seitenpanel. Startet Scan und KI-Analyse und zeigt die Ergebnisse an.
// Die Analyse der Website steht in analyse.js, alles zur KI in ki.js.

// Elemente aus panel.html holen
const scanButton = document.getElementById('scanButton');
const kiButton = document.getElementById('kiButton');
const screenshotHaken = document.getElementById('screenshotHaken');
const zeitpunkt = document.getElementById('zeitpunkt');
const befundListe = document.getElementById('befundListe');
const kiStatus = document.getElementById('kiStatus');
const kiListe = document.getElementById('kiListe');
const ergebnis = document.getElementById('ergebnis');
const liste = document.getElementById('liste');
const einstellungen = document.getElementById('einstellungen');
const apiKeyFeld = document.getElementById('apiKey');
const modellFeld = document.getElementById('modell');
const speichernButton = document.getElementById('speichernButton');

let letzterScan = null; // Ergebnis des letzten Scans (wird für die KI gebraucht)
let regelKarten = []; // Karten der Regel-Befunde, damit die KI-Bewertung dort ergänzt werden kann

// ============================================================
// Einstellungen: API-Key und Modell (nur in diesem Browser gespeichert)
// ============================================================
chrome.storage.local.get(['apiKey', 'modell']).then((gespeichert) => {
  apiKeyFeld.value = gespeichert.apiKey || '';
  modellFeld.value = gespeichert.modell || '';
});

speichernButton.addEventListener('click', async () => {
  await chrome.storage.local.set({ apiKey: apiKeyFeld.value.trim(), modell: modellFeld.value.trim() });
  speichernButton.textContent = 'Gespeichert ✓';
  setTimeout(() => (speichernButton.textContent = 'Speichern'), 1500);
});

// ============================================================
// Stufe 1: Seite mit festen Regeln scannen
// ============================================================
scanButton.addEventListener('click', async () => {
  scanButton.disabled = true;
  scanButton.textContent = 'Scanne …';
  try {
    await scannen();
  } catch (fehler) {
    befundListe.textContent = 'Diese Seite kann nicht gescannt werden: ' + fehler.message;
  } finally {
    scanButton.disabled = false;
    scanButton.textContent = 'Seite scannen';
  }
});

async function scannen() {
  // 1. Den aktuell geöffneten Tab finden
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 2. analyse.js in der Seite und in allen eingebetteten Seiten (iframes) ausführen
  let antworten;
  try {
    antworten = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['analyse.js']
    });
  } catch {
    // Falls ein iframe sich sperrt: nur die Hauptseite scannen
    antworten = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['analyse.js'] });
  }

  // 3. Ergebnisse aller Frames zusammenführen
  const scan = {
    url: tab.url,
    titel: tab.title,
    tabId: tab.id,
    windowId: tab.windowId,
    zeit: new Date(),
    elemente: [],
    befunde: [],
    bannerTexte: [],
    seitentext: '',
    versteckt: 0,
    bannerGefunden: false
  };
  for (const antwort of antworten) {
    const r = antwort.result;
    if (!r) continue;
    scan.elemente.push(...r.elemente);
    scan.befunde.push(...r.befunde);
    scan.bannerTexte.push(...r.bannerTexte);
    if (r.seitentext) scan.seitentext = r.seitentext;
    scan.versteckt += r.versteckt;
    if (r.bannerGefunden) scan.bannerGefunden = true;
  }
  letzterScan = scan;

  // 4. Anzeigen
  const adresse = new URL(tab.url);
  zeitpunkt.textContent = `${adresse.hostname}${adresse.pathname} – ${scan.zeit.toLocaleTimeString('de-DE')}`;

  befundListe.textContent = '';
  kiListe.textContent = '';
  kiStatus.textContent = '';
  const bannerHinweis = document.createElement('p');
  bannerHinweis.style.cssText = 'font-size:12px;color:gray;margin:0 0 8px;';
  bannerHinweis.textContent = `Cookie-Banner gefunden: ${scan.bannerGefunden ? 'ja' : 'nein'} · ${scan.befunde.length} Einträge`;
  befundListe.appendChild(bannerHinweis);
  regelKarten = scan.befunde.map((befund, i) => befundKarteErstellen(befund, `R${i + 1}`, 'Regel'));
  befundListe.append(...regelKarten);

  const anzahlButton = scan.elemente.filter((e) => e.wirktWie === 'Button').length;
  ergebnis.textContent =
    `Alle Bedienelemente (${scan.elemente.length}): ${anzahlButton} wirken wie Button, ` +
    `${scan.elemente.length - anzahlButton} wie Text. ${scan.versteckt} versteckte ignoriert.`;
  liste.textContent = '';
  for (const element of scan.elemente) liste.appendChild(eintragErstellen(element));

  return scan;
}

// ============================================================
// Stufe 2: KI-Analyse
// ============================================================
kiButton.addEventListener('click', async () => {
  const { apiKey, modell } = await chrome.storage.local.get(['apiKey', 'modell']);
  if (!apiKey) {
    einstellungen.open = true;
    kiStatus.textContent = 'Bitte zuerst unten unter „Einstellungen“ den API-Key eintragen.';
    return;
  }

  kiButton.disabled = true;
  scanButton.disabled = true;
  try {
    // 1. Ohne aktuellen Scan dieser Seite keine KI-Analyse: Die KI braucht die Regel-Befunde
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!letzterScan || letzterScan.url !== tab.url) {
      kiStatus.textContent = 'Scanne die Seite zuerst …';
      await scannen();
    }

    // 2. Screenshot vom sichtbaren Bereich – vorher die pinken Markierungen ausblenden,
    //    damit sie die KI nicht beeinflussen
    let screenshot = null;
    if (screenshotHaken.checked) {
      await markierungenZeigen(letzterScan.tabId, false);
      screenshot = await chrome.tabs.captureVisibleTab(letzterScan.windowId, { format: 'jpeg', quality: 70 });
      await markierungenZeigen(letzterScan.tabId, true);
    }

    // 3. Anfrage an die KI
    kiStatus.textContent = 'KI-Analyse läuft … (meist 15–60 Sekunden)';
    const antwort = await anfrageAnKI({ apiKey, modell, scan: letzterScan, screenshot });
    kiErgebnisAnzeigen(antwort);
  } catch (fehler) {
    kiStatus.textContent = 'KI-Analyse fehlgeschlagen: ' + fehler.message;
  } finally {
    kiButton.disabled = false;
    scanButton.disabled = false;
  }
});

// Blendet die Markierungen auf der Seite aus (false) oder wieder ein (true)
async function markierungenZeigen(tabId, sichtbar) {
  await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: (sichtbar) => {
        for (const m of window.__dpMarkierungen || []) {
          m.etikett.style.display = sichtbar ? '' : 'none';
          m.element.style.outline = sichtbar ? m.neuerRahmen : m.alterRahmen;
        }
      },
      args: [sichtbar]
    })
    .catch(() => {});
  // kurz warten, bis der Browser die Seite neu gezeichnet hat
  await new Promise((fertig) => setTimeout(fertig, 150));
}

function kiErgebnisAnzeigen(antwort) {
  const { ergebnis: ki, modell, eingabeTokens, ausgabeTokens, promptVersion } = antwort;

  kiStatus.textContent =
    `Fertig · Modell ${modell} · Prompt-Version ${promptVersion} · ` +
    `${eingabeTokens} Eingabe- und ${ausgabeTokens} Ausgabe-Tokens`;

  // KI-Befunde als eigene Karten (blau markiert)
  kiListe.textContent = '';
  const befunde = ki.befunde || [];
  if (befunde.length === 0) {
    kiListe.textContent = 'Die KI hat keine Dark Patterns der fünf Typen gefunden.';
  }
  befunde.forEach((befund, i) => kiListe.appendChild(befundKarteErstellen(befund, `K${i + 1}`, 'KI')));

  // Bewertung der Regel-Befunde in die jeweilige Karte schreiben
  for (const bewertung of ki.bewertung_regeln || []) {
    const nummer = parseInt(String(bewertung.nr).replace(/\D/g, ''), 10);
    const karte = regelKarten[nummer - 1];
    if (!karte) continue;
    const zeile = document.createElement('div');
    zeile.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px dashed #ccc;color:#2457c5;';
    zeile.textContent = `KI: ${bewertung.einschaetzung} – ${bewertung.begruendung || ''}`;
    karte.appendChild(zeile);
  }

  // Weitere Beobachtungen und Grenzen der Analyse
  for (const [bezeichnung, text] of [
    ['Weitere Beobachtungen', ki.weitere_beobachtungen],
    ['Grenzen laut KI', ki.grenzen]
  ]) {
    if (!text) continue;
    const absatz = document.createElement('p');
    absatz.style.cssText = 'font-size:12px;background:#eef3fd;padding:6px;border-radius:4px;';
    absatz.textContent = `${bezeichnung}: ${text}`;
    kiListe.appendChild(absatz);
  }
}

// ============================================================
// Anzeige-Bausteine
// ============================================================

// Baut eine Karte für einen Befund – aus den Regeln (pink/orange) oder von der KI (blau)
function befundKarteErstellen(befund, nummer, quelle) {
  const farben = { Befund: '#e5007d', Grenzfall: '#e08a00', 'kein Befund': '#999', 'nicht bewertet': '#999' };
  const randfarbe = quelle === 'KI' ? (befund.status === 'Grenzfall' ? '#8fb0e8' : '#2457c5') : farben[befund.status];

  const karte = document.createElement('div');
  karte.style.cssText =
    `border:1px solid #ddd;border-left:4px solid ${randfarbe};` +
    'border-radius:4px;padding:8px;margin-bottom:8px;font-size:13px;';

  const titel = document.createElement('strong');
  titel.textContent = `${nummer} · ${befund.status}: ${befund.typ} · ${befund.kontext || ''}`;
  karte.appendChild(titel);

  const zeilen = [
    ['Beleg', befund.beleg],
    ['Zustimmen', befund.zustimmen],
    ['Ablehnen', befund.zustimmen ? befund.ablehnen || '– nicht auf erster Ebene –' : null],
    ['Abo-Option', befund.abo],
    ['Einstellungen', befund.einstellungen],
    ['Designmerkmale', befund.designmerkmale],
    [
      'Mechanismus',
      befund.status === 'Befund' || befund.status === 'Grenzfall'
        ? befund.mechanismus + (befund.nebenmechanismus ? ` (Neben: ${befund.nebenmechanismus})` : '')
        : null
    ],
    ['Konfidenz', befund.konfidenz],
    ['Begründung', befund.begruendung],
    ['Quelle', befund.eingebettet ? `eingebettet von ${befund.quelle}` : null]
  ];
  for (const [bezeichnung, wert] of zeilen) {
    if (!wert) continue;
    const zeile = document.createElement('div');
    zeile.textContent = `${bezeichnung}: ${wert}`;
    karte.appendChild(zeile);
  }

  const hinweise = [...(befund.merkmale || []), ...(befund.hinweise || [])];
  if (befund.status === 'kein Befund') hinweise.push('Optionen gleichwertig gestaltet – keines der vier Merkmale erfüllt');
  if (hinweise.length) {
    const merkmalListe = document.createElement('ul');
    merkmalListe.style.cssText = 'margin:4px 0 0;padding-left:18px;';
    for (const hinweis of hinweise) {
      const punkt = document.createElement('li');
      punkt.textContent = hinweis;
      merkmalListe.appendChild(punkt);
    }
    karte.appendChild(merkmalListe);
  }
  return karte;
}

// Baut einen Listeneintrag für ein Bedienelement
function eintragErstellen(element) {
  const eintrag = document.createElement('li');
  eintrag.style.marginBottom = '8px';

  const farbe = document.createElement('span');
  farbe.style.cssText =
    'display:inline-block;width:12px;height:12px;margin-right:6px;border:1px solid #999;vertical-align:middle;';
  farbe.style.backgroundColor = element.hintergrund;

  const titel = document.createElement('strong');
  titel.textContent = element.text;

  const details = document.createElement('div');
  details.style.cssText = 'font-size:12px;color:gray;';
  let art = 'wirkt wie Text';
  if (element.wirktWie === 'Button') {
    art = element.gefuellt ? 'wirkt wie Button (gefüllt)' : 'wirkt wie Button (umrandet)';
  }
  details.textContent =
    `${art} · im Code: ${element.codeTyp} · ${element.breite}×${element.hoehe} px · Schrift ${element.schriftgroesse}` +
    (element.eingebettet ? ` · eingebettet von ${element.quelle}` : '');

  eintrag.append(farbe, titel, details);
  return eintrag;
}