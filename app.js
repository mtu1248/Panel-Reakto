/* Panel Statystyk REAKTO — warstwa aplikacji.
   Pobiera CAŁY skoroszyt wprost z Arkuszy Google (ten sam plik XLSX, który
   ściąga wersja na Maca), rozpakowuje go na urządzeniu, liczy statystyki
   i zapamiętuje ostatni wynik, żeby działać także bez połączenia.
   Jeden wklejony adres arkusza obejmuje wszystkie zakładki i miesiące. */

const WERSJA_APP = '3.0.1';

/* Niepełna aktualizacja: nowy app.js ze starym analiza.js (albo odwrotnie).
   Pokazujemy to wprost, zamiast mylącego „brak połączenia”. */
function zgodnoscPlikow() {
  if (typeof WERSJA_ANALIZY === 'undefined' || WERSJA_ANALIZY !== WERSJA_APP
      || typeof rekordyZArkuszy !== 'function') {
    return 'Aplikacja zaktualizowała się tylko częściowo (pliki z dwóch wersji: app.js '
      + WERSJA_APP + ', analiza.js ' + (typeof WERSJA_ANALIZY === 'undefined' ? 'starsza niż 3.0' : WERSJA_ANALIZY)
      + '). Zamknij aplikację całkowicie (przesuń w górę) i otwórz ją ponownie. '
      + 'Jeśli to nie pomoże: sprawdź, czy na GitHubie są wszystkie pliki nowej wersji, '
      + 'albo usuń ikonę i dodaj ją jeszcze raz z Safari.';
  }
  return null;
}

const KOLORY = {
  'Wilgotność': '#E9A13B', 'Deszcz': '#2E6FA8', 'Wiatr': '#9BC7DE',
  'Mgła': '#6FBBD6', 'Awaria': '#D9534F', 'Serwis': '#8896AB',
  'KP': '#7D8BA1', 'Inne': '#C9D6E5',
};

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pl = n => Number(n || 0).toLocaleString('pl-PL');
const proc = n => Number(n || 0).toFixed(2).replace('.', ',') + '%';

/* ---------- ustawienia ---------- */
const DOM = 'reakto.';
function ust() {
  try { return JSON.parse(localStorage.getItem(DOM + 'ust')) || {}; }
  catch (e) { return {}; }
}
function zapiszUst(u) { localStorage.setItem(DOM + 'ust', JSON.stringify(u)); }
/* Okres obsługi i harmonogram obiektów (3.0, jak desktop 3.8) — na
   urządzeniu. Brak klucza = pierwsze uruchomienie 3.0: wchodzi wzorzec
   (INPOST — ostatnia doba 26.10). Klucz obecny zostaje, nawet pusty. */
function obiektyUst() {
  const u = ust();
  if (u.obiekty === undefined) return JSON.parse(JSON.stringify(OBIEKTY_WZORCOWE));
  return u.obiekty || {};
}

/* Wybrany obiekt (pusty = całe Centrum) i surowe rekordy w pamięci —
   przełączenie obiektu albo zapis ustawień nie pobiera arkusza ponownie. */
let LOK = '';
try { LOK = localStorage.getItem(DOM + 'lok') || ''; } catch (e) { LOK = ''; }
let REK = null;
function ustawLok(v) {
  LOK = v || '';
  try { LOK ? localStorage.setItem(DOM + 'lok', LOK) : localStorage.removeItem(DOM + 'lok'); } catch (e) {}
}
function przeliczZPamieci() {
  if (!REK) return wczytaj(true);
  try {
    const d = przelicz(REK, obiektyUst(), LOK);
    if (LOK && !d.lokalizacja) { ustawLok(''); return przeliczZPamieci(); }
    const stare = cache() || {};
    d.odswiezanie_sek = stare.odswiezanie_sek; d.diagnostyka = stare.diagnostyka;
    d.zaktualizowano = stare.zaktualizowano || d.zaktualizowano;
    localStorage.setItem(DOM + 'dane', JSON.stringify(d));
    render(d);
  } catch (e) { wczytaj(true); }
}

function cache() {
  try { return JSON.parse(localStorage.getItem(DOM + 'dane')); }
  catch (e) { return null; }
}

/* ---------- pobieranie ---------- */
async function pobierz(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.text();
}

async function pobierzPlik(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.arrayBuffer();
}

