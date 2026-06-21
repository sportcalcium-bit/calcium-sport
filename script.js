const API_URL = 'https://script.google.com/macros/s/AKfycbyFU-9M16UBls1YvTZfXxCDGLFBT2CL1qvTH7S_pmdHCD6kSeQpHQlQW_gg6r5vhfjOZA/exec';

let appData = null;
let currentCompetition = new URLSearchParams(window.location.search).get('competition') || '';
let currentSearch = '';
let currentGroup = '';

const $ = id => document.getElementById(id);

init();

async function init() {
  setLoadingState();

  try {
    await loadCompetition(currentCompetition);
    bindEvents();
  } catch (error) {
    console.error(error);
    showError('Could not load competition data. Please check the Apps Script backend.');
  }
}

async function loadCompetition(competitionParam) {
  const url = competitionParam
    ? `${API_URL}?competition=${encodeURIComponent(competitionParam)}`
    : API_URL;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  appData = await response.json();

  if (appData.error) {
    throw new Error(appData.error);
  }

  populateCompetitionDropdown();
  populateGroupDropdown();
  renderAll();
}

function bindEvents() {
  $('competitionSelect')?.addEventListener('change', async event => {
    const selected = event.target.value;
    const url = new URL(window.location.href);
    url.searchParams.set('competition', selected);
    window.history.replaceState({}, '', url.toString());
    await loadCompetition(selected);
  });

  $('jumpSelect')?.addEventListener('change', event => {
    jumpTo(event.target.value);
  });

  $('searchInput')?.addEventListener('input', event => {
    currentSearch = event.target.value.toLowerCase().trim();
    renderAll();
  });

  $('groupFilter')?.addEventListener('change', event => {
    currentGroup = event.target.value;
    renderAll();
  });

  $('clearFilters')?.addEventListener('click', () => {
    currentSearch = '';
    currentGroup = '';
    if ($('searchInput')) $('searchInput').value = '';
    if ($('groupFilter')) $('groupFilter').value = '';
    renderAll();
  });

  document.querySelectorAll('[data-jump]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
      button.classList.add('active');
      jumpTo(button.dataset.jump);
    });
  });

  $('backToTop')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function setLoadingState() {
  setText('competitionTitle', 'Loading...');
  setText('competitionSubtitle', 'Loading competition data');
  setHTML('latestResults', '<div class="empty">Loading results...</div>');
  setHTML('upcomingFixtures', '<div class="empty">Loading fixtures...</div>');
}

function renderAll() {
  renderHeader();
  renderSummary();
  renderResults();
  renderFixtures();
  renderStandings();
  renderStats();
}

function renderHeader() {
  const site = appData.site || {};
  const selected = appData.selectedCompetition || {};
  const name = selected['Competition Name'] || site.competition || 'Competition';
  const year = selected.Year || site.year || '';
  const region = selected.Region || site.region || 'World';
  const logo = selected['Logo URL'] || site.logoUrl || '';

  setText('competitionTitle', name);
  setText('competitionSubtitle', year ? `${name} ${year}` : name);
  setText('siteSubtitle', year ? `${name} ${year}` : 'Football results centre');
  setText('competitionRegion', region);
  setText('startDate', selected.StartDate || site.startDate || 'Start');
  setText('endDate', selected.EndDate || site.endDate || 'End');

  if ($('competitionLogo')) {
    $('competitionLogo').src = logo || '';
    $('competitionLogo').alt = `${name} logo`;
  }
}

function populateCompetitionDropdown() {
  const select = $('competitionSelect');
  if (!select) return;

  const competitions = appData.competitions || [];
  const selectedName = (appData.selectedCompetition || {})['Competition Name'] || '';

  select.innerHTML = competitions.map(comp => {
    const name = comp['Competition Name'] || '';
    const label = `${name} ${comp.Year || ''}`.trim();
    const selected = name === selectedName ? 'selected' : '';
    return `<option value="${escapeAttr(name)}" ${selected}>${escapeHTML(label)}</option>`;
  }).join('');
}

function populateGroupDropdown() {
  const select = $('groupFilter');
  if (!select) return;

  const groups = [...new Set((appData.standings || []).map(row => row.Group).filter(Boolean))];
  select.innerHTML = `<option value="">All groups/tables</option>${groups.map(group => `<option value="${escapeAttr(group)}">${escapeHTML(group)}</option>`).join('')}`;
}

function renderSummary() {
  const matches = getFilteredMatches();
  const latest = matches.filter(match => match.Status === 'FT').slice(-6).reverse();
  const upcoming = matches.filter(match => match.Status !== 'FT').slice(0, 6);

  setHTML('latestResults', latest.length ? latest.map(renderMatchRow).join('') : '<div class="empty">No latest results yet.</div>');
  setHTML('upcomingFixtures', upcoming.length ? upcoming.map(renderMatchRow).join('') : '<div class="empty">No upcoming fixtures yet.</div>');
}

function renderResults() {
  const rows = getFilteredMatches().filter(match => match.Status === 'FT').reverse();
  setText('resultsCount', `${rows.length} matches`);
  setHTML('resultsList', rows.length ? rows.map(renderMatchRow).join('') : '<div class="empty">No results found.</div>');
}

