const API_URL = 'https://script.google.com/macros/s/AKfycbyFU-9M16UBls1YvTZfXxCDGLFBT2CL1qvTH7S_pmdHCD6kSeQpHQlQW_gg6r5vhfjOZA/exec';

let appData = null;
let currentCompetition = new URLSearchParams(window.location.search).get('competition') || '';
let currentSearch = '';
let currentGroup = '';
let currentRound = '';
let selectedDateKey = '';

let expandedStats = {
  topScorers: false,
  topAssists: false,
  yellowCards: false,
  redCards: false
};

const $ = id => document.getElementById(id);

const SMALL_LOGO_STYLE = 'width:24px;height:24px;min-width:24px;max-width:24px;min-height:24px;max-height:24px;object-fit:contain;border-radius:3px;display:inline-block;';
const STAT_LOGO_STYLE = SMALL_LOGO_STYLE;

init();

async function init() {
  setLoadingState();

  try {
    await loadCompetition(resolveInitialCompetition());
    bindEvents();
  } catch (error) {
    console.error(error);
    showError('Could not load competition data. Please check the Apps Script backend.');
  }
}

function resolveInitialCompetition() {
  return currentCompetition || '';
}

async function loadCompetition(competitionParam) {
  const url = competitionParam
    ? `${API_URL}?competition=${encodeURIComponent(competitionParam)}`
    : `${API_URL}?mode=home`;

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

  if (!selectedDateKey) {
    selectedDateKey = getTodayKey();
  }

  expandedStats = {
    topScorers: false,
    topAssists: false,
    yellowCards: false,
    redCards: false
  };

  populateCompetitionDropdown();
  populateGroupDropdown();
  populateRoundDropdown();
  populateSeasonDropdown();
  renderAll();
}