function nazwaZUrl(u, i) {
  return 'Arkusz ' + (i + 1);
}

async function wczytaj(wymuszone) {
  const u = ust();
  const zrodla = (u.arkusze || []).filter(a => a.url);
  if (!zrodla.length) {
    pokazBrakKonfiguracji();
    return;
  }
  const niezgodne = zgodnoscPlikow();
  if (niezgodne) {
    $('#alert').textContent = niezgodne;
    $('#alert').classList.remove('hidden');
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
    }
    return;
  }
  $('#odswiez').classList.add('spin');

  // Każde źródło pobierane jest niezależnie — awaria jednego (błąd sieci,
  // pusty arkusz, chwilowy problem Google) nie może zablokować pozostałych.
  // To samo podejście co w wersji na komputer.
  const arkusze = [];
  const diagnostyka = [];
  const pomijaj = (u.pomijaj || []).map(x => x.trim().toLowerCase()).filter(Boolean);

  for (let i = 0; i < zrodla.length; i++) {
    const z = zrodla[i];
    const nazwaZrodla = (z.nazwa || nazwaZUrl(z.url, i)).trim();
    try {
      // Zwykły link do arkusza Google — pobieramy cały skoroszyt jako plik
      // XLSX, dokładnie tą samą drogą co aplikacja na Maca. Jeden adres
      // rozwija się na wszystkie zakładki.
      const id = idArkusza(z.url);
      if (id) {
        const buf = await pobierzPlik(adresXLSX(id));
        const zakladki = await czytajXLSX(buf);
        let dodane = 0;
        for (const ark of zakladki) {
          if (pomijaj.includes((ark.nazwa || '').toLowerCase())) continue;
          arkusze.push({ nazwa: ark.nazwa, rows: ark.rows });
          diagnostyka.push({ nazwa: ark.nazwa, ok: true,
            znakow: buf.byteLength, wierszy: ark.rows.length });
          dodane++;
        }
        if (!dodane) {
          diagnostyka.push({ nazwa: nazwaZrodla, ok: false, url: z.url,
            blad: 'Skoroszyt pobrany, ale nie ma w nim żadnej zakładki z danymi.' });
        }
        continue;
      }

      const tekst = await pobierz(z.url);
      // Adres Apps Script zwraca JSON z CAŁYM skoroszytem naraz — jeden
      // wpis w ustawieniach rozwija się wtedy na wiele zakładek, dokładnie
      // jak wersja na komputer. Zwykły opublikowany CSV (stary sposób)
      // nadal działa bez zmian — rozpoznanie jest automatyczne.
      let dopisane = 0;
      let json = null;
      try { json = JSON.parse(tekst); } catch (e) { /* to zwykły CSV, nie JSON */ }

      if (json && Array.isArray(json.arkusze)) {
        for (const ark of json.arkusze) {
          const nazwa = (ark.nazwa || nazwaZrodla).trim();
          if (pomijaj.includes(nazwa.toLowerCase())) continue;
          const rows = ark.rows || [];
          arkusze.push({ nazwa, rows });
          diagnostyka.push({ nazwa, ok: true, znakow: tekst.length, wierszy: rows.length });
          dopisane++;
        }
        if (!dopisane && !json.arkusze.length) {
          diagnostyka.push({ nazwa: nazwaZrodla, ok: false,
            blad: 'Skrypt odpowiedział, ale skoroszyt nie ma żadnych zakładek z danymi.' });
        }
      } else if (json && json.blad) {
        // Skrypt Apps Script sam zgłosił błąd (np. zły klucz dostępu)
        diagnostyka.push({ nazwa: nazwaZrodla, ok: false, blad: String(json.blad) });
      } else {
        if (pomijaj.includes(nazwaZrodla.toLowerCase())) continue;
        const rows = parseCSV(tekst);
        arkusze.push({ nazwa: nazwaZrodla, rows });
        diagnostyka.push({ nazwa: nazwaZrodla, ok: true, znakow: tekst.length, wierszy: rows.length });
      }
    } catch (e) {
      diagnostyka.push({ nazwa: nazwaZrodla, ok: false, blad: e.message, url: z.url });
    }
  }

  try {
    if (!arkusze.length) {
      throw new Error('Żadne źródło nie odpowiedziało — zobacz listę poniżej.');
    }
    REK = rekordyZArkuszy(arkusze);
    let d = przelicz(REK, obiektyUst(), LOK);
    // zapamiętany obiekt zniknął z arkusza — wracamy do całości
    if (LOK && !d.lokalizacja) { ustawLok(''); d = przelicz(REK, obiektyUst(), ''); }
    d.odswiezanie_sek = (u.cykl || 10) * 60;
    d.diagnostyka = diagnostyka;
    localStorage.setItem(DOM + 'dane', JSON.stringify(d));
    render(d);
    $('#alert').classList.add('hidden');
    // Jeśli którekolwiek źródło zawiodło, a reszta wystarczyła do policzenia
    // statystyk, informujemy o tym bez blokowania widoku.
    const zle = diagnostyka.filter(x => !x.ok);
    if (zle.length) {
      $('#alert').textContent = 'Nie udało się pobrać: '
        + zle.map(x => x.nazwa).join(', ') + '. Pokazane dane pochodzą z '
        + 'pozostałych źródeł.';
      $('#alert').classList.remove('hidden');
    }
  } catch (e) {
    // „Brak połączenia” tylko wtedy, gdy naprawdę żadne źródło nie odpowiedziało.
    // Gdy arkusz przyszedł, a nie dał się przeliczyć — mówimy to wprost, z treścią błędu.
    const pobrano = arkusze.length > 0;
    const z = cache();
    if (z) {
      try { render(z); } catch (e2) { /* zapis ze starszej wersji */ }
      $('#alert').textContent = (pobrano
        ? 'Arkusz pobrany, ale nie udało się go przeliczyć: ' + e.message + ' — '
        : 'Brak połączenia — ')
        + 'pokazane są dane z ostatniego pobrania (' + (z.zaktualizowano || '—') + ').';
      $('#alert').classList.remove('hidden');
    } else {
      pokazBladPobierania(e, diagnostyka);
    }
  } finally {
    $('#odswiez').classList.remove('spin');
  }
}

