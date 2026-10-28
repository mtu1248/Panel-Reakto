/* Panel Statystyk REAKTO — logika analizy danych.
   Odpowiednik modułu analiza.py z wersji na komputer: rozpoznaje układ
   arkusza, klasyfikuje wpisy i liczy statystyki. Dane pobierane są wprost
   z Arkuszy Google, bez pośrednictwa komputera. */

const DATE_RE = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\s*$/;
const LP_RE = /^\s*LP\s*\.?\s*\d*\s*$/i;
const ZDARZ_RE = /^\s*zdarzeni/i;
const LI_RE = /^\s*LI\s*\.?\s*\d*\s*$/i;
const GODZ_RE = /\b\d{1,2}[:;.]\d{2}\b/g;
const DNI_MIES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const KAT_LABEL = {
  OK: 'Wykonane', DESZCZ: 'Deszcz', WILG: 'Wilgotność', WIATR: 'Wiatr',
  MGLA: 'Mgła', AWARIA: 'Awaria', SERWIS: 'Serwis', KP: 'KP', INNE: 'Inne',
};

const MIESIACE = ['', 'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

/* ---------- odczyt CSV ---------- */
function parseCSV(tekst) {
  const wiersze = [];
  let pole = '', wiersz = [], wCudzyslowie = false;
  for (let i = 0; i < tekst.length; i++) {
    const z = tekst[i];
    if (wCudzyslowie) {
      if (z === '"') {
        if (tekst[i + 1] === '"') { pole += '"'; i++; }
        else wCudzyslowie = false;
      } else pole += z;
    } else if (z === '"') wCudzyslowie = true;
    else if (z === ',') { wiersz.push(pole); pole = ''; }
    else if (z === '\n') { wiersz.push(pole); wiersze.push(wiersz); wiersz = []; pole = ''; }
    else if (z !== '\r') pole += z;
  }
  if (pole !== '' || wiersz.length) { wiersz.push(pole); wiersze.push(wiersz); }
  return wiersze.map(w => w.map(c => (c || '').trim()));
}

/* ---------- daty ---------- */
function parseDate(txt) {
  const m = DATE_RE.exec(txt || '');
  if (!m) return null;
  let d1 = +m[1], d2 = +m[2], mm = +m[3], yy = +m[4];
  if (!(mm >= 1 && mm <= 12 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31)) return null;
  // zapis podaje miesiąc DRUGIEGO dnia; doba z przełomu należy do poprzedniego
  if (d1 > d2) { mm -= 1; if (mm === 0) { mm = 12; yy -= 1; } }
  if (d1 > DNI_MIES[mm - 1]) return null;
  return yy * 10000 + mm * 100 + d1;
}
const rokZ = k => Math.floor(k / 10000);
const miesZ = k => Math.floor(k / 100) % 100;
const dzienZ = k => k % 100;

function dniMies(yy, mm) { return (mm === 2 && yy % 4 !== 0) ? 28 : DNI_MIES[mm - 1]; }

function etykietaDoby(k) {
  const yy = rokZ(k), mm = miesZ(k), d1 = dzienZ(k);
  const p = n => String(n).padStart(2, '0');
  if (d1 >= dniMies(yy, mm)) return `${p(d1)}.${p(mm)} → 01.${p(mm % 12 + 1)}`;
  return `${p(d1)}.${p(mm)} → ${p(d1 + 1)}.${p(mm)}`;
}
function etykietaKrotka(k) {
  const yy = rokZ(k), mm = miesZ(k), d1 = dzienZ(k);
  const p = n => String(n).padStart(2, '0');
  const d2 = d1 >= dniMies(yy, mm) ? 1 : d1 + 1;
  return `${p(d1)}/${p(d2)}.${p(mm)}`;
}

/* ---------- klasyfikacja wpisu ---------- */
const POGODA = ['DESZCZ', 'WILG', 'WIATR', 'MGLA', 'MGŁA', 'OPAD', 'BURZA', 'SNIEG', 'ŚNIEG', 'OBLODZ'];

function klasyfikuj(v) {
  const x = (v || '').trim().toUpperCase().replace(/\./g, '').replace(/\s/g, '');
  if (!x) return [null, false];
  if (x === '1') return ['OK', false];
  if (x.startsWith('1-')) return ['OK', true];
  const liczba = parseFloat(x.replace(',', '.'));
  if (!isNaN(liczba) && liczba > 0 && /^[\d,.]+$/.test(x)) return ['OK', false];
  if (x.startsWith('KP')) return ['KP', false];
  if (x.startsWith('SERWIS')) return ['SERWIS', false];
  if (x.startsWith('AWARIA') || x.startsWith('TECH') || x.startsWith('USTERKA')) return ['AWARIA', false];
  for (const p of POGODA) {
    if (x.startsWith(p)) {
      if (x.startsWith('WILG')) return ['WILG', false];
      if (x.startsWith('WIATR')) return ['WIATR', false];
      if (x.startsWith('MG')) return ['MGLA', false];
      return ['DESZCZ', false];
    }
  }
  return ['INNE', false];
}

function kluczLokalizacji(n) {
  return (n || '').toUpperCase().replace(/\u00a0/g, ' ')
    .replace(/[–—]/g, '-').replace(/\s+/g, '');
}

/* Ostrzejszy klucz nazwy — bez interpunkcji i polskich liter. Odpowiednik
   analiza.klucz_scisly: tym kluczem zestawiamy nazwy z arkusza z ustawieniami
   obiektów (okres obsługi, harmonogram) i z wyborem obiektu. */
function kluczScisly(n) {
  const mapa = { 'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z' };
  return String(n || '').toUpperCase().replace(/[ĄĆĘŁŃÓŚŹŻ]/g, c => mapa[c])
    .replace(/[^A-Z0-9]/g, '');
}
const nazwaLadna = n => String(n || '').replace(/\s+/g, ' ').trim();

/* LPD — lot patrolowy dodatkowy (od desktopu 2.9). Nadrabia loty niewykonane
   wcześniej, więc NIE jest planem. W komórce stoi LICZBA lotów („3” = trzy),
   „3-M” = trzy ręczne. Wiersze LPD mają tę samą etykietę, dlatego dokładamy
   do niej numer wiersza/kolumny — inaczej deduplikacja zlałaby je w jeden. */
const LPD_RE = /^\s*LPD\s*\.?\s*\d*\s*$/i;

function wartoscDodatkowych(v) {
  let x = String(v || '').trim().replace(/ /g, '').replace(/\s/g, '');
  if (!x) return [0, false];
  const manual = x.toUpperCase().endsWith('-M');
  if (manual) x = x.slice(0, -2);
  if (!x) return manual ? [1, true] : [0, false];
  if (!/^[\d,.]+$/.test(x)) return [0, false];
  const n = parseFloat(x.replace(',', '.'));
  if (isNaN(n) || n <= 0) return [0, false];
  return [Math.round(n), manual];
}

/* ---------- rozpoznanie układu ---------- */
function wykryjUklad(rows) {
  let wWierszu = 0, wKolumnie = 0;
  rows.slice(0, 14).forEach(r => {
    wWierszu = Math.max(wWierszu, r.filter(c => parseDate(c)).length);
  });
  const szer = Math.max(...rows.map(r => r.length), 0);
  for (let i = 0; i < Math.min(szer, 14); i++) {
    const n = rows.filter(r => parseDate(r[i])).length;
    wKolumnie = Math.max(wKolumnie, n);
  }
  return wWierszu >= wKolumnie ? 'A' : 'B';
}

function ukladA(rows, zrodlo) {
  let hdr = 0, best = -1;
  rows.slice(0, 14).forEach((r, i) => {
    const n = r.filter(c => parseDate(c)).length;
    if (n > best) { best = n; hdr = i; }
  });
  const kolumny = [];
  rows[hdr].forEach((c, i) => { const d = parseDate(c); if (d) kolumny.push([i, d]); });

  let kolTyp = null;
  for (const r of rows.slice(hdr + 1)) {
    for (let i = 0; i < Math.min(6, r.length); i++) {
      const c = r[i] || '';
      if (LP_RE.test(c) || LI_RE.test(c) || LPD_RE.test(c)) { kolTyp = i; break; }
    }
    if (kolTyp !== null) break;
  }
  if (kolTyp === null) return [[], [], [], []];
  const kolLok = Math.max(0, kolTyp - 1);

  const loty = [], zdarz = [], interw = [], dod = [];
  let lok = null;
  rows.slice(hdr + 1).forEach((r, ri) => {
    if (r[kolLok] && r[kolLok].trim()) lok = r[kolLok].trim();
    const typ = (r[kolTyp] || '').trim();
    if (LPD_RE.test(typ)) {
      const et = typ.toUpperCase() + '#' + ri;
      kolumny.forEach(([ci, dat]) => dod.push([dat, lok || '—', et, r[ci] || '']));
    } else if (LP_RE.test(typ)) {
      kolumny.forEach(([ci, dat]) => loty.push([dat, lok || '—', typ.toUpperCase(), r[ci] || '', zrodlo]));
    } else if (LI_RE.test(typ)) {
      kolumny.forEach(([ci, dat]) => {
        const n = wartoscInterwencyjnego(r[ci] || '');
        if (n) interw.push([dat, lok || '—', typ.toUpperCase(), n]);
      });
    } else if (ZDARZ_RE.test(typ)) {
      kolumny.forEach(([ci, dat]) => { if ((r[ci] || '').trim()) zdarz.push([dat, lok || '—', r[ci]]); });
    }
  });
  return [loty, zdarz, interw, dod];
}

function ukladB(rows, zrodlo) {
  const szer = Math.max(...rows.map(r => r.length), 0);
  let kolDat = 0, best = -1;
  for (let i = 0; i < Math.min(szer, 14); i++) {
    const n = rows.filter(r => parseDate(r[i])).length;
    if (n > best) { best = n; kolDat = i; }
  }
  let wTyp = null;
  for (let i = 0; i < Math.min(16, rows.length); i++) {
    if (rows[i].filter(c => LP_RE.test(c || '')).length >= 2) { wTyp = i; break; }
  }
  if (wTyp === null) return [[], [], [], []];
  const wLok = wTyp > 0 ? wTyp - 1 : wTyp;

  const naglowek = {};
  let biez = null;
  for (let i = 0; i < szer; i++) {
    const n = (rows[wLok][i] || '').trim();
    if (n) biez = n;
    naglowek[i] = biez;
  }
  const kolLP = [], kolZd = [], kolLI = [], kolLPD = [];
  for (let i = 0; i < szer; i++) {
    const t = rows[wTyp][i] || '';
    if (LPD_RE.test(t)) kolLPD.push([i, t.trim().toUpperCase() + '#' + i]);
    else if (LP_RE.test(t)) kolLP.push([i, t.trim().toUpperCase()]);
    else if (LI_RE.test(t)) kolLI.push([i, t.trim().toUpperCase()]);
    else if (ZDARZ_RE.test(t)) kolZd.push(i);
  }
  const loty = [], zdarz = [], interw = [], dod = [];
  for (const r of rows.slice(wTyp + 1)) {
    const dat = parseDate(r[kolDat]);
    if (!dat) continue;
    kolLP.forEach(([ci, et]) => loty.push([dat, naglowek[ci] || '—', et, r[ci] || '', zrodlo]));
    kolZd.forEach(ci => { if ((r[ci] || '').trim()) zdarz.push([dat, naglowek[ci] || '—', r[ci]]); });
    kolLI.forEach(([ci, et]) => {
      const n = wartoscInterwencyjnego(r[ci] || '');
      if (n) interw.push([dat, naglowek[ci] || '—', et, n]);
    });
    kolLPD.forEach(([ci, et]) => dod.push([dat, naglowek[ci] || '—', et, r[ci] || '']));
  }
  return [loty, zdarz, interw, dod];
}

function rekordyZArkusza(rows, zrodlo) {
  if (!rows || !rows.length) return [[], [], [], []];
  return wykryjUklad(rows) === 'A' ? ukladA(rows, zrodlo) : ukladB(rows, zrodlo);
}

/* Loty interwencyjne rozliczane są osobno — nie wchodzą do planu ani
   do procentu realizacji, bo wykonuje się je na zgłoszenie. */
function wartoscInterwencyjnego(v) {
  const x = (v || '').trim().replace(/ /g, '').replace(/\s/g, '');
  if (!x) return 0;
  const n = parseFloat(x.replace(',', '.'));
  if (!isNaN(n) && /^[\d,.]+$/.test(x)) return n > 0 ? Math.round(n) : 0;
  return x.toUpperCase().startsWith('1-') ? 1 : 0;
}

function policzObjazdy(t) {
  const s = (t || '').toLowerCase();
  if (!s.includes('objaz') && !s.includes('objad')) return 0;
  return (t.match(GODZ_RE) || []).length;
}

/* ---------- agregacja ---------- */
const nowaDoba = () => ({ plan: 0, ok: 0, man: 0, objazdy: 0, interw: 0, dod: 0,
  kat: {}, lok: new Map(), lokKlucze: new Map(), zrodla: {} });
const nowaLok = () => ({ plan: 0, ok: 0, man: 0, objazdy: 0, interw: 0, dod: 0, kat: {} });

function lokDoby(d, lok) {
  const kl = kluczLokalizacji(lok);
  if (!d.lokKlucze.has(kl)) d.lokKlucze.set(kl, lok);
  const nazwa = d.lokKlucze.get(kl);
  if (!d.lok.has(nazwa)) d.lok.set(nazwa, nowaLok());
  return d.lok.get(nazwa);
}

/* Odpowiednik analiza.zbierz: doby z rozbiciem na lokalizacje, z tymi samymi
   licznikami co cała doba. `ok` doby to tu nadal same LP — LPD dochodzą
   dopiero przy sumowaniu (tak jak w desktopie 3.7). */
function zbierz(loty, zdarzenia, interwencyjne, dodatkowe) {
  const doby = new Map(), widziane = new Set();
  let dubli = 0;
  for (const [dat, lok, etyk, val, zrodlo] of loty) {
    const [kat, manual] = klasyfikuj(val);
    if (!kat) continue;
    const klucz = dat + '|' + kluczLokalizacji(lok) + '|' + etyk;
    if (widziane.has(klucz)) { dubli++; continue; }
    widziane.add(klucz);
    if (!doby.has(dat)) doby.set(dat, nowaDoba());
    const d = doby.get(dat);
    if (zrodlo) d.zrodla[zrodlo] = (d.zrodla[zrodlo] || 0) + 1;
    const l = lokDoby(d, lok);
    for (const t of [d, l]) {
      t.plan++;
      t.kat[kat] = (t.kat[kat] || 0) + 1;
      if (kat === 'OK') { t.ok++; if (manual) t.man++; }
    }
  }
  const widzianeD = new Set();
  for (const [dat, lok, etyk, val] of (dodatkowe || [])) {
    const [ile, manual] = wartoscDodatkowych(val);
    if (!ile) continue;
    const klucz = dat + '|' + kluczLokalizacji(lok) + '|' + etyk;
    if (widzianeD.has(klucz)) continue;
    widzianeD.add(klucz);
    if (!doby.has(dat)) doby.set(dat, nowaDoba());
    const d = doby.get(dat), l = lokDoby(d, lok);
    for (const t of [d, l]) { t.dod += ile; if (manual) t.man += ile; }
  }
  const widzianeZ = new Set();
  for (const [dat, lok, tekst] of zdarzenia) {
    const k = dat + '|' + lok + '|' + tekst.trim();
    if (widzianeZ.has(k)) continue;
    widzianeZ.add(k);
    const n = policzObjazdy(tekst);
    if (n && doby.has(dat)) {
      const d = doby.get(dat);
      d.objazdy += n;
      const nazwa = d.lokKlucze.get(kluczLokalizacji(lok));
      if (nazwa && d.lok.has(nazwa)) d.lok.get(nazwa).objazdy += n;
    }
  }
  const widzianeI = new Set();
  for (const [dat, lok, etyk, n] of (interwencyjne || [])) {
    const k = dat + '|' + kluczLokalizacji(lok) + '|' + etyk;
    if (widzianeI.has(k)) continue;
    widzianeI.add(k);
    if (doby.has(dat)) {
      const d = doby.get(dat);
      const nazwa = d.lokKlucze.get(kluczLokalizacji(lok));
      if (nazwa && d.lok.has(nazwa)) d.lok.get(nazwa).interw += n;
    } else doby.set(dat, nowaDoba());
    doby.get(dat).interw += n;
  }
  return [new Map([...doby.entries()].sort((a, b) => a[0] - b[0])), dubli];
}

/* LPD WCHODZĄ DO WYKONANIA (desktop 3.7, decyzja Maria 07.10.2026):
   `ok` = LP wykonane + LPD, procent z tej sumy; `okLp`/`procLp` — sam
   harmonogram; `niew` — loty z planu, które się nie odbyły (= suma przyczyn). */
function sumuj(doby, klucze) {
  const w = { plan: 0, ok: 0, man: 0, objazdy: 0, interw: 0, dod: 0, kat: {}, lok: new Map(), doby: 0 };
  const lk = new Map();
  for (const k of klucze) {
    const d = doby.get(k);
    if (!d) continue;
    w.doby++;
    ['plan', 'ok', 'man', 'objazdy', 'interw', 'dod'].forEach(p => { w[p] += (d[p] || 0); });
    Object.entries(d.kat).forEach(([kk, v]) => { w.kat[kk] = (w.kat[kk] || 0) + v; });
    d.lok.forEach((v, nazwa) => {
      const kl = kluczLokalizacji(nazwa);
      if (!lk.has(kl)) lk.set(kl, nazwa);
      const n = lk.get(kl);
      if (!w.lok.has(n)) w.lok.set(n, { plan: 0, ok: 0, dod: 0 });
      const t = w.lok.get(n);
      t.plan += v.plan; t.ok += v.ok + (v.dod || 0); t.dod += v.dod || 0;
    });
  }
  w.okLp = w.ok;
  w.ok = w.okLp + w.dod;
  w.niew = w.plan - w.okLp;
  w.proc = w.plan ? (100 * w.ok / w.plan) : 0;
  w.procLp = w.plan ? (100 * w.okLp / w.plan) : 0;
  w.pogoda = ['DESZCZ', 'WILG', 'WIATR', 'MGLA'].reduce((a, k) => a + (w.kat[k] || 0), 0);
  w.technika = ['AWARIA', 'SERWIS'].reduce((a, k) => a + (w.kat[k] || 0), 0);
  w.kp = w.kat.KP || 0;
  return w;
}

/* ---------- obiekty: okres obsługi i harmonogram (desktop 3.8) ----------
   Ustawienia trzymane na urządzeniu: { klucz: {nazwa, od, do, zmiany:[{od, loty}]} },
   daty 'RRRR-MM-DD' = dzień rozpoczęcia doby (26.10 = noc 26/27.10). */
const OBIEKTY_WZORCOWE = {
  INPOST: { nazwa: 'INPOST', od: null, do: '2026-10-26', zmiany: [] },
};
const dataNum = iso => iso ? Number(String(iso).replace(/-/g, '')) : null;
const isoZ = k => `${rokZ(k)}-${String(miesZ(k)).padStart(2, '0')}-${String(dzienZ(k)).padStart(2, '0')}`;

function aktywny(u, dat) {
  if (!u) return true;
  if (u.od && dat < dataNum(u.od)) return false;
  if (u.do && dat > dataNum(u.do)) return false;
  return true;
}
function normaDoby(u, dat) {
  let w = null;
  for (const z of (u && u.zmiany) || []) if (dataNum(z.od) <= dat && z.loty) w = z.loty;
  return w;
}
function przedPierwszaZmiana(u, dat) {
  const zm = ((u && u.zmiany) || []).filter(z => z.od).sort((a, b) => a.od < b.od ? -1 : 1);
  return zm.length > 0 && dat < dataNum(zm[0].od);
}
function status(u, dat) {
  if (!u) return 'aktywny';
  if (u.do && dat > dataNum(u.do)) return 'zakonczony';
  if (u.od && dat < dataNum(u.od)) return 'planowany';
  return 'aktywny';
}

/* Odcina rekordy spoza okresu obsługi — przed `zbierz`, jak na desktopie.
   Zwraca też liczbę odciętych WYPEŁNIONYCH komórek per obiekt. */
function filtrujRekordy(rek, obiekty) {
  const odciete = {};
  if (!Object.values(obiekty || {}).some(u => u && (u.od || u.do))) return [rek, odciete];
  const pam = new Map();
  const kl = n => { if (!pam.has(n)) pam.set(n, kluczScisly(n)); return pam.get(n); };
  const out = {};
  for (const [nazwa, lista] of Object.entries(rek)) {
    out[nazwa] = lista.filter(r => {
      const k = kl(r[1]);
      const ok = aktywny(obiekty[k], r[0]);
      if (!ok && (nazwa === 'loty' || nazwa === 'dodatkowe') && String(r[3] || '').trim())
        odciete[k] = (odciete[k] || 0) + 1;
      return ok;
    });
  }
  return [out, odciete];
}

function planLok(d) {
  const o = {};
  if (d) d.lok.forEach((v, n) => { const k = kluczScisly(n); o[k] = (o[k] || 0) + v.plan; });
  return o;
}
function potencjalLok(loty, dat) {
  const s = new Set();
  for (const r of loty) if (r[0] === dat) s.add(kluczScisly(r[1]) + '|' + r[2]);
  const o = {};
  s.forEach(x => { const k = x.split('|')[0]; o[k] = (o[k] || 0) + 1; });
  return o;
}

/* „Zaplanowane” na bieżącej dobie — obiekt po obiekcie (obiekty.nominal_doby).
   Z harmonogramem = liczba z harmonogramu; bez — max(plan z 7 zamkniętych dób,
   wpisane dziś, wiersze LP na dziś). Przed pierwszą zmianą wierszy LP nie
   liczymy (LP15–LP40 dopisane w arkuszu z wyprzedzeniem). */
function nominalDoby(doby, loty, biezaca, zamkniete, obiekty) {
  const dzis = planLok(doby.get(biezaca)), pot = potencjalLok(loty, biezaca), hist = {};
  zamkniete.slice(-7).forEach(k => {
    Object.entries(planLok(doby.get(k))).forEach(([kl, n]) => { hist[kl] = Math.max(hist[kl] || 0, n); });
  });
  let suma = 0;
  new Set([...Object.keys(dzis), ...Object.keys(pot), ...Object.keys(hist)]).forEach(kl => {
    const u = obiekty[kl];
    if (u && !aktywny(u, biezaca)) return;
    const n = u ? normaDoby(u, biezaca) : null;
    let v;
    if (n != null) v = Math.max(n, dzis[kl] || 0);
    else if (u && przedPierwszaZmiana(u, biezaca)) v = Math.max(hist[kl] || 0, dzis[kl] || 0);
    else v = Math.max(hist[kl] || 0, dzis[kl] || 0, pot[kl] || 0);
    suma += v;
  });
  return suma;
}

/* Te same doby, ale liczniki jednej lokalizacji (server.filtr_doby) —
   widok obiektu idzie przez dokładnie ten sam kod co widok całości. */
function filtrDoby(doby, klucz) {
  const out = new Map();
  doby.forEach((d, k) => {
    for (const [n, v] of d.lok) {
      if (kluczScisly(n) !== klucz) continue;
      out.set(k, Object.assign({}, v, { kat: v.kat || {}, lok: new Map([[n, v]]),
        lokKlucze: new Map([[kluczLokalizacji(n), n]]), zrodla: d.zrodla }));
      return;
    }
  });
  return out;
}

function nazwyLokalizacji(doby) {
  const o = new Map();
  doby.forEach(d => d.lok.forEach((v, n) => { const k = kluczScisly(n); if (!o.has(k)) o.set(k, nazwaLadna(n)); }));
  return o;
}

/* ---------- złożenie pełnego zestawu danych ---------- */
/* Odczyt arkuszy -> surowe rekordy. Trzymane w pamięci, żeby zmiana obiektu
   albo ustawień nie wymagała ponownego pobierania skoroszytu. */
function rekordyZArkuszy(arkusze) {
  const rek = { loty: [], zdarzenia: [], interwencyjne: [], dodatkowe: [] };
  const info = [];
  for (const { nazwa, rows } of arkusze) {
    const [l, z, iv, dd] = rekordyZArkusza(rows, nazwa);
    const wypelnione = l.filter(r => (r[3] || '').trim());
    if (!wypelnione.length) continue;
    const daty = [...new Set(wypelnione.map(r => r[0]))].sort();
    const p = n => String(n).padStart(2, '0');
    info.push({
      arkusz: nazwa, loty: wypelnione.length,
      zakres: `${p(dzienZ(daty[0]))}.${p(miesZ(daty[0]))} – ${p(dzienZ(daty[daty.length - 1]))}.${p(miesZ(daty[daty.length - 1]))}.${rokZ(daty[daty.length - 1])}`,
    });
    for (const r of l) rek.loty.push(r);
    for (const r of z) rek.zdarzenia.push(r);
    for (const r of iv) rek.interwencyjne.push(r);
    for (const r of dd) rek.dodatkowe.push(r);
  }
  return { rek, info };
}

/* Przegląd obiektów do ustawień — liczony z dób PRZED filtrem okresu,
   żeby było widać wpisy po końcu umowy. */
function przegladObiektow(dobySur, obiekty, odciete, biezaca) {
  const klucze = [...dobySur.keys()];
  const out = [];
  nazwyLokalizacji(dobySur).forEach((nazwa, kl) => {
    const dni = klucze.filter(k => (planLok(dobySur.get(k))[kl] || 0) > 0);
    if (!dni.length) return;
    const zamk = dni.filter(k => k !== biezaca);
    const ost = zamk.length ? zamk[zamk.length - 1] : dni[dni.length - 1];
    const u = obiekty[kl];
    out.push({ klucz: kl, nazwa,
      od_danych: etykietaKrotka(dni[0]), do_danych: etykietaKrotka(dni[dni.length - 1]),
      ostatnia_doba: etykietaKrotka(ost), loty_ostatniej: planLok(dobySur.get(ost))[kl] || 0,
      norma: u ? normaDoby(u, biezaca) : null,
      status: status(u, biezaca), odciete: odciete[kl] || 0,
      ustawienia: u || { nazwa, od: null, do: null, zmiany: [] } });
  });
  return out.sort((a, b) => a.nazwa < b.nazwa ? -1 : 1);
}

function przelicz(arkuszeLubRek, obiekty, lokKlucz) {
  const wej = arkuszeLubRek.rek ? arkuszeLubRek : rekordyZArkuszy(arkuszeLubRek);
  obiekty = obiekty || {};
  const [rek, odciete] = filtrujRekordy(wej.rek, obiekty);
  let [doby, dubli] = zbierz(rek.loty, rek.zdarzenia, rek.interwencyjne, rek.dodatkowe);
  if (!doby.size) throw new Error('Nie znaleziono danych o lotach w podanych arkuszach.');
  const [dobySur] = zbierz(wej.rek.loty, [], [], wej.rek.dodatkowe);
  const kluczeWsz = [...doby.keys()];
  const biezWsz = kluczeWsz[kluczeWsz.length - 1];

  // lista obiektów do przełącznika — zawsze pełna (z całości)
  const lokalizacje = [];
  const wMiesWsz = sumuj(doby, kluczeWsz.filter(k => rokZ(k) === rokZ(biezWsz) && miesZ(k) === miesZ(biezWsz)));
  nazwyLokalizacji(doby).forEach((nazwa, kl) => {
    let plan = 0;
    wMiesWsz.lok.forEach((v, n) => { if (kluczScisly(n) === kl) plan += v.plan; });
    const u = obiekty[kl];
    lokalizacje.push({ klucz: kl, nazwa, plan, status: status(u, biezWsz), do: u && u.do });
  });
  lokalizacje.sort((a, b) => a.nazwa < b.nazwa ? -1 : 1);

  let loty = rek.loty, wybrany = null;
  if (lokKlucz) {
    const f = filtrDoby(doby, lokKlucz);
    if (f.size) {
      doby = f;
      loty = loty.filter(r => kluczScisly(r[1]) === lokKlucz);
      wybrany = { klucz: lokKlucz, nazwa: nazwyLokalizacji(f).get(lokKlucz) || lokKlucz };
    }
  }

  const klucze = [...doby.keys()];
  const biezaca = klucze[klucze.length - 1];
  const zamkniete = klucze.slice(0, -1);
  const tydzien = zamkniete.slice(-7);
  const mies = miesZ(biezaca), rok = rokZ(biezaca);
  const miesKlucze = zamkniete.filter(k => rokZ(k) === rok && miesZ(k) === mies);

  const lokLista = w => [...w.lok.entries()]
    .filter(([, v]) => v.plan)
    .map(([nazwa, v]) => ({ nazwa: nazwaLadna(nazwa), plan: v.plan, ok: v.ok, dod: v.dod,
      proc: Math.round(1000 * v.ok / v.plan) / 10 }))
    .sort((a, b) => b.proc - a.proc);

  const pak = (w, tytul, opis) => ({
    tytul, opis, plan: w.plan, ok: w.ok, ok_lp: w.okLp, niew: w.niew, dod: w.dod,
    proc: Math.round(w.proc * 100) / 100, proc_lp: Math.round(w.procLp * 100) / 100,
    man: w.man, doby: w.doby, objazdy: w.objazdy, interw: w.interw,
    pogoda: w.pogoda, technika: w.technika, kp: w.kp,
    kat: Object.fromEntries(Object.entries(w.kat)
      .filter(([k, v]) => k !== 'OK' && v).map(([k, v]) => [KAT_LABEL[k] || k, v])),
    lok: lokLista(w),
  });

  const wBiez = sumuj(doby, [biezaca]);
  const nominal = Math.max(nominalDoby(doby, loty, biezaca, zamkniete, obiekty), wBiez.plan);

  const przebieg = zamkniete.slice(-14).map(k => {
    const w = sumuj(doby, [k]);
    return {
      etykieta: etykietaKrotka(k), plan: w.plan, ok: w.ok, ok_lp: w.okLp, dod: w.dod,
      proc: Math.round(w.proc * 10) / 10, man: w.man, objazdy: w.objazdy, interw: w.interw,
    };
  });

  const kontrola = klucze.map(k => {
    const d = doby.get(k), w = sumuj(doby, [k]);
    return {
      doba: etykietaDoby(k), biezaca: k === biezaca,
      plan: w.plan, ok: w.ok, dod: w.dod, niew: w.niew, pogoda: w.pogoda,
      technika: w.technika, kp: w.kp, man: w.man, objazdy: w.objazdy,
      interw: w.interw,
      zrodla: Object.entries(d.zrodla).map(([n, c]) => `${n} (${c})`).join(', '),
      lok: [...d.lok.entries()].filter(([, v]) => v.plan || v.dod)
        .map(([nazwa, v]) => ({ nazwa: nazwaLadna(nazwa), plan: v.plan, ok: v.ok + (v.dod || 0), dod: v.dod || 0 })),
    };
  });

  const wTydz = sumuj(doby, tydzien);
  const wMies = sumuj(doby, miesKlucze);
  const kartaDoby = pak(wBiez, 'Bieżąca doba', `Doba ${etykietaDoby(biezaca)} — w trakcie`);
  kartaDoby.nominal = nominal;
  kartaDoby.proc = nominal ? Math.round(10000 * wBiez.ok / nominal) / 100 : 0;

  return {
    zaktualizowano: new Date().toLocaleString('pl-PL',
      { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    biezaca_doba: etykietaDoby(biezaca),
    karty: {
      doba: kartaDoby,
      tydzien: pak(wTydz, 'Ostatni tydzień', `${wTydz.doby} ostatnich dób zamkniętych`),
      miesiac: pak(wMies, `Narastająco — ${MIESIACE[mies]} ${rok}`,
        `${wMies.doby} dób zamkniętych od początku miesiąca`),
    },
    przebieg, kontrola, arkusze: wej.info, duplikaty: dubli,
    lokalizacje, lokalizacja: wybrany,
    obiekty: przegladObiektow(dobySur, obiekty, odciete, biezWsz),
    biezaca_iso: isoZ(biezWsz),
  };
}

/* Numer wersji logiki — app.js sprawdza, czy pasuje do jego własnego.
   Różne numery = telefon złożył aplikację z plików dwóch wersji. */
const WERSJA_ANALIZY = '3.0.1';

/* do testów w Node — w przeglądarce bez znaczenia */
if (typeof module !== 'undefined') {
  module.exports = { przelicz, rekordyZArkuszy, zbierz, sumuj, filtrujRekordy, nominalDoby,
    kluczScisly, OBIEKTY_WZORCOWE, wartoscDodatkowych, parseDate };
}
