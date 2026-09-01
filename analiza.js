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
      if (LP_RE.test(r[i] || '')) { kolTyp = i; break; }
    }
    if (kolTyp !== null) break;
  }
  if (kolTyp === null) return [[], []];
  const kolLok = Math.max(0, kolTyp - 1);

  const loty = [], zdarz = [], interw = [];
  let lok = null;
  for (const r of rows.slice(hdr + 1)) {
    if (r[kolLok] && r[kolLok].trim()) lok = r[kolLok].trim();
    const typ = (r[kolTyp] || '').trim();
    if (LP_RE.test(typ)) {
      kolumny.forEach(([ci, dat]) => loty.push([dat, lok || '—', typ.toUpperCase(), r[ci] || '', zrodlo]));
    } else if (LI_RE.test(typ)) {
      kolumny.forEach(([ci, dat]) => {
        const n = wartoscInterwencyjnego(r[ci] || '');
        if (n) interw.push([dat, lok || '—', typ.toUpperCase(), n]);
      });
    } else if (ZDARZ_RE.test(typ)) {
      kolumny.forEach(([ci, dat]) => { if ((r[ci] || '').trim()) zdarz.push([dat, lok || '—', r[ci]]); });
    }
  }
  return [loty, zdarz, interw];
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
  if (wTyp === null) return [[], []];
  const wLok = wTyp > 0 ? wTyp - 1 : wTyp;

  const naglowek = {};
  let biez = null;
  for (let i = 0; i < szer; i++) {
    const n = (rows[wLok][i] || '').trim();
    if (n) biez = n;
    naglowek[i] = biez;
  }
  const kolLP = [], kolZd = [], kolLI = [];
  for (let i = 0; i < szer; i++) {
    const t = rows[wTyp][i] || '';
    if (LP_RE.test(t)) kolLP.push([i, t.trim().toUpperCase()]);
    else if (LI_RE.test(t)) kolLI.push([i, t.trim().toUpperCase()]);
    else if (ZDARZ_RE.test(t)) kolZd.push(i);
  }
  const loty = [], zdarz = [], interw = [];
  for (const r of rows.slice(wTyp + 1)) {
    const dat = parseDate(r[kolDat]);
    if (!dat) continue;
    kolLP.forEach(([ci, et]) => loty.push([dat, naglowek[ci] || '—', et, r[ci] || '', zrodlo]));
    kolZd.forEach(ci => { if ((r[ci] || '').trim()) zdarz.push([dat, naglowek[ci] || '—', r[ci]]); });
    kolLI.forEach(([ci, et]) => {
      const n = wartoscInterwencyjnego(r[ci] || '');
      if (n) interw.push([dat, naglowek[ci] || '—', et, n]);
    });
  }
  return [loty, zdarz, interw];
}

function rekordyZArkusza(rows, zrodlo) {
  if (!rows || !rows.length) return [[], [], []];
  return wykryjUklad(rows) === 'A' ? ukladA(rows, zrodlo) : ukladB(rows, zrodlo);
}

/* Loty interwencyjne rozliczane są osobno — nie wchodzą do planu ani
   do procentu realizacji, bo wykonuje się je na zgłoszenie. */