function renderFixtures() {
  const rows = getFilteredMatches().filter(match => match.Status !== 'FT');
  setText('fixturesCount', `${rows.length} matches`);
  setHTML('fixturesList', rows.length ? rows.map(renderMatchRow).join('') : '<div class="empty">No scheduled games found.</div>');
}

function renderStandings() {
  const standings = getFilteredStandings();

  if (!standings.length) {
    setHTML('standingsContainer', '<div class="empty">No standings found.</div>');
    return;
  }

  const groups = groupBy(standings, row => row.Group || 'Table');

  const html = Object.keys(groups).map(groupName => {
    const rows = groups[groupName];
    return `<section class="table-card"><div class="table-card-header"><h3>${escapeHTML(groupName)}</h3><span>${rows.length} teams</span></div><div class="standings-table-wrap"><table class="standings-table"><thead><tr><th>#</th><th>Team</th><th>PT</th><th>GW</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th></tr></thead><tbody>${rows.map((team, index) => `<tr><td>${index + 1}</td><td class="team-cell">${team.Logo ? `<img src="${escapeAttr(team.Logo)}" alt="">` : ''}<span>${escapeHTML(team.Team)}</span></td><td><strong>${safeNumber(team.Points)}</strong></td><td>${safeNumber(team.Played)}</td><td>${safeNumber(team.Won)}</td><td>${safeNumber(team.Drawn)}</td><td>${safeNumber(team.Lost)}</td><td>${safeNumber(team.GoalsFor)}</td><td>${safeNumber(team.GoalsAgainst)}</td><td>${formatGoalDifference(team.GoalDifference)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }).join('');

  setHTML('standingsContainer', html);
}

function renderStats() {
  const stats = getFilteredStats();
  renderStatList('topScorers', stats, 'Goals');
  renderStatList('topAssists', stats, 'Assists');
  renderStatList('yellowCards', stats, 'YellowCards');
  renderStatList('redCards', stats, 'RedCards');
}

function renderStatList(id, stats, key) {
  const rows = stats.filter(row => Number(row[key]) > 0).sort((a, b) => Number(b[key]) - Number(a[key])).slice(0, 15);
  setHTML(id, rows.length ? rows.map((row, index) => `<div class="stat-row"><span class="stat-rank">${index + 1}</span><span class="stat-player">${row.Logo ? `<img src="${escapeAttr(row.Logo)}" alt="">` : ''}<span>${escapeHTML(row.Player)}</span></span><span class="stat-team">${escapeHTML(row.Team)}</span><strong class="stat-value">${safeNumber(row[key])}</strong></div>`).join('') : '<div class="empty">No data yet.</div>');
}

function renderMatchRow(match) {
  const finished = match.Status === 'FT';
  const score = finished ? `${safeScore(match.HomeScore)} - ${safeScore(match.AwayScore)}` : '- : -';
  return `<article class="match-row"><div class="match-status">${finished ? 'Finished' : 'Scheduled'}</div><div class="match-teams"><div class="team-line">${match.HomeLogo ? `<img src="${escapeAttr(match.HomeLogo)}" alt="">` : ''}<span>${escapeHTML(match.HomeTeam)}</span></div><div class="team-line">${match.AwayLogo ? `<img src="${escapeAttr(match.AwayLogo)}" alt="">` : ''}<span>${escapeHTML(match.AwayTeam)}</span></div></div><div class="match-score">${score}</div><div class="match-meta"><span>${escapeHTML(match.Round || 'Competition')}</span>${match.Date ? `<span>${escapeHTML(match.Date)}</span>` : ''}</div></article>`;
}

function getFilteredMatches() {
  let rows = appData.matches || [];
  if (currentSearch) rows = rows.filter(match => [match.HomeTeam, match.AwayTeam, match.Round, match.Competition].join(' ').toLowerCase().includes(currentSearch));
  if (currentGroup) rows = rows.filter(match => String(match.Round || '').toLowerCase() === currentGroup.toLowerCase());
  return rows;
}

function getFilteredStandings() {
  let rows = appData.standings || [];
  if (currentSearch) rows = rows.filter(row => [row.Team, row.Group, row.Competition].join(' ').toLowerCase().includes(currentSearch));
  if (currentGroup) rows = rows.filter(row => row.Group === currentGroup);
  return rows;
}

function getFilteredStats() {
  let rows = appData.stats || [];
  if (currentSearch) rows = rows.filter(row => [row.Player, row.Team].join(' ').toLowerCase().includes(currentSearch));
  return rows;
}

function jumpTo(id) {
  const el = $(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function groupBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function setText(id, value) { const el = $(id); if (el) el.textContent = value; }
function setHTML(id, value) { const el = $(id); if (el) el.innerHTML = value; }
function showError(message) { setText('competitionTitle', 'Error'); setText('competitionSubtitle', message); setHTML('latestResults', `<div class="empty">${escapeHTML(message)}</div>`); }
function safeNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function safeScore(value) { return value === '' || value == null ? '-' : value; }
function formatGoalDifference(value) { const n = Number(value); if (!Number.isFinite(n)) return '0'; return n > 0 ? `+${n}` : String(n); }
function escapeHTML(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function escapeAttr(value) { return escapeHTML(value); }
