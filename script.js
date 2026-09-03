const API_URL = 'https://script.google.com/macros/s/AKfycbwGK-Qg0o1UwBzU6np-y9_XA9KefEiuqGmEVax7kfT2cees6WD5zwBz4iCGHSYt5CwQ/exec';
const HUB_SPREADSHEET_ID = '1XpJYhVzkPLqj_xFBpUGYzY4Jn8hTmGvbFbTGJCEOKw0';
const MY_GAMES_NATIONAL_TEAMS = new Set([
  'Portugal','Spain','France','England','Italy','Netherlands',
  'Germany','Morocco','Brazil','Argentina'
].map(normaliseTeamName));

let appData = null;
let playerImageLookup = new Map();
let playerTeamsLookup = new Map();
let teamLogoLookup = new Map();
let activePlayerProfileName='';
let activePlayerSeason='';
const competitionDetailCache = new Map();
let currentCompetition = new URLSearchParams(window.location.search).get('competition') || '';
let currentSearch = '';
let currentGroup = '';
let currentRound = '';
let selectedDateKey = '';
let currentHomeTab = 'allGames';
let expandedStats = { topScorers:false, topAssists:false, cleanSheets:false, yellowCards:false, redCards:false };
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

async function init(){
  setLoadingState();
  bindEvents();
  try{ await loadCompetition(currentCompetition); }
  catch(error){ console.error(error); showError('Could not load competition data. Please check the Apps Script backend.'); }
}

/* =========================================================
   MAIN DATA LOADER

   Home page:
     Apps Script API (?action=home) -> Global Games hub sheet,
     already filtered into "All games" + "My Games" (favourite
     teams) by the backend.

   Competition page:
     Apps Script API (?action=competitions) -> resolves the
     selected competition's own Sheet ID, then
     (?action=competitionDetail) reads that competition's
     spreadsheet (Fixtures, Standings, Goals, Assists, Yellow
     Cards, Red Cards, Clean Sheets) server-side.

   Both paths also read the Website Hub's Players + Logos tabs
   via (?action=hubData), for player photos and team badges.

   Everything goes through the Apps Script backend rather than
   reading sheets directly from the browser, since a
   server-side read is always immune to any regular filter
   applied in the sheet - a filter only affects direct browser
   reads (like gviz), never SpreadsheetApp reads.
========================================================= */

let hubDataCache = null;
let competitionsListCache = null;

async function loadCompetition(competitionParam){

  appData = {
    matches:[], playoffs:[], allMatches:[], myGames:[],
    standings:[], stats:[], competitions:[],
    players:[], playerTeams:[],
    selectedCompetition:null, site:{}
  };

  if(!hubDataCache){
    const hubResponse = await fetch(`${API_URL}?action=hubData&v=${Date.now()}`, { cache:'no-store' }).catch(()=>null);
    hubDataCache = (hubResponse && hubResponse.ok) ? await hubResponse.json().catch(()=>null) : null;
  }
  const hubData = hubDataCache;

  appData.players = (hubData && hubData.players) || [];
  teamLogoLookup = buildTeamLogoLookup((hubData && hubData.logos) || []);

  if(!competitionParam){
    await loadHomeData();
  } else {
    await loadCompetitionData(competitionParam);
  }

  playerImageLookup = buildPlayerImageLookup(appData.players);
  playerTeamsLookup = buildPlayerTeamsLookup(appData.playerTeams);

  const selected = appData.selectedCompetition || appData.site || {};
  currentCompetition = makeCompetitionSlug(selected);
  if(!selectedDateKey) selectedDateKey = getTodayKey();
  expandedStats = { topScorers:false, topAssists:false, cleanSheets:false, yellowCards:false, redCards:false };
  populateCompetitionDropdowns();
  populateFilters();
  renderAll();
}

async function loadHomeData(){
  const response = await fetch(`${API_URL}?action=home&v=${Date.now()}`, { cache:'no-store' });
  if(!response.ok) throw new Error(`Backend error: ${response.status}`);
  const data = await response.json();
  if(data.error) throw new Error(data.error);

  appData.allMatches = (data.allGames||[]).map(mapApiMatchToPascal);
  appData.myGames = (data.myGames||[]).map(mapApiMatchToPascal);
  appData.competitions = (data.competitions||[]).map(mapApiCompetitionToPascal);

  // The deployed home endpoint can temporarily serve an older Global Games
  // snapshot after a hub rebuild. Keep Nations League visible by falling back
  // to the same dedicated Fixtures source used by its competition page.
  await mergeMissingHomeCompetition('Nations League');
  mergeNationalTeamFavouritesIntoMyGames();
}

function mergeNationalTeamFavouritesIntoMyGames(){
  const nationalTeamMatches = appData.allMatches.filter(match => {
    if(getCompetitionCategoryKey(match) !== 'national-teams') return false;
    return MY_GAMES_NATIONAL_TEAMS.has(normaliseTeamName(match.HomeTeam)) ||
      MY_GAMES_NATIONAL_TEAMS.has(normaliseTeamName(match.AwayTeam));
  });
  appData.myGames = dedupeMatchArray(appData.myGames.concat(nationalTeamMatches));
}

async function mergeMissingHomeCompetition(competitionName){
  const wanted = normaliseCompetitionName(competitionName);
  const alreadyIncluded = appData.allMatches.some(match =>
    normaliseCompetitionName(match.Competition) === wanted
  );
  if(alreadyIncluded) return;

  const competition = appData.competitions
    .filter(comp => normaliseCompetitionName(comp['Competition Name']) === wanted)
    .sort((a,b) => compareSeasonsDesc(a.Year,b.Year))[0];
  const sheetId = String(competition?.['Sheet ID'] || '').trim();
  if(!competition || !sheetId) return;

  try{
    const response = await fetch(`${API_URL}?action=competitionDetail&sheetId=${encodeURIComponent(sheetId)}&v=${Date.now()}`, { cache:'no-store' });
    if(!response.ok) return;
    const detail = await response.json();
    if(detail.error) return;

    const matches = parseFixturesTable(detail.fixtures || []).map(match => ({
      ...match,
      Competition: competition['Competition Name'],
      Year: competition.Year,
      Region: competition.Region,
      CompetitionType: competition['Competition Type']
    }));
    appData.allMatches = dedupeMatchArray(appData.allMatches.concat(matches));
  } catch(error){
    console.warn(`Could not load ${competitionName} home fallback.`, error);
  }
}

