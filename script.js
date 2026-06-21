const API_URL = 'https://script.google.com/macros/s/AKfycbyFU-9M16UBls1YvTZfXxCDGLFBT2CL1qvTH7S_pmdHCD6kSeQpHQlQW_gg6r5vhfjOZA/exec';
let appData = null;
let currentCompetition = new URLSearchParams(location.search).get('competition') || '';

const $ = id => document.getElementById(id);

init();

async function init(){
  setLoading();
  await loadCompetition(currentCompetition);
  bindEvents();
}

function setLoading(){
  $('competitionTitle').textContent = 'Loading...';
  $('latestResults').innerHTML = '<div class="empty">Loading results...</div>';
}

async function loadCompetition(comp){
  const url = comp ? `${API_URL}?competition=${encodeURIComponent(comp)}` : API_URL;
  const res = await fetch(url, {cache:'no-store'});
  appData = await res.json();
  currentCompetition = comp || competitionKey(appData.selectedCompetition || (appData.competitions || [])[0]);
  renderAll();
}

function bindEvents(){
  $('competitionSelect').addEventListener('change', async e => {
    const value = e.target.value;
    const qs = value ? `?competition=${encodeURIComponent(value)}` : location.pathname;
    history.replaceState(null, '', qs);
    await loadCompetition(value);
  });
  $('jumpSelect').addEventListener('change', e => scrollToSection(e.target.value));
  document.querySelectorAll('.tabs button').forEach(btn => btn.addEventListener('click', () => scrollToSection(btn.dataset.target)));
  $('searchInput').addEventListener('input', renderContent);
  $('groupFilter').addEventListener('change', renderContent);
  $('clearFilters').addEventListener('click', () => { $('searchInput').value=''; $('groupFilter').value='all'; renderContent(); });
  window.addEventListener('scroll', () => { $('toTop').style.display = scrollY > 500 ? 'block' : 'none'; });
  $('toTop').addEventListener('click', () => scrollTo({top:0,behavior:'smooth'}));
}

function renderAll(){
  renderHeader();
  renderCompetitionSelect();
  renderGroups();
  renderContent();
}

function renderHeader(){
  const site = appData.site || {};
  $('competitionTitle').textContent = `${site.competition || 'Competition'} ${site.year || ''}`.trim();
  $('competitionMeta').textContent = `${site.region || ''} • ${site.tagline || 'Fixtures, results, standings and stats'}`;
  $('regionLabel').textContent = (site.region || 'World').toUpperCase();
  $('seasonLabel').textContent = `${site.competition || 'Football'} ${site.year || ''}`.trim();
  $('startDate').textContent = site.startDate || 'Start';
  $('endDate').textContent = site.endDate || 'End';
  if(site.logoUrl){ $('competitionLogo').src = site.logoUrl; $('competitionLogo').style.display='block'; } else { $('competitionLogo').style.display='none'; }
  $('progressBar').style.width = progressPercent(site.startDate, site.endDate) + '%';
}

function renderCompetitionSelect(){
  const comps = appData.competitions || [];
  const selectedName = (appData.selectedCompetition || {})['Competition Name'];
  $('competitionSelect').innerHTML = comps.map(c => {
    const key = competitionKey(c);
    const label = `${c['Competition Name']} ${c.Year || ''}`.trim();
    const selected = c['Competition Name'] === selectedName ? 'selected' : '';
    return `<option value="${escapeHtml(key)}" ${selected}>${escapeHtml(label)}</option>`;
  }).join('');
}

function renderGroups(){
  const groups = [...new Set((appData.standings || []).map(r => r.Group).filter(Boolean))];
  $('groupFilter').innerHTML = '<option value="all">All groups/tables</option>' + groups.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
}

function renderContent(){
  const q = $('searchInput').value.trim().toLowerCase();
  const group = $('groupFilter').value;
  const matches = filterMatches(appData.matches || [], q);
  const completed = matches.filter(m => m.Status === 'FT').slice().reverse();
  const scheduled = matches.filter(m => m.Status !== 'FT');
  const standings = filterStandings(appData.standings || [], q, group);
  const stats = filterStats(appData.stats || [], q);

  $('latestResults').innerHTML = renderMatches(completed.slice(0,5));
  $('upcomingFixtures').innerHTML = renderMatches(scheduled.slice(0,5));
  $('resultsList').innerHTML = renderMatches(completed);
  $('fixturesList').innerHTML = renderMatches(scheduled);
  $('resultsCount').textContent = `${completed.length} matches`;
  $('fixturesCount').textContent = `${scheduled.length} matches`;
  renderStandings(standings);
  renderStats(stats);
}