function pokazBladPobierania(e, diagnostyka) {
  $('#stamp').innerHTML = '<span>błąd pobierania</span>';
  const wiersze = (diagnostyka || []).map(x => x.ok
    ? `<tr><td>${esc(x.nazwa)}</td><td style="color:var(--green)">odebrano ${pl(x.znakow)} znaków, ${pl(x.wierszy)} wierszy — ale bez lotów</td></tr>`
    : `<tr><td>${esc(x.nazwa)}</td><td style="color:var(--red)">${esc(x.blad)}</td></tr>`
  ).join('');
  $('#app').innerHTML = `<div class="card"><h3>Nie udało się pobrać danych</h3>
    <p class="muted">${esc(e.message)}</p>
    ${wiersze ? `<div class="tw"><table class="diag"><tbody>${wiersze}</tbody></table></div>` : ''}
    <p class="muted" style="margin-top:12px">Najczęstsze przyczyny:</p>
    <p class="muted">
    <b>1.</b> Arkusz przestał być udostępniony przez link. Otwórz go w Safari
    w trybie prywatnym — jeśli prosi o logowanie, właściciel zmienił
    udostępnianie i trzeba je przywrócić („każda osoba mająca link —
    przeglądający”).<br>
    <b>2.</b> Wklejony adres nie jest adresem arkusza Google. Powinien
    zawierać fragment <code>/spreadsheets/d/</code>.<br>
    <b>3.</b> Za stary system — rozpakowanie skoroszytu wymaga iOS 16.4
    lub nowszego.<br>
    <b>4.</b> Chwilowy brak sieci — spróbuj ponownie za chwilę.</p>
    <button class="b pri" onclick="otworzUstawienia()">Otwórz ustawienia</button>
    </div>`;
}

function pokazBrakKonfiguracji() {
  $('#stamp').innerHTML = '<span>brak konfiguracji</span>';
  $('#app').innerHTML = `<div class="card">
    <h3>Zacznij od podania arkusza</h3>
    <p class="muted">Aplikacja pobiera cały skoroszyt wprost z Arkuszy Google —
    tak samo jak wersja na komputer. Nie potrzebuje Maca, serwera ani
    publikowania arkusza.</p>
    <p class="muted"><b>1.</b> Otwórz arkusz z realizacją lotów (w Arkuszach
    Google albo w Safari).<br>
    <b>2.</b> Skopiuj jego adres — wystarczy zwykły link „Udostępnij” albo
    adres z paska przeglądarki.<br>
    <b>3.</b> Wklej go w ustawieniach poniżej i zapisz.</p>
    <p class="muted">Jeden adres obejmuje wszystkie zakładki i wszystkie
    miesiące. Warunek: arkusz musi być udostępniony „każda osoba mająca
    link — przeglądający” (tak jest dziś ustawiony).</p>
    <button class="b pri" onclick="otworzUstawienia()">Otwórz ustawienia</button>
  </div>`;
}