async function loadCompetitionData(slug){
  if(!competitionsListCache){
    const response = await fetch(`${API_URL}?action=competitions&v=${Date.now()}`, { cache:'no-store' });
    if(!response.ok) throw new Error(`Backend error: ${response.status}`);
    const data = await response.json();
    if(data.error) throw new Error(data.error);
    competitionsListCache = (data.competitions||[]).map(mapApiCompetitionToPascal);
  }

  const competitions = competitionsListCache;
  appData.competitions = competitions;

  const selected = competitions.find(c => makeCompetitionSlug(c) === slug);
  if(!selected){
    throw new Error('Competition not found: ' + slug);
  }

  appData.selectedCompetition = selected;
  appData.site = {
    competition: selected['Competition Name'],
    year: selected.Year,
    logoUrl: selected['Logo URL'],
    region: selected.Region,
    competitionType: selected['Competition Type'] || ''
  };

  const sheetId = selected['Sheet ID'];
  if(!sheetId){
    throw new Error('No Sheet ID configured for this competition.');
  }

  const detailResponse = await fetch(`${API_URL}?action=competitionDetail&sheetId=${encodeURIComponent(sheetId)}&v=${Date.now()}`, { cache:'no-store' });
  if(!detailResponse.ok) throw new Error(`Backend error: ${detailResponse.status}`);
  const detail = await detailResponse.json();
  if(detail.error) throw new Error(detail.error);

  appData.matches = parseFixturesTable(detail.fixtures || []);
  appData.playoffs = [];
  appData.standings = parseStandingsTable(detail.standings || [], appData);
  appData.stats = mergeStatsTables({
    Goals: detail.goals || [],
    Assists: detail.assists || [],
    YellowCards: detail.yellowCards || [],
    RedCards: detail.redCards || [],
    CleanSheets: detail.cleanSheets || []
  });
}
function bindEvents(){
  $('seasonSelect')?.addEventListener('change', async e => { resetFilters(); updateUrlCompetition(e.target.value); await loadCompetition(e.target.value); });
  $('jumpSelect')?.addEventListener('change', e => jumpToSection(e.target.value));
  $('searchInput')?.addEventListener('input', e => { currentSearch = e.target.value.toLowerCase().trim(); renderAll(); });
  $('groupFilter')?.addEventListener('change', e => { currentGroup = e.target.value; renderAll(); });
  $('roundFilter')?.addEventListener('change', e => { currentRound = e.target.value; renderAll(); });
  $('clearFilters')?.addEventListener('click', () => { resetFilters(); renderAll(); });
  $('backToTop')?.addEventListener('click', () => window.scrollTo({top:0,behavior:'smooth'}));
  $('masterSearchInput')?.addEventListener('input', e => renderMasterSearchResults(e.target.value));
  $('masterSearchInput')?.addEventListener('focus', e => renderMasterSearchResults(e.target.value));
  $('masterSearchClear')?.addEventListener('click', clearMasterSearch);
  document.addEventListener('click', event => {
    if(event.target.closest('[data-view]')){ const view = event.target.closest('[data-view]').dataset.view; setActiveTab(view); jumpToSection(view); }
    if(event.target.closest('[data-home-tab]')){ currentHomeTab = event.target.closest('[data-home-tab]').dataset.homeTab || 'allGames'; renderHomeTab(); }
    const nav = $('competitionCategoryNav'); if(nav && !nav.contains(event.target)) nav.querySelectorAll('.category-menu').forEach(menu=>menu.classList.remove('open'));
  });
}

function setLoadingState(){
  setText('competitionTitle','Loading...'); setText('competitionSubtitle','Loading competition data');
  ['homeGamesList','myGamesList','scoreboardList','resultsList','fixturesList','standingsContainer'].forEach(id=>setHTML(id,'<div class="empty">Loading...</div>'));
}
function renderAll(){
  if(!appData) return;
  document.body.classList.toggle('is-home-page', isHomePage());
  document.body.classList.toggle('is-competition-page', !isHomePage());
  renderHeader(); renderDateTabs();
  if(isHomePage()){ renderHomeGames(); renderMyGames(); renderHomeTab(); return; }
  renderScoreboard(); renderResults(); renderFixtures(); renderStandings(); renderStats();
}
function isHomePage(){ return !new URLSearchParams(window.location.search).get('competition'); }
function renderHeader(){
  const site = appData.site || {}; const selected = appData.selectedCompetition || {};
  if(isHomePage()){ setText('siteSubtitle','Football results centre'); setText('competitionTitle','Football'); setText('competitionSubtitle','All games across every competition'); return; }
  const name = selected['Competition Name'] || site.competition || 'Competition'; const year = selected.Year || site.year || ''; const logo = selected['Logo URL'] || site.logoUrl || '';
  setText('competitionTitle',name); setText('competitionSubtitle',year ? `${name} ${year}` : name); setText('siteSubtitle',year ? `${name} ${year}` : 'Football results centre');
  const logoEl = $('competitionLogo'); if(logoEl){ logoEl.style.display = logo ? 'block' : 'none'; if(logo){ logoEl.src = logo; logoEl.alt = `${name} logo`; } }
}
function populateCompetitionDropdowns(){ renderCompetitionCategoryNav(); populateSeasonDropdown(); }
function populateSeasonDropdown(){
  const seasonSelect=$('seasonSelect'), seasonWrap=$('seasonSwitcherWrap');
  if(!seasonSelect || !seasonWrap || isHomePage() || !appData?.selectedCompetition){ seasonWrap?.classList.add('is-hidden'); return; }
  const selected=appData.selectedCompetition; const selectedName=normaliseCompetitionName(selected['Competition Name']); const selectedRegion=normaliseRegion(selected.Region);
  const seasons=(appData.competitions||[]).filter(c=>normaliseCompetitionName(c['Competition Name'])===selectedName && normaliseRegion(c.Region)===selectedRegion).sort((a,b)=>compareSeasonsDesc(a.Year,b.Year));
  if(seasons.length<=1){ seasonWrap.classList.add('is-hidden'); seasonSelect.innerHTML=''; return; }
  seasonWrap.classList.remove('is-hidden');
  seasonSelect.innerHTML=seasons.map(c=>`<option value="${escapeAttr(makeCompetitionSlug(c))}" ${makeCompetitionSlug(c)===currentCompetition?'selected':''}>${escapeHTML(c.Year||'Season')}</option>`).join('');
}
function populateFilters(){ populateGroupDropdown(); populateRoundDropdown(); }
/* =========================================================
   SHEET READING HELPERS
========================================================= */

function tableToObjects(table){
  if(!table || !Array.isArray(table.cols) || !Array.isArray(table.rows)) return [];
  const labels = table.cols.map(col => String(col?.label||'').trim());
  return table.rows.map(row=>{
    const obj={};
    labels.forEach((label,index)=>{
      if(!label) return;
      const cell = row?.c?.[index];
      obj[label] = cell?.f ?? cell?.v ?? '';
    });
    return obj;
  });
}

function buildTeamLogoLookup(rows){
  const lookup = new Map();
  rows.forEach(row=>{
    const name = String(row['Teams']||row['Team']||'').trim();
    const url = String(row['Logo URL']||'').trim();
    if(name && url) lookup.set(normaliseTeamName(name), url);
  });
  return lookup;
}

function isPresent(value){
  return value !== undefined && value !== null && value !== '';
}

function mapApiMatchToPascal(match){
  const home = match.homeTeam || '';
  const away = match.awayTeam || '';
  return {
    MatchID: match.matchId || `${home}-${away}-${match.date}`,
    Competition: match.competition || '',
    Year: match.year || '',
    Region: match.region || '',
    CompetitionType: match.competitionType || '',
    Round: match.round || '',
    Date: match.date || '',
    Time: match.time || '',
    HomeTeam: home,
    AwayTeam: away,
    HomeScore: isPresent(match.homeScore) ? match.homeScore : '',
    AwayScore: isPresent(match.awayScore) ? match.awayScore : '',
    HomePens: isPresent(match.homePens) ? match.homePens : '',
    AwayPens: isPresent(match.awayPens) ? match.awayPens : '',
    Venue: match.venue || '',
    YouTubeURL: match.youtube || '',
    Status: match.status || '',
    HomeLogo: teamLogoLookup.get(normaliseTeamName(home)) || '',
    AwayLogo: teamLogoLookup.get(normaliseTeamName(away)) || ''
  };
}

function mapApiCompetitionToPascal(comp){
  return {
    'Competition Name': comp.name || '',
    Year: comp.year || '',
    'Sheet ID': comp.sheetId || '',
    Region: comp.region || '',
    'Logo URL': comp.logo || '',
    'Competition Type': comp.type || '',
    Active: comp.active || ''
  };
}

function splitScoreText(text){
  const match = String(text||'').trim().match(/^(\d+)\s*-\s*(\d+)$/);
  return match ? {home:match[1], away:match[2]} : {home:'', away:''};
}

function parseFixturesTable(rows){
  return (rows||[]).map((row,index)=>{
    const home = String(row['Home']||'').trim();
    const away = String(row['Away']||'').trim();
    if(!home || !away) return null;

    const fallback = splitScoreText(row['S']);
    const homeScore = String(row['HG']??'').trim() || fallback.home;
    const awayScore = String(row['AG']??'').trim() || fallback.away;
    const homePens = String(row['HP']??'').trim();
    const awayPens = String(row['AP']??'').trim();
    const matchId = String(row['Match ID']||'').trim() || `${home}-${away}-${index}`;

    return {
      MatchID: matchId,
      Round: String(row['R']||'').trim(),
      HomeTeam: home,
      AwayTeam: away,
      HomeScore: homeScore,
      AwayScore: awayScore,
      HomePens: homePens,
      AwayPens: awayPens,
      Date: row['Date']||'',
      Time: row['Time']||'',
      Venue: row['Venue']||'',
      YouTubeURL: row['YouTube URL']||'',
      Status: (homeScore!=='' && awayScore!=='') ? 'FT' : 'Scheduled',
      HomeLogo: teamLogoLookup.get(normaliseTeamName(home))||'',
      AwayLogo: teamLogoLookup.get(normaliseTeamName(away))||''
    };
  }).filter(Boolean);
}