function filterMatches(rows,q){
  if(!q) return rows;
  return rows.filter(m => `${m.HomeTeam} ${m.AwayTeam} ${m.Round}`.toLowerCase().includes(q));
}
function filterStandings(rows,q,group){
  return rows.filter(r => (group === 'all' || r.Group === group) && (!q || `${r.Team} ${r.Group}`.toLowerCase().includes(q)));
}
function filterStats(rows,q){
  if(!q) return rows;
  return rows.filter(r => `${r.Player} ${r.Team}`.toLowerCase().includes(q));
}

function renderMatches(rows){
  if(!rows.length) return '<div class="empty">No matches found.</div>';
  return rows.map(m => `
    <div class="match-row">
      <div class="status ${m.Status === 'FT' ? 'ft' : ''}">${m.Status === 'FT' ? 'Finished' : 'Scheduled'}</div>
      <div class="teams">
        <div class="team">${logo(m.HomeLogo)}<span>${escapeHtml(m.HomeTeam)}</span></div>
        <div class="team">${logo(m.AwayLogo)}<span>${escapeHtml(m.AwayTeam)}</span></div>
        <div class="meta">${escapeHtml(m.Round || '')}${m.Date ? ' • ' + escapeHtml(m.Date) : ''}</div>
      </div>
      <div class="score"><span>${m.HomeScore || '-'}</span><span>:</span><span>${m.AwayScore || '-'}</span></div>
    </div>`).join('');
}

function renderStandings(rows){
  if(!rows.length){ $('standingsWrap').innerHTML='<div class="empty">No standings found.</div>'; return; }
  const byGroup = groupBy(rows, 'Group');
  $('standingsWrap').innerHTML = Object.entries(byGroup).map(([group, teams]) => `
    <div class="table-card">
      <div class="table-title">${escapeHtml(group)}</div>
      <table class="standings-table">
        <thead><tr><th>#</th><th>Team</th><th>Pts</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th></tr></thead>
        <tbody>${teams.map((t,i) => `<tr><td class="rank">${i+1}</td><td class="team-cell">${logo(t.Logo)}${escapeHtml(t.Team)}</td><td><b>${t.Points}</b></td><td>${t.Played}</td><td>${t.Won}</td><td>${t.Drawn}</td><td>${t.Lost}</td><td>${t.GoalsFor}</td><td>${t.GoalsAgainst}</td><td>${t.GoalDifference}</td></tr>`).join('')}</tbody>
      </table>
    </div>`).join('');
}

function renderStats(rows){
  renderStatBox('topScorers', rows, 'Goals');
  renderStatBox('topAssists', rows, 'Assists');
  renderStatBox('yellowCards', rows, 'YellowCards', 'yellow');
  renderStatBox('redCards', rows, 'RedCards', 'red');
}
function renderStatBox(id, rows, key, cls=''){
  const sorted = rows.filter(r => Number(r[key]) > 0).sort((a,b)=>Number(b[key])-Number(a[key])).slice(0,10);
  $(id).innerHTML = sorted.length ? sorted.map(r => `<div class="stat-row"><div><div class="stat-name">${escapeHtml(r.Player)}</div><div class="stat-team">${logo(r.Logo)} ${escapeHtml(r.Team)}</div></div><div class="stat-value ${cls}">${r[key]}</div></div>`).join('') : '<div class="empty">No data yet.</div>';
}

function competitionKey(c){ return slugify(`${c?.['Competition Name'] || ''} ${c?.Year || ''}`.trim()); }
function slugify(v){ return String(v).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function logo(src){ return src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''; }
function groupBy(rows,key){ return rows.reduce((acc,row)=>{ const k=row[key]||'Table'; (acc[k] ||= []).push(row); return acc; },{}); }
function scrollToSection(id){ document.getElementById(id)?.scrollIntoView({behavior:'smooth', block:'start'}); document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.target===id)); }
function progressPercent(start,end){ const s=Date.parse(start), e=Date.parse(end), n=Date.now(); if(!s||!e||e<=s) return 45; return Math.max(0,Math.min(100,Math.round(((n-s)/(e-s))*100))); }
function escapeHtml(v){ return String(v ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