/* ---------- karty ---------- */
function kartaDoby(d) {
  const nom = d.nominal || d.plan;
  // od 3.0 `ok` zawiera LPD; „oczekuje” liczymy z samego harmonogramu
  const ok = d.ok, niew = d.niew;
  const okLp = d.ok_lp != null ? d.ok_lp : ok - (d.dod || 0);
  const czeka = Math.max(0, nom - okLp - niew);
  const p = n => nom ? (100 * n / nom) : 0;
  const w = (nazwa, n, kolor, zProc) => `<div class="dr">
      <span class="dot" style="background:${kolor}"></span>
      <span class="dn">${nazwa}</span>
      <span class="dv">${pl(n)}</span>
      <span class="dp">${zProc ? proc(p(n)) : ''}</span></div>`;
  return `<div class="card">
    <h3>${esc(d.tytul)}</h3><div class="sub">${esc(d.opis)}</div>
    ${w('Zaplanowane', nom, '#132F55', false)}
    ${w(d.dod ? 'Wykonane (z LPD)' : 'Wykonane', ok, '#27B0D8', true)}
    ${w('Niewykonane', niew, '#D9534F', true)}
    ${w('Oczekuje na wykonanie', czeka, '#C9D6E5', true)}
    ${d.dod ? w('w tym dodatkowe (LPD)', d.dod, '#229668', false) : ''}
    <div class="bar"><i class="ok" style="width:${Math.min(100, p(ok))}%"></i>
      <i class="nw" style="width:${p(niew)}%"></i></div>
    ${miniAlt(d)}${przyczyny(d)}</div>`;
}

function miniAlt(d) {
  return `<div class="mini alt cztery">
    <div><b>${pl(d.man)}</b><span>loty ręczne</span></div>
    <div><b>${pl(d.objazdy)}</b><span>objazdy</span></div>
    <div><b>${pl(d.interw)}</b><span>interwencyjne</span></div>
    <div><b>${pl(d.kp)}</b><span>KP</span></div></div>`;
}

function przyczyny(d) {
  const k = Object.entries(d.kat || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!k.length) return '';
  const max = k[0][1];
  return `<div class="reasons">${k.map(([n, v]) => `<div class="reason">
    <span class="nm">${esc(n)}</span>
    <span class="tr"><i style="width:${Math.round(100 * v / max)}%;background:${KOLORY[n] || '#8896AB'}"></i></span>
    <span class="n">${v}</span></div>`).join('')}</div>`;
}

// 1 dodatkowy, 2–4 dodatkowe, 5+ dodatkowych (12–14 też „dodatkowych”)
function odmDod(n) {
  if (n === 1) return 'dodatkowy';
  const j = n % 10, d = n % 100;
  return (j >= 2 && j <= 4 && !(d >= 12 && d <= 14)) ? 'dodatkowe' : 'dodatkowych';
}

function karta(d, akcent) {
  return `<div class="card">
    <h3>${esc(d.tytul)}</h3><div class="sub">${esc(d.opis)}</div>
    <div class="big ${akcent ? 'cy' : ''}">${proc(d.proc)}</div>
    <div class="bsub">${pl(d.ok)} z ${pl(d.plan)} lotów zrealizowanych${
      d.dod ? ` <b class="gr">(w tym ${pl(d.dod)} ${odmDod(d.dod)} — LPD)</b>` : ''}</div>
    <div class="bar"><i class="ok" style="width:${Math.min(100, d.proc)}%"></i></div>
    ${d.dod && d.proc_lp != null ? `<div class="bsub">sam harmonogram, bez LPD: <b>${proc(d.proc_lp)}</b></div>` : ''}
    <div class="mini">
      <div><b>${pl(d.niew)}</b><span>niezrealizowane</span></div>
      <div><b>${pl(d.pogoda)}</b><span>pogoda</span></div>
      <div><b>${pl(d.technika)}</b><span>technika</span></div></div>
    ${miniAlt(d)}${przyczyny(d)}</div>`;
}

