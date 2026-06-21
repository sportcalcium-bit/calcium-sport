const API_URL = 'https://script.google.com/macros/s/AKfycbyFU-9M16UBls1YvTZfXxCDGLFBT2CL1qvTH7S_pmdHCD6kSeQpHQlQW_gg6r5vhfjOZA/exec';

let appData = null;
let currentCompetition = new URLSearchParams(window.location.search).get('competition') || '';
let currentView = 'summary';
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

  const selected = appData.selectedCompetition || appData.site || {};
  currentCompetition = makeCompetitionSlug(selected);

  populateCompetitionDropdown();
  populateGroupDropdown();
  renderAll();
}

function bindEvents() {
  const competitionSelect = $('competitionSelect') || $('competitionDropdown') || $('competition');
  const jumpSelect = $('jumpSelect') || $('jumpTo') || $('sectionSelect');
  const searchInput = $('searchInput') || $('search');
  const groupFilter = $('groupFilter') || $('groupSelect');
  const clearBtn = $('clearFilters') || $('clearBtn');

  if (competitionSelect) {
    competitionSelect.addEventListener('change', async event => {
      const selected = event.target.value;
      currentSearch = '';
      currentGroup = '';

      if (searchInput) searchInput.value = '';
      if (groupFilter) groupFilter.value = '';

      updateUrlCompetition(selected);
      await loadCompetition(selected);
    });
  }

  if (jumpSelect) {
    jumpSelect.addEventListener('change', event => {
      const section = event.target.value;
      currentView = section;
      setActiveTab(section);
      renderAll();
      jumpToSection(section);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', event => {
      currentSearch = event.target.value.toLowerCase().trim();
      renderAll();
    });
  }

  if (groupFilter) {
    groupFilter.addEventListener('change', event => {
      currentGroup = event.target.value;
      renderAll();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      currentSearch = '';
      currentGroup = '';

      if (searchInput) searchInput.value = '';
      if (groupFilter) groupFilter.value = '';

      renderAll();
    });
  }

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      currentView = button.getAttribute('data-view');
      setActiveTab(currentView);
      renderAll();
      jumpToSection(currentView);
    });
  });

  const backTop = $('backToTop');
  if (backTop) {
    backTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

function renderAll() {
  if (!appData) return;

  renderHeader();
  renderSummary();
  renderResults();
  renderFixtures();
  renderStandings();
  renderStats();
}

function setLoadingState() {
  setText('competitionTitle', 'Loading...');
  setText('competitionSubtitle', 'Loading competition data');
  setHTML('latestResults', '<div class="empty">Loading results...</div>');
  setHTML('upcomingFixtures', '<div class="empty">Loading fixtures...</div>');
  setHTML('standingsContainer', '<div class="empty">Loading standings...</div>');
}

function renderHeader() {
  const site = appData.site || {};
  const selected = appData.selectedCompetition || {};

  const name = selected['Competition Name'] || site.competition || 'Competition';
  const year = selected.Year || site.year || '';
  const region = selected.Region || site.region || 'Football';
  const logo = selected['Logo URL'] || site.logoUrl || '';

  setText('competitionTitle', name);
  setText('competitionSubtitle', year ? `${name} ${year}` : name);
  setText('siteSubtitle', year ? `${name} ${year}` : 'Football results centre');
  setText('competitionRegion', region);
  setText('regionLabel', region);
  setText('startDate', selected.StartDate || site.startDate || 'Start');
  setText('endDate', selected.EndDate || site.endDate || 'End');

  const logoEl = $('competitionLogo');
  if (logoEl && logo) {
    logoEl.src = logo;
    logoEl.alt = `${name} logo`;
  }
}

function populateCompetitionDropdown() {
  const select = $('competitionSelect') || $('competitionDropdown') || $('competition');
  if (!select) return;

  const competitions = appData.competitions || [];

  select.innerHTML = competitions.map(comp => {
    const value = makeCompetitionSlug(comp);
    const label = `${comp['Competition Name'] || 'Competition'} ${comp.Year || ''}`.trim();
    const selected = value === currentCompetition ? 'selected' : '';

    return `<option value="${escapeHTML(value)}" ${selected}>${escapeHTML(label)}</option>`;
  }).join('');
}

function populateGroupDropdown() {
  const select = $('groupFilter') || $('groupSelect');
  if (!select) return;

  const groups = [...new Set((appData.standings || []).map(row => row.Group).filter(Boolean))];

  select.innerHTML = `
    <option value="">All groups/tables</option>
    ${groups.map(group => `<option value="${escapeHTML(group)}">${escapeHTML(group)}</option>`).join('')}
  `;
}

function renderSummary() {
  const matches = getFilteredMatches();

  const latestResults = matches
    .filter(match => match.Status === 'FT')
    .slice(-6)
    .reverse();

  const upcoming = matches
    .filter(match => match.Status !== 'FT')
    .slice(0, 6);

  setHTML('latestResults', latestResults.length
    ? latestResults.map(renderMatchRow).join('')
    : '<div class="empty">No latest results yet.</div>'
  );

  setHTML('upcomingFixtures', upcoming.length
    ? upcoming.map(renderMatchRow).join('')
    : '<div class="empty">No upcoming fixtures yet.</div>'
  );
}

function renderResults() {
  const results = getFilteredMatches()
    .filter(match => match.Status === 'FT')
    .reverse();

  const html = results.length
    ? results.map(renderMatchRow).join('')
    : '<div class="empty">No results found.</div>';

  setHTML('resultsList', html);
  setHTML('allResults', html);

  const countEl = $('resultsCount');
  if (countEl) countEl.textContent = `${results.length} matches`;
}

function renderFixtures() {
  const fixtures = getFilteredMatches()
    .filter(match => match.Status !== 'FT');

  const html = fixtures.length
    ? fixtures.map(renderMatchRow).join('')
    : '<div class="empty">No scheduled games found.</div>';

  setHTML('fixturesList', html);
  setHTML('allFixtures', html);

  const countEl = $('fixturesCount');
  if (countEl) countEl.textContent = `${fixtures.length} matches`;
}

function renderStandings() {
  const standings = getFilteredStandings();

  if (!standings.length) {
    setHTML('standingsContainer', '<div class="empty">No standings found.</div>');
    setHTML('standingsList', '<div class="empty">No standings found.</div>');
    return;
  }

  const groups = groupBy(standings, row => row.Group || 'Table');

  const html = Object.keys(groups).map(groupName => {
    const rows = groups[groupName];

    return `
      <section class="table-card">
        <div class="table-card-header">
          <h3>${escapeHTML(groupName)}</h3>
          <span>${rows.length} teams</span>
        </div>

        <div class="standings-table-wrap">
          <table class="standings-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>PT</th>
                <th>GW</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>GF</th>
                <th>GA</th>
                <th>GD</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((team, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td class="team-cell">
                    ${team.Logo ? `<img src="${escapeAttr(team.Logo)}" alt="">` : ''}
                    <span>${escapeHTML(team.Team)}</span>
                  </td>
                  <td><strong>${safeNumber(team.Points)}</strong></td>
                  <td>${safeNumber(team.Played)}</td>
                  <td>${safeNumber(team.Won)}</td>
                  <td>${safeNumber(team.Drawn)}</td>
                  <td>${safeNumber(team.Lost)}</td>
                  <td>${safeNumber(team.GoalsFor)}</td>
                  <td>${safeNumber(team.GoalsAgainst)}</td>
                  <td>${formatGoalDifference(team.GoalDifference)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }).join('');

  setHTML('standingsContainer', html);
  setHTML('standingsList', html);
}

function renderStats() {
  const stats = getFilteredStats();

  renderStatList('topScorers', stats, 'Goals', 'G');
  renderStatList('topAssists', stats, 'Assists', 'A');
  renderStatList('yellowCards', stats, 'YellowCards', 'Y');
  renderStatList('redCards', stats, 'RedCards', 'R');
}

function renderStatList(containerId, stats, key, label) {
  const rows = stats
    .filter(row => Number(row[key]) > 0)
    .sort((a, b) => Number(b[key]) - Number(a[key]))
    .slice(0, 15);

  const html = rows.length
    ? rows.map((row, index) => `
      <div class="stat-row">
        <span class="stat-rank">${index + 1}</span>
        <span class="stat-player">
          ${row.Logo ? `<img src="${escapeAttr(row.Logo)}" alt="">` : ''}
          <span>${escapeHTML(row.Player)}</span>
        </span>
        <span class="stat-team">${escapeHTML(row.Team)}</span>
        <strong class="stat-value">${safeNumber(row[key])}</strong>
      </div>
    `).join('')
    : '<div class="empty">No data yet.</div>';

  setHTML(containerId, html);
}

function renderMatchRow(match) {
  const isFinished = match.Status === 'FT';
  const score = isFinished
    ? `${safeScore(match.HomeScore)} - ${safeScore(match.AwayScore)}`
    : '- : -';

  return `
    <article class="match-row">
      <div class="match-status">${isFinished ? 'Finished' : 'Scheduled'}</div>

      <div class="match-teams">
        <div class="team-line">
          ${match.HomeLogo ? `<img src="${escapeAttr(match.HomeLogo)}" alt="">` : ''}
          <span>${escapeHTML(match.HomeTeam)}</span>
        </div>
        <div class="team-line">
          ${match.AwayLogo ? `<img src="${escapeAttr(match.AwayLogo)}" alt="">` : ''}
          <span>${escapeHTML(match.AwayTeam)}</span>
        </div>
      </div>

      <div class="match-score">${score}</div>

      <div class="match-meta">
        <span>${escapeHTML(match.Round || 'Competition')}</span>
        ${match.Date ? `<span>${escapeHTML(match.Date)}</span>` : ''}
      </div>
    </article>
  `;
}

function getFilteredMatches() {
  let matches = appData.matches || [];

  if (currentSearch) {
    matches = matches.filter(match => {
      return [
        match.HomeTeam,
        match.AwayTeam,
        match.Round,
        match.Competition
      ].join(' ').toLowerCase().includes(currentSearch);
    });
  }

  if (currentGroup) {
    const teamsInGroup = (appData.standings || [])
      .filter(row => row.Group === currentGroup)
      .map(row => row.Team);

    matches = matches.filter(match => {
      return (
        teamsInGroup.includes(match.HomeTeam) ||
        teamsInGroup.includes(match.AwayTeam) ||
        String(match.Round || '').toLowerCase() === currentGroup.toLowerCase()
      );
    });
  }

  return matches;
}

function getFilteredStandings() {
  let standings = appData.standings || [];

  if (currentSearch) {
    standings = standings.filter(row => {
      return [
        row.Team,
        row.Group,
        row.Competition
      ].join(' ').toLowerCase().includes(currentSearch);
    });
  }

  if (currentGroup) {
    standings = standings.filter(row => row.Group === currentGroup);
  }

  return standings;
}

function getFilteredStats() {
  let stats = appData.stats || [];

  if (currentSearch) {
    stats = stats.filter(row => {
      return [
        row.Player,
        row.Team
      ].join(' ').toLowerCase().includes(currentSearch);
    });
  }

  return stats;
}

function jumpToSection(section) {
  const map = {
    summary: 'summarySection',
    results: 'resultsSection',
    fixtures: 'fixturesSection',
    standings: 'standingsSection',
    stats: 'statsSection'
  };

  const id = map[section] || section;
  const el = $(id);

  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function setActiveTab(view) {
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.getAttribute('data-view') === view);
  });
}

function updateUrlCompetition(slug) {
  const url = new URL(window.location.href);
  url.searchParams.set('competition', slug);
  window.history.replaceState({}, '', url.toString());
}

function makeCompetitionSlug(comp) {
  const name = comp['Competition Name'] || comp.competition || '';
  const year = comp.Year || comp.year || '';

  return slugify(`${name} ${year}`.trim());
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function groupBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);

    if (!acc[key]) {
      acc[key] = [];
    }

    acc[key].push(item);
    return acc;
  }, {});
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setHTML(id, value) {
  const el = $(id);
  if (el) el.innerHTML = value;
}

function showError(message) {
  setText('competitionTitle', 'Error');
  setText('competitionSubtitle', message);
  setHTML('latestResults', `<div class="empty">${escapeHTML(message)}</div>`);
  setHTML('upcomingFixtures', '');
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function safeScore(value) {
  return value === '' || value === undefined || value === null ? '-' : value;
}

function formatGoalDifference(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return '0';
  }

  return num > 0 ? `+${num}` : String(num);
}

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHTML(value);
}