function mergeStatsTables(tables){
  const merged = new Map();

  function upsert(player, team, key, value){
    const cleanPlayer = String(player||'').trim();
    if(!cleanPlayer) return;
    const mapKey = normalisePlayerName(cleanPlayer) + '|' + normaliseTeamName(team);
    if(!merged.has(mapKey)){
      merged.set(mapKey, {
        Player:cleanPlayer, Team:String(team||'').trim(),
        Goals:0, Assists:0, CleanSheets:0, YellowCards:0, RedCards:0,
        Logo: teamLogoLookup.get(normaliseTeamName(team))||''
      });
    }
    merged.get(mapKey)[key] = safeNumber(value);
  }

  (tables.Goals||[]).forEach(r=>upsert(r['Player'], r['Team'], 'Goals', r['Goals']));
  (tables.Assists||[]).forEach(r=>upsert(r['Player'], r['Team'], 'Assists', r['Assists']));
  (tables.YellowCards||[]).forEach(r=>upsert(r['Player'], r['Team'], 'YellowCards', r['Yellow Cards']));
  (tables.RedCards||[]).forEach(r=>upsert(r['Player'], r['Team'], 'RedCards', r['Red Cards']));
  (tables.CleanSheets||[]).forEach(r=>upsert(r['Player'], r['Team'], 'CleanSheets', r['Clean Sheets']));

  return Array.from(merged.values());
}
function loadGoogleVisualizationTable(sheetId,sheetName){
  return new Promise((resolve,reject)=>{
    const callback=`calciumStandings_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script=document.createElement('script');
    const cleanup=()=>{ clearTimeout(timer); script.remove(); try{ delete window[callback]; }catch(_error){ window[callback]=undefined; } };
    const timer=setTimeout(()=>{ cleanup(); reject(new Error('Standings sheet request timed out.')); },15000);
    window[callback]=payload=>{
      cleanup();
      if(payload?.status!=='ok'||!payload?.table) reject(new Error(payload?.errors?.[0]?.detailed_message||'Invalid standings sheet response.'));
      else resolve(payload.table);
    };
    script.onerror=()=>{ cleanup(); reject(new Error('Could not load the Standings sheet.')); };
    const base=`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq`;
    script.src=`${base}?tqx=responseHandler:${encodeURIComponent(callback)}&sheet=${encodeURIComponent(sheetName)}&headers=1&v=${Date.now()}`;
    document.head.appendChild(script);
  });
}
function parseStandingsTable(rows,data){
  if(!Array.isArray(rows) || !rows.length) return [];
  const sampleLabels = Object.keys(rows[0]).map(normaliseStandingHeader);
  if(!sampleLabels.includes('team')) return [];
  const selected=data?.selectedCompetition||{};
  const competition=selected['Competition Name']||data?.site?.competition||'';
  const year=selected.Year||data?.site?.year||'';
  const region=selected.Region||data?.site?.region||'';
  const competitionType=selected['Competition Type']||data?.competitionType||data?.site?.competitionType||'';
  return rows.map(row=>{
    const values={};
    Object.keys(row).forEach(key=>{
      const label=normaliseStandingHeader(key);
      if(label) values[label]=row[key]??'';
    });
    return {
      Competition:competition, Year:year, Region:region, CompetitionType:competitionType,
      League:values.league||'', Group:values.group||'', Team:values.team||'', Logo:values.logo||'',
      Points:safeNumber(values.points), Played:safeNumber(values.played), Won:safeNumber(values.won),
      Drawn:safeNumber(values.drawn), Lost:safeNumber(values.lost), GoalsFor:safeNumber(values.goalsFor),
      GoalsAgainst:safeNumber(values.goalsAgainst), GoalDifference:safeNumber(values.goalDifference),
      AwayGoals:safeNumber(values.awayGoals), AwayWins:safeNumber(values.awayWins),
      DisciplinaryPoints:safeNumber(values.disciplinaryPoints), FairPlayPoints:safeNumber(values.fairPlayPoints),
      ClubCoefficient:safeNumber(values.clubCoefficient), AccessListRank:safeNumber(values.accessListRank)
    };
  }).filter(row=>String(row.Team).trim());
}
function normaliseStandingHeader(value){
  const key=String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  return ({
    league:'league', group:'group', team:'team', teams:'team', logo:'logo', logourl:'logo',
    pt:'points', pts:'points', points:'points',
    gw:'played', p:'played', played:'played', matches:'played',
    w:'won', won:'won', wins:'won',
    d:'drawn', drawn:'drawn', draws:'drawn',
    l:'lost', lost:'lost', losses:'lost',
    gf:'goalsFor', goalsfor:'goalsFor', goals:'goalsFor',
    ga:'goalsAgainst', goalsagainst:'goalsAgainst',
    gd:'goalDifference', goaldifference:'goalDifference', goaldiff:'goalDifference',
    ag:'awayGoals', awaygoals:'awayGoals',
    aw:'awayWins', awaywins:'awayWins',
    dp:'disciplinaryPoints', disciplinarypoints:'disciplinaryPoints', discipline:'disciplinaryPoints', fairplay:'fairPlayPoints', fairplaypoints:'fairPlayPoints',
    coefficient:'clubCoefficient', clubcoefficient:'clubCoefficient', coeff:'clubCoefficient',
    accesslist:'accessListRank', accesslistrank:'accessListRank', nationleagueaccesslist:'accessListRank', nationsleagueaccesslist:'accessListRank'
  })[key]||'';
}
function formatStandingLeague(league){ const value=String(league||'').trim(); return !value ? '' : /^league\s/i.test(value) ? value : `League ${value}`; }
function formatStandingGroup(group){ const value=String(group||'').trim(); return !value ? '' : /^group\s/i.test(value) ? value : `Group ${value}`; }
function getStandingGroupKey(row){ const league=formatStandingLeague(row?.League); const group=formatStandingGroup(row?.Group); return [league,group].filter(Boolean).join(' · ') || 'Table'; }
function populateGroupDropdown(){ const select=$('groupFilter'); if(!select) return; const groups=[...new Set((appData.standings||[]).map(getStandingGroupKey).filter(Boolean))]; select.innerHTML=`<option value="">All groups/tables</option>${groups.map(g=>`<option value="${escapeAttr(g)}">${escapeHTML(g)}</option>`).join('')}`; if(currentGroup&&groups.includes(currentGroup)) select.value=currentGroup; }
function populateRoundDropdown(){ const select=$('roundFilter'); if(!select) return; const rounds=[...new Set(getCompetitionMatches().map(m=>String(m.Round||'').trim()).filter(Boolean))].sort((a,b)=>roundSortValue(a)-roundSortValue(b)); select.innerHTML=`<option value="">All rounds</option>${rounds.map(r=>`<option value="${escapeAttr(r)}">${escapeHTML(formatRoundLabel(r))}</option>`).join('')}`; if(currentRound&&rounds.includes(currentRound)) select.value=currentRound; else currentRound=''; }
function renderDateTabs(){
  const container = $('dateTabs');
  if(!container) return;

  const today = new Date();
  const thisWeekStart = getWeekStart(today);
  const lastWeekStart = addDays(thisWeekStart,-7);
  const nextWeekStart = addDays(thisWeekStart,7);

  const selected = parseDateOnly(selectedDateKey) || today;
  const selectedWeekStart = getWeekStart(selected);

  const weeks = [
    {key:dateToKey(lastWeekStart),label:'Last week',start:lastWeekStart},
    {key:dateToKey(thisWeekStart),label:'This week',start:thisWeekStart},
    {key:dateToKey(nextWeekStart),label:'Next week',start:nextWeekStart}
  ];

  const buttons = weeks.map(item=>{
    const isActive = dateToKey(selectedWeekStart)===dateToKey(item.start);
    return `
    <button type="button" class="${isActive?'active':''}" onclick="selectDateTab('${escapeAttr(item.key)}')">
      <span>${escapeHTML(item.label)}</span>
      <strong>${escapeHTML(getWeekRangeLabel(item.start))}</strong>
    </button>
  `;
  }).join('');

  const isCustomWeek = !weeks.some(item=>dateToKey(item.start)===dateToKey(selectedWeekStart));
  const picked = selectedDateKey || getTodayKey();

  container.innerHTML = `
    ${buttons}
    <div class="date-picker-button ${isCustomWeek?'active':''}" id="datePickerButton">
      <span>📅</span>
      <span>Pick a week</span>
      <input id="homeDatePicker" type="date" value="${escapeAttr(picked)}">
    </div>
  `;

  const pickerButton = $('datePickerButton');
  const input = $('homeDatePicker');

  if(input){
    input.addEventListener('change', e => {
      pickHomeDate(e.target.value);
    });
  }

  if(pickerButton && input){
    pickerButton.addEventListener('click', () => {
      if(typeof input.showPicker === 'function'){
        input.showPicker();
      } else {
        input.click();
      }
    });
  }
}

function selectDateTab(key){
  if(!key) return;

  selectedDateKey = key;
  currentHomeTab = 'allGames';

  renderDateTabs();
  renderHomeGames();
  renderMyGames();
  renderHomeTab();
}
window.selectDateTab = selectDateTab;

function pickHomeDate(value){
  if(!value) return;

  selectedDateKey = value;
  currentHomeTab = 'allGames';

  renderDateTabs();
  renderHomeGames();
  renderMyGames();
  renderHomeTab();
}
window.pickHomeDate = pickHomeDate;

function renderMatchRowFlat(match){
  const p = formatScoreboardDateParts(match.Date,match.Time);
  const score = match.Status==='FT' ? renderScoreText(match) : 'vs';
  const click = match.MatchID ? `onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"` : '';
  const league = match.CompetitionLabel || match.Competition || 'Competition';
  const statusText = match.Status || 'Scheduled';
  const statusClass = statusText.trim().toUpperCase()==='FT' ? 'status-ft' : 'status-scheduled';
  return `<article class="my-games-match" ${click}><div class="my-games-date"><span>${escapeHTML(p.date)} - ${escapeHTML(p.time)}</span><span>${escapeHTML(league)}</span></div><div class="my-games-team-name home">${escapeHTML(match.HomeTeam)}</div><div class="my-games-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="my-games-score">${score}</div><div class="my-games-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="my-games-team-name away">${escapeHTML(match.AwayTeam)}</div><div class="my-games-status ${statusClass}">${escapeHTML(statusText)}</div></article>`;
}
function renderHomeGames(){
  const selected = parseDateOnly(selectedDateKey) || new Date();
  const weekStart = getWeekStart(selected);
  const weekEnd = addDays(weekStart,6);

  const matches = getGlobalMatches().filter(m=>{
    const d = parseDateOnly(m.Date);
    if(!d) return false;
    const cd = new Date(d.getFullYear(),d.getMonth(),d.getDate());
    return cd >= weekStart && cd <= weekEnd;
  }).sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b) || compareCompetitionPriority(a,b));

  setText('homeMatchCount', matches.length);
  setText('homeAllGamesTitle', `All games (${matches.length})`);

  if(!matches.length){
    setHTML('homeGamesList','<div class="empty home-empty">No games scheduled this week.</div>');
    return;
  }

  const dayGroups = groupBy(matches, m=>getDateKey(m.Date));
  const html = Object.keys(dayGroups).sort((a,b)=>a.localeCompare(b)).map(dayKey=>{
    const dayMatches = dayGroups[dayKey].sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b) || compareCompetitionPriority(a,b));
    const dayDate = parseDateOnly(dayKey);
    const dayLabel = dayDate ? `${weekdayNameFromDate(dayDate)} ${formatShortDateFromDate(dayDate).replace(/\.$/,'')}` : dayKey;
    return `<section class="home-time-block"><div class="home-time-heading">${escapeHTML(dayLabel)}</div>${dayMatches.map(renderMatchRowFlat).join('')}</section>`;
  }).join('');

  setHTML('homeGamesList', html);
}
function renderHomeTab(){ const allPanel=$('allGamesPanel'), myPanel=$('myGamesPanel'), jump=$('jumpSelect'); document.querySelectorAll('[data-home-tab]').forEach(b=>b.classList.toggle('active',b.dataset.homeTab===currentHomeTab)); allPanel?.classList.toggle('hidden',currentHomeTab!=='allGames'); myPanel?.classList.toggle('hidden',currentHomeTab!=='myGames'); if(jump&&isHomePage()) jump.value=currentHomeTab==='myGames'?'myGames':'nextUp'; }
const PERSONAL_DAY_PRIORITY = ['Friday','Monday','Sunday','Thursday','Tuesday','Wednesday','Saturday'];
const PERSONAL_DAY_PRIORITY = ['Friday','Monday','Sunday','Thursday','Tuesday','Wednesday','Saturday'];
const MONDAY_TO_SUNDAY_DISPLAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const WEEKDAY_NAMES_BY_JS_INDEX = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function weekdayNameFromDate(d){
  return WEEKDAY_NAMES_BY_JS_INDEX[d.getDay()];
}

const WEEKDAY_OFFSET_FROM_WEEK_START = {
  Monday:0,
  Tuesday:1,
  Wednesday:2,
  Thursday:3,
  Friday:4,
  Saturday:5,
  Sunday:6
};

/*
  MY GAMES ONLY

  Global Games is completely untouched.

  My Games always contains ONLY matches whose real fixture date falls
  inside the selected Monday-Sunday week.

  There is NO carry-over logic.
  There are NO overdue matches moved from previous weeks.

  My Games competition priority:

  1. UEFA Champions League
  2. UEFA Europa League
  3. UEFA Conference League
  4. Domestic Cups
       France
       Germany
       Spain
       Italy
       England
  5. Domestic Leagues
       France
       Germany
       Spain
       Italy
       England

  The existing personal weekday-distribution system is preserved.
*/

function computeDayQuotas(total, dayNames){
  const dayCount = dayNames.length;

  if(!dayCount){
    return {};
  }

  const base = Math.floor(total / dayCount);
  const remainder = total % dayCount;

  const priorityOrder =
    PERSONAL_DAY_PRIORITY.filter(
      name => dayNames.includes(name)
    );

  const remainderDays =
    new Set(
      priorityOrder.slice(0, remainder)
    );

  const quota = {};

  dayNames.forEach(name => {
    quota[name] =
      base +
      (remainderDays.has(name) ? 1 : 0);
  });

  return quota;
}


function fillDaysInCalendarOrder(sortedMatches, dayNames, quota){

  const assignment = new Map();

  let idx = 0;

  dayNames.forEach(name => {

    for(
      let n = 0;
      n < quota[name] &&
      idx < sortedMatches.length;
      n++, idx++
    ){
      assignment.set(
        sortedMatches[idx],
        name
      );
    }

  });

  while(idx < sortedMatches.length){

    assignment.set(
      sortedMatches[idx],
      dayNames[dayNames.length - 1]
    );

    idx++;

  }

  return assignment;
}


function buildMyGamesDayAssignment(
  weekMatches,
  weekStart,
  isCurrentWeek
){

  const sortedAll =
    [...weekMatches].sort(
      compareMyGamesMatches
    );

  const baselineQuota =
    computeDayQuotas(
      sortedAll.length,
      MONDAY_TO_SUNDAY_DISPLAY_ORDER
    );

  const baseline =
    fillDaysInCalendarOrder(
      sortedAll,
      MONDAY_TO_SUNDAY_DISPLAY_ORDER,
      baselineQuota
    );


  if(!isCurrentWeek){
    return baseline;
  }


  const today = new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );


  const eligibleDays =
    MONDAY_TO_SUNDAY_DISPLAY_ORDER.filter(
      name => {

        const d =
          addDays(
            weekStart,
            WEEKDAY_OFFSET_FROM_WEEK_START[name]
          );

        return (
          d.getTime() >=
          today.getTime()
        );

      }
    );


  const finalEligibleDays =
    eligibleDays.length
      ? eligibleDays
      : MONDAY_TO_SUNDAY_DISPLAY_ORDER.slice();


  let splitIndex =
    sortedAll.findIndex(
      match =>
        match.Status !== 'FT'
    );


  if(splitIndex === -1){
    splitIndex =
      sortedAll.length;
  }


  const confirmed =
    sortedAll.slice(
      0,
      splitIndex
    );


  const pool =
    sortedAll.slice(
      splitIndex
    );


  const assignment =
    new Map();


  confirmed.forEach(match => {

    assignment.set(
      match,
      baseline.get(match)
    );

  });


  if(pool.length){

    const poolQuota =
      computeDayQuotas(
        pool.length,
        finalEligibleDays
      );


    const poolAssignment =
      fillDaysInCalendarOrder(
        pool,
        finalEligibleDays,
        poolQuota
      );


    poolAssignment.forEach(
      (name, match) => {

        assignment.set(
          match,
          name
        );

      }
    );

  }


  return assignment;
}


function renderMyGames(){

  const all =
    Array.isArray(appData?.myGames)
      ? appData.myGames
      : [];


  const selected =
    parseDateOnly(selectedDateKey) ||
    new Date();


  /*
    STRICT REAL WEEK:

    Monday -> Sunday.

    This now matches exactly what the visible
    week selector says.

    Example:

    31/08 - 06/09

    means ONLY fixtures dated:

    31/08
    01/09
    02/09
    03/09
    04/09
    05/09
    06/09
  */

  const weekStart =
    getWeekStart(selected);


  const matchWindowStart =
    weekStart;


  const matchWindowEnd =
    addDays(
      weekStart,
      6
    );


  /*
    My Games now uses the normal calendar
    week for current/past-week detection.

    This does NOT affect Global Games.
  */

  const currentWeekStart =
    getWeekStart(
      new Date()
    );


  const isCurrentWeek =
    dateToKey(weekStart) ===
    dateToKey(currentWeekStart);


  const isPastWeek =
    weekStart.getTime() <
    currentWeekStart.getTime();


  /*
    IMPORTANT:

    Only games whose ACTUAL fixture date
    belongs to the selected week are included.

    Nothing is carried forward from an
    earlier week.
  */

  let weekMatches =
    all.filter(match => {

      const d =
        parseDateOnly(
          match.Date
        );


      if(!d){
        return false;
      }


      const cd =
        new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate()
        );


      return (
        cd >= matchWindowStart &&
        cd <= matchWindowEnd
      );

    });


  /*
    Past weeks still display their matches.

    We deliberately DO NOT remove scheduled
    matches and DO NOT move them elsewhere.

    The selected week's real fixture list
    remains historically accurate.
  */


  setText(
    'myGamesTitle',
    getSeasonWeekLabel(selected)
  );


  setText(
    'myGamesSubtitle',
    getWeekRangeLabel(selected)
  );


  const myGamesPlayedCount =
    weekMatches.filter(
      isPlayedMatch
    ).length;


  const myGamesScheduledCount =
    weekMatches.length -
    myGamesPlayedCount;


  setText(
    'myGamesTotalValue',
    weekMatches.length
  );


  setText(
    'myGamesPlayedValue',
    myGamesPlayedCount
  );


  setText(
    'myGamesScheduledValue',
    myGamesScheduledCount
  );


  if(!weekMatches.length){

    setHTML(
      'myGamesList',
      '<div class="empty home-empty">No My Games found for this week.</div>'
    );

    return;

  }


  const dayAssignment =
    buildMyGamesDayAssignment(
      weekMatches,
      weekStart,
      isCurrentWeek
    );


  const dayGroups =
    new Map();


  MONDAY_TO_SUNDAY_DISPLAY_ORDER.forEach(
    name =>
      dayGroups.set(
        name,
        []
      )
  );


  weekMatches.forEach(match => {

    const dayName =
      dayAssignment.get(match) ||
      'Monday';


    dayGroups
      .get(dayName)
      .push(match);

  });


  const html =
    MONDAY_TO_SUNDAY_DISPLAY_ORDER
      .map(dayName => {

        const dayDate =
          addDays(
            weekStart,
            WEEKDAY_OFFSET_FROM_WEEK_START[
              dayName
            ]
          );


        const label =
          `${dayName} ${
            formatShortDateFromDate(
              dayDate
            ).replace(/\.$/, '')
          }`;


        const dayMatches =
          dayGroups
            .get(dayName)
            .sort(
              compareMyGamesMatches
            );


        const body =
          dayMatches.length
            ? dayMatches
                .map(
                  renderMatchRowFlat
                )
                .join('')
            : '<div class="empty home-empty">No games.</div>';


        return `
          <section class="home-time-block">
            <div class="home-time-heading">
              ${escapeHTML(label)}
            </div>
            ${body}
          </section>
        `;

      })
      .join('');


  setHTML(
    'myGamesList',
    html
  );

}