function tabelaLok(lok) {
  if (!lok || !lok.length) return '<p class="muted">Brak danych.</p>';
  const s = lok.reduce((a, r) => ({ plan: a.plan + r.plan, ok: a.ok + r.ok }), { plan: 0, ok: 0 });
  return `<div class="tw"><table><thead><tr><th>Lokalizacja</th><th>Plan</th>
    <th>Wyk.</th><th>Realiz.</th></tr></thead><tbody>
    ${lok.map(r => `<tr><td>${esc(r.nazwa)}</td><td>${pl(r.plan)}</td>
      <td>${pl(r.ok)}</td><td>${String(r.proc).replace('.', ',')}%</td></tr>`).join('')}
    <tr class="total"><td>RAZEM</td><td>${pl(s.plan)}</td><td>${pl(s.ok)}</td>
      <td>${s.plan ? (100 * s.ok / s.plan).toFixed(1).replace('.', ',') : '0'}%</td></tr>
    </tbody></table></div>`;
}

function wykres(dane, etyk, wart, maxWart) {
  if (!dane || !dane.length) return '';
  const max = Math.max(...dane.map(maxWart), 1);
  return `<div class="chart">${dane.map(d => {
    const h = Math.round(118 * maxWart(d) / max);
    const hf = Math.round(h * (maxWart(d) ? wart(d) / maxWart(d) : 0));
    return `<div class="col"><div class="vl">${d.proc != null ? String(d.proc).replace('.', ',') + '%' : ''}</div>
      <div class="st"><div class="rs" style="height:${h - hf}px"></div>
      <div class="fl" style="height:${hf}px"></div></div>
      <div class="lb">${esc(etyk(d))}</div></div>`;
  }).join('')}</div>
  <div class="legend">
    <span><i class="dot" style="background:#27B0D8"></i>wykonane</span>
    <span><i class="dot" style="background:#DCE6F1"></i>plan niezrealizowany</span></div>`;
}

/* ---------- render ---------- */
let ODL = null;
function odliczanie(sek) {
  clearInterval(ODL);
  let left = sek;
  const p = () => {
    const el = $('#next');
    if (!el) return;
    const m = Math.ceil(left / 60);
    el.textContent = left > 0 ? ' · następne za ' + m + ' min' : ' · odświeżanie…';
  };
  p();
  ODL = setInterval(() => { left = Math.max(0, left - 1); p(); }, 1000);
}

