// panel.js – läuft im Seitenpanel. Startet den Scan und zeigt die Ergebnisse an.
// Die eigentliche Analyse der Website steht in analyse.js.

// Elemente aus panel.html holen
const scanButton = document.getElementById('scanButton');
const zeitpunkt = document.getElementById('zeitpunkt');
const befundListe = document.getElementById('befundListe');
const ergebnis = document.getElementById('ergebnis');
const liste = document.getElementById('liste');

// Wenn auf den Knopf geklickt wird ...
scanButton.addEventListener('click', async () => {
  try {
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
      antworten = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['analyse.js']
      });
    }

    // 3. Ergebnisse aller Frames zusammenführen
    const elemente = [];
    const befunde = [];
    let versteckt = 0;
    for (const antwort of antworten) {
      if (!antwort.result) continue;
      elemente.push(...antwort.result.elemente);
      befunde.push(...antwort.result.befunde);
      versteckt += antwort.result.versteckt;
    }

    // 4. Zeitpunkt anzeigen
    const adresse = new URL(tab.url);
    const uhrzeit = new Date().toLocaleTimeString('de-DE');
    zeitpunkt.textContent = `${adresse.hostname}${adresse.pathname} – ${uhrzeit}`;

    // 5. Befunde anzeigen
    befundListe.textContent = '';
    if (befunde.length === 0) {
      befundListe.textContent = 'Kein Cookie-Banner gefunden.';
    }
    for (const befund of befunde) {
      befundListe.appendChild(befundKarteErstellen(befund));
    }

    // 6. Alle Bedienelemente anzeigen (aufklappbar)
    const anzahlButton = elemente.filter((e) => e.wirktWie === 'Button').length;
    ergebnis.textContent =
      `Alle Bedienelemente (${elemente.length}): ${anzahlButton} wirken wie Button, ` +
      `${elemente.length - anzahlButton} wie Text. ${versteckt} versteckte ignoriert.`;
    liste.textContent = '';
    for (const element of elemente) {
      liste.appendChild(eintragErstellen(element));
    }
  } catch (fehler) {
    befundListe.textContent = 'Diese Seite kann nicht gescannt werden: ' + fehler.message;
  }
});

// Baut eine Karte für einen Befund
function befundKarteErstellen(befund) {
  const farben = { Befund: '#e5007d', Grenzfall: '#e08a00', 'kein Befund': '#999' };

  const karte = document.createElement('div');
  karte.style.cssText =
    `border:1px solid #ddd;border-left:4px solid ${farben[befund.status]};` +
    'border-radius:4px;padding:8px;margin-bottom:8px;font-size:13px;';

  const titel = document.createElement('strong');
  titel.textContent = `${befund.status}: ${befund.typ} · ${befund.kontext}`;
  karte.appendChild(titel);

  const zeilen = [
    ['Zustimmen', befund.zustimmen],
    ['Ablehnen', befund.ablehnen || '– nicht auf erster Ebene –'],
    ['Abo-Option', befund.abo],
    ['Einstellungen', befund.einstellungen],
    ['Mechanismus', befund.status === 'kein Befund' ? null : befund.mechanismus],
    ['Quelle', befund.eingebettet ? `eingebettet von ${befund.quelle}` : null]
  ];
  for (const [bezeichnung, wert] of zeilen) {
    if (!wert) continue;
    const zeile = document.createElement('div');
    zeile.textContent = `${bezeichnung}: ${wert}`;
    karte.appendChild(zeile);
  }

  const hinweise = [...befund.merkmale, ...befund.hinweise];
  if (befund.status === 'kein Befund') hinweise.push('Optionen gleichwertig gestaltet – keines der vier Merkmale erfüllt');
  const merkmalListe = document.createElement('ul');
  merkmalListe.style.cssText = 'margin:4px 0 0;padding-left:18px;';
  for (const hinweis of hinweise) {
    const punkt = document.createElement('li');
    punkt.textContent = hinweis;
    merkmalListe.appendChild(punkt);
  }
  karte.appendChild(merkmalListe);
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