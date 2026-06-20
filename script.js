const API_URL = 'https://script.google.com/macros/s/AKfycbyFU-9M16UBls1YvTZfXxCDGLFBT2CL1qvTH7S_pmdHCD6kSeQpHQlQW_gg6r5vhfjOZA/exec';

let appData = { matches: [], standings: [], stats: [] };
let activeView = 'summary';

const $ = (id) => document.getElementById(id);

async function init() {
  bindNavigation();
  try {
    const res = await fetch(`${API_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error('Network response failed');
    appData = await res.json();
    $('loading').classList.add('hidden');
    hydrateSettings();
    populateGroups();
    renderAll();
  } catch (err) {
    console.error(err);
    $('loading').classList.add('hidden');
    $('error').classList.remove('hidden');
  }
}

function bindNavigation() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => showView(el.dataset.view));
  });
  $('jumpSelect').addEventListener('change', e => showView(e.target.value));
  $('groupFilter').addEventListener('change', renderAll);
  $('searchInput').addEventListener('input', renderAll);
  window.addEventListener('scroll', () => $('backTop').classList.toggle('show', window.scrollY > 500));
  $('backTop').addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
}

function showView(view) {
  activeView = view;
  document.querySelectorAll('.view-section').forEach(s => s.classList.toggle('active', s.id === view));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('jumpSelect').value = view;
  document.querySelector('.control-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hydrateSettings() {
  const site = appData.site || {};
  $('siteTitle').textContent = site.siteTitle || 'Calcium Sport';
  $('siteTagline').textContent = site.tagline || 'World Cup 2026 results, fixtures, standings and stats';
}

function populateGroups() {
  const groups = [...new Set((appData.standings || []).map(r => r.Group).filter(Boolean))].sort(groupSort);
  $('groupFilter').innerHTML = '<option value="all">All groups</option>' + groups.map(g => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join('');
}

function getFilteredData() {
  const term = $('searchInput').value.trim().toLowerCase();
  const group = $('groupFilter').value;
  const standingsTeams = new Set((appData.standings || []).filter(r => group === 'all' || r.Group === group).map(r => r.Team));

  let matches = appData.matches || [];
  let standings = appData.standings || [];
  let stats = appData.stats || [];

  if (group !== 'all') {
    standings = standings.filter(r => r.Group === group);
    matches = matches.filter(m => standingsTeams.has(m.HomeTeam) || standingsTeams.has(m.AwayTeam) || m.Round === group);
    stats = stats.filter(s => standingsTeams.has(s.Team));
  }

  if (term) {
    matches = matches.filter(m => [m.HomeTeam, m.AwayTeam, m.Round].join(' ').toLowerCase().includes(term));
    standings = standings.filter(r => [r.Team, r.Group].join(' ').toLowerCase().includes(term));
    stats = stats.filter(s => [s.Player, s.Team].join(' ').toLowerCase().includes(term));
  }
  return { matches, standings, stats };
}

function renderAll() {
  const { matches, standings, stats } = getFilteredData();
  const results = matches.filter(isFinished).sort((a,b) => compareDate(b.Date, a.Date));
  const fixtures = matches.filter(m => !isFinished(m)).sort((a,b) => compareDate(a.Date, b.Date));

  $('latestResults').innerHTML = results.slice(0, 6).map(renderMatch).join('') || empty('No finished matches found.');
  $('nextFixtures').innerHTML = fixtures.slice(0, 6).map(renderMiniFixture).join('') || empty('No upcoming games found.');
  $('leaders').innerHTML = renderLeaders(stats);
  $('resultsList').innerHTML = results.map(renderMatch).join('') || empty('No results found.');
  $('fixturesList').innerHTML = fixtures.map(renderMatch).join('') || empty('No fixtures found.');
  $('standingsGrid').innerHTML = renderStandings(standings);
  renderStatBox('topGoals', stats, 'Goals');
  renderStatBox('topAssists', stats, 'Assists');
  renderStatBox('topYellows', stats, 'YellowCards');
  renderStatBox('topReds', stats, 'RedCards');
}

function renderMatch(m) {
  const statusClass = isFinished(m) ? 'ft' : 'scheduled';
  const statusText = isFinished(m) ? 'Finished' : 'Scheduled';
  const scoreHome = isFinished(m) ? escapeHtml(m.HomeScore || '0') : '–';
  const scoreAway = isFinished(m) ? escapeHtml(m.AwayScore || '0') : '–';
  return `
    <article class="match-row">
      <div><span class="round-pill">${escapeHtml(m.Round || 'Group Stage')}</span><div class="status ${statusClass}">${statusText}</div></div>
      <div class="teams">
        <div class="team-line"><img class="logo" src="${escapeAttr(m.HomeLogo)}" onerror="this.style.visibility='hidden'" alt=""><strong>${escapeHtml(m.HomeTeam)}</strong><span class="score">${scoreHome}</span></div>
        <div class="team-line"><img class="logo" src="${escapeAttr(m.AwayLogo)}" onerror="this.style.visibility='hidden'" alt=""><strong>${escapeHtml(m.AwayTeam)}</strong><span class="score">${scoreAway}</span></div>
      </div>
      <div class="muted">${escapeHtml(formatDate(m.Date))}</div>
    </article>`;
}

function renderMiniFixture(m) {
  return `<div class="mini-item"><span>${escapeHtml(m.HomeTeam)} vs ${escapeHtml(m.AwayTeam)}</span><strong>${escapeHtml(formatDate(m.Date))}</strong></div>`;
}

function renderLeaders(stats) {
  const topGoal = topBy(stats, 'Goals');
  const topAssist = topBy(stats, 'Assists');
  const topYellow = topBy(stats, 'YellowCards');
  return [
    leaderLine('Top scorer', topGoal, 'Goals'),
    leaderLine('Most assists', topAssist, 'Assists'),
    leaderLine('Most yellows', topYellow, 'YellowCards')
  ].join('');
}

function leaderLine(label, row, key) {
  if (!row) return `<div class="leader-item"><span>${label}</span><strong>–</strong></div>`;
  return `<div class="leader-item"><span>${label}<br><small class="muted">${escapeHtml(row.Player)} · ${escapeHtml(row.Team)}</small></span><strong>${Number(row[key] || 0)}</strong></div>`;
}

function renderStandings(rows) {
  const groups = groupBy(rows, 'Group');
  const names = Object.keys(groups).sort(groupSort);
  if (!names.length) return empty('No standings found.');
  return names.map(group => {
    const groupRows = groups[group].slice().sort(sortTableRows);
    return `<article class="table-card"><h3>${escapeHtml(group || 'Group')}</h3><table class="standing-table"><thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>${groupRows.map((r,i) => `<tr><td><div class="standing-team"><span>${i+1}</span><img class="logo" src="${escapeAttr(r.Logo)}" onerror="this.style.visibility='hidden'" alt="">${escapeHtml(r.Team)}</div></td><td>${num(r.Played)}</td><td>${num(r.Won)}</td><td>${num(r.Drawn)}</td><td>${num(r.Lost)}</td><td>${num(r.GoalDifference)}</td><td><strong>${num(r.Points)}</strong></td></tr>`).join('')}</tbody></table></article>`;
  }).join('');
}

function renderStatBox(id, stats, key) {
  const rows = stats.filter(s => Number(s[key] || 0) > 0).sort((a,b) => Number(b[key] || 0) - Number(a[key] || 0) || String(a.Player).localeCompare(String(b.Player))).slice(0, 12);
  $(id).innerHTML = rows.map(r => `<div class="stat-row"><img class="logo" src="${escapeAttr(r.Logo)}" onerror="this.style.visibility='hidden'" alt=""><div><div class="stat-player">${escapeHtml(r.Player)}</div><div class="stat-team">${escapeHtml(r.Team)}</div></div><div class="stat-value">${num(r[key])}</div></div>`).join('') || empty('No data yet.');
}

function isFinished(m) { return String(m.Status || '').toLowerCase().includes('ft') || (m.HomeScore !== '' && m.AwayScore !== ''); }
function topBy(rows, key) { return rows.filter(r => Number(r[key] || 0) > 0).sort((a,b) => Number(b[key] || 0) - Number(a[key] || 0))[0]; }
function sortTableRows(a,b){ return Number(b.Points)-Number(a.Points) || Number(b.GoalDifference)-Number(a.GoalDifference) || Number(b.GoalsFor)-Number(a.GoalsFor) || String(a.Team).localeCompare(String(b.Team)); }
function groupBy(rows,key){ return rows.reduce((acc,row)=>{ const k=row[key]||''; (acc[k] ||= []).push(row); return acc; },{}); }
function compareDate(a,b){ return new Date(a || 0) - new Date(b || 0); }
function groupSort(a,b){ return String(a).localeCompare(String(b), undefined, { numeric:true }); }
function formatDate(v){ if(!v) return ''; const d = new Date(v); return isNaN(d) ? v : d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}); }
function num(v){ return Number(v || 0); }
function empty(text){ return `<div class="state-card">${escapeHtml(text)}</div>`; }
function escapeHtml(v){ return String(v ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function escapeAttr(v){ return escapeHtml(v); }

init();