/*
  =========================================================
  MY GAMES COMPETITION ORDERING

  THIS DOES NOT CONTROL GLOBAL GAMES.
  =========================================================
*/


const MY_GAMES_COUNTRY_ORDER = [
  'france',
  'germany',
  'spain',
  'italy',
  'england'
];


const MY_GAMES_LEAGUE_NAME_KEYWORDS = [
  'premier league',
  'serie a',
  'la liga',
  'bundesliga',
  'ligue 1',
  'championship'
];


const MY_GAMES_CUP_NAME_KEYWORDS = [
  'fa cup',
  'carabao cup',
  'community shield',

  'coppa italia',
  'supercoppa',

  'copa del rey',
  'supercopa',

  'dfb-pokal',
  'dfb pokal',
  'dfl-supercup',
  'dfl supercup',

  'coupe de france',
  'trophee des champions',
  'trophée des champions'
];


function getMyGamesCompetitionName(match){

  return String(
    match?.Competition ||
    match?.CompetitionLabel ||
    match?.['Competition Name'] ||
    ''
  )
    .toLowerCase()
    .trim();

}


function getMyGamesEuropeanPriority(match){

  const name =
    getMyGamesCompetitionName(
      match
    );


  /*
    Must check Conference and Europa separately.

    Champions League = absolute priority 1.
  */

  if(
    name.includes(
      'champions league'
    )
  ){
    return 0;
  }


  if(
    name.includes(
      'europa league'
    )
  ){
    return 1;
  }


  if(
    name.includes(
      'conference league'
    )
  ){
    return 2;
  }


  return 999;

}


function isMyGamesDomesticLeague(match){

  const name =
    getMyGamesCompetitionName(
      match
    );


  return (
    MY_GAMES_LEAGUE_NAME_KEYWORDS
      .some(
        keyword =>
          name.includes(
            keyword
          )
      )
  );

}


function isCupCompetition(match){

  const name =
    getMyGamesCompetitionName(
      match
    );


  /*
    European UEFA competitions are handled
    separately and must NEVER accidentally
    enter the Domestic Cup category.
  */

  if(
    name.includes(
      'champions league'
    ) ||
    name.includes(
      'europa league'
    ) ||
    name.includes(
      'conference league'
    )
  ){
    return false;
  }


  if(
    isMyGamesDomesticLeague(
      match
    )
  ){
    return false;
  }


  return (
    MY_GAMES_CUP_NAME_KEYWORDS
      .some(
        keyword =>
          name.includes(
            keyword
          )
      )
  );

}


function getMyGamesGroupLabel(match){

  return ({
    england:'England',
    italy:'Italy',
    spain:'Spain',
    germany:'Germany',
    france:'France',
    europe:'Europe',
    world:'World',
    'national-teams':'National Teams'
  }[
    getCompetitionCategoryKey(
      match
    )
  ] || 'World');

}


/*
  Final My Games hierarchy:

  0 Champions League
  1 Europa League
  2 Conference League

  10 Domestic Cup France
  11 Domestic Cup Germany
  12 Domestic Cup Spain
  13 Domestic Cup Italy
  14 Domestic Cup England

  20 Domestic League France
  21 Domestic League Germany
  22 Domestic League Spain
  23 Domestic League Italy
  24 Domestic League England

  Everything else comes afterwards.
*/


function getMyGamesCompetitionRank(match){

  /*
    UEFA competitions first.
  */

  const europeanPriority =
    getMyGamesEuropeanPriority(
      match
    );


  if(
    europeanPriority !== 999
  ){
    return europeanPriority;
  }


  const country =
    getCompetitionCategoryKey(
      match
    );


  const countryIndex =
    MY_GAMES_COUNTRY_ORDER
      .indexOf(
        country
      );


  /*
    Only the five requested domestic
    countries participate in the domestic
    Cup / League hierarchy.
  */

  if(countryIndex !== -1){

    if(
      isCupCompetition(
        match
      )
    ){
      return (
        10 +
        countryIndex
      );
    }


    if(
      isMyGamesDomesticLeague(
        match
      )
    ){
      return (
        20 +
        countryIndex
      );
    }

  }


  /*
    Other competitions are intentionally
    placed after the requested hierarchy.
  */

  return 999;

}