function bindEvents() {
  const competitionSelect = $('competitionSelect');
  const seasonSelect = $('seasonSelect');
  const jumpSelect = $('jumpSelect');
  const searchInput = $('searchInput');
  const groupFilter = $('groupFilter');
  const roundFilter = $('roundFilter');
  const clearBtn = $('clearFilters');

  if (competitionSelect) {
    competitionSelect.addEventListener('change', async event => {
      const selected = event.target.value;
      resetFilters();
      updateUrlCompetition(selected);
      await loadCompetition(selected);
    });
  }

  if (seasonSelect) {
    seasonSelect.addEventListener('change', async event => {
      const selected = event.target.value;
      resetFilters();
      updateUrlCompetition(selected);
      await loadCompetition(selected);
    });
  }

  if (jumpSelect) {
    jumpSelect.addEventListener('change', event => {
      jumpToSection(event.target.value);
      setActiveTab(event.target.value);
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

  if (roundFilter) {
    roundFilter.addEventListener('change', event => {
      currentRound = event.target.value;
      renderAll();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      resetFilters();
      renderAll();
    });
  }

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      const view = button.getAttribute('data-view');
      setActiveTab(view);
      jumpToSection(view);
    });
  });

  const backTop = $('backToTop');

  if (backTop) {
    backTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

function resetFilters() {
  currentSearch = '';
  currentGroup = '';
  currentRound = '';

  const searchInput = $('searchInput');
  const groupFilter = $('groupFilter');
  const roundFilter = $('roundFilter');

  if (searchInput) {
    searchInput.value = '';
  }

  if (groupFilter) {
    groupFilter.value = '';
  }

  if (roundFilter) {
    roundFilter.value = '';
  }
}

function renderAll() {
  if (!appData) {
    return;
  }

  renderHeader();
  renderDateTabs();
  renderHomeGames();
  renderScoreboard();
  renderResults();
  renderFixtures();
  renderStandings();
  renderStats();
}

function setLoadingState() {
  setText('competitionTitle', 'Loading...');
  setText('competitionSubtitle', 'Loading competition data');
  setHTML('homeGamesList', '<div class="empty">Loading games...</div>');
  setHTML('scoreboardList', '<div class="empty">Loading matches...</div>');
  setHTML('resultsList', '<div class="empty">Loading results...</div>');
  setHTML('fixturesList', '<div class="empty">Loading fixtures...</div>');
  setHTML('standingsContainer', '<div class="empty">Loading standings...</div>');
}

function renderHeader() {
  const site = appData.site || {};
  const selected = appData.selectedCompetition || {};

  if (isHomePage()) {
    setText('siteSubtitle', 'Football results centre');
    setText('competitionTitle', 'Football');
    setText('competitionSubtitle', '');
    setText('regionLabel', '');
    setText('startDate', '');
    setText('endDate', '');
    return;
  }

  const name = selected['Competition Name'] || site.competition || 'Competition';
  const year = selected.Year || site.year || '';
  const logo = selected['Logo URL'] || site.logoUrl || '';

  setText('competitionTitle', name);
  setText('competitionSubtitle', '');
  setText('siteSubtitle', year ? `${name} ${year}` : 'Football results centre');
  setText('regionLabel', '');
  setText('startDate', '');
  setText('endDate', '');

  const scoreboardTitle = $('scoreboardTitle');
  if (scoreboardTitle) scoreboardTitle.textContent = 'Next Up';

  const logoEl = $('competitionLogo');
  if (logoEl && logo) {
    logoEl.src = logo;
    logoEl.alt = `${name} logo`;
  }
}
function populateCompetitionDropdown() {
  const select = $('competitionSelect');

  if (select) {
    const competitions = appData.competitions || [];

    select.innerHTML = competitions.map(comp => {
      const value = makeCompetitionSlug(comp);
      const label = `${comp['Competition Name'] || 'Competition'} ${comp.Year || ''}`.trim();
      const selected = value === currentCompetition ? 'selected' : '';

      return `<option value="${escapeHTML(value)}" ${selected}>${escapeHTML(label)}</option>`;
    }).join('');
  }

  renderCompetitionCategoryNav();
}

function populateSeasonDropdown() {
  const seasonSelect = $('seasonSelect');
  const seasonWrap = $('seasonSwitcherWrap');

  if (!seasonSelect || !seasonWrap || !appData || !appData.selectedCompetition) {
    return;
  }

  const selected = appData.selectedCompetition;
  const selectedName = normaliseCompetitionName(selected['Competition Name']);
  const selectedRegion = normaliseRegion(selected.Region);

  const seasons = (appData.competitions || [])
    .filter(comp => {
      return (
        normaliseCompetitionName(comp['Competition Name']) === selectedName &&
        normaliseRegion(comp.Region) === selectedRegion
      );
    })
    .sort((a, b) => compareSeasonsDesc(a.Year, b.Year));

  if (seasons.length <= 1) {
    seasonWrap.classList.add('is-hidden');
    seasonSelect.innerHTML = '';
    return;
  }

  seasonWrap.classList.remove('is-hidden');

  seasonSelect.innerHTML = seasons.map(comp => {
    const value = makeCompetitionSlug(comp);
    const label = comp.Year || 'Season';
    const selectedOption = value === currentCompetition ? 'selected' : '';

    return `<option value="${escapeHTML(value)}" ${selectedOption}>${escapeHTML(label)}</option>`;
  }).join('');
}

function populateGroupDropdown() {
  const select = $('groupFilter');

  if (!select) {
    return;
  }

  const groups = [...new Set((appData.standings || []).map(row => row.Group).filter(Boolean))];

  select.innerHTML = `
    <option value="">All groups/tables</option>
    ${groups.map(group => `<option value="${escapeHTML(group)}">${escapeHTML(group)}</option>`).join('')}
  `;
}

function populateRoundDropdown() {
  const select = $('roundFilter');

  if (!select) {
    return;
  }

  const rounds = [...new Set((appData.matches || [])
    .map(match => String(match.Round || '').trim())
    .filter(Boolean))]
    .sort((a, b) => roundSortValue(a) - roundSortValue(b));

  select.innerHTML = `
    <option value="">All rounds</option>
    ${rounds.map(round => `<option value="${escapeHTML(round)}">${escapeHTML(formatRoundLabel(round))}</option>`).join('')}
  `;

  if (currentRound && rounds.includes(currentRound)) {
    select.value = currentRound;
  }

  if (currentRound && !rounds.includes(currentRound)) {
    currentRound = '';
    select.value = '';
  }
}

function renderDateTabs() {
  const container = $('dateTabs');

  if (!container) {
    return;
  }

  const dates = getDateRangeTabs();

  container.innerHTML = dates.map(item => {
    const active = item.key === selectedDateKey ? 'active' : '';

    return `
      <button type="button" class="${active}" onclick="selectDateTab('${escapeAttr(item.key)}')">
        <span>${escapeHTML(item.dayLabel)}</span>
        <strong>${escapeHTML(item.shortDate)}</strong>
      </button>
    `;
  }).join('');
}

window.selectDateTab = function selectDateTab(key) {
  selectedDateKey = key;
  renderDateTabs();
  renderHomeGames();
};

function renderHomeGames() {
  const allMatches = appData.allMatches || [];
  const matches = allMatches
    .filter(match => getDateKey(match.Date) === selectedDateKey)
    .sort((a, b) => matchDateSortValue(a) - matchDateSortValue(b));

  const countEl = $('homeMatchCount');

  if (countEl) {
    countEl.textContent = matches.length;
  }

  if (!matches.length) {
    setHTML('homeGamesList', '<div class="empty home-empty">No games on this date.</div>');
    return;
  }

  const grouped = groupBy(matches, match => match.CompetitionLabel || match.Competition || 'Competition');

  const html = Object.keys(grouped).map(competitionName => {
    const compMatches = grouped[competitionName];

    return `
      <section class="home-competition-block">
        <div class="home-competition-title">
          <span>${escapeHTML(getRegionForCompetition(compMatches[0]))}</span>
          <strong>${escapeHTML(competitionName)}</strong>
        </div>

        ${compMatches.map(renderHomeMatchRow).join('')}
      </section>
    `;
  }).join('');

  setHTML('homeGamesList', html);
}

function renderHomeMatchRow(match) {
  const isFinished = match.Status === 'FT';
  const timeLabel = isFinished ? 'FT' : (match.Time || 'Scheduled');

  const scoreLabel = isFinished
    ? renderScoreText(match)
    : '- : -';

  const homeLogo = match.HomeLogo
    ? `<img src="${escapeAttr(match.HomeLogo)}" alt="">`
    : '';

  const awayLogo = match.AwayLogo
    ? `<img src="${escapeAttr(match.AwayLogo)}" alt="">`
    : '';

  const clickHandler = match.MatchID ? `onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"` : '';

  return `
    <article class="home-match-row" ${clickHandler}>
      <div class="home-match-time">${escapeHTML(timeLabel)}</div>

      <div class="home-match-teams">
        <div>
          ${homeLogo}
          <span>${escapeHTML(match.HomeTeam)}</span>
        </div>

        <div>
          ${awayLogo}
          <span>${escapeHTML(match.AwayTeam)}</span>
        </div>
      </div>

      <div class="home-match-score">${scoreLabel}</div>
    </article>
  `;
}

function getRegionForCompetition(match) {
  return String(match.Region || 'World').toUpperCase();
}

function renderScoreboard() {
  const matches = getFilteredMatches();

  if (!matches.length) {
    setHTML('scoreboardList', '<div class="empty">No matches found.</div>');
    return;
  }

  const nextUp = getNextUpMatch(matches);

  if (!nextUp) {
    setHTML('scoreboardList', '<div class="empty">No matches found.</div>');
    return;
  }

  const targetRound = normaliseText(nextUp.Round || '');

  const roundMatches = matches
    .filter(match => normaliseText(match.Round || '') === targetRound)
    .sort((a, b) => matchDateSortValue(a) - matchDateSortValue(b));

  const note = nextUp.Status === 'FT'
    ? '<div class="season-complete-note">Season completed. Showing the last round played.</div>'
    : '';

  setHTML('scoreboardList', `
    ${note}
    <section class="round-block">
      <div class="round-heading">${escapeHTML(formatRoundLabel(nextUp.Round || 'Next Up'))}</div>
      ${roundMatches.map(renderScoreboardRow).join('')}
    </section>
  `);
}

function renderResults() {
  const results = getFilteredMatches()
    .filter(match => match.Status === 'FT')
    .sort((a, b) => matchDateSortValue(b) - matchDateSortValue(a));

  const html = results.length
    ? renderGroupedScoreboard(results)
    : '<div class="empty">No results found.</div>';

  setHTML('resultsList', html);

  const countEl = $('resultsCount');

  if (countEl) {
    countEl.textContent = `${results.length} matches`;
  }
}

function renderFixtures() {
  const fixtures = getFilteredMatches()
    .filter(match => match.Status !== 'FT')
    .sort((a, b) => matchDateSortValue(a) - matchDateSortValue(b));

  const html = fixtures.length
    ? renderGroupedScoreboard(fixtures)
    : '<div class="empty">No scheduled games found.</div>';

  setHTML('fixturesList', html);

  const countEl = $('fixturesCount');

  if (countEl) {
    countEl.textContent = `${fixtures.length} matches`;
  }
}

function renderSmartScoreboard(matches) {
  const grouped = groupBy(matches, match => formatRoundLabel(match.Round));

  return Object.keys(grouped).map(round => {
    return `
      <section class="round-block">
        <div class="round-heading">${escapeHTML(round)}</div>
        ${grouped[round].map(renderScoreboardRow).join('')}
      </section>
    `;
  }).join('');
}

function sortMatchesByNextOrLatest(matches) {
  const now = Date.now();

  return [...matches].sort((a, b) => {
    const aTime = matchDateSortValue(a);
    const bTime = matchDateSortValue(b);
    const aPlayed = a.Status === 'FT';
    const bPlayed = b.Status === 'FT';

    if (!aPlayed && !bPlayed) {
      return aTime - bTime;
    }

    if (aPlayed && bPlayed) {
      return bTime - aTime;
    }

    if (!aPlayed && bPlayed) {
      return -1;
    }

    if (aPlayed && !bPlayed) {
      return 1;
    }

    return Math.abs(aTime - now) - Math.abs(bTime - now);
  });
}

function renderGroupedScoreboard(matches) {
  const grouped = groupBy(matches, match => formatRoundLabel(match.Round));

  return Object.keys(grouped).map(round => {
    return `
      <section class="round-block">
        <div class="round-heading">${escapeHTML(round)}</div>
        ${grouped[round].map(renderScoreboardRow).join('')}
      </section>
    `;
  }).join('');
}

function renderScoreboardRow(match) {
  const dateParts = formatScoreboardDateParts(match.Date, match.Time);
  const score = match.Status === 'FT' ? renderScoreText(match) : '- : -';

  const homeLogo = match.HomeLogo
    ? `<img src="${escapeAttr(match.HomeLogo)}" alt="" style="${SMALL_LOGO_STYLE}">`
    : '';

  const awayLogo = match.AwayLogo
    ? `<img src="${escapeAttr(match.AwayLogo)}" alt="" style="${SMALL_LOGO_STYLE}">`
    : '';

  const clickableClass = match.MatchID ? 'is-clickable' : '';
  const clickHandler = match.MatchID ? `onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"` : '';

  return `
    <article class="scoreboard-row calcium-row-layout ${clickableClass}" ${clickHandler}>
      <div class="scoreboard-date">
        <span class="scoreboard-date-main">${escapeHTML(dateParts.date)}</span>
        <span class="scoreboard-time-main">${escapeHTML(dateParts.time)}</span>
      </div>

      <div class="score-team-line score-team-home">
        ${homeLogo}
        <span>${escapeHTML(match.HomeTeam)}</span>
      </div>

      <div class="scoreboard-score single-score">${score}</div>

      <div class="score-team-line score-team-away">
        ${awayLogo}
        <span>${escapeHTML(match.AwayTeam)}</span>
      </div>
    </article>
  `;
}

function openMatchDetail(matchId) {
  const allMatches = (appData.allMatches || []).concat(appData.matches || []);
  const seen = new Set();

  const uniqueMatches = allMatches.filter(match => {
    const key = match.MatchID || match.ID;

    if (!key) {
      return false;
    }

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  const match = uniqueMatches.find(item => item.MatchID === matchId || item.ID === matchId);

  if (!match) {
    return;
  }

  const modal = $('matchModal');
  const content = $('matchDetailContent');

  if (!modal || !content) {
    return;
  }

  content.innerHTML = renderMatchDetail(match);
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

window.openMatchDetail = openMatchDetail;

function closeMatchModal() {
  const modal = $('matchModal');

  if (modal) {
    modal.classList.add('hidden');
  }

  document.body.classList.remove('modal-open');
}

window.closeMatchModal = closeMatchModal;

function renderMatchDetail(match) {
  const matchEvents = getMatchEvents(match.MatchID || match.ID);
  const firstHalf = matchEvents.filter(event => getHalfNumber(event.Half) === 1);
  const secondHalf = matchEvents.filter(event => getHalfNumber(event.Half) === 2);
  const youtubeUrl = match.YouTubeURL || match.YoutubeURL || match.HighlightsURL || '';
  const highlights = renderHighlights(youtubeUrl);

  const homeLogo = match.HomeLogo
    ? `<img src="${escapeAttr(match.HomeLogo)}" alt="">`
    : '';

  const awayLogo = match.AwayLogo
    ? `<img src="${escapeAttr(match.AwayLogo)}" alt="">`
    : '';

  const penaltyText = getPenaltyWinnerText(match);

  return `
    <section class="match-hero">
      <div class="match-date-main">${escapeHTML(formatFullDateTime(match.Date, match.Time))}</div>

      <div class="match-main-teams">
        <div class="match-main-team">
          <div class="match-main-logo">${homeLogo}</div>
          <strong>${escapeHTML(match.HomeTeam)}</strong>
        </div>

        <div class="match-main-score">
          <div>${renderScoreText(match)}</div>
          ${penaltyText ? `<span>${escapeHTML(penaltyText)}</span>` : ''}
        </div>

        <div class="match-main-team">
          <div class="match-main-logo">${awayLogo}</div>
          <strong>${escapeHTML(match.AwayTeam)}</strong>
        </div>
      </div>
    </section>

    <section class="venue-row">
      <span>🏟️ Venue:</span>
      <strong>${escapeHTML(match.Venue || match.Stadium || 'Venue unavailable')}</strong>
    </section>

    <section class="event-section">
      ${renderHalfEvents('1ST HALF', firstHalf, match)}
      ${renderHalfEvents('2ND HALF', secondHalf, match)}
    </section>

    ${highlights}
  `;
}

function getMatchEvents(matchId) {
  const seen = new Set();

  return (appData.allEvents || [])
    .filter(event => event.MatchID === matchId)
    .filter(event => {
      const key = [
        event.MatchID,
        event.Half,
        event.Minute,
        event.Team,
        event.Event,
        event.Player,
        event.Detail
      ].join('|').toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(a.Minute || 0) - Number(b.Minute || 0));
}

function renderHalfEvents(title, events, match) {
  if (!events.length) {
    return `
      <div class="half-block">
        <div class="half-title">${escapeHTML(title)}</div>
        <div class="empty match-empty">No events.</div>
      </div>
    `;
  }

  let liveHome = 0;
  let liveAway = 0;

  const allEventsBeforeThisHalf = getMatchEvents(match.MatchID || match.ID)
    .filter(event => {
      if (title === '1ST HALF') {
        return false;
      }

      return getHalfNumber(event.Half) === 1;
    })
    .sort((a, b) => Number(a.Minute || 0) - Number(b.Minute || 0));

  allEventsBeforeThisHalf.forEach(event => {
    if (isGoalEvent(event)) {
      if (sameTeam(event.Team, match.HomeTeam)) {
        liveHome += 1;
      }

      if (sameTeam(event.Team, match.AwayTeam)) {
        liveAway += 1;
      }
    }
  });

  const rows = events.map(event => {
    if (isGoalEvent(event)) {
      if (sameTeam(event.Team, match.HomeTeam)) {
        liveHome += 1;
      }

      if (sameTeam(event.Team, match.AwayTeam)) {
        liveAway += 1;
      }
    }

    return renderEventRow(event, match, liveHome, liveAway);
  }).join('');

  return `
    <div class="half-block">
      <div class="half-title">${escapeHTML(title)}</div>
      ${rows}
    </div>
  `;
}

function renderEventRow(event, match, liveHome, liveAway) {
  const isHome = sameTeam(event.Team, match.HomeTeam);
  const sideClass = isHome ? 'event-home' : 'event-away';
  const eventLabel = getEventLabel(event, liveHome, liveAway, isHome);

  return `
    <div class="event-row ${sideClass}">
      <div class="event-minute">${escapeHTML(event.Minute)}'</div>
      <div class="event-content">
        ${eventLabel}
      </div>
    </div>
  `;
}

function getEventLabel(event, liveHome, liveAway, isHome) {
  const eventType = String(event.Event || '').toLowerCase().trim();
  const detail = String(event.Detail || '').trim();
  const player = String(event.Player || '').trim();
  const isPenaltyGoal = eventType === 'goal' && detail.toLowerCase() === 'penalty';

  if (eventType === 'goal') {
    if (isPenaltyGoal && !isHome) {
      return `
        <strong>(Penalty) ${escapeHTML(player)}</strong>
        <span class="goal-pill">${liveHome} - ${liveAway} ⚽</span>
      `;
    }

    const detailText = detail ? ` (${escapeHTML(detail)})` : '';

    return `
      <span class="goal-pill">⚽ ${liveHome} - ${liveAway}</span>
      <strong>${escapeHTML(player)}${detailText}</strong>
    `;
  }

  if (eventType === 'red card') {
    const detailText = detail ? ` (${escapeHTML(detail)})` : '';

    return `
      <span class="red-card-icon">■</span>
      <strong>${escapeHTML(player)}${detailText}</strong>
    `;
  }

  if (eventType === 'penalty missed' || eventType === 'missed penalty') {
    if (!isHome) {
      return `
        <strong>${escapeHTML(player)} (Penalty missed)</strong>
        <span class="penalty-missed-icon" aria-label="Penalty missed">⚽</span>
      `;
    }

    return `
      <span class="penalty-missed-icon" aria-label="Penalty missed">⚽</span>
      <strong>${escapeHTML(player)} (Penalty missed)</strong>
    `;
  }

  const detailText = detail ? ` (${escapeHTML(detail)})` : '';

  return `
    <span class="event-dot">•</span>
    <strong>${escapeHTML(player)}${detailText}</strong>
  `;
}

function renderHighlights(url) {
  const cleanUrl = String(url || '').trim();

  if (!cleanUrl) {
    return '';
  }

  const videoId = getYouTubeId(cleanUrl);
  const thumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : '';

  if (!thumbnail) {
    return `
      <section class="highlights-row">
        <div>
          <span>▶ Highlights:</span>
          <strong>Watch match highlights</strong>
        </div>
        <a class="highlight-button" href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">Open video</a>
      </section>
    `;
  }

  return `
    <section class="highlights-card highlights-bottom">
      <div class="highlights-header">
        <span>▶ Highlights</span>
        <a href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">Open on YouTube</a>
      </div>

      <a class="youtube-preview" href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">
        <img src="${escapeAttr(thumbnail)}" alt="YouTube highlights thumbnail" onerror="this.src='https://img.youtube.com/vi/${escapeAttr(videoId)}/hqdefault.jpg'">
        <span class="youtube-play">▶</span>
      </a>
    </section>
  `;
}

function getYouTubeId(url) {
  const text = String(url || '').trim();

  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/i,
    /youtu\.be\/([^?&]+)/i,
    /youtube\.com\/shorts\/([^?&]+)/i,
    /youtube\.com\/embed\/([^?&]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match && match[1]) {
      return match[1];
    }
  }

  return '';
}

function renderStandings() {
  const standings = getFilteredStandings();

  if (!standings.length) {
    setHTML('standingsContainer', '<div class="empty">No standings found.</div>');
    return;
  }

  const groups = groupBy(standings, row => row.Group || 'Table');

  const html = Object.keys(groups).map(groupName => {
    const rows = [...groups[groupName]].sort(compareStandingRows);
    const isGroupStage = isGroupStageCompetition();

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
              ${rows.map((team, index) => {
                const logo = team.Logo
                  ? `<img src="${escapeAttr(team.Logo)}" alt="" style="${SMALL_LOGO_STYLE}">`
                  : '';

                const rankClass = getRankClass(index, rows.length, isGroupStage);

                return `
                  <tr>
                    <td>
                      <span class="rank-badge ${rankClass}">${index + 1}</span>
                    </td>
                    <td class="team-cell">
                      ${logo}
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
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        ${isGroupStage ? '<div class="qualification-note"><span class="note-dot qualified"></span> Top 2 qualify <span class="note-dot eliminated"></span> Bottom 2 eliminated</div>' : renderLeagueLegend()}
      </section>
    `;
  }).join('');

  setHTML('standingsContainer', html);
}

function compareStandingRows(a, b) {
  const pointsA = safeNumber(a.Points);
  const pointsB = safeNumber(b.Points);

  if (pointsB !== pointsA) {
    return pointsB - pointsA;
  }

  const headToHead = getHeadToHeadWinner(a.Team, b.Team);

  if (headToHead === a.Team) {
    return -1;
  }

  if (headToHead === b.Team) {
    return 1;
  }

  const gdA = safeNumber(a.GoalDifference);
  const gdB = safeNumber(b.GoalDifference);

  if (gdB !== gdA) {
    return gdB - gdA;
  }

  const gfA = safeNumber(a.GoalsFor);
  const gfB = safeNumber(b.GoalsFor);

  if (gfB !== gfA) {
    return gfB - gfA;
  }

  const gaA = safeNumber(a.GoalsAgainst);
  const gaB = safeNumber(b.GoalsAgainst);

  if (gaA !== gaB) {
    return gaA - gaB;
  }

  return String(a.Team || '').localeCompare(String(b.Team || ''));
}

function getHeadToHeadWinner(teamA, teamB) {
  const teamAKey = normaliseTeamName(teamA);
  const teamBKey = normaliseTeamName(teamB);

  const directMatches = (appData.matches || []).filter(match => {
    if (match.Status !== 'FT') {
      return false;
    }

    const home = normaliseTeamName(match.HomeTeam);
    const away = normaliseTeamName(match.AwayTeam);

    return (
      (home === teamAKey && away === teamBKey) ||
      (home === teamBKey && away === teamAKey)
    );
  });

  if (!directMatches.length) {
    return '';
  }

  let teamAPoints = 0;
  let teamBPoints = 0;

  directMatches.forEach(match => {
    const home = normaliseTeamName(match.HomeTeam);
    const away = normaliseTeamName(match.AwayTeam);
    const homeScore = safeNumber(match.HomeScore);
    const awayScore = safeNumber(match.AwayScore);

    if (homeScore === awayScore) {
      teamAPoints += 1;
      teamBPoints += 1;
      return;
    }

    const winnerKey = homeScore > awayScore ? home : away;

    if (winnerKey === teamAKey) {
      teamAPoints += 3;
    }

    if (winnerKey === teamBKey) {
      teamBPoints += 3;
    }
  });

  if (teamAPoints > teamBPoints) {
    return teamA;
  }

  if (teamBPoints > teamAPoints) {
    return teamB;
  }

  return '';
}

function renderStats() {
  const stats = getFilteredStats();

  renderStatList('topScorers', stats, 'Goals', 'topScorers');
  renderStatList('topAssists', stats, 'Assists', 'topAssists');
  renderStatList('yellowCards', stats, 'YellowCards', 'yellowCards');
  renderStatList('redCards', stats, 'RedCards', 'redCards');
}

function renderStatList(containerId, stats, key, expandKey) {
  const allRows = stats
    .filter(row => Number(row[key]) > 0)
    .sort((a, b) => {
      if (Number(b[key]) !== Number(a[key])) {
        return Number(b[key]) - Number(a[key]);
      }

      return String(a.Player || '').localeCompare(String(b.Player || ''));
    });

  const isExpanded = expandedStats[expandKey];
  const visibleRows = isExpanded ? allRows : allRows.slice(0, 3);

  if (!allRows.length) {
    setHTML(containerId, '<div class="empty">No data yet.</div>');
    return;
  }

  const rowsHtml = visibleRows.map((row, index) => {
    const logo = row.Logo
      ? `<img src="${escapeAttr(row.Logo)}" alt="" style="${STAT_LOGO_STYLE}">`
      : '';

    return `
      <div class="stat-row">
        <span class="stat-rank">${index + 1}</span>

        <span class="stat-player">
          ${logo}
          <span class="stat-player-name" title="${escapeAttr(row.Player)}">${escapeHTML(row.Player)}</span>
        </span>

        <strong class="stat-value">${safeNumber(row[key])}</strong>
      </div>
    `;
  }).join('');

  const buttonHtml = allRows.length > 3
    ? `
      <button class="stat-toggle" type="button" onclick="toggleStatList('${expandKey}')">
        ${isExpanded ? 'Show less' : `See more (${allRows.length})`}
      </button>
    `
    : '';

  setHTML(containerId, rowsHtml + buttonHtml);
}

window.toggleStatList = function toggleStatList(key) {
  expandedStats[key] = !expandedStats[key];
  renderStats();
};

function getFilteredMatches() {
  let matches = appData.matches || [];

  if (currentSearch) {
    matches = matches.filter(match => {
      return [
        match.HomeTeam,
        match.AwayTeam,
        match.Round,
        match.Competition,
        match.Date,
        match.Time
      ].join(' ').toLowerCase().includes(currentSearch);
    });
  }

  if (currentRound) {
    const selectedRoundKey = normaliseText(currentRound);
    matches = matches.filter(match => normaliseText(match.Round) === selectedRoundKey);
  }

  if (currentGroup) {
    const selectedGroupKey = normaliseText(currentGroup);

    const teamsInGroup = (appData.standings || [])
      .filter(row => normaliseText(row.Group) === selectedGroupKey)
      .map(row => normaliseTeamName(row.Team))
      .filter(Boolean);

    matches = matches.filter(match => {
      const home = normaliseTeamName(match.HomeTeam);
      const away = normaliseTeamName(match.AwayTeam);
      const round = normaliseText(match.Round);

      return (
        teamsInGroup.includes(home) ||
        teamsInGroup.includes(away) ||
        round === selectedGroupKey ||
        round.includes(selectedGroupKey)
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
    const selectedGroupKey = normaliseText(currentGroup);
    standings = standings.filter(row => normaliseText(row.Group) === selectedGroupKey);
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
    home: 'homeSection',
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

function getDateRangeTabs() {
  const base = new Date();

  return [-2, -1, 0, 1, 2, 3, 4].map(offset => {
    const date = new Date(base);
    date.setDate(base.getDate() + offset);

    return {
      key: dateToKey(date),
      dayLabel: getDayLabel(date, offset),
      shortDate: formatShortDateFromDate(date)
    };
  });
}

function getDayLabel(date, offset) {
  if (offset === -1) {
    return 'Yesterday';
  }

  if (offset === 0) {
    return 'Today';
  }

  if (offset === 1) {
    return 'Tomorrow';
  }

  return date.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
}

function getTodayKey() {
  return dateToKey(new Date());
}

function dateToKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getDateKey(value) {
  const parsed = parseDateOnly(value);

  return parsed ? dateToKey(parsed) : '';
}

function parseDateOnly(value) {
  const text = String(value || '').trim();

  if (!text) {
    return null;
  }

  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(text)) {
    const parts = text.split(/[./-]/);
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parts = text.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  return null;
}

function formatShortDateFromDate(date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`;
}

function formatRoundLabel(value) {
  const text = String(value || '').trim();

  if (!text) {
    return 'MATCHES';
  }

  if (/^\d+$/.test(text)) {
    return `ROUND ${text}`;
  }

  return text.toUpperCase();
}

function roundSortValue(value) {
  const text = String(value || '').toLowerCase().trim();

  if (/^\d+$/.test(text)) {
    return Number(text);
  }

  if (text.includes('final') && !text.includes('semi') && !text.includes('quarter')) {
    return 100;
  }

  if (text.includes('semi')) {
    return 90;
  }

  if (text.includes('quarter')) {
    return 80;
  }

  if (text.includes('16')) {
    return 70;
  }

  if (text.includes('32')) {
    return 60;
  }

  return 0;
}

function matchDateSortValue(match) {
  const parsedDate = parseDateOnly(match.Date);

  if (!parsedDate) {
    return 0;
  }

  const time = String(match.Time || '00:00').trim();
  const timeParts = time.split(':');

  parsedDate.setHours(Number(timeParts[0]) || 0);
  parsedDate.setMinutes(Number(timeParts[1]) || 0);

  return parsedDate.getTime();
}

function formatDateTime(date, time) {
  const parsed = parseDateOnly(date);
  const cleanTime = String(time || '').trim();

  const shortDate = parsed ? formatShortDateFromDate(parsed) : String(date || '').trim();

  return cleanTime ? `${shortDate} ${cleanTime}` : shortDate;
}

function formatScoreboardDateParts(date, time) {
  const parsed = parseDateOnly(date);
  const cleanTime = String(time || '').trim();
  const dateText = parsed ? formatShortDateFromDate(parsed).replace(/\.$/, '') : String(date || '').trim();

  return {
    date: dateText,
    time: cleanTime || ''
  };
}

function formatFullDateTime(date, time) {
  const parsed = parseDateOnly(date);
  const cleanTime = String(time || '').trim();

  const dateText = parsed
    ? parsed.toLocaleDateString('en-GB')
    : String(date || '').trim();

  return [dateText, cleanTime].filter(Boolean).join(' ');
}

function renderScoreText(match) {
  const home = safeScore(match.HomeScore);
  const away = safeScore(match.AwayScore);
  const hp = String(match.HomePens || '').trim();
  const ap = String(match.AwayPens || '').trim();

  if (hp && ap) {
    return `(${escapeHTML(hp)}) ${escapeHTML(home)} - ${escapeHTML(away)} (${escapeHTML(ap)})`;
  }

  return `${escapeHTML(home)} - ${escapeHTML(away)}`;
}

function getPenaltyWinnerText(match) {
  const hp = Number(match.HomePens);
  const ap = Number(match.AwayPens);

  if (!Number.isFinite(hp) || !Number.isFinite(ap)) {
    return '';
  }

  if (hp > ap) {
    return `${match.HomeTeam} win ${hp}-${ap} on penalties`;
  }

  if (ap > hp) {
    return `${match.AwayTeam} win ${ap}-${hp} on penalties`;
  }

  return '';
}

function isGoalEvent(event) {
  return String(event.Event || '').toLowerCase().trim() === 'goal';
}

function sameTeam(a, b) {
  return normaliseTeamName(a) === normaliseTeamName(b);
}

function getHalfNumber(value) {
  const text = String(value || '').toLowerCase().trim();

  if (text === '1' || text.includes('1st') || text.includes('first')) {
    return 1;
  }

  if (text === '2' || text.includes('2nd') || text.includes('second')) {
    return 2;
  }

  return 0;
}

function getRankClass(index, groupSize, isGroupStage) {
  if (isGroupStage) {
    if (groupSize <= 2) {
      return 'rank-neutral';
    }

    if (index <= 1) {
      return 'rank-qualified';
    }

    return 'rank-eliminated';
  }

  const pos = index + 1;
  const league = getLeagueKeyForStandings();

  if (league === 'premier-league' || league === 'serie-a' || league === 'la-liga') {
    if (pos <= 4) {
      return 'rank-ucl';
    }

    if (pos <= 6) {
      return 'rank-uel';
    }

    if (pos <= 8) {
      return 'rank-uecl';
    }

    if (pos >= 18) {
      return 'rank-relegation';
    }

    return 'rank-neutral';
  }

  if (league === 'bundesliga') {
    if (pos <= 4) {
      return 'rank-ucl';
    }

    if (pos <= 6) {
      return 'rank-uel';
    }

    if (pos <= 8) {
      return 'rank-uecl';
    }

    if (pos === 16) {
      return 'rank-playout';
    }

    if (pos >= 17) {
      return 'rank-relegation';
    }

    return 'rank-neutral';
  }

  if (league === 'ligue-1') {
    if (pos <= 3) {
      return 'rank-ucl';
    }

    if (pos <= 5) {
      return 'rank-uel';
    }

    if (pos <= 7) {
      return 'rank-uecl';
    }

    if (pos === 16) {
      return 'rank-playout';
    }

    if (pos >= 17) {
      return 'rank-relegation';
    }

    return 'rank-neutral';
  }

  return 'rank-neutral';
}

function getLeagueKeyForStandings() {
  const selected = appData && appData.selectedCompetition ? appData.selectedCompetition : {};
  const site = appData && appData.site ? appData.site : {};

  const name = normaliseCompetitionName(
    selected['Competition Name'] ||
    selected.competition ||
    site.competition ||
    currentCompetition ||
    ''
  );

  const slug = slugify(name);

  if (slug.includes('premier-league')) {
    return 'premier-league';
  }

  if (slug === 'serie-a' || slug.includes('serie-a')) {
    return 'serie-a';
  }

  if (slug.includes('la-liga') || slug.includes('laliga')) {
    return 'la-liga';
  }

  if (slug.includes('bundesliga')) {
    return 'bundesliga';
  }

  if (slug.includes('ligue-1')) {
    return 'ligue-1';
  }

  return '';
}

function renderLeagueLegend() {
  const league = getLeagueKeyForStandings();

  const standardLeagues = ['premier-league', 'serie-a', 'la-liga'];
  const playoffLeagues = ['bundesliga', 'ligue-1'];

  if (!standardLeagues.includes(league) && !playoffLeagues.includes(league)) {
    return '';
  }

  const items = [
    ['ucl', 'Champions League'],
    ['uel', 'Europa League'],
    ['uecl', 'Conference League']
  ];

  if (playoffLeagues.includes(league)) {
    items.push(['playout', 'Play-out relegation']);
  }

  items.push(['relegation', 'Relegation']);

  return `
    <div class="qualification-note">
      ${items.map(item => `
        <span class="note-dot ${item[0]}"></span>
        ${escapeHTML(item[1])}
      `).join('')}
    </div>
  `;
}

function isGroupStageCompetition() {
  const type = String(appData.competitionType || appData.site?.competitionType || '').toLowerCase();

  return type.includes('group') || type.includes('groups');
}

function normaliseCompetitionName(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function normaliseRegion(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
}

function compareSeasonsDesc(a, b) {
  const aYear = extractSeasonStartYear(a);
  const bYear = extractSeasonStartYear(b);

  if (bYear !== aYear) {
    return bYear - aYear;
  }

  return String(b || '').localeCompare(String(a || ''));
}

function extractSeasonStartYear(value) {
  const text = String(value || '');
  const match = text.match(/\d{4}/);

  return match ? Number(match[0]) : 0;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normaliseText(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function normaliseTeamName(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\([a-z]{2,4}\)/gi, '')
    .replace(/[^a-z0-9À-ÿ\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  if (el) {
    el.textContent = value;
  }
}

function setHTML(id, value) {
  const el = $(id);

  if (el) {
    el.innerHTML = value;
  }
}

function showError(message) {
  setText('competitionTitle', 'Error');
  setText('competitionSubtitle', message);
  setHTML('homeGamesList', `<div class="empty">${escapeHTML(message)}</div>`);
  setHTML('scoreboardList', `<div class="empty">${escapeHTML(message)}</div>`);
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

/* Competition region menus */

function renderCompetitionCategoryNav() {
  const nav = $('competitionCategoryNav');

  if (!nav || !appData || !appData.competitions) {
    return;
  }

  const categories = getCompetitionCategories();

  nav.innerHTML = categories.map(category => {
    const competitions = getUniqueCompetitionsForCategory(category.key);

    const activeCategory = competitions.some(comp => {
      const active = appData.selectedCompetition || {};
      return (
        normaliseCompetitionName(comp['Competition Name']) === normaliseCompetitionName(active['Competition Name']) &&
        getCompetitionCategoryKey(comp) === getCompetitionCategoryKey(active)
      );
    });

    const activeClass = activeCategory ? 'is-active' : '';
    const disabledClass = competitions.length ? '' : 'is-empty';

    const items = competitions.length
      ? competitions.map(comp => {
          const latest = getLatestSeasonForCompetition(comp);
          const slug = makeCompetitionSlug(latest);
          const active = appData.selectedCompetition || {};
          const activeItem =
            normaliseCompetitionName(comp['Competition Name']) === normaliseCompetitionName(active['Competition Name']) &&
            getCompetitionCategoryKey(comp) === getCompetitionCategoryKey(active)
              ? 'active-item'
              : '';

          return `
            <button type="button" class="category-menu-item ${activeItem}" onclick="selectCompetitionFromCategory('${escapeAttr(slug)}')">
              <span>${escapeHTML(comp['Competition Name'] || 'Competition')}</span>
              ${activeItem ? '<strong>Current</strong>' : ''}
            </button>
          `;
        }).join('')
      : `<div class="category-empty">No competitions yet</div>`;

    return `
      <div class="competition-category ${activeClass} ${disabledClass}">
        <button type="button" class="category-button" onclick="toggleCompetitionCategory('${escapeAttr(category.key)}')">
          <span class="category-icon">${category.icon}</span>
          <span class="category-name">${escapeHTML(category.label)}</span>
          <span class="category-arrow">⌄</span>
        </button>

        <div class="category-menu" data-category-menu="${escapeAttr(category.key)}">
          <div class="category-menu-title">
            <span>${category.icon}</span>
            <strong>${escapeHTML(category.label)}</strong>
          </div>

          ${items}
        </div>
      </div>
    `;
  }).join('');
}

function getCompetitionCategories() {
  return [
    {
      key: 'england',
      label: 'England',
      icon: '🏴󠁧󠁢󠁥󠁮󠁧󠁿'
    },
    {
      key: 'italy',
      label: 'Italy',
      icon: '🇮🇹'
    },
    {
      key: 'spain',
      label: 'Spain',
      icon: '🇪🇸'
    },
    {
      key: 'germany',
      label: 'Germany',
      icon: '🇩🇪'
    },
    {
      key: 'france',
      label: 'France',
      icon: '🇫🇷'
    },
    {
      key: 'europe',
      label: 'Europe',
      icon: '🇪🇺'
    },
    {
      key: 'world',
      label: 'World',
      icon: '🌍'
    },
    {
      key: 'national-teams',
      label: 'National Teams',
      icon: '🏆'
    }
  ];
}

function getUniqueCompetitionsForCategory(categoryKey) {
  const competitions = (appData.competitions || [])
    .filter(comp => getCompetitionCategoryKey(comp) === categoryKey);

  const map = new Map();

  competitions.forEach(comp => {
    const key = `${getCompetitionCategoryKey(comp)}|${normaliseCompetitionName(comp['Competition Name'])}`;

    if (!map.has(key)) {
      map.set(key, comp);
      return;
    }

    const existing = map.get(key);
    const latest = compareSeasonsDesc(comp.Year, existing.Year) < 0 ? comp : existing;
    map.set(key, latest);
  });

  return Array.from(map.values()).sort((a, b) => {
    const priority = getCompetitionPriority(categoryKey, a) - getCompetitionPriority(categoryKey, b);

    if (priority !== 0) {
      return priority;
    }

    return String(a['Competition Name'] || '').localeCompare(String(b['Competition Name'] || ''));
  });
}

function getLatestSeasonForCompetition(comp) {
  const categoryKey = getCompetitionCategoryKey(comp);
  const competitionName = normaliseCompetitionName(comp['Competition Name']);

  const seasons = (appData.competitions || [])
    .filter(item => {
      return (
        getCompetitionCategoryKey(item) === categoryKey &&
        normaliseCompetitionName(item['Competition Name']) === competitionName
      );
    })
    .sort((a, b) => compareSeasonsDesc(a.Year, b.Year));

  return seasons[0] || comp;
}

function getCompetitionCategoryKey(comp) {
  const region = normaliseRegion(comp.Region);

  if (region === 'england') {
    return 'england';
  }

  if (region === 'italy') {
    return 'italy';
  }

  if (region === 'spain') {
    return 'spain';
  }

  if (region === 'germany') {
    return 'germany';
  }

  if (region === 'france') {
    return 'france';
  }

  if (region === 'europe') {
    return 'europe';
  }

  if (region === 'world') {
    return 'world';
  }

  if (
    region === 'national teams' ||
    region === 'national-teams' ||
    region === 'international' ||
    region === 'africa' ||
    region === 'south america' ||
    region === 'north america' ||
    region === 'asia'
  ) {
    return 'national-teams';
  }

  return 'world';
}

function getCompetitionPriority(categoryKey, comp) {
  const name = String(comp['Competition Name'] || '').toLowerCase();

  const priorityMap = {
    england: [
      'premier league',
      'fa cup',
      'carabao cup',
      'community shield',
      'championship',
      'league one',
      'league two'
    ],
    italy: [
      'serie a',
      'coppa italia',
      'italian super cup',
      'supercoppa'
    ],
    spain: [
      'la liga',
      'copa del rey',
      'supercopa'
    ],
    germany: [
      'bundesliga',
      'dfb-pokal',
      'dfl-supercup'
    ],
    france: [
      'ligue 1',
      'coupe de france',
      'trophee des champions'
    ],
    europe: [
      'champions league',
      'europa league',
      'conference league',
      'uefa super cup'
    ],
    world: [
      'world cup',
      'club world cup',
      'world championship',
      'intercontinental cup'
    ],
    'national-teams': [
      'world cup',
      'euro',
      'nations league',
      'afcon',
      'africa cup',
      'copa america',
      'asian cup',
      'gold cup'
    ]
  };

  const list = priorityMap[categoryKey] || [];

  for (let i = 0; i < list.length; i++) {
    if (name.includes(list[i])) {
      return i;
    }
  }

  return 999;
}

function toggleCompetitionCategory(categoryKey) {
  const nav = $('competitionCategoryNav');

  if (!nav) {
    return;
  }

  const allMenus = nav.querySelectorAll('.category-menu');
  const clickedMenu = nav.querySelector(`[data-category-menu="${categoryKey}"]`);

  allMenus.forEach(menu => {
    if (menu !== clickedMenu) {
      menu.classList.remove('open');
    }
  });

  if (clickedMenu) {
    clickedMenu.classList.toggle('open');
  }
}

window.toggleCompetitionCategory = toggleCompetitionCategory;

async function selectCompetitionFromCategory(slug) {
  const nav = $('competitionCategoryNav');

  if (nav) {
    nav.querySelectorAll('.category-menu').forEach(menu => {
      menu.classList.remove('open');
    });
  }

  resetFilters();
  updateUrlCompetition(slug);
  await loadCompetition(slug);
}

window.selectCompetitionFromCategory = selectCompetitionFromCategory;

document.addEventListener('click', event => {
  const nav = $('competitionCategoryNav');

  if (!nav) {
    return;
  }

  if (!nav.contains(event.target)) {
    nav.querySelectorAll('.category-menu').forEach(menu => {
      menu.classList.remove('open');
    });
  }
});

/* =========================================
   Calcium Sport update 6906
   Home landing page + global daily games
   Competition pages: Next Up / Results / Fixtures / Standings / Stats
========================================= */

function isHomePage() {
  return !new URLSearchParams(window.location.search).get('competition');
}

function getCompetitionMatches() {
  const main = Array.isArray(appData && appData.matches) ? appData.matches : [];
  const playoffs = Array.isArray(appData && appData.playoffs) ? appData.playoffs : [];
  return dedupeMatchArray(main.concat(playoffs));
}

function getGlobalMatches() {
  const all = Array.isArray(appData && appData.allMatches) ? appData.allMatches : [];
  return dedupeMatchArray(all);
}

function dedupeMatchArray(matches) {
  const seen = new Set();
  return (matches || []).filter(match => {
    const key = String(match.MatchID || match.ID || '').trim();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function loadCompetition(competitionParam) {
  const url = competitionParam
    ? `${API_URL}?competition=${encodeURIComponent(competitionParam)}`
    : `${API_URL}?mode=home`;

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

  if (!selectedDateKey) {
    selectedDateKey = getTodayKey();
  }

  expandedStats = {
    topScorers: false,
    topAssists: false,
    cleanSheets: false,
    yellowCards: false,
    redCards: false
  };

  populateCompetitionDropdown();
  populateGroupDropdown();
  populateRoundDropdown();
  populateSeasonDropdown();
  renderAll();
}

function bindEvents() {
  const competitionSelect = $('competitionSelect');
  const seasonSelect = $('seasonSelect');
  const jumpSelect = $('jumpSelect');
  const searchInput = $('searchInput');
  const groupFilter = $('groupFilter');
  const roundFilter = $('roundFilter');
  const clearBtn = $('clearFilters');

  if (competitionSelect) {
    competitionSelect.addEventListener('change', async event => {
      const selected = event.target.value;
      resetFilters();
      updateUrlCompetition(selected);
      await loadCompetition(selected);
    });
  }

  if (seasonSelect) {
    seasonSelect.addEventListener('change', async event => {
      const selected = event.target.value;
      resetFilters();
      updateUrlCompetition(selected);
      await loadCompetition(selected);
    });
  }

  if (jumpSelect) {
    jumpSelect.addEventListener('change', event => {
      if (isHomePage()) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      jumpToSection(event.target.value);
      setActiveTab(event.target.value);
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

  if (roundFilter) {
    roundFilter.addEventListener('change', event => {
      currentRound = event.target.value;
      renderAll();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      resetFilters();
      renderAll();
    });
  }

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      const view = button.getAttribute('data-view');
      setActiveTab(view);
      jumpToSection(view);
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
  if (!appData) {
    return;
  }

  document.body.classList.toggle('is-home-page', isHomePage());
  document.body.classList.toggle('is-competition-page', !isHomePage());

  renderHeader();
  renderDateTabs();

  if (isHomePage()) {
    renderHomeGames();
    return;
  }

  renderScoreboard();
  renderResults();
  renderFixtures();
  renderStandings();
  renderStats();
}

function renderHeader() {
  const site = appData.site || {};
  const selected = appData.selectedCompetition || {};

  if (isHomePage()) {
    setText('siteSubtitle', 'Football results centre');
    setText('competitionTitle', 'Football');
    setText('competitionSubtitle', 'All games across every competition');
    setText('regionLabel', 'Home');
    setText('startDate', '');
    setText('endDate', '');

    const jumpSelect = $('jumpSelect');
    if (jumpSelect) {
      jumpSelect.value = 'nextUp';
    }

    return;
  }

  const name = selected['Competition Name'] || site.competition || 'Competition';
  const year = selected.Year || site.year || '';
  const region = selected.Region || site.region || 'Football';
  const logo = selected['Logo URL'] || site.logoUrl || '';

  setText('competitionTitle', name);
  setText('competitionSubtitle', year ? `${name} ${year}` : name);
  setText('siteSubtitle', year ? `${name} ${year}` : 'Football results centre');
  setText('regionLabel', region);
  setText('startDate', selected.StartDate || site.startDate || 'Start');
  setText('endDate', selected.EndDate || site.endDate || 'End');

  const scoreboardTitle = $('scoreboardTitle');

  if (scoreboardTitle) {
    scoreboardTitle.textContent = 'Next Up';
  }

  const logoEl = $('competitionLogo');

  if (logoEl && logo) {
    logoEl.src = logo;
    logoEl.alt = `${name} logo`;
  }
}

function renderDateTabs() {
  const container = $('dateTabs');

  if (!container) {
    return;
  }

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dates = [
    { key: dateToKey(yesterday), dayLabel: 'Yesterday', shortDate: formatShortDateFromDate(yesterday) },
    { key: dateToKey(today), dayLabel: 'Today', shortDate: formatShortDateFromDate(today) },
    { key: dateToKey(tomorrow), dayLabel: 'Tomorrow', shortDate: formatShortDateFromDate(tomorrow) }
  ];

  const buttons = dates.map(item => {
    const active = item.key === selectedDateKey ? 'active' : '';

    return `
      <button type="button" class="${active}" onclick="selectDateTab('${escapeAttr(item.key)}')">
        <span>${escapeHTML(item.dayLabel)}</span>
        <strong>${escapeHTML(item.shortDate)}</strong>
      </button>
    `;
  }).join('');

  const picked = parseDateOnly(selectedDateKey);
  const pickedValue = picked ? dateToKey(picked) : selectedDateKey;
  const customDateActive = dates.some(item => item.key === selectedDateKey) ? '' : 'active';

  container.innerHTML = `
  ${buttons}
  <div class="date-picker-button ${customDateActive}">
    <span class="calendar-icon">📅</span>
    <span class="calendar-label">Pick a date</span>
    <input id="homeDatePicker" type="date" value="${escapeAttr(pickedValue)}" onchange="pickHomeDate(this.value)" aria-label="Pick a date" style="position:static; opacity:1; width:120px; min-width:120px; height:auto; padding:4px; margin-top:4px; cursor:pointer;">
  </div>
`;
}

window.selectDateTab = function selectDateTab(key) {
  selectedDateKey = key;
  renderDateTabs();
  renderHomeGames();
};

window.pickHomeDate = function pickHomeDate(value) {
  if (!value) {
    return;
  }

  selectedDateKey = value;
  renderDateTabs();
  renderHomeGames();
};

window.openHomeDatePicker = function openHomeDatePicker() {
  const picker = document.getElementById('homeDatePicker');

  if (!picker) {
    console.warn('homeDatePicker input was not found');
    return;
  }

  try {
    if (typeof picker.showPicker === 'function') {
      picker.showPicker();
      return;
    }
  } catch (error) {
    console.warn('showPicker failed, using click fallback', error);
  }

  picker.focus();
  picker.click();
};

function renderHomeGames() {
  const allMatches = getGlobalMatches();
  const matches = allMatches
    .filter(match => getDateKey(match.Date) === selectedDateKey)
    .sort(compareHomeMatches);

  const countEl = $('homeMatchCount');
  const titleEl = $('homeAllGamesTitle');

  if (countEl) {
    countEl.textContent = matches.length;
  }

  if (titleEl) {
    titleEl.textContent = `All games (${matches.length})`;
  }

  if (!matches.length) {
    setHTML('homeGamesList', '<div class="empty home-empty">No games scheduled on this date.</div>');
    return;
  }

  const timeGroups = groupBy(matches, match => normaliseKickoffTime(match.Time));

  const html = Object.keys(timeGroups)
    .sort((a, b) => timeSortValue(a) - timeSortValue(b))
    .map(time => {
      const timeMatches = timeGroups[time].sort((a, b) => compareCompetitionPriority(a, b));
      const competitionGroups = groupBy(timeMatches, match => match.CompetitionLabel || match.Competition || 'Competition');

      const competitionHtml = Object.keys(competitionGroups)
        .sort((a, b) => compareCompetitionNamePriority(a, b, competitionGroups))
        .map(competitionName => {
          const compMatches = competitionGroups[competitionName];

          return `
            <section class="home-competition-block">
              <div class="home-competition-mini-title">
                <span>${escapeHTML(getRegionForCompetition(compMatches[0]))}</span>
                <strong>${escapeHTML(competitionName)}</strong>
              </div>
              ${compMatches.map(renderHomeMatchRow).join('')}
            </section>
          `;
        }).join('');

      return `
        <section class="home-time-block">
          <div class="home-time-heading">${escapeHTML(time || 'Scheduled')}</div>
          ${competitionHtml}
        </section>
      `;
    }).join('');

  setHTML('homeGamesList', html);
}

function renderHomeMatchRow(match) {
  const isFinished = match.Status === 'FT';
  const scoreLabel = isFinished ? renderScoreText(match) : '- : -';

  const homeLogo = match.HomeLogo
    ? `<img src="${escapeAttr(match.HomeLogo)}" alt="">`
    : '';

  const awayLogo = match.AwayLogo
    ? `<img src="${escapeAttr(match.AwayLogo)}" alt="">`
    : '';

  const clickHandler = match.MatchID ? `onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"` : '';

  return `
    <article class="home-match-row" ${clickHandler}>
      <div class="home-match-time">${escapeHTML(match.Time || '')}</div>

      <div class="home-match-teams">
        <div>
          ${homeLogo}
          <span>${escapeHTML(match.HomeTeam)}</span>
        </div>

        <div>
          ${awayLogo}
          <span>${escapeHTML(match.AwayTeam)}</span>
        </div>
      </div>

      <div class="home-match-score">${scoreLabel}</div>
    </article>
  `;
}

function compareHomeMatches(a, b) {
  const timeDiff = timeSortValue(normaliseKickoffTime(a.Time)) - timeSortValue(normaliseKickoffTime(b.Time));
  if (timeDiff !== 0) {
    return timeDiff;
  }

  const compDiff = compareCompetitionPriority(a, b);
  if (compDiff !== 0) {
    return compDiff;
  }

  return String(a.HomeTeam || '').localeCompare(String(b.HomeTeam || ''));
}

function compareCompetitionPriority(a, b) {
  const aCategory = getCompetitionCategoryKey(a);
  const bCategory = getCompetitionCategoryKey(b);
  const categoryOrder = ['england', 'italy', 'spain', 'germany', 'france', 'europe', 'world', 'national-teams'];

  const categoryDiff = (categoryOrder.indexOf(aCategory) === -1 ? 999 : categoryOrder.indexOf(aCategory)) -
    (categoryOrder.indexOf(bCategory) === -1 ? 999 : categoryOrder.indexOf(bCategory));

  if (categoryDiff !== 0) {
    return categoryDiff;
  }

  return getCompetitionPriority(aCategory, { 'Competition Name': a.Competition || a.CompetitionLabel || '' }) -
    getCompetitionPriority(bCategory, { 'Competition Name': b.Competition || b.CompetitionLabel || '' });
}

function compareCompetitionNamePriority(aName, bName, grouped) {
  const aMatch = grouped[aName][0] || {};
  const bMatch = grouped[bName][0] || {};
  return compareCompetitionPriority(aMatch, bMatch) || aName.localeCompare(bName);
}

function normaliseKickoffTime(value) {
  const text = String(value || '').trim();
  return text || 'Scheduled';
}

function timeSortValue(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return 99999;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function populateRoundDropdown() {
  const select = $('roundFilter');

  if (!select) {
    return;
  }

  const rounds = [...new Set(getCompetitionMatches()
    .map(match => String(match.Round || '').trim())
    .filter(Boolean))]
    .sort((a, b) => roundSortValue(a) - roundSortValue(b));

  select.innerHTML = `
    <option value="">All rounds</option>
    ${rounds.map(round => `<option value="${escapeHTML(round)}">${escapeHTML(formatRoundLabel(round))}</option>`).join('')}
  `;

  if (currentRound && rounds.includes(currentRound)) {
    select.value = currentRound;
  }

  if (currentRound && !rounds.includes(currentRound)) {
    currentRound = '';
    select.value = '';
  }
}

function renderScoreboard() {
  const matches = getFilteredMatches();

  if (!matches.length) {
    setHTML('scoreboardList', '<div class="empty">No matches found.</div>');
    return;
  }

  const nextUp = getNextUpMatch(matches);
  const html = nextUp
    ? `
      ${nextUp.Status === 'FT' ? '<div class="season-complete-note">Season completed. Showing the last match played.</div>' : ''}
      <section class="round-block">
        <div class="round-heading">${escapeHTML(formatRoundLabel(nextUp.Round || 'Next Up'))}</div>
        ${renderScoreboardRow(nextUp)}
      </section>
    `
    : '<div class="empty">No matches found.</div>';

  setHTML('scoreboardList', html);
}

function getNextUpMatch(matches) {
  const ordered = [...matches].sort((a, b) => matchDateSortValue(a) - matchDateSortValue(b));
  const scheduled = ordered.filter(match => match.Status !== 'FT' && matchDateSortValue(match) > 0);

  if (scheduled.length) {
    return scheduled[0];
  }

  const completed = ordered
    .filter(match => match.Status === 'FT' && matchDateSortValue(match) > 0)
    .sort((a, b) => matchDateSortValue(b) - matchDateSortValue(a));

  return completed[0] || ordered[0] || null;
}

function renderResults() {
  const results = getFilteredMatches()
    .filter(match => match.Status === 'FT')
    .sort((a, b) => matchDateSortValue(b) - matchDateSortValue(a));

  const html = results.length
    ? renderGroupedScoreboard(results)
    : '<div class="empty">No results found.</div>';

  setHTML('resultsList', html);

  const countEl = $('resultsCount');

  if (countEl) {
    countEl.textContent = `${results.length} matches`;
  }
}

function renderFixtures() {
  const fixtures = getFilteredMatches()
    .filter(match => match.Status !== 'FT')
    .sort((a, b) => matchDateSortValue(a) - matchDateSortValue(b));

  const html = fixtures.length
    ? renderGroupedScoreboard(fixtures)
    : '<div class="empty">No scheduled games found.</div>';

  setHTML('fixturesList', html);

  const countEl = $('fixturesCount');

  if (countEl) {
    countEl.textContent = `${fixtures.length} matches`;
  }
}

function getFilteredMatches() {
  let matches = getCompetitionMatches();

  if (currentSearch) {
    matches = matches.filter(match => {
      return [
        match.HomeTeam,
        match.AwayTeam,
        match.Round,
        match.Competition,
        match.Date,
        match.Time
      ].join(' ').toLowerCase().includes(currentSearch);
    });
  }

  if (currentRound) {
    const selectedRoundKey = normaliseText(currentRound);
    matches = matches.filter(match => normaliseText(match.Round) === selectedRoundKey);
  }

  if (currentGroup) {
    const selectedGroupKey = normaliseText(currentGroup);

    const teamsInGroup = (appData.standings || [])
      .filter(row => normaliseText(row.Group) === selectedGroupKey)
      .map(row => normaliseTeamName(row.Team))
      .filter(Boolean);

    matches = matches.filter(match => {
      const home = normaliseTeamName(match.HomeTeam);
      const away = normaliseTeamName(match.AwayTeam);
      const round = normaliseText(match.Round);

      return (
        teamsInGroup.includes(home) ||
        teamsInGroup.includes(away) ||
        round === selectedGroupKey ||
        round.includes(selectedGroupKey)
      );
    });
  }

  return matches;
}

function openMatchDetail(matchId) {
  const allMatches = getGlobalMatches().concat(getCompetitionMatches());
  const seen = new Set();

  const uniqueMatches = allMatches.filter(match => {
    const key = match.MatchID || match.ID;

    if (!key) {
      return false;
    }

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  const match = uniqueMatches.find(item => item.MatchID === matchId || item.ID === matchId);

  if (!match) {
    return;
  }

  const modal = $('matchModal');
  const content = $('matchDetailContent');

  if (!modal || !content) {
    return;
  }

  content.innerHTML = renderMatchDetail(match);
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

window.openMatchDetail = openMatchDetail;

function renderStats() {
  const stats = getFilteredStats();

  renderStatList('topScorers', stats, 'Goals', 'topScorers');
  renderStatList('topAssists', stats, 'Assists', 'topAssists');
  renderStatList('cleanSheets', stats, 'CleanSheets', 'cleanSheets');
  renderStatList('yellowCards', stats, 'YellowCards', 'yellowCards');
  renderStatList('redCards', stats, 'RedCards', 'redCards');
}

function jumpToSection(section) {
  const map = {
    home: 'homeSection',
    nextUp: 'nextUpSection',
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

function updateUrlCompetition(slug) {
  const url = new URL(window.location.href);

  if (!slug || slug === 'home') {
    url.searchParams.delete('competition');
  } else {
    url.searchParams.set('competition', slug);
  }

  window.history.replaceState({}, '', url.toString());
}

function renderCompetitionCategoryNav() {
  const nav = $('competitionCategoryNav');

  if (!nav || !appData || !appData.competitions) {
    return;
  }

  const categories = getCompetitionCategories();

  const homeButton = `
    <div class="competition-category ${isHomePage() ? 'is-active' : ''}">
      <button type="button" class="category-button" onclick="goHomePage()">
        <span class="category-icon">🏠</span>
        <span class="category-name">Home</span>
      </button>
    </div>
  `;

  nav.innerHTML = homeButton + categories.map(category => {
    const competitions = getUniqueCompetitionsForCategory(category.key);

    const activeCategory = !isHomePage() && competitions.some(comp => {
      const active = appData.selectedCompetition || {};
      return (
        normaliseCompetitionName(comp['Competition Name']) === normaliseCompetitionName(active['Competition Name']) &&
        getCompetitionCategoryKey(comp) === getCompetitionCategoryKey(active)
      );
    });

    const activeClass = activeCategory ? 'is-active' : '';
    const disabledClass = competitions.length ? '' : 'is-empty';

    const items = competitions.length
      ? competitions.map(comp => {
          const latest = getLatestSeasonForCompetition(comp);
          const slug = makeCompetitionSlug(latest);
          const active = appData.selectedCompetition || {};
          const activeItem = !isHomePage() &&
            normaliseCompetitionName(comp['Competition Name']) === normaliseCompetitionName(active['Competition Name']) &&
            getCompetitionCategoryKey(comp) === getCompetitionCategoryKey(active)
              ? 'active-item'
              : '';

          return `
            <button type="button" class="category-menu-item ${activeItem}" onclick="selectCompetitionFromCategory('${escapeAttr(slug)}')">
              <span>${escapeHTML(comp['Competition Name'] || 'Competition')}</span>
              ${activeItem ? '<strong>Current</strong>' : ''}
            </button>
          `;
        }).join('')
      : `<div class="category-empty">No competitions yet</div>`;

    return `
      <div class="competition-category ${activeClass} ${disabledClass}">
        <button type="button" class="category-button" onclick="toggleCompetitionCategory('${escapeAttr(category.key)}')">
          <span class="category-icon">${category.icon}</span>
          <span class="category-name">${escapeHTML(category.label)}</span>
          <span class="category-arrow">⌄</span>
        </button>

        <div class="category-menu" data-category-menu="${escapeAttr(category.key)}">
          <div class="category-menu-title">
            <span>${category.icon}</span>
            <strong>${escapeHTML(category.label)}</strong>
          </div>

          ${items}
        </div>
      </div>
    `;
  }).join('');
}

async function goHomePage() {
  const nav = $('competitionCategoryNav');

  if (nav) {
    nav.querySelectorAll('.category-menu').forEach(menu => {
      menu.classList.remove('open');
    });
  }

  resetFilters();
  updateUrlCompetition('');
  await loadCompetition('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.goHomePage = goHomePage;

async function selectCompetitionFromCategory(slug) {
  const nav = $('competitionCategoryNav');

  if (nav) {
    nav.querySelectorAll('.category-menu').forEach(menu => {
      menu.classList.remove('open');
    });
  }

  resetFilters();
  updateUrlCompetition(slug);
  await loadCompetition(slug);
  setActiveTab('nextUp');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.selectCompetitionFromCategory = selectCompetitionFromCategory;

window.CALCIUM_SCRIPT_VERSION = '6913-native-date-input';

give me the new full one for all these edits I told you to do
.hero-top,
.hero-copy > p,
.competition-meta-row,
.date-row {
  display: none !important;
}

.scoreboard-row.calcium-row-layout {
  grid-template-columns: 130px minmax(180px, 1fr) 90px minmax(180px, 1fr) !important;
  gap: 22px !important;
}

.scoreboard-row.calcium-row-layout .score-team-home {
  justify-content: flex-end !important;
  text-align: right !important;
}

.scoreboard-row.calcium-row-layout .score-team-away {
  justify-content: flex-start !important;
  text-align: left !important;
}

.scoreboard-row.calcium-row-layout .scoreboard-score {
  justify-self: center !important;
}