let PETLA = null;
function render(d) {
  $('#stamp').innerHTML = '<span>aktualizacja: <b>' + esc(d.zaktualizowano)
    + '</b><span id="next"></span></span>';
  if (d.odswiezanie_sek) {
    odliczanie(d.odswiezanie_sek);
    clearInterval(PETLA);
    PETLA = setInterval(() => wczytaj(true), Math.max(60, d.odswiezanie_sek) * 1000);
  }

  const wy = d.lokalizacja || null;
  const etyk = x => esc(x.nazwa) + (x.status === 'zakonczony' && x.do
    ? ' — zakończony (ostatnia noc ' + esc(nocZ(x.do)) + ')' : '');
  $('#app').innerHTML = `
    ${(d.lokalizacje || []).length ? `<div class="lokw">
      <select id="lokSel" aria-label="Zakres danych">
        <option value="">Całe Centrum Operacyjne</option>
        ${d.lokalizacje.map(x => `<option value="${esc(x.klucz)}"${wy && wy.klucz === x.klucz ? ' selected' : ''}>${etyk(x)}</option>`).join('')}
      </select></div>` : ''}
    <div class="kicker">${wy ? 'Wybrany obiekt' : 'Stan bieżący'}</div>
    <h2>${wy ? esc(wy.nazwa) : 'Realizacja lotów'}</h2>
    <div class="cards">
      ${kartaDoby(d.karty.doba)}
      ${karta(d.karty.tydzien, true)}
      ${karta(d.karty.miesiac, false)}
    </div>

    <div class="kicker">Przebieg dobowy</div>
    <h2>Ostatnie doby zamknięte</h2>
    <div class="card">${wykres(d.przebieg, x => x.etykieta, x => x.ok, x => x.plan)}</div>

    ${wy ? '' : `<div class="kicker">Podział na obiekty</div>
    <h2>Lokalizacje</h2>
    <div class="card"><h3>Narastająco w miesiącu</h3>${tabelaLok(d.karty.miesiac.lok)}</div>
    <div class="card"><h3>Ostatni tydzień</h3>${tabelaLok(d.karty.tydzien.lok)}</div>`}

    <div class="kicker">Ciągłość usługi</div>
    <h2>Objazdy i loty ręczne</h2>
    <div class="card">
      <p class="muted" style="margin:0 0 12px">Gdy lot automatyczny nie mógł się odbyć,
      obiekt nie zostawał bez nadzoru — realizowany był objazd zastępczy albo lot ręczny.</p>
      ${[['Bieżąca doba', d.karty.doba], ['Ostatni tydzień', d.karty.tydzien],
         ['Narastająco w miesiącu', d.karty.miesiac]].map(([t, k]) => `
        <div class="dr"><span class="dn"><b>${esc(t)}</b></span>
          <span class="dv">${pl(k.objazdy)}</span><span class="dp">objazdy</span></div>
        <div class="dr"><span class="dn"></span>
          <span class="dv">${pl(k.man)}</span><span class="dp">ręczne</span></div>
        <div class="dr"><span class="dn"></span>
          <span class="dv">${pl(k.interw)}</span><span class="dp">interwencyjne</span></div>`).join('')}
    </div>

    <div class="kicker">Kontrola danych</div>
    <h2 class="sec-t" onclick="this.classList.toggle('open');
      document.getElementById('ctrl').classList.toggle('open')">
      <span class="caret">▸</span>Rozliczenie doba po dobie</h2>
    <div id="ctrl" class="card coll">
      <p class="muted" style="margin:0 0 11px">Kolumna „arkusz” pokazuje, skąd pochodzą
      loty danej doby. Dotknij wiersza, aby zobaczyć rozbicie na lokalizacje.</p>
      <div class="tw"><table>
        <thead><tr><th>Doba</th><th>Plan</th><th>Wyk.</th><th>w tym LPD</th><th>Niewyk.</th><th>Pogoda</th>
          <th>Techn.</th><th>KP</th><th>Ręczne</th><th>Objazdy</th><th>Interw.</th>
          <th style="text-align:left">Arkusz</th></tr></thead><tbody>
        ${(d.kontrola || []).map((x, i) => `<tr class="row-d ${x.biezaca ? 'bz' : ''}"
            onclick="document.getElementById('lk${i}').classList.toggle('open')">
          <td>${esc(x.doba)}</td><td>${pl(x.plan)}</td><td>${pl(x.ok)}</td>
          <td>${pl(x.dod)}</td><td>${pl(x.niew)}</td><td>${pl(x.pogoda)}</td><td>${pl(x.technika)}</td>
          <td>${pl(x.kp)}</td><td>${pl(x.man)}</td><td>${pl(x.objazdy)}</td>
          <td>${pl(x.interw)}</td>
          <td class="src">${esc(x.zrodla || '—')}</td></tr>
        <tr id="lk${i}" class="lok-r"><td colspan="12">
          ${(x.lok || []).map(l => `<span class="lchip"><b>${esc(l.nazwa)}</b>${l.ok}/${l.plan}${l.dod ? ' (LPD ' + l.dod + ')' : ''}</span>`).join('')}
        </td></tr>`).join('')}
        ${(() => {
          const z = (d.kontrola || []).filter(x => !x.biezaca);
          const s = f => z.reduce((a, x) => a + x[f], 0);
          return `<tr class="total"><td>RAZEM (zamknięte)</td><td>${pl(s('plan'))}</td>
            <td>${pl(s('ok'))}</td><td>${pl(s('dod'))}</td><td>${pl(s('niew'))}</td><td>${pl(s('pogoda'))}</td>
            <td>${pl(s('technika'))}</td><td>${pl(s('kp'))}</td><td>${pl(s('man'))}</td>
            <td>${pl(s('objazdy'))}</td><td>${pl(s('interw'))}</td><td></td></tr>`;
        })()}
      </tbody></table></div>
    </div>`;
  const sel = $('#lokSel');
  if (sel) sel.onchange = () => { ustawLok(sel.value); przeliczZPamieci(); window.scrollTo(0, 0); };
  OSTATNIE = d;

  if (d.diagnostyka) {
    const zle = d.diagnostyka.filter(x => !x.ok);
    let h = '<label style="font-family:var(--head);font-size:12px;'
      + 'font-weight:600;color:var(--navy)">Pobieranie źródeł</label>'
      + '<table class="diag"><tbody>'
      + d.diagnostyka.map(x => x.ok
          ? `<tr><td>${esc(x.nazwa)}</td><td style="color:var(--green)">OK — ${pl(x.wierszy)} wierszy</td></tr>`
          : `<tr><td>${esc(x.nazwa)}</td><td style="color:var(--red)">${esc(x.blad)}</td></tr>`)
        .join('')
      + '</tbody></table>';
    if (zle.length) {
      h += `<p class="muted" style="margin-top:6px">Adres źródła z błędem: `
        + zle.map(x => `<code>${esc((x.url || '').slice(0, 46))}…</code>`).join(', ') + '</p>';
    }
    $('#stan').innerHTML = h;
  }
  if (d.arkusze) {
    $('#stan').innerHTML += '<label style="font-family:var(--head);font-size:12px;'
      + 'font-weight:600;color:var(--navy);margin-top:10px;display:block">Rozpoznane loty</label>'
      + '<table class="diag"><tbody>'
      + d.arkusze.map(a => `<tr><td>${esc(a.arkusz)}</td><td>${pl(a.loty)} lotów</td>
          <td>${esc(a.zakres)}</td></tr>`).join('')
      + '</tbody></table>'
      + (d.duplikaty ? `<p class="muted" style="margin-top:7px">Pominięto
          ${pl(d.duplikaty)} powtórzonych wpisów.</p>` : '');
  }
}