function compareMyGamesMatches(a,b){

  const aRank =
    getMyGamesCompetitionRank(
      a
    );


  const bRank =
    getMyGamesCompetitionRank(
      b
    );


  if(
    aRank !==
    bRank
  ){
    return (
      aRank -
      bRank
    );
  }


  /*
    Same competition priority:
    preserve real chronological order.
  */

  const dateDifference =
    matchDateSortValue(a) -
    matchDateSortValue(b);


  if(dateDifference !== 0){
    return dateDifference;
  }


  return String(
    a.HomeTeam ||
    ''
  ).localeCompare(
    String(
      b.HomeTeam ||
      ''
    )
  );

}
function getRankClass(index,size,isGroup,teamRow,groupName){

  const pos = index + 1;
  const competitionKey = getStandingsRuleKey();
  const league = getLeagueKeyForStandings();

  const competitionName = slugify(normaliseCompetitionName(
    appData?.selectedCompetition?.['Competition Name'] ||
    appData?.site?.competition ||
    currentCompetition ||
    ''
  ));

  // Champions League league phase
  if(competitionKey === 'champions-league' || competitionName.includes('champions-league')){
    if(pos <= 8) return 'rank-qualified';
    if(pos <= 24) return 'rank-uel';
    return 'rank-eliminated';
  }

  // Europa League and Conference League old 8-group format
  if(
    competitionKey === 'europa-league-old-groups' ||
    competitionKey === 'conference-league-old-groups'
  ){
    if(pos <= 2) return 'rank-qualified';
    return 'rank-eliminated';
  }

  // Nations League
  if(competitionKey === 'nations-league' || competitionName.includes('nations-league')){

    const leagueLabel = getNationsLeagueLevel(teamRow, groupName);

    // League A = top 2 green, 3rd red
    if(leagueLabel === 'A'){
      if(pos <= 2) return 'rank-qualified';
      if(pos === 3) return 'rank-eliminated';
      return 'rank-neutral';
    }

    // League B = 1st green, 3rd red
    if(leagueLabel === 'B'){
      if(pos === 1) return 'rank-qualified';
      if(pos === 3) return 'rank-eliminated';
      return 'rank-neutral';
    }

    // League C = 1st green, no 3rd red
    if(leagueLabel === 'C'){
      if(pos === 1) return 'rank-qualified';
      return 'rank-neutral';
    }

    return 'rank-neutral';
  }

  // Generic group stage
  if(isGroup){
    if(size <= 2) return 'rank-neutral';
    return pos <= 2 ? 'rank-qualified' : 'rank-eliminated';
  }

  // Domestic leagues
  if(['premier-league','serie-a','la-liga'].includes(league)){
    if(pos <= 4) return 'rank-ucl';
    if(pos <= 6) return 'rank-uel';
    if(pos <= 8) return 'rank-uecl';
    if(pos >= 18) return 'rank-relegation';
  }

  if(league === 'bundesliga'){
    if(pos <= 4) return 'rank-ucl';
    if(pos <= 6) return 'rank-uel';
    if(pos <= 8) return 'rank-uecl';
    if(pos === 16) return 'rank-playout';
    if(pos >= 17) return 'rank-relegation';
  }

  if(league === 'ligue-1'){

    const seasonYear = String(
      appData?.selectedCompetition?.Year ||
      appData?.site?.year ||
      ''
    ).trim();

    const teamName = normaliseTeamName(teamRow?.Team || '');

    // ONE-OFF OVERRIDE: Ligue 1 2026
    if(seasonYear === '2026'){

      // 1st to 3rd = Champions League
      if(pos <= 3) return 'rank-ucl';

      // Toulouse = Europa League = orange
      if(teamName === normaliseTeamName('Toulouse')){
        return 'rank-uel';
      }

      // AS Monaco + Lyon = Conference League = green
      if(
        teamName === normaliseTeamName('AS Monaco') ||
        teamName === normaliseTeamName('Lyon')
      ){
        return 'rank-uecl';
      }

      // Nice = no colour
      if(teamName === normaliseTeamName('Nice')){
        return 'rank-neutral';
      }

      // 4th = Europa League normally
      if(pos === 4) return 'rank-uel';

      if(pos === 16) return 'rank-playout';
      if(pos >= 17) return 'rank-relegation';

      return 'rank-neutral';
    }

    // Normal Ligue 1 seasons
    if(pos <= 3) return 'rank-ucl';
    if(pos <= 5) return 'rank-uel';
    if(pos <= 7) return 'rank-uecl';
    if(pos === 16) return 'rank-playout';
    if(pos >= 17) return 'rank-relegation';
  }

  return 'rank-neutral';
}
function getNationsLeagueLevel(teamRow, groupName){

  const values = [
    teamRow?.League,
    teamRow?.Group,
    groupName
  ].map(value => String(value || '').trim());

  const text = values.join(' ').toLowerCase();

  if(/\bleague\s*a\b/.test(text)) return 'A';
  if(/\bleague\s*b\b/.test(text)) return 'B';
  if(/\bleague\s*c\b/.test(text)) return 'C';

  return '';
}
function getLeagueKeyForStandings(){ const selected=appData?.selectedCompetition||{}, site=appData?.site||{}; const slug=slugify(normaliseCompetitionName(selected['Competition Name']||selected.competition||site.competition||currentCompetition||'')); if(slug.includes('premier-league'))return'premier-league'; if(slug.includes('serie-a'))return'serie-a'; if(slug.includes('la-liga')||slug.includes('laliga'))return'la-liga'; if(slug.includes('bundesliga'))return'bundesliga'; if(slug.includes('ligue-1'))return'ligue-1'; return''; }
function renderLeagueLegend(){

  const league = getLeagueKeyForStandings();

  if(!['premier-league','serie-a','la-liga','bundesliga','ligue-1'].includes(league)){
    return '';
  }

  const seasonYear = String(
    appData?.selectedCompetition?.Year ||
    appData?.site?.year ||
    ''
  ).trim();

  if(league === 'ligue-1' && seasonYear === '2026'){
    return `<div class="qualification-note">
      <span class="note-dot ucl"></span> Champions League
      <span class="note-dot uel"></span> Europa League
      <span class="note-dot uecl"></span> Conference League
      <span class="note-dot playout"></span> Play-out relegation
      <span class="note-dot relegation"></span> Relegation
    </div>`;
  }

  const items = [
    ['ucl','Champions League'],
    ['uel','Europa League'],
    ['uecl','Conference League']
  ];

  if(['bundesliga','ligue-1'].includes(league)){
    items.push(['playout','Play-out relegation']);
  }

  items.push(['relegation','Relegation']);

  return `<div class="qualification-note">${items.map(i =>
    `<span class="note-dot ${i[0]}"></span>${escapeHTML(i[1])}`
  ).join('')}</div>`;
}
function getCompetitionLegend(isGroupStage){

  const competitionKey = getStandingsRuleKey();
  const competitionName = slugify(normaliseCompetitionName(
    appData?.selectedCompetition?.['Competition Name'] ||
    appData?.site?.competition ||
    currentCompetition ||
    ''
  ));

  if(competitionKey === 'champions-league' || competitionName.includes('champions-league')){
    return '<div class="qualification-note"><span class="note-dot qualified"></span> 1–8 Round of 16 <span class="note-dot uel"></span> 9–24 Play-off <span class="note-dot eliminated"></span> 25–36 eliminated</div>';
  }

  if(
    competitionKey === 'europa-league-old-groups' ||
    competitionKey === 'conference-league-old-groups'
  ){
    return '<div class="qualification-note"><span class="note-dot qualified"></span> Top 2 qualify <span class="note-dot eliminated"></span> Bottom 2 eliminated</div>';
  }

  if(competitionKey === 'nations-league' || competitionName.includes('nations-league')){
    return '<div class="qualification-note"><span class="note-dot qualified"></span> Green = qualification / promotion <span class="note-dot eliminated"></span> Red = relegation / eliminated</div>';
  }

  if(isGroupStage){
    return '<div class="qualification-note"><span class="note-dot qualified"></span> Top 2 qualify <span class="note-dot eliminated"></span> Bottom 2 eliminated</div>';
  }

  return renderLeagueLegend();
}
function getCurrentCompetitionType(){
  const selected=appData?.selectedCompetition||{};
  const site=appData?.site||{};
  return String(selected['Competition Type'] || selected.CompetitionType || appData?.competitionType || site.competitionType || '').toLowerCase();
}

function isGroupStageCompetition(){
  const type = getCurrentCompetitionType();
  return type.includes('group') && !type.includes('league phase');
}

