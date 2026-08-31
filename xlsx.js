/* Panel Statystyk REAKTO — czytnik plików XLSX w przeglądarce.

   Odpowiednik xlsx.py z wersji na komputer. Plik XLSX to archiwum ZIP
   z plikami XML w środku. Rozpakowanie robi przeglądarka (DecompressionStream),
   XML czyta wbudowany DOMParser — zero bibliotek zewnętrznych, zgodnie
   z zasadą projektu.

   Dzięki temu telefon pobiera CAŁY skoroszyt jednym adresem, tak samo jak
   aplikacja na Maca — wszystkie zakładki, wszystkie miesiące. */

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

function xlsxDostepny() {
  return typeof DecompressionStream === 'function';
}

/* ---------- ZIP ---------- */

/* Zwraca mapę: nazwa pliku w archiwum -> funkcja pobierająca jego treść.
   Rozpakowujemy dopiero to, co naprawdę czytamy — skoroszyt ma kilkadziesiąt
   plików, a interesuje nas kilka. */
function otworzZip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  let eocd = -1;
  const dolna = Math.max(0, u8.length - 66000);
  for (let i = u8.length - 22; i >= dolna; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('To nie jest plik XLSX (brak stopki archiwum).');

  const ile = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dek = new TextDecoder('utf-8');
  const wpisy = new Map();

  for (let k = 0; k < ile; k++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const metoda = dv.getUint16(off + 10, true);
    const skompr = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true);
    const elen = dv.getUint16(off + 30, true);
    const clen = dv.getUint16(off + 32, true);
    const lokalny = dv.getUint32(off + 42, true);
    const nazwa = dek.decode(u8.subarray(off + 46, off + 46 + nlen));
    wpisy.set(nazwa, { metoda, skompr, lokalny });
    off += 46 + nlen + elen + clen;
  }

  return {
    ma: n => wpisy.has(n),
    async tekst(n) {
      const e = wpisy.get(n);
      if (!e) return null;
      const nlen = dv.getUint16(e.lokalny + 26, true);
      const elen = dv.getUint16(e.lokalny + 28, true);
      const start = e.lokalny + 30 + nlen + elen;
      const dane = u8.subarray(start, start + e.skompr);
      if (e.metoda === 0) return dek.decode(dane);
      if (e.metoda !== 8) throw new Error('Nieobsługiwana kompresja w archiwum.');
      const strumien = new Blob([dane]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(strumien).text();
    },
  };
}

/* ---------- XML ---------- */

function xml(tekst) {
  const d = new DOMParser().parseFromString(tekst, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) {
    throw new Error('Uszkodzona zawartość skoroszytu.');
  }
  return d;
}

function kolumnaNaIndeks(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  const litery = m ? m[1] : '';
  let n = 0;
  for (const ch of litery) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function tekstElementu(el) {
  if (!el) return '';
  const t = el.getElementsByTagNameNS(NS_MAIN, 't');
  let s = '';
  for (let i = 0; i < t.length; i++) s += t[i].textContent || '';
  return s;
}

/* ---------- skoroszyt ---------- */

/* Zwraca [{ nazwa, rows }] — dokładnie w formacie, którego oczekuje
   przelicz() z analiza.js. */
async function czytajXLSX(buf) {
  if (!xlsxDostepny()) {
    throw new Error('Ta wersja systemu nie umie rozpakować pliku arkusza. '
      + 'Wymagany iOS 16.4 lub nowszy.');
  }
  const zip = otworzZip(buf);

  /* teksty współdzielone — komórki tekstowe trzymają tylko numer wpisu */
  const wspolne = [];
  if (zip.ma('xl/sharedStrings.xml')) {
    const d = xml(await zip.tekst('xl/sharedStrings.xml'));
    const si = d.getElementsByTagNameNS(NS_MAIN, 'si');
    for (let i = 0; i < si.length; i++) wspolne.push(tekstElementu(si[i]));
  }

  /* lista zakładek i ścieżek do ich plików */
  const rels = {};
  const dr = xml(await zip.tekst('xl/_rels/workbook.xml.rels'));
  const rl = dr.getElementsByTagNameNS(NS_PKG, 'Relationship');
  for (let i = 0; i < rl.length; i++) {
    rels[rl[i].getAttribute('Id')] = rl[i].getAttribute('Target') || '';
  }

  const dw = xml(await zip.tekst('xl/workbook.xml'));
  const sh = dw.getElementsByTagNameNS(NS_MAIN, 'sheet');
  const zakladki = [];
  for (let i = 0; i < sh.length; i++) {
    const rid = sh[i].getAttributeNS(NS_REL, 'id');
    const cel = rels[rid] || '';
    let sciezka;
    if (cel.startsWith('/xl/')) sciezka = cel.slice(1);
    else if (cel.startsWith('xl/')) sciezka = cel;
    else sciezka = 'xl/' + cel.replace(/^\//, '');
    zakladki.push({ nazwa: sh[i].getAttribute('name') || ('Arkusz ' + (i + 1)), sciezka });
  }

  const wynik = [];
  for (const z of zakladki) {
    if (!zip.ma(z.sciezka)) continue;
    wynik.push({ nazwa: z.nazwa, rows: wierszeArkusza(xml(await zip.tekst(z.sciezka)), wspolne) });
  }
  return wynik;
}

function wierszeArkusza(doc, wspolne) {
  const rows = [];
  const wiersze = doc.getElementsByTagNameNS(NS_MAIN, 'row');
  for (let i = 0; i < wiersze.length; i++) {
    const komorki = wiersze[i].getElementsByTagNameNS(NS_MAIN, 'c');
    const mapa = new Map();
    let maks = -1;
    for (let j = 0; j < komorki.length; j++) {
      const c = komorki[j];
      const ref = c.getAttribute('r') || '';
      const idx = ref ? kolumnaNaIndeks(ref) : j;
      const typ = c.getAttribute('t');
      const v = c.getElementsByTagNameNS(NS_MAIN, 'v')[0];
      let txt = '';
      if (typ === 's' && v) {
        txt = wspolne[Number(v.textContent)] || '';
      } else if (typ === 'inlineStr') {
        txt = tekstElementu(c.getElementsByTagNameNS(NS_MAIN, 'is')[0]);
      } else if (typ === 'str') {
        txt = v ? (v.textContent || '') : '';
      } else if (v) {
        txt = v.textContent || '';
      }
      txt = txt.trim();
      if (idx >= 0) { mapa.set(idx, txt); if (idx > maks) maks = idx; }
    }
    if (maks < 0) { rows.push([]); continue; }
    const r = new Array(maks + 1);
    for (let k = 0; k <= maks; k++) r[k] = mapa.get(k) || '';
    rows.push(r);
  }
  return rows;
}

/* ---------- adres arkusza ---------- */

/* Z wklejonego linku (albo samego identyfikatora) wyciąga ID skoroszytu.
   Akceptujemy zwykły link „Udostępnij”, link z paska adresu, ID. */
function idArkusza(txt) {
  const t = (txt || '').trim();
  if (!t) return null;
  const m = t.match(/\/spreadsheets\/d\/(?:e\/)?([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{25,}$/.test(t)) return t;
  return null;
}

function adresXLSX(id) {
  return 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx';
}