/* ---------- ustawienia obiektów ---------- */
let OSTATNIE = null;
function nocZ(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00'), n = new Date(d.getTime() + 864e5);
  const p = x => String(x).padStart(2, '0');
  return p(d.getDate()) + '/' + p(n.getDate()) + '.' + p(n.getMonth() + 1);
}
const ST = { aktywny: 'aktywny', zakonczony: 'zakończony', planowany: 'jeszcze nie ruszył' };

function wierszZm(z) {
  return `<div class="ob-zm"><input type="date" data-z="od" value="${esc(z.od || '')}" aria-label="od doby">
    <input type="number" min="1" inputmode="numeric" data-z="loty" value="${esc(z.loty || '')}" placeholder="lotów/dobę">
    <button type="button" class="ob-x">×</button></div>`;
}

function rysujObiekty() {
  const box = $('#obiekty');
  const lista = (OSTATNIE && OSTATNIE.obiekty) || [];
  if (!lista.length) { box.innerHTML = '<p class="muted">Lista pojawi się po pierwszym pobraniu danych.</p>'; return; }
  const ustOb = obiektyUst();
  box.innerHTML = lista.map(o => {
    const u = ustOb[o.klucz] || { od: null, do: null, zmiany: [] };
    return `<details class="ob" data-klucz="${esc(o.klucz)}" data-nazwa="${esc(o.nazwa)}">
      <summary><b>${esc(o.nazwa)}</b> <span class="ob-st st-${o.status}">${ST[o.status] || o.status}</span></summary>
      <p class="muted">dane: ${esc(o.od_danych)} – ${esc(o.do_danych)} · ostatnia zamknięta doba
        ${esc(o.ostatnia_doba)}: ${o.loty_ostatniej}${o.norma ? ' z ' + o.norma : ''} lotów${
        o.odciete ? ` · <b>poza okresem: ${o.odciete} wpisów</b>` : ''}</p>
      <div class="ob-2">
        <label>Pierwsza doba<input type="date" data-u="od" value="${esc(u.od || '')}"></label>
        <label>Ostatnia doba<input type="date" data-u="do" value="${esc(u.do || '')}"></label>
      </div>
      <p class="muted ob-noc">${u.do ? 'ostatnia noc: ' + esc(nocZ(u.do)) : ''}</p>
      <label class="ob-l">Zmiany liczby lotów (od doby · lotów na dobę)</label>
      <div class="ob-zmiany">${(u.zmiany || []).map(wierszZm).join('')}</div>
      <button type="button" class="b sec ob-dodaj">+ Zmiana liczby lotów</button>
    </details>`;
  }).join('');
  box.querySelectorAll('details.ob').forEach(det => {
    const pod = () => det.querySelectorAll('.ob-x').forEach(b => b.onclick = () => b.parentNode.remove());
    det.querySelector('.ob-dodaj').onclick = () => {
      det.querySelector('.ob-zmiany').insertAdjacentHTML('beforeend', wierszZm({})); pod();
    };
    const doInp = det.querySelector('[data-u="do"]');
    doInp.oninput = () => { det.querySelector('.ob-noc').textContent = doInp.value ? 'ostatnia noc: ' + nocZ(doInp.value) : ''; };
    pod();
  });
}