function isLeaguePhaseCompetition(){
  const type = getCurrentCompetitionType();
  const name = slugify(normaliseCompetitionName(appData?.selectedCompetition?.['Competition Name'] || appData?.site?.competition || currentCompetition || ''));
  return type.includes('league phase') || name.includes('champions-league');
}
function getRegionForCompetition(m){ return String(m.Region||'World').toUpperCase(); }
function getDateKey(v){ const d=parseDateOnly(v); return d?dateToKey(d):''; }
function parseDateOnly(v){ if(v instanceof Date) return new Date(v.getFullYear(),v.getMonth(),v.getDate()); const t=String(v||'').trim(); if(!t)return null; if(/^\d{4}-\d{2}-\d{2}$/.test(t)){ const p=t.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); } if(/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(t)){ const p=t.split(/[./-]/); return new Date(+p[2],+p[1]-1,+p[0]); } const fallback=new Date(t); if(!isNaN(fallback)) return new Date(fallback.getFullYear(),fallback.getMonth(),fallback.getDate()); return null; }
function matchDateSortValue(m){ const d=parseDateOnly(m.Date); if(!d)return 0; const p=String(m.Time||'00:00').trim().split(':'); d.setHours(+p[0]||0,+p[1]||0,0,0); return d.getTime(); }
function formatScoreboardDateParts(date,time){ const d=parseDateOnly(date); return {date:d?formatShortDateFromDate(d).replace(/\.$/,''):String(date||'').trim(), time:String(time||'').trim()}; }
function formatFullDateTime(date,time){ const d=parseDateOnly(date); return [d?d.toLocaleDateString('en-GB'):String(date||'').trim(),String(time||'').trim()].filter(Boolean).join(' '); }
function dateToKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function getTodayKey(){ return dateToKey(new Date()); }
function addDays(date,days){ const d=new Date(date); d.setDate(d.getDate()+days); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
function getWeekStart(date){ const d=new Date(date.getFullYear(),date.getMonth(),date.getDate()); const day=d.getDay(); d.setDate(d.getDate()+(day===0?-6:1-day)); return d; }
function getWeekRangeLabel(date){ const start=getWeekStart(date), end=addDays(start,6); return `${formatMyGamesDate(start)} - ${formatMyGamesDate(end)}`; }
function getSeasonWeekLabel(date){ const selected=new Date(date.getFullYear(),date.getMonth(),date.getDate()); let y=selected.getMonth()>=7?selected.getFullYear():selected.getFullYear()-1; let first=getFirstWeekStartOfAugust(y); if(selected<first){ y--; first=getFirstWeekStartOfAugust(y); } return `Week ${Math.max(1,Math.floor((selected-first)/604800000)+1)}`; }
function getFirstWeekStartOfAugust(y){ const d=new Date(y,7,1); const day=d.getDay(); d.setDate(d.getDate()+(day===1?0:(8-day)%7)); return d; }
function formatShortDateFromDate(d){ return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.`; }
function formatMyGamesDate(d){ return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function normaliseKickoffTime(v){ return String(v||'').trim()||'Scheduled'; }
function timeSortValue(v){ const m=String(v||'').trim().match(/^(\d{1,2}):(\d{2})$/); return m?(+m[1]*60)+(+m[2]):99999; }
function renderScoreText(m){ const hp=String(m.HomePens||'').trim(), ap=String(m.AwayPens||'').trim(), home=safeScore(m.HomeScore), away=safeScore(m.AwayScore); return hp&&ap?`(${escapeHTML(hp)}) ${escapeHTML(home)} - ${escapeHTML(away)} (${escapeHTML(ap)})`:`${escapeHTML(home)} - ${escapeHTML(away)}`; }
function getPenaltyWinnerText(m){ const hp=Number(m.HomePens), ap=Number(m.AwayPens); if(!Number.isFinite(hp)||!Number.isFinite(ap))return''; if(hp>ap)return`${m.HomeTeam} win ${hp}-${ap} on penalties`; if(ap>hp)return`${m.AwayTeam} win ${ap}-${hp} on penalties`; return''; }
function isGoalEvent(e){ return String(e.Event||'').toLowerCase().trim()==='goal'; }
function sameTeam(a,b){ return normaliseTeamName(a)===normaliseTeamName(b); }
function getHalfNumber(v){ const t=String(v||'').toLowerCase().trim(); if(t==='1'||t.includes('1st')||t.includes('first'))return 1; if(t==='2'||t.includes('2nd')||t.includes('second'))return 2; return 0; }
function makeCompetitionSlug(comp){ return slugify(`${comp['Competition Name']||comp.competition||''} ${comp.Year||comp.year||''}`.trim()); }
function slugify(v){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function normaliseText(v){ return String(v||'').toLowerCase().trim().replace(/\s+/g,' '); }
function normaliseTeamName(v){ return String(v||'').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\([a-z]{2,4}\)/gi,'').replace(/[^a-z0-9\s]/gi,'').replace(/\s+/g,' ').trim(); }
function normaliseCompetitionName(v){ return normaliseText(v); }
function normaliseRegion(v){ return String(v||'').toLowerCase().trim().replace(/_/g,' ').replace(/\s+/g,' '); }
function compareSeasonsDesc(a,b){ const ay=extractSeasonStartYear(a), by=extractSeasonStartYear(b); return by!==ay?by-ay:String(b||'').localeCompare(String(a||'')); }
function extractSeasonStartYear(v){ const m=String(v||'').match(/\d{4}/); return m?Number(m[0]):0; }
function roundSortValue(v){ const t=String(v||'').toLowerCase().trim(); if(/^\d+$/.test(t))return Number(t); if(t.includes('final')&&!t.includes('semi')&&!t.includes('quarter'))return 100; if(t.includes('semi'))return 90; if(t.includes('quarter'))return 80; if(t.includes('16'))return 70; if(t.includes('32'))return 60; return 0; }
function formatRoundLabel(v){ const t=String(v||'').trim(); if(!t)return'MATCHES'; if(/^\d+$/.test(t))return`ROUND ${t}`; return t.toUpperCase(); }
function groupBy(items,fn){ return items.reduce((acc,item)=>{ const key=fn(item); (acc[key] ||= []).push(item); return acc; },{}); }
function setText(id,value){ const el=$(id); if(el) el.textContent=value; }
function setHTML(id,value){ const el=$(id); if(el) el.innerHTML=value; }
function showError(message){ setText('competitionTitle','Error'); setText('competitionSubtitle',message); setHTML('homeGamesList',`<div class="empty">${escapeHTML(message)}</div>`); setHTML('scoreboardList',`<div class="empty">${escapeHTML(message)}</div>`); }
function safeNumber(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
function safeScore(v){ return v===''||v===undefined||v===null?'-':v; }
function formatGoalDifference(v){ const n=Number(v); if(!Number.isFinite(n))return'0'; return n>0?`+${n}`:String(n); }
function escapeHTML(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function escapeAttr(v){ return escapeHTML(v); }
window.CALCIUM_SCRIPT_VERSION='7089-standings-logo-sheet-fix';
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then(() => {
        console.log("Calcium Sport PWA ready");
      })
      .catch(error => {
        console.error("Service Worker registration failed:", error);
      });
  });
}