function wartoscInterwencyjnego(v) {
  const x = (v || '').trim().replace(/\u00a0/g, '').replace(/\s/g, '');
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
function zbierz(loty, zdarzenia, interwencyjne) {
  const doby = new Map(), widziane = new Set();
  let dubli = 0;
  for (const [dat, lok, etyk, val, zrodlo] of loty) {
    const [kat, manual] = klasyfikuj(val);
    if (!kat) continue;
    const kl = kluczLokalizacji(lok);
    const klucz = dat + '|' + kl + '|' + etyk;
    if (widziane.has(klucz)) { dubli++; continue; }
    widziane.add(klucz);
    if (!doby.has(dat)) doby.set(dat, {
      plan: 0, ok: 0, man: 0, objazdy: 0, interw: 0, kat: {}, lok: new Map(),
      lokKlucze: new Map(), zrodla: {},
    });
    const d = doby.get(dat);
    if (zrodlo) d.zrodla[zrodlo] = (d.zrodla[zrodlo] || 0) + 1;
    d.plan++;
    d.kat[kat] = (d.kat[kat] || 0) + 1;
    if (kat === 'OK') { d.ok++; if (manual) d.man++; }
    if (!d.lokKlucze.has(kl)) d.lokKlucze.set(kl, lok);
    const nazwa = d.lokKlucze.get(kl);
    if (!d.lok.has(nazwa)) d.lok.set(nazwa, { plan: 0, ok: 0 });
    const l = d.lok.get(nazwa);
    l.plan++;
    if (kat === 'OK') l.ok++;
  }
  const widzianeZ = new Set();
  for (const [dat, lok, tekst] of zdarzenia) {
    const k = dat + '|' + lok + '|' + tekst.trim();
    if (widzianeZ.has(k)) continue;
    widzianeZ.add(k);
    const n = policzObjazdy(tekst);
    if (n && doby.has(dat)) doby.get(dat).objazdy += n;
  }
  const widzianeI = new Set();
  for (const [dat, lok, etyk, n] of (interwencyjne || [])) {
    const k = dat + '|' + kluczLokalizacji(lok) + '|' + etyk;
    if (widzianeI.has(k)) continue;
    widzianeI.add(k);
    if (!doby.has(dat)) doby.set(dat, {
      plan: 0, ok: 0, man: 0, objazdy: 0, interw: 0, kat: {}, lok: new Map(),
      lokKlucze: new Map(), zrodla: {},
    });
    doby.get(dat).interw += n;
  }
  return [new Map([...doby.entries()].sort((a, b) => a[0] - b[0])), dubli];
}

function sumuj(doby, klucze) {
  const w = { plan: 0, ok: 0, man: 0, objazdy: 0, interw: 0, kat: {}, lok: new Map(), doby: 0 };
  const lk = new Map();
  for (const k of klucze) {
    const d = doby.get(k);
    if (!d) continue;
    w.doby++;
    ['plan', 'ok', 'man', 'objazdy', 'interw'].forEach(p => { w[p] += (d[p] || 0); });
    Object.entries(d.kat).forEach(([kk, v]) => { w.kat[kk] = (w.kat[kk] || 0) + v; });
    d.lok.forEach((v, nazwa) => {
      const kl = kluczLokalizacji(nazwa);
      if (!lk.has(kl)) lk.set(kl, nazwa);
      const n = lk.get(kl);
      if (!w.lok.has(n)) w.lok.set(n, { plan: 0, ok: 0 });
      const t = w.lok.get(n);
      t.plan += v.plan; t.ok += v.ok;
    });
  }
  w.niew = w.plan - w.ok;
  w.proc = w.plan ? (100 * w.ok / w.plan) : 0;
  w.pogoda = ['DESZCZ', 'WILG', 'WIATR', 'MGLA'].reduce((a, k) => a + (w.kat[k] || 0), 0);
  w.technika = ['AWARIA', 'SERWIS'].reduce((a, k) => a + (w.kat[k] || 0), 0);
  w.kp = w.kat.KP || 0;
  return w;
}

/* Ile miejsc na loty (wierszy/kolumn LP) jest zdefiniowanych w arkuszu dla
   danej doby — licząc też jeszcze puste komórki. Odpowiednik potencjal_doby()
   z analiza.py — zobacz tam pełny opis i uzasadnienie. */
function potencjalDoby(loty, dat) {
  const widziane = new Set();
  for (const rek of loty) {
    if (rek[0] !== dat) continue;
    widziane.add(kluczLokalizacji(rek[1]) + '|' + rek[2]);
  }
  return widziane.size;
}

/* ---------- złożenie pełnego zestawu danych ---------- */
function przelicz(arkusze) {
  let loty = [], zdarz = [], interw = [];
  const info = [];
  for (const { nazwa, rows } of arkusze) {
    const [l, z, iv] = rekordyZArkusza(rows, nazwa);
    const wypelnione = l.filter(r => (r[3] || '').trim());
    if (!wypelnione.length) continue;
    const daty = [...new Set(wypelnione.map(r => r[0]))].sort();
    const p = n => String(n).padStart(2, '0');
    info.push({
      arkusz: nazwa, loty: wypelnione.length,
      zakres: `${p(dzienZ(daty[0]))}.${p(miesZ(daty[0]))} – ${p(dzienZ(daty[daty.length - 1]))}.${p(miesZ(daty[daty.length - 1]))}.${rokZ(daty[daty.length - 1])}`,
    });
    loty = loty.concat(l);
    zdarz = zdarz.concat(z);
    interw = interw.concat(iv);
  }
  const [doby, dubli] = zbierz(loty, zdarz, interw);
  if (!doby.size) throw new Error('Nie znaleziono danych o lotach w podanych arkuszach.');

  const klucze = [...doby.keys()];
  const biezaca = klucze[klucze.length - 1];
  const zamkniete = klucze.slice(0, -1);
  const tydzien = zamkniete.slice(-7);
  const mies = miesZ(biezaca), rok = rokZ(biezaca);
  const miesKlucze = zamkniete.filter(k => rokZ(k) === rok && miesZ(k) === mies);

  const lokLista = w => [...w.lok.entries()]
    .filter(([, v]) => v.plan)
    .map(([nazwa, v]) => ({ nazwa, plan: v.plan, ok: v.ok, proc: Math.round(1000 * v.ok / v.plan) / 10 }))
    .sort((a, b) => b.proc - a.proc);

  const pak = (w, tytul, opis) => ({
    tytul, opis, plan: w.plan, ok: w.ok, niew: w.niew,
    proc: Math.round(w.proc * 100) / 100, man: w.man, doby: w.doby,
    objazdy: w.objazdy, interw: w.interw,
    pogoda: w.pogoda, technika: w.technika, kp: w.kp,
    kat: Object.fromEntries(Object.entries(w.kat)
      .filter(([k, v]) => k !== 'OK' && v).map(([k, v]) => [KAT_LABEL[k] || k, v])),
    lok: lokLista(w),
  });

  const wBiez = sumuj(doby, [biezaca]);
  // Jezeli w arkuszu przybylo lotow dla lokalizacji (np. zwiekszenie liczby
  // lotow na dobe), dwie pierwsze wartosci tego jeszcze nie widza - opieraja
  // sie na dobach juz zamknietych. Dokladamy wiec realna liczbe miejsc na
  // loty zdefiniowana w arkuszu na dzis, zeby 100% od razu odzwierciedlalo
  // nowa liczbe lotow, zamiast czekac do jutra.
  const nominal = Math.max(
    ...zamkniete.slice(-7).map(k => sumuj(doby, [k]).plan),
    wBiez.plan, potencjalDoby(loty, biezaca), 0);

  const miesAgg = new Map();
  zamkniete.forEach(k => {
    const kk = rokZ(k) * 100 + miesZ(k);
    if (!miesAgg.has(kk)) miesAgg.set(kk, []);
    miesAgg.get(kk).push(k);
  });
  const listaMies = [...miesAgg.entries()].sort((a, b) => a[0] - b[0]).map(([kk, ks]) => {
    const w = sumuj(doby, ks);
    const mm = kk % 100, yy = Math.floor(kk / 100);
    return {
      etykieta: MIESIACE[mm].charAt(0).toUpperCase() + MIESIACE[mm].slice(1) + ' ' + yy,
      krotka: MIESIACE[mm].slice(0, 3).charAt(0).toUpperCase() + MIESIACE[mm].slice(1, 3),
      plan: w.plan, ok: w.ok, niew: w.niew, proc: Math.round(w.proc * 100) / 100,
      doby: w.doby, pogoda: w.pogoda, technika: w.technika, kp: w.kp,
      man: w.man, objazdy: w.objazdy, interw: w.interw,
    };
  });
  const wRok = sumuj(doby, zamkniete);

  const przebieg = zamkniete.slice(-14).map(k => {
    const w = sumuj(doby, [k]);
    return {
      etykieta: etykietaKrotka(k), plan: w.plan, ok: w.ok,
      proc: Math.round(w.proc * 10) / 10, man: w.man, objazdy: w.objazdy,
      interw: w.interw,
    };
  });

  const kontrola = klucze.map(k => {
    const d = doby.get(k), w = sumuj(doby, [k]);
    return {
      doba: etykietaDoby(k), biezaca: k === biezaca,
      plan: w.plan, ok: w.ok, niew: w.niew, pogoda: w.pogoda,
      technika: w.technika, kp: w.kp, man: w.man, objazdy: w.objazdy,
      interw: w.interw,
      zrodla: Object.entries(d.zrodla).map(([n, c]) => `${n} (${c})`).join(', '),
      lok: [...d.lok.entries()].filter(([, v]) => v.plan)
        .map(([nazwa, v]) => ({ nazwa, plan: v.plan, ok: v.ok })),
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
    rok: {
      miesiace: listaMies,
      suma: {
        plan: wRok.plan, ok: wRok.ok, niew: wRok.niew,
        proc: Math.round(wRok.proc * 100) / 100, doby: wRok.doby,
        man: wRok.man, objazdy: wRok.objazdy, interw: wRok.interw,
      },
    },
    przebieg, kontrola, arkusze: info, duplikaty: dubli,
  };
}