function zbierzObiekty() {
  const out = {};
  // obiekty spoza bieżącej listy (np. nieobecne w arkuszu) zostają nietknięte
  Object.assign(out, obiektyUst());
  document.querySelectorAll('#obiekty details.ob').forEach(det => {
    const u = { nazwa: det.dataset.nazwa, od: null, do: null, zmiany: [] };
    det.querySelectorAll('[data-u]').forEach(p => { u[p.dataset.u] = p.value || null; });
    det.querySelectorAll('.ob-zm').forEach(w => {
      const od = w.querySelector('[data-z="od"]').value, loty = Number(w.querySelector('[data-z="loty"]').value);
      if (od && loty > 0) u.zmiany.push({ od, loty });
    });
    u.zmiany.sort((a, b) => a.od < b.od ? -1 : 1);
    if (u.od && u.do && u.od > u.do) throw new Error(u.nazwa + ': pierwsza doba jest po ostatniej.');
    if (!u.od && !u.do && !u.zmiany.length) delete out[det.dataset.klucz];
    else out[det.dataset.klucz] = u;
  });
  return out;
}

/* ---------- ustawienia ---------- */
function wierszZrodla(nazwa, url) {
  const d = document.createElement('div');
  d.className = 'src-r';
  d.innerHTML = `<input class="u" placeholder="adres kolejnego arkusza" value="${esc(url || '')}">
    <button type="button">×</button>`;
  d.querySelector('button').onclick = () => d.remove();
  return d;
}

function otworzUstawienia() {
  const u = ust();
  const wszystkie = u.arkusze || [];
  const l = $('#lista');
  l.innerHTML = '';
  $('#glowny').value = wszystkie[0] ? wszystkie[0].url : '';
  wszystkie.slice(1).forEach(a => l.appendChild(wierszZrodla(a.nazwa, a.url)));
  $('#cykl').value = u.cykl || 10;
  $('#pomijaj').value = (u.pomijaj || []).join(', ');
  if (wszystkie.length > 1) {
    $('#zaawToggle').classList.add('open');
    $('#zaawBox').classList.add('open');
  }
  rysujObiekty();
  $('#sheet').classList.remove('hidden');
}

$('#ustaw').onclick = otworzUstawienia;
$('#zamknij').onclick = () => $('#sheet').classList.add('hidden');
$('#dodaj').onclick = () => $('#lista').appendChild(wierszZrodla('', ''));
$('#odswiez').onclick = () => wczytaj(true);
$('#zapisz').onclick = () => {
  let obiekty;
  try { obiekty = zbierzObiekty(); }
  catch (e) { alert(e.message); return; }
  const arkusze = [];
  const glowny = $('#glowny').value.trim();
  if (glowny) arkusze.push({ nazwa: '', url: glowny });
  [...$('#lista').querySelectorAll('.src-r')].forEach((r, i) => {
    const url = r.querySelector('.u').value.trim();
    if (url) arkusze.push({ nazwa: 'Źródło ' + (i + 2), url });
  });
  zapiszUst({
    arkusze,
    cykl: Number($('#cykl').value) || 10,
    pomijaj: $('#pomijaj').value.split(',').map(x => x.trim()).filter(Boolean),
    obiekty,
  });
  $('#sheet').classList.add('hidden');
  $('#stamp').innerHTML = '<span>przeliczanie…</span>';
  // te same arkusze w pamięci — przeliczamy od razu, potem i tak pobieramy
  if (REK && arkusze.length) przeliczZPamieci();
  wczytaj(true);
};

/* ---------- start ---------- */
const z = cache();
if (z) { try { render(z); } catch (e) { /* zapis ze starszej wersji — poczekaj na pobranie */ } }
wczytaj(false);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) wczytaj(false);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
