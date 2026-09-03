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
const MONDAY_TO_SUNDAY_DISPLAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const WEEKDAY_NAMES_BY_JS_INDEX = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function weekdayNameFromDate(d){ return WEEKDAY_NAMES_BY_JS_INDEX[d.getDay()]; }
const WEEKDAY_OFFSET_FROM_WEEK_START = { Monday:0, Tuesday:1, Wednesday:2, Thursday:3, Friday:4, Saturday:5, Sunday:6 };

/*
  My Games dividers are always the 7 real calendar days of the selected
  week, Monday through Sunday, in that fixed order - every one shown,
  even if a day ends up with no games.

  Every match in the week gets slotted into one of those 7 days: sort
  all of them by real kickoff time, size each day's quota using the
  Friday/Monday/Sunday/Thursday/Tuesday/Wednesday/Saturday preference
  (whoever's highest in that order gets any leftover games first), then
  fill the days STRICTLY in calendar order (Monday's chunk is always the
  earliest kickoffs, Sunday's the latest). Filling in calendar order -
  rather than preference order - is what guarantees a later day can
  never end up holding earlier games than an earlier day.

  "Played" is simply: does the match have a score / is Status FT. That's
  it - no separate tracking of when a result was entered.

  For the current week only: find the first still-unplayed match in
  real chronological order. Everything before it is confirmed played
  and keeps its day. Everything from that point on - including any
  later match that's already played - is re-split evenly across today
  and the remaining days of the week, still in calendar order. Since
  this is recomputed fresh from today's real date on every page load,
  a game still sitting unplayed once its day has passed simply falls
  into that pool and rolls onto whichever day it lands on next - no
  scheduled trigger needed.
*/
function computeDayQuotas(total, dayNames){
  const dayCount = dayNames.length;
  if(!dayCount) return {};
  const base = Math.floor(total/dayCount);
  const remainder = total % dayCount;
  const priorityOrder = PERSONAL_DAY_PRIORITY.filter(name=>dayNames.includes(name));
  const remainderDays = new Set(priorityOrder.slice(0, remainder));
  const quota = {};
  dayNames.forEach(name=>{ quota[name] = base + (remainderDays.has(name)?1:0); });
  return quota;
}

function fillDaysInCalendarOrder(sortedMatches, dayNames, quota){
  const assignment = new Map();
  let idx = 0;
  dayNames.forEach(name=>{
    for(let n=0; n<quota[name] && idx<sortedMatches.length; n++, idx++){
      assignment.set(sortedMatches[idx], name);
    }
  });
  while(idx < sortedMatches.length){
    assignment.set(sortedMatches[idx], dayNames[dayNames.length-1]);
    idx++;
  }
  return assignment;
}

function buildMyGamesDayAssignment(weekMatches, weekStart, isCurrentWeek){

  const sortedAll = [...weekMatches].sort(compareMyGamesMatches);

  const baselineQuota = computeDayQuotas(sortedAll.length, MONDAY_TO_SUNDAY_DISPLAY_ORDER);
  const baseline = fillDaysInCalendarOrder(sortedAll, MONDAY_TO_SUNDAY_DISPLAY_ORDER, baselineQuota);

  if(!isCurrentWeek){
    return baseline;
  }

  const today = new Date();
  today.setHours(0,0,0,0);

  const eligibleDays = MONDAY_TO_SUNDAY_DISPLAY_ORDER.filter(name=>{
    const d = addDays(weekStart, WEEKDAY_OFFSET_FROM_WEEK_START[name]);
    return d.getTime() >= today.getTime();
  });
  const finalEligibleDays = eligibleDays.length ? eligibleDays : MONDAY_TO_SUNDAY_DISPLAY_ORDER.slice();

  let splitIndex = sortedAll.findIndex(m=>m.Status!=='FT');
  if(splitIndex===-1) splitIndex = sortedAll.length;

  const confirmed = sortedAll.slice(0, splitIndex);
  const pool = sortedAll.slice(splitIndex);

  const assignment = new Map();
  confirmed.forEach(m=>assignment.set(m, baseline.get(m)));

  if(pool.length){
    const poolQuota = computeDayQuotas(pool.length, finalEligibleDays);
    const poolAssignment = fillDaysInCalendarOrder(pool, finalEligibleDays, poolQuota);
    poolAssignment.forEach((name,m)=>assignment.set(m,name));
  }

  return assignment;

}

function getMyGamesWeekStart(date){
  // Same Monday-start week as getWeekStart, EXCEPT: a Monday itself is
  // treated as belonging to the PREVIOUS week's block, since a Monday
  // night fixture is the tail end of the previous weekend's gameweek,
  // not the start of a new one. Only used for My Games grouping - the
  // shared date-tab labels and Global Games still use plain
  // getWeekStart/getWeekRangeLabel, untouched.
  const normalStart = getWeekStart(date);
  return date.getDay()===1 ? addDays(normalStart,-7) : normalStart;
}

function renderMyGames(){
  const all=Array.isArray(appData?.myGames)?appData.myGames:[];
  const selected=parseDateOnly(selectedDateKey)||new Date();
  const weekStart=getWeekStart(selected);
  // The My Games match window runs one day later than the visible label
  // (Tuesday through the FOLLOWING Monday) so a Monday night fixture is
  // grouped with the gameweek that's ending, not the one about to start.
  // The "This week / 24/08 - 30/08" label itself is untouched.
  const matchWindowStart = addDays(weekStart,1);
  const matchWindowEnd = addDays(weekStart,7);

  const currentWeekStart = getMyGamesWeekStart(new Date());
  const isCurrentWeek = dateToKey(weekStart)===dateToKey(currentWeekStart);
  const isPastWeek = weekStart.getTime() < currentWeekStart.getTime();

  let weekMatches=all.filter(match=>{
    const d=parseDateOnly(match.Date);
    if(!d) return false;
    const cd=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    return cd>=matchWindowStart && cd<=matchWindowEnd;
  });

  if(isCurrentWeek){
    // Carry forward anything from an earlier week that's still not marked
    // played, so it never gets stuck in the past and forgotten.
    const overdue = all.filter(match=>{
      if(match.Status==='FT') return false;
      const d=parseDateOnly(match.Date);
      if(!d) return false;
      const cd=new Date(d.getFullYear(),d.getMonth(),d.getDate());
      return cd < matchWindowStart;
    });
    weekMatches = overdue.concat(weekMatches);
  } else if(isPastWeek){
    // Unplayed matches from a past week have moved to the current week's
    // list instead, so don't show them here too.
    weekMatches = weekMatches.filter(match=>match.Status==='FT');
  }

  setText('myGamesTitle', getSeasonWeekLabel(selected));
  setText('myGamesSubtitle', getWeekRangeLabel(selected));
  const myGamesPlayedCount = weekMatches.filter(isPlayedMatch).length;
  const myGamesScheduledCount = weekMatches.length - myGamesPlayedCount;
  setText('myGamesTotalValue', weekMatches.length);
  setText('myGamesPlayedValue', myGamesPlayedCount);
  setText('myGamesScheduledValue', myGamesScheduledCount);

  if(!weekMatches.length){
    setHTML('myGamesList','<div class="empty home-empty">No My Games found for this week.</div>');
    return;
  }

  const dayAssignment = buildMyGamesDayAssignment(weekMatches, weekStart, isCurrentWeek);

  const dayGroups = new Map();
  MONDAY_TO_SUNDAY_DISPLAY_ORDER.forEach(name=>dayGroups.set(name, []));
  weekMatches.forEach(match=>{
    const dayName = dayAssignment.get(match) || 'Monday';
    dayGroups.get(dayName).push(match);
  });

  const html = MONDAY_TO_SUNDAY_DISPLAY_ORDER.map(dayName=>{
    const dayDate = addDays(weekStart, WEEKDAY_OFFSET_FROM_WEEK_START[dayName]);
    const label = `${dayName} ${formatShortDateFromDate(dayDate).replace(/\.$/,'')}`;
    const dayMatches = dayGroups.get(dayName).sort(compareMyGamesMatches);
    const body = dayMatches.length ? dayMatches.map(renderMatchRowFlat).join('') : '<div class="empty home-empty">No games.</div>';
    return `<section class="home-time-block"><div class="home-time-heading">${escapeHTML(label)}</div>${body}</section>`;
  }).join('');

  setHTML('myGamesList', html);
}
function renderScoreboard(){ const matches=getFilteredMatches(); if(!matches.length){ setHTML('scoreboardList','<div class="empty">No matches found.</div>'); return; } const round=getNextUpRound(matches); if(!round){ setHTML('scoreboardList','<div class="empty">No matches found.</div>'); return; } const rows=matches.filter(m=>normaliseText(m.Round||'')===normaliseText(round)).sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); const scheduled=rows.some(m=>m.Status!=='FT'); setHTML('scoreboardList',`${scheduled?'':'<div class="season-complete-note">Season completed. Showing the last round played.</div>'}<section class="round-block"><div class="round-heading">${escapeHTML(formatRoundLabel(round))}</div>${rows.map(renderScoreboardRow).join('')}</section>`); }
function renderScoreboardRow(match){ const p=formatScoreboardDateParts(match.Date,match.Time); const score=match.Status==='FT'?renderScoreText(match):'vs'; const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:''; return `<article class="scoreboard-row ${match.MatchID?'is-clickable':''}" ${click}><div class="scoreboard-date"><span class="scoreboard-date-main">${escapeHTML(p.date)}</span><span class="scoreboard-time-main">${escapeHTML(p.time)}</span></div><div class="score-team-home-name">${escapeHTML(match.HomeTeam)}</div><div class="score-team-home-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="scoreboard-score">${score}</div><div class="score-team-away-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="score-team-away-name">${escapeHTML(match.AwayTeam)}</div></article>`; }
function renderResults(){ const results=getFilteredMatches().filter(m=>m.Status==='FT').sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); setHTML('resultsList',results.length?renderGroupedScoreboard(results):'<div class="empty">No results found.</div>'); setText('resultsCount',`${results.length} matches`); }
function renderFixtures(){ const fixtures=getFilteredMatches().filter(m=>m.Status!=='FT').sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); setHTML('fixturesList',fixtures.length?renderGroupedScoreboard(fixtures):'<div class="empty">No scheduled games found.</div>'); setText('fixturesCount',`${fixtures.length} matches`); }
function renderGroupedScoreboard(matches){ const grouped=groupBy(matches,m=>formatRoundLabel(m.Round)); return Object.keys(grouped).map(round=>`<section class="round-block"><div class="round-heading">${escapeHTML(round)}</div>${grouped[round].map(renderScoreboardRow).join('')}</section>`).join(''); }
function renderStandings(){
  const standings=getFilteredStandings(); 
  if(!standings.length){
    setHTML('standingsContainer','<div class="empty">No standings found.</div>'); 
    return; 
  }

  const groups=groupBy(standings,getStandingGroupKey);

  const orderedGroups = Object.keys(groups).sort((a, b) =>
  a.localeCompare(b, undefined, { numeric: true })
);

const html = orderedGroups.map(groupName => {
    const rows=[...groups[groupName]].sort(compareStandingRows); 
    const isGroupStage=isGroupStageCompetition();

    const legend = getCompetitionLegend(isGroupStage);

    return `<section class="table-card"><div class="table-card-header"><h3>${escapeHTML(groupName)}</h3><span>${rows.length} teams</span></div><div class="standings-table-wrap"><table class="standings-table"><thead><tr><th>#</th><th>Team</th><th>PT</th><th>GW</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th></tr></thead><tbody>${rows.map((team,i)=>{const zone=getRankClass(i,rows.length,isGroupStage,team,groupName);return `<tr class="standing-row standing-row-${zone.replace('rank-','')}"><td><span class="rank-badge ${zone}">${i+1}</span></td><td class="team-cell"><div class="standing-team-content">${renderTeamLogo(getStandingTeamLogo(team),team.Team)}<span class="standing-team-name">${escapeHTML(team.Team)}</span></div></td><td class="standings-points"><strong>${safeNumber(team.Points)}</strong></td><td>${safeNumber(team.Played)}</td><td>${safeNumber(team.Won)}</td><td>${safeNumber(team.Drawn)}</td><td>${safeNumber(team.Lost)}</td><td>${safeNumber(team.GoalsFor)}</td><td>${safeNumber(team.GoalsAgainst)}</td><td>${formatGoalDifference(team.GoalDifference)}</td></tr>`;}).join('')}</tbody></table></div>${legend}</section>`;
  }).join('');

  setHTML('standingsContainer',html);
}
function renderStats(){ const stats=getFilteredStats(); renderStatList('topScorers',stats,'Goals','topScorers'); renderStatList('topAssists',stats,'Assists','topAssists'); renderStatList('cleanSheets',stats,'CleanSheets','cleanSheets'); renderStatList('yellowCards',stats,'YellowCards','yellowCards'); renderStatList('redCards',stats,'RedCards','redCards'); }
function renderStatList(id,stats,key,expandKey){ const all=stats.filter(r=>Number(r[key])>0).sort((a,b)=>Number(b[key])-Number(a[key])||String(a.Player||'').localeCompare(String(b.Player||''))); if(!all.length){ setHTML(id,'<div class="empty">No data yet.</div>'); return; } const visible=expandedStats[expandKey]?all:all.slice(0,3); const rows=visible.map((r,i)=>`<div class="stat-row"><span class="stat-rank">${i+1}</span><span class="stat-player">${renderTeamLogo(r.Logo,r.Team)}${renderPlayerLink(r.Player,'stat-player-name')}</span><strong class="stat-value">${safeNumber(r[key])}</strong></div>`).join(''); const btn=all.length>3?`<button class="stat-toggle" type="button" onclick="toggleStatList('${expandKey}')">${expandedStats[expandKey]?'Show less':`See more (${all.length})`}</button>`:''; setHTML(id,rows+btn); }
window.toggleStatList = key => { expandedStats[key]=!expandedStats[key]; renderStats(); };
function renderTeamLogo(url,teamName){ if(!url) return '<span class="team-logo team-logo-empty"></span>'; return `<span class="team-logo"><img src="${escapeAttr(url)}" alt="${escapeAttr(teamName||'Team logo')}" loading="lazy"></span>`; }
function buildPlayerImageLookup(players){
  const lookup=new Map();
  if(!Array.isArray(players)) return lookup;
  players.forEach(row=>{
    const name=String(row?.['Player Name']??row?.Player??row?.Name??row?.[0]??'').trim();
    const imageUrl=String(row?.['Player Image URL']??row?.ImageURL??row?.['Image URL']??row?.[1]??'').trim();
    const key=normalisePlayerName(name);
    if(key&&!lookup.has(key)) lookup.set(key,imageUrl);
  });
  return lookup;
}
function buildPlayerTeamsLookup(rows){
  const lookup=new Map();
  if(!Array.isArray(rows)) return lookup;
  rows.forEach(row=>{
    const name=String(row?.['Player Name']??row?.Player??row?.[0]??'').trim();
    const team=String(row?.Team??row?.[1]??'').trim();
    if(!name||!team) return;
    const key=normalisePlayerName(name);
    if(!lookup.has(key)) lookup.set(key,[]);
    lookup.get(key).push({playerName:name,team,teamType:String(row?.['Team Type']??row?.TeamType??row?.[2]??'').trim(),startDate:String(row?.['Start Date']??row?.StartDate??row?.[3]??'').trim(),endDate:String(row?.['End Date']??row?.EndDate??row?.[4]??'').trim(),includeGames:String(row?.['Include Games']??row?.IncludeGames??row?.[5]??'Yes').trim()});
  });
  return lookup;
}
function normalisePlayerName(value){
  return String(value||'')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/^\s*[•\-–—]\s*/,'')
    .replace(/^\s*\+\s*/,'')
    .replace(/^\s*\d+(?:\+\d+)?\s*['’]?\s*/,'')
    .replace(/\(\s*\d+(?:\+\d+)?\s*['’]?\s*\)/g,'')
    .replace(/\s+\d+(?:\+\d+)?\s*['’]?\s*$/,'')
    .replace(/\s*OG\s*$/i,'')
    .replace(/P\s*$/i,'')
    .replace(/\s+/g,' ')
    .trim()
    .toLocaleLowerCase();
}
function getPlayerImageUrl(playerName){ return playerImageLookup.get(normalisePlayerName(playerName))||''; }
function renderPlayerImage(playerName){
  const name=String(playerName||'').trim()||'Player';
  const imageUrl=getPlayerImageUrl(name)||'player-placeholder.svg';
  return `<span class="player-photo"><img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='player-placeholder.svg'"></span>`;
}
function renderPlayerLink(playerName,nameClass=''){
  const name=String(playerName||'').trim();
  if(!name) return '';
  return `<button class="player-link ${escapeAttr(nameClass)}" type="button" onclick="openPlayerProfile('${escapeAttr(name)}',event)" title="Open ${escapeAttr(name)} profile">${renderPlayerImage(name)}<span>${escapeHTML(name)}</span></button>`;
}
async function openMatchDetail(matchId){
  const unique=dedupeMatchArray(getGlobalMatches().concat(getCompetitionMatches()).concat(Array.isArray(appData?.myGames)?appData.myGames:[]));
  const match=unique.find(m=>m.MatchID===matchId||m.ID===matchId);
  if(!match) return;
  const modal=$('matchModal'),content=$('matchDetailContent');
  if(!modal||!content) return;
  const hasEvents=getMatchEvents(match.MatchID||match.ID).length>0;
  content.innerHTML=renderMatchDetail(match,!hasEvents&&isHomePage());
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  if(!hasEvents&&isHomePage()){
    await loadCompetitionDetailsForMatch(match);
    if(!modal.classList.contains('hidden')) content.innerHTML=renderMatchDetail(match,false);
  }
}
window.openMatchDetail=openMatchDetail;
function closeMatchModal(){ $('matchModal')?.classList.add('hidden'); document.body.classList.remove('modal-open'); }
window.closeMatchModal=closeMatchModal;
function renderMatchDetail(match,eventsLoading=false){ const events=getMatchEvents(match.MatchID||match.ID); const youtube=match.YouTubeURL||match.YoutubeURL||match.HighlightsURL||''; const penalty=getPenaltyWinnerText(match); const motm=getMatchMOTM(match); const eventContent=eventsLoading?'<div class="empty">Loading goals, assists and cards...</div>':renderTimelineEvents(events,match); return `<section class="match-hero"><div class="match-date-main">${escapeHTML(formatFullDateTime(match.Date,match.Time))}</div><div class="match-main-teams"><div class="match-main-team"><div class="match-main-logo">${match.HomeLogo?`<img src="${escapeAttr(match.HomeLogo)}" alt="">`:''}</div><strong>${escapeHTML(match.HomeTeam)}</strong></div><div class="match-main-score"><div>${renderScoreText(match)}</div>${penalty?`<span>${escapeHTML(penalty)}</span>`:''}</div><div class="match-main-team"><div class="match-main-logo">${match.AwayLogo?`<img src="${escapeAttr(match.AwayLogo)}" alt="">`:''}</div><strong>${escapeHTML(match.AwayTeam)}</strong></div></div></section><section class="venue-row"><span>🏟️ Venue:</span><strong>${escapeHTML(match.Venue||match.Stadium||'Venue unavailable')}</strong></section><section class="event-section">${eventContent}</section>${motm?`<section class="motm-row"><span>⭐ Man of the Match:</span>${renderPlayerLink(motm)}</section>`:''}${renderHighlights(youtube)}`; }
async function loadCompetitionDetailsForMatch(match){
  const slug=resolveMatchCompetitionSlug(match);
  if(!slug) return;
  let detail=competitionDetailCache.get(slug);
  if(!detail){
    try{
      const response=await fetch(`${API_URL}?competition=${encodeURIComponent(slug)}&v=${Date.now()}`,{cache:'no-store'});
      if(!response.ok) return;
      detail=await response.json();
      if(detail?.error) return;
      competitionDetailCache.set(slug,detail);
    }catch(error){ console.warn('Could not load match events for the home popup.',error); return; }
  }
  appData.allEvents=mergeUniqueEvents(appData.allEvents,detail.allEvents||detail.events||[]);
  appData.matchData=(appData.matchData||[]).concat(detail.matchData||detail.data||[]);
}
function resolveMatchCompetitionSlug(match){
  const direct=String(match.CompetitionSlug||match.Slug||'').trim();
  if(direct) return direct;
  const matchName=normaliseCompetitionName(match.Competition||match['Competition Name']||'');
  const matchYear=String(match.Year||match.Season||'').trim();
  const candidates=(appData?.competitions||[]).filter(comp=>{
    const candidateName=normaliseCompetitionName(comp['Competition Name']||comp.Competition);
    return candidateName===matchName||candidateName.includes(matchName)||matchName.includes(candidateName);
  });
  const selected=candidates.find(comp=>!matchYear||String(comp.Year||'').trim()===matchYear)||candidates[0];
  if(selected) return makeCompetitionSlug(selected);
  return matchName?slugify(`${matchName} ${matchYear}`.trim()):'';
}
function mergeUniqueEvents(first,second){
  const seen=new Set();
  return ([]).concat(Array.isArray(first)?first:[],Array.isArray(second)?second:[]).filter(event=>{
    const key=[event.MatchID,event.Half,event.Minute,event.Team,event.Event,event.Player,event.Detail].join('|').toLowerCase();
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function getMatchEvents(matchId){ const targetId=String(matchId||'').trim(); const seen=new Set(); return (appData.allEvents||[]).filter(e=>String(e.MatchID||e['Match ID']||e.ID||'').trim()===targetId).filter(e=>{ const key=[e.MatchID,e.Half,e.Minute,e.Team,e.Event,e.Player,e.Detail].join('|').toLowerCase(); if(seen.has(key)) return false; seen.add(key); return true; }).sort((a,b)=>Number(a.Minute||0)-Number(b.Minute||0)); }
function renderHalfEvents(title,events,match){ if(!events.length) return `<div class="half-block"><div class="half-title">${escapeHTML(title)}</div><div class="empty">No events.</div></div>`; let liveHome=0, liveAway=0; const rows=events.map(e=>{ if(isGoalEvent(e)){ if(sameTeam(e.Team,match.HomeTeam)) liveHome++; if(sameTeam(e.Team,match.AwayTeam)) liveAway++; } return renderEventRow(e,match,liveHome,liveAway); }).join(''); return `<div class="half-block"><div class="half-title">${escapeHTML(title)}</div>${rows}</div>`; }
function renderEventRow(event,match,liveHome,liveAway){ const side=sameTeam(event.Team,match.HomeTeam)?'event-home':'event-away'; return `<div class="event-row ${side}"><div class="event-minute">${escapeHTML(event.Minute)}'</div><div class="event-content">${getEventLabel(event,liveHome,liveAway)}</div></div>`; }
function getEventLabel(event,liveHome,liveAway){
  const type=String(event.Event||'').toLowerCase().trim(), detail=String(event.Detail||'').trim(), player=String(event.Player||'').trim();
  const playerLabel=renderPlayerLink(player);
  const detailLabel=renderEventDetail(detail);
  if(type==='goal') return `<span class="goal-pill">⚽ ${liveHome} - ${liveAway}</span>${playerLabel}${detailLabel}`;
  if(type==='yellow card') return `<span>🟨</span>${playerLabel}${detailLabel}`;
  if(type==='red card') return `<span>🟥</span>${playerLabel}${detailLabel}`;
  if(type==='penalty missed'||type==='missed penalty') return `<span>❌</span>${playerLabel}<span class="event-detail">(Penalty missed)</span>`;
  return `<span>•</span>${playerLabel}${detailLabel}`;
}
function renderEventDetail(detail){
  const cleanDetail=cleanEventDetail(detail);
  if(!cleanDetail) return '';
  const assist=String(detail||'').match(/(?:^|,\s*)Assist:\s*(.+)$/i)?.[1]?.trim();
  if(assist) return `<span class="event-detail event-assist">(Assist: ${renderPlayerLink(assist)})</span>`;
  return `<span class="event-detail">(${escapeHTML(cleanDetail)})</span>`;
}

function renderTimelineEvents(events,match){ if(!events.length) return '<div class="empty">No events.</div>'; let liveHome=0, liveAway=0; const rows=events.map(e=>{ if(isGoalEvent(e)){ if(sameTeam(e.Team,match.HomeTeam)) liveHome++; if(sameTeam(e.Team,match.AwayTeam)) liveAway++; } return renderEventRow(e,match,liveHome,liveAway); }).join(''); return `<div class="timeline-block">${rows}</div>`; }
function cleanEventDetail(detail){ const text=String(detail||'').trim(); if(!text) return ''; return text.replace(/^Assist:\s*/i,'').replace(/^Penalty,\s*Assist:\s*/i,'Penalty, ').replace(/,\s*Assist:\s*/i,', '); }
function getMatchMOTM(match){ if(match.MOTM) return match.MOTM; const matchId=match.MatchID||match.ID; const row=(appData.matchData||appData.data||[]).find(item=>(item.MatchID||item['Match ID'])===matchId); return row ? (row.MOTM || row.Motm || '') : ''; }
function renderHighlights(url){ const cleanUrl=String(url||'').trim(); if(!cleanUrl) return ''; const id=getYouTubeId(cleanUrl); if(!id) return `<section class="highlights-card"><div class="highlights-header"><span>📺 Highlights</span><a href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">Open video</a></div></section>`; return `<section class="highlights-card"><div class="highlights-header"><span>📺 Highlights</span><a href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">Open on YouTube</a></div><a class="youtube-preview" href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer"><img src="https://img.youtube.com/vi/${escapeAttr(id)}/maxresdefault.jpg" alt="YouTube highlights thumbnail" onerror="this.src='https://img.youtube.com/vi/${escapeAttr(id)}/hqdefault.jpg'"><span class="youtube-play">▶</span></a></section>`; }
function getYouTubeId(url){ const text=String(url||'').trim(); const patterns=[/youtube\.com\/watch\?v=([^&]+)/i,/youtu\.be\/([^?&]+)/i,/youtube\.com\/shorts\/([^?&]+)/i,/youtube\.com\/embed\/([^?&]+)/i]; for(const p of patterns){ const m=text.match(p); if(m?.[1]) return m[1]; } return ''; }

function openPlayerProfile(playerName,event){
  event?.stopPropagation?.(); activePlayerProfileName=String(playerName||'').trim(); activePlayerSeason=String(getCurrentSeasonYear());
  renderActivePlayerProfile(); $('playerModal')?.classList.remove('hidden'); document.body.classList.add('modal-open');
}
window.openPlayerProfile=openPlayerProfile;
function closePlayerProfile(){ $('playerModal')?.classList.add('hidden'); if($('matchModal')?.classList.contains('hidden')&&$('teamModal')?.classList.contains('hidden')) document.body.classList.remove('modal-open'); }
window.closePlayerProfile=closePlayerProfile;
function renderActivePlayerProfile(){ if($('playerDetailContent')) $('playerDetailContent').innerHTML=renderPlayerProfile(activePlayerProfileName,activePlayerSeason); }
function changePlayerSeason(value){ activePlayerSeason=String(value); renderActivePlayerProfile(); }
window.changePlayerSeason=changePlayerSeason;
function getCurrentSeasonYear(date=new Date()){ return date.getMonth()>=7?date.getFullYear()+1:date.getFullYear(); }
function getSeasonYearForDate(value){ const d=parseDateOnly(value); return d?(d.getMonth()>=7?d.getFullYear()+1:d.getFullYear()):''; }
function isPlayedMatch(match){
  if(String(match?.Status||'').toUpperCase()==='FT') return true;
  const home=String(match?.HomeScore??'').trim();
  const away=String(match?.AwayScore??'').trim();
  return /^\d+$/.test(home) && /^\d+$/.test(away);
}
function renderPlayerProfile(playerName,seasonYear=getCurrentSeasonYear()){
  const name=String(playerName||'').trim(),assignments=playerTeamsLookup.get(normalisePlayerName(name))||[],allMatches=getPlayerMatches(assignments,name);
  const current=String(getCurrentSeasonYear()),seasons=[...new Set(allMatches.map(x=>String(getSeasonYearForDate(x.match.Date))).filter(Boolean))];
  if(!seasons.includes(current)) seasons.push(current); seasons.sort((a,b)=>Number(b)-Number(a));
  const selected=seasons.includes(String(seasonYear))?String(seasonYear):current,matches=allMatches.filter(x=>String(getSeasonYearForDate(x.match.Date))===selected);
  const totals=matches.reduce((s,x)=>{s.goals+=x.stats.goals;s.assists+=x.stats.assists;s.yellow+=x.stats.yellow;s.red+=x.stats.red;return s},{goals:0,assists:0,yellow:0,red:0});
  const national=assignments.find(x=>normaliseText(x.teamType)==='national team'),clubs=assignments.filter(x=>normaliseText(x.teamType)==='club');
  const teams=assignments.length?assignments.map(renderPlayerTeamAssignment).join(''):'<div class="empty">Team information has not been added yet.</div>';
  const rows=matches.length?matches.map(renderPlayerMatchRow).join(''):'<div class="empty">No played games are available for this player in this season.</div>';
  const options=seasons.map(y=>`<option value="${escapeAttr(y)}" ${y===selected?'selected':''}>${escapeHTML(y)}</option>`).join('');
  return `<section class="player-profile-hero"><div class="player-profile-photo">${renderPlayerImage(name)}</div><div class="player-profile-copy"><div class="eyebrow">Player profile</div><h2>${escapeHTML(name)}</h2>${national?`<p>🌍 ${escapeHTML(national.team)}</p>`:''}${clubs.length?`<p>${clubs.map(x=>escapeHTML(x.team)).join(' · ')}</p>`:''}</div><label class="profile-season-select"><span>Season</span><select onchange="changePlayerSeason(this.value)">${options}</select></label></section><section class="player-summary-grid"><div><strong>${matches.length}</strong><span>Games</span></div><div><strong>${totals.goals}</strong><span>Goals</span></div><div><strong>${totals.assists}</strong><span>Assists</span></div><div><strong>${totals.yellow}</strong><span>Yellow</span></div><div><strong>${totals.red}</strong><span>Red</span></div></section><section class="player-teams-section"><h3>Teams</h3>${teams}</section><section class="player-matches-section"><h3>Played games · ${escapeHTML(selected)}</h3>${rows}</section>`;
}
function renderPlayerTeamAssignment(item){
  const dates=item.startDate||item.endDate?`${item.startDate||'Beginning'} → ${item.endDate||'Present'}`:'Dates not restricted';
  return `<div class="player-team-row">${renderTeamLogo(findTeamLogo(item.team),item.team)}<span><strong>${escapeHTML(item.team)}</strong><small>${escapeHTML(item.teamType||'Team')} · ${escapeHTML(dates)}</small></span></div>`;
}
function getPlayerMatches(assignments,playerName){
  if(!assignments.length) return [];
  const matches=dedupeMatchArray(getGlobalMatches().concat(getCompetitionMatches()).concat(Array.isArray(appData?.myGames)?appData.myGames:[]));
  return matches.filter(match=>isPlayedMatch(match)&&assignments.some(item=>assignmentIncludesMatch(item,match))).map(match=>({match,stats:getPlayerMatchStats(match,playerName)})).sort((a,b)=>matchDateSortValue(b.match)-matchDateSortValue(a.match));
}
function assignmentIncludesMatch(item,match){
  if(normaliseText(item.includeGames)==='no') return false;
  const team=normaliseTeamName(item.team);
  if(team!==normaliseTeamName(match.HomeTeam)&&team!==normaliseTeamName(match.AwayTeam)) return false;
  const date=getDateKey(match.Date);
  if(item.startDate&&date<getDateKey(item.startDate)) return false;
  if(item.endDate&&date>getDateKey(item.endDate)) return false;
  return true;
}
function getPlayerMatchStats(match,playerName){
  const key=normalisePlayerName(playerName);
  const totals={goals:0,assists:0,yellow:0,red:0};
  getMatchEvents(match.MatchID||match.ID).forEach(event=>{
    const type=normaliseText(event.Event),player=normalisePlayerName(event.Player);
    if(player===key){ if(type==='goal') totals.goals++; if(type==='yellow card') totals.yellow++; if(type==='red card') totals.red++; }
    const assist=String(event.Detail||'').match(/(?:^|,\s*)Assist:\s*(.+)$/i)?.[1]?.trim();
    if(assist&&normalisePlayerName(assist)===key) totals.assists++;
  });
  return totals;
}
function renderPlayerMatchRow(item){
  const match=item.match,s=item.stats,click=match.MatchID?`onclick="closePlayerProfile();openMatchDetail('${escapeAttr(match.MatchID)}')"`:'';
  const badges=[s.goals?`⚽ ${s.goals}`:'',s.assists?`A ${s.assists}`:'',s.yellow?`🟨 ${s.yellow}`:'',s.red?`🟥 ${s.red}`:''].filter(Boolean).join(' ');
  return `<button class="player-match-row" type="button" ${click}><span class="player-match-date">${escapeHTML(formatScoreboardDateParts(match.Date,match.Time).date)}</span><span class="player-match-teams"><strong>${escapeHTML(match.HomeTeam)} ${escapeHTML(renderScoreText(match))} ${escapeHTML(match.AwayTeam)}</strong><small>${escapeHTML(match.Competition||match['Competition Name']||match.Round||'')}</small></span><span class="player-match-events">${badges||'—'}</span></button>`;
}

function getMasterSearchItems(){
 const players=[],seenP=new Set(),teams=[],seenT=new Set();
 const addP=n=>{n=String(n||'').trim();const k=normalisePlayerName(n);if(n&&!seenP.has(k)){seenP.add(k);players.push(n)}};
 const addT=n=>{n=String(n||'').trim();const k=normaliseTeamName(n);if(n&&!seenT.has(k)){seenT.add(k);teams.push(n)}};
 (appData?.players||[]).forEach(r=>addP(r?.['Player Name']??r?.Player??r?.Name??r?.[0]));
 (appData?.playerTeams||[]).forEach(r=>{addP(r?.['Player Name']??r?.Player??r?.[0]);addT(r?.Team??r?.[1])});
 getGlobalMatches().concat(getCompetitionMatches()).concat(appData?.myGames||[]).forEach(m=>{addT(m.HomeTeam);addT(m.AwayTeam)});
 return {players,teams};
}
function renderMasterSearchResults(value){
 const box=$('masterSearchResults'),q=normaliseText(value); $('masterSearchClear')?.classList.toggle('hidden',!q);
 if(!box)return;if(!q){box.classList.add('hidden');box.innerHTML='';return}
 const data=getMasterSearchItems(),players=data.players.filter(n=>normaliseText(n).includes(q)).slice(0,8),teams=data.teams.filter(n=>normaliseText(n).includes(q)).slice(0,8);
 box.innerHTML=(players.length?`<div class="master-search-label">Players</div>${players.map(n=>`<button class="master-search-result" onclick="selectMasterPlayer('${escapeAttr(n)}')">${renderPlayerImage(n)}<strong>${escapeHTML(n)}</strong></button>`).join('')}`:'')+(teams.length?`<div class="master-search-label">Teams</div>${teams.map(n=>`<button class="master-search-result" onclick="selectMasterTeam('${escapeAttr(n)}')">${renderTeamLogo(findTeamLogo(n),n)}<strong>${escapeHTML(n)}</strong></button>`).join('')}`:'')+(!players.length&&!teams.length?'<div class="empty">No players or teams found.</div>':''); box.classList.remove('hidden');
}
function clearMasterSearch(){if($('masterSearchInput'))$('masterSearchInput').value='';$('masterSearchResults')?.classList.add('hidden');$('masterSearchClear')?.classList.add('hidden')}
window.clearMasterSearch=clearMasterSearch;
function selectMasterPlayer(n){clearMasterSearch();openPlayerProfile(n)} window.selectMasterPlayer=selectMasterPlayer;
function selectMasterTeam(n){clearMasterSearch();openTeamProfile(n)} window.selectMasterTeam=selectMasterTeam;
function openTeamProfile(teamName){if(!$('teamModal')||!$('teamDetailContent'))return;$('teamDetailContent').innerHTML=renderTeamProfile(teamName);$('teamModal').classList.remove('hidden');document.body.classList.add('modal-open')}
window.openTeamProfile=openTeamProfile;
function closeTeamProfile(){$('teamModal')?.classList.add('hidden');if($('matchModal')?.classList.contains('hidden')&&$('playerModal')?.classList.contains('hidden'))document.body.classList.remove('modal-open')}
window.closeTeamProfile=closeTeamProfile;
function renderTeamProfile(teamName){
 const name=String(teamName||'').trim(),key=normaliseTeamName(name);
 const matches=dedupeMatchArray(getGlobalMatches().concat(getCompetitionMatches()).concat(appData?.myGames||[])).filter(m=>isPlayedMatch(m)&&(normaliseTeamName(m.HomeTeam)===key||normaliseTeamName(m.AwayTeam)===key)).sort((a,b)=>matchDateSortValue(b)-matchDateSortValue(a));
 const seen=new Set(),squad=[];(appData?.playerTeams||[]).forEach(r=>{const t=String(r?.Team??r?.[1]??''),p=String(r?.['Player Name']??r?.Player??r?.[0]??'').trim(),pk=normalisePlayerName(p);if(p&&normaliseTeamName(t)===key&&!seen.has(pk)){seen.add(pk);squad.push(p)}});
 const sq=squad.length?squad.sort().map(p=>`<button class="team-squad-player" onclick="closeTeamProfile();openPlayerProfile('${escapeAttr(p)}')">${renderPlayerImage(p)}<strong>${escapeHTML(p)}</strong></button>`).join(''):'<div class="empty">No squad players found.</div>';
 const games=matches.length?matches.map(m=>`<button class="team-profile-match" ${m.MatchID?`onclick="closeTeamProfile();openMatchDetail('${escapeAttr(m.MatchID)}')"`:''}><span>${escapeHTML(formatScoreboardDateParts(m.Date,m.Time).date)}</span><span><strong>${escapeHTML(m.HomeTeam)} ${escapeHTML(renderScoreText(m))} ${escapeHTML(m.AwayTeam)}</strong><small>${escapeHTML(m.Competition||m['Competition Name']||'Competition')}</small></span></button>`).join(''):'<div class="empty">No played games found.</div>';
 return `<section class="team-profile-hero">${renderTeamLogo(findTeamLogo(name),name)}<div><div class="eyebrow">Team profile</div><h2>${escapeHTML(name)}</h2></div></section><section class="team-profile-section"><h3>Squad</h3><div class="team-squad-grid">${sq}</div></section><section class="team-profile-section"><h3>All played games</h3>${games}</section>`;
}

function getCompetitionMatches(){ return dedupeMatchArray((Array.isArray(appData?.matches)?appData.matches:[]).concat(Array.isArray(appData?.playoffs)?appData.playoffs:[])); }
function getGlobalMatches(){ return dedupeMatchArray(Array.isArray(appData?.allMatches)?appData.allMatches:[]); }
function findTeamLogo(teamName){
  const team=normaliseTeamName(teamName);
  const directLogo = teamLogoLookup.get(team);
  if(directLogo) return directLogo;

  const matches=getGlobalMatches().concat(getCompetitionMatches()).concat(Array.isArray(appData?.myGames)?appData.myGames:[]);
  for(const match of matches){
    if(normaliseTeamName(match.HomeTeam)===team&&match.HomeLogo) return match.HomeLogo;
    if(normaliseTeamName(match.AwayTeam)===team&&match.AwayLogo) return match.AwayLogo;
  }
  return '';
}

function getStandingTeamLogo(standing){
  if(standing?.Logo) return standing.Logo;

  const team=normaliseTeamName(standing?.Team);
  if(!team) return '';

  const directLogo = teamLogoLookup.get(team);
  if(directLogo) return directLogo;

  const matches=[]
    .concat(Array.isArray(appData?.matches)?appData.matches:[])
    .concat(Array.isArray(appData?.playoffs)?appData.playoffs:[])
    .concat(Array.isArray(appData?.allMatches)?appData.allMatches:[])
    .concat(Array.isArray(appData?.myGames)?appData.myGames:[]);

  for(const match of matches){
    if(normaliseTeamName(match?.HomeTeam)===team&&match?.HomeLogo) return match.HomeLogo;
    if(normaliseTeamName(match?.AwayTeam)===team&&match?.AwayLogo) return match.AwayLogo;
  }

  return '';
}
function dedupeMatchArray(matches){ const seen=new Set(); return (matches||[]).filter(m=>{ const key=String(m.MatchID||m.ID||'').trim(); if(!key||seen.has(key)) return false; seen.add(key); return true; }); }
function getFilteredMatches(){ let matches=getCompetitionMatches(); if(currentSearch) matches=matches.filter(m=>[m.HomeTeam,m.AwayTeam,m.Round,m.Competition,m.Date,m.Time].join(' ').toLowerCase().includes(currentSearch)); if(currentRound){ const key=normaliseText(currentRound); matches=matches.filter(m=>normaliseText(m.Round)===key); } if(currentGroup){ const key=normaliseText(currentGroup); const teams=(appData.standings||[]).filter(r=>normaliseText(getStandingGroupKey(r))===key).map(r=>normaliseTeamName(r.Team)).filter(Boolean); matches=matches.filter(m=>teams.includes(normaliseTeamName(m.HomeTeam))||teams.includes(normaliseTeamName(m.AwayTeam))||normaliseText(m.Round)===key||normaliseText(m.Round).includes(key)); } return matches; }
function getFilteredStandings(){ let standings=appData.standings||[]; if(currentSearch) standings=standings.filter(r=>[r.Team,r.League,r.Group,r.Competition].join(' ').toLowerCase().includes(currentSearch)); if(currentGroup) standings=standings.filter(r=>normaliseText(getStandingGroupKey(r))===normaliseText(currentGroup)); return standings; }
function getFilteredStats(){ let stats=appData.stats||[]; if(currentSearch) stats=stats.filter(r=>[r.Player,r.Team].join(' ').toLowerCase().includes(currentSearch)); return stats; }
function getNextUpRound(matches){ const ordered=[...matches].sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); const now=Date.now()-86400000; const next=ordered.find(m=>m.Status!=='FT'&&matchDateSortValue(m)>=now); if(next) return next.Round||''; const completed=ordered.filter(m=>m.Status==='FT'&&matchDateSortValue(m)>0).sort((a,b)=>matchDateSortValue(b)-matchDateSortValue(a)); return completed.length?completed[0].Round||'':''; }
const TABLE_TIEBREAKER_RULES = {
  'premier-league': ['goalDifference','goalsFor','headToHeadPoints','headToHeadAwayGoals'],
  'serie-a': ['headToHeadPoints','headToHeadGoalDifference','goalDifference','goalsFor'],
  'la-liga': ['headToHeadPoints','headToHeadGoalDifference','goalDifference','goalsFor','fairPlayPoints'],
  'bundesliga': ['goalDifference','goalsFor','headToHeadPoints','headToHeadGoalDifference','headToHeadAwayGoals','awayGoals'],
  'ligue-1': ['goalDifference','headToHeadPoints','headToHeadGoalDifference','goalsFor','won','awayWins','disciplinaryPoints'],
  'champions-league': ['goalDifference','goalsFor','awayGoals','won','awayWins','opponentsPoints','opponentsGoalDifference','opponentsGoalsFor','disciplinaryPoints','clubCoefficient'],
  'nations-league': ['headToHeadPoints','headToHeadGoalDifference','headToHeadGoalsFor','goalDifference','goalsFor','awayGoals','won','awayWins','disciplinaryPoints','accessListRank'],
  'europa-league-old-groups': ['headToHeadPoints','headToHeadGoalDifference','headToHeadGoalsFor','goalDifference','goalsFor','awayGoals','won','awayWins','disciplinaryPoints','clubCoefficient'],
  'conference-league-old-groups': ['headToHeadPoints','headToHeadGoalDifference','headToHeadGoalsFor','goalDifference','goalsFor','awayGoals','won','awayWins','disciplinaryPoints','clubCoefficient'],
  default: ['goalDifference','goalsFor','goalsAgainst']
};

function compareStandingRows(a,b){
  const pA=safeNumber(a.Points), pB=safeNumber(b.Points);
  if(pB!==pA) return pB-pA;

  const tiedTeams=(appData.standings||[]).filter(r=>
    getStandingGroupKey(r)===getStandingGroupKey(a) &&
    safeNumber(r.Points)===pA
  );

  const ruleKey=getStandingsRuleKey();
  const rules=TABLE_TIEBREAKER_RULES[ruleKey] || TABLE_TIEBREAKER_RULES.default;

  for(const metric of rules){
    const result=compareStandingMetric(a,b,metric,tiedTeams);
    if(result!==0) return result;
  }

  // Final stable fallback for criteria that are not in the sheets yet
  // such as fair play, UEFA access list, coefficients or drawing lots.
  return String(a.Team||'').localeCompare(String(b.Team||''));
}

function getStandingsRuleKey(){
  const selected=appData?.selectedCompetition||{};
  const site=appData?.site||{};
  const name=slugify(normaliseCompetitionName(
    selected['Competition Name'] || selected.competition || site.competition || currentCompetition || ''
  ));
  const type=normaliseText(selected['Competition Type'] || selected.CompetitionType || site.competitionType || appData?.competitionType || '');

  if(name.includes('premier-league')) return 'premier-league';
  if(name.includes('serie-a')) return 'serie-a';
  if(name.includes('la-liga') || name.includes('laliga')) return 'la-liga';
  if(name.includes('bundesliga')) return 'bundesliga';
  if(name.includes('ligue-1') || name.includes('ligue1')) return 'ligue-1';
  if(name.includes('champions-league')) return 'champions-league';
  if(name.includes('nations-league')) return 'nations-league';

  // The user's Europa League / Conference League data is the old 8-group format.
  if(name.includes('europa-league') && !type.includes('league phase')) return 'europa-league-old-groups';
  if(name.includes('conference-league') && !type.includes('league phase')) return 'conference-league-old-groups';

  return 'default';
}

function compareStandingMetric(a,b,metric,tiedTeams){
  const direction = ['disciplinaryPoints','fairPlayPoints','goalsAgainst','accessListRank'].includes(metric) ? 'asc' : 'desc';
  const aValue = getStandingMetricValue(a,metric,tiedTeams);
  const bValue = getStandingMetricValue(b,metric,tiedTeams);

  if(aValue===bValue) return 0;
  return direction==='asc' ? aValue-bValue : bValue-aValue;
}

function getStandingMetricValue(row,metric,tiedTeams){
  const teamKey=normaliseTeamName(row.Team);
  const h2h=getHeadToHeadStatsForTie(tiedTeams || []);
  const overall=getOverallMatchStatsForTable(tiedTeams || []);
  const opponents=getOpponentStrengthStatsForTable(tiedTeams || []);

  switch(metric){
    case 'goalDifference': return safeNumber(row.GoalDifference);
    case 'goalsFor': return safeNumber(row.GoalsFor);
    case 'goalsAgainst': return safeNumber(row.GoalsAgainst);
    case 'won': return safeNumber(row.Won);
    case 'awayGoals': return getOptionalOrCalculated(row,'AwayGoals',overall[teamKey]?.awayGoals);
    case 'awayWins': return getOptionalOrCalculated(row,'AwayWins',overall[teamKey]?.awayWins);
    case 'disciplinaryPoints': return getOptionalOrCalculated(row,'DisciplinaryPoints',0);
    case 'fairPlayPoints': return getOptionalOrCalculated(row,'FairPlayPoints',0);
    case 'clubCoefficient': return getOptionalOrCalculated(row,'ClubCoefficient',0);
    case 'accessListRank': return getOptionalOrCalculated(row,'AccessListRank',9999);
    case 'opponentsPoints': return opponents[teamKey]?.points || 0;
    case 'opponentsGoalDifference': return opponents[teamKey]?.goalDifference || 0;
    case 'opponentsGoalsFor': return opponents[teamKey]?.goalsFor || 0;
        case 'headToHeadPoints':
      if(!isHeadToHeadTieReady(tiedTeams || [])) return 0;
      return h2h[teamKey]?.points || 0;

    case 'headToHeadGoalDifference':
      if(!isHeadToHeadTieReady(tiedTeams || [])) return 0;
      return h2h[teamKey]?.goalDifference || 0;

    case 'headToHeadGoalsFor':
      if(!isHeadToHeadTieReady(tiedTeams || [])) return 0;
      return h2h[teamKey]?.goalsFor || 0;

    case 'headToHeadAwayGoals':
      if(!isHeadToHeadTieReady(tiedTeams || [])) return 0;
      return h2h[teamKey]?.awayGoals || 0;
  }
}

function getOptionalOrCalculated(row,key,calculatedValue){
  const own = Number(row?.[key]);
  if(Number.isFinite(own) && own !== 0) return own;
  const calculated = Number(calculatedValue);
  return Number.isFinite(calculated) ? calculated : 0;
}

function getHeadToHeadStatsForTie(tiedTeams){
  const keys=(tiedTeams||[]).map(t=>normaliseTeamName(t.Team)).filter(Boolean);
  const uniqueKeys=[...new Set(keys)];
  const output={};

  uniqueKeys.forEach(key=>{
    const row=(tiedTeams||[]).find(t=>normaliseTeamName(t.Team)===key) || {};
    output[key]={team:row.Team||'',points:0,goalsFor:0,goalsAgainst:0,goalDifference:0,awayGoals:0,wins:0,awayWins:0,matches:0};
  });

  if(uniqueKeys.length<2) return output;

  getCompetitionMatches().forEach(match=>{
    if(!isPlayedMatch(match)) return;

    const home=normaliseTeamName(match.HomeTeam);
    const away=normaliseTeamName(match.AwayTeam);
    if(!output[home] || !output[away]) return;

    const homeScore=safeNumber(match.HomeScore);
    const awayScore=safeNumber(match.AwayScore);

    output[home].matches += 1;
    output[away].matches += 1;

    output[home].goalsFor += homeScore;
    output[home].goalsAgainst += awayScore;
    output[home].goalDifference += homeScore-awayScore;

    output[away].goalsFor += awayScore;
    output[away].goalsAgainst += homeScore;
    output[away].goalDifference += awayScore-homeScore;
    output[away].awayGoals += awayScore;

    if(homeScore>awayScore){
      output[home].points += 3;
      output[home].wins += 1;
    } else if(awayScore>homeScore){
      output[away].points += 3;
      output[away].wins += 1;
      output[away].awayWins += 1;
    } else {
      output[home].points += 1;
      output[away].points += 1;
    }
  });

  return output;
}
function isHeadToHeadTieReady(tiedTeams){

  const keys = [...new Set(
    (tiedTeams || [])
      .map(team => normaliseTeamName(team.Team))
      .filter(Boolean)
  )];

  if(keys.length < 2){
    return false;
  }

  let playedHeadToHeadMatches = 0;

  getCompetitionMatches().forEach(match => {
    if(!isPlayedMatch(match)) return;

    const home = normaliseTeamName(match.HomeTeam);
    const away = normaliseTeamName(match.AwayTeam);

    if(keys.includes(home) && keys.includes(away)){
      playedHeadToHeadMatches += 1;
    }
  });

  const competitionKey = getStandingsRuleKey();

  const doubleRoundRobinCompetitions = [
    'serie-a',
    'la-liga',
    'bundesliga',
    'ligue-1',
    'premier-league',
    'europa-league-old-groups',
    'conference-league-old-groups',
    'nations-league'
  ];

  if(doubleRoundRobinCompetitions.includes(competitionKey)){
    const requiredMatches = keys.length * (keys.length - 1);
    return playedHeadToHeadMatches >= requiredMatches;
  }

  return playedHeadToHeadMatches > 0;
}
function getOverallMatchStatsForTable(tableRows){
  const keys=(tableRows||[]).map(row=>normaliseTeamName(row.Team)).filter(Boolean);
  const output={};

  keys.forEach(key=>{
    output[key]={awayGoals:0,awayWins:0,wins:0};
  });

  getCompetitionMatches().forEach(match=>{
    if(!isPlayedMatch(match)) return;

    const home=normaliseTeamName(match.HomeTeam);
    const away=normaliseTeamName(match.AwayTeam);
    if(!output[home] && !output[away]) return;

    const homeScore=safeNumber(match.HomeScore);
    const awayScore=safeNumber(match.AwayScore);

    if(output[home] && homeScore>awayScore) output[home].wins += 1;
    if(output[away]){
      output[away].awayGoals += awayScore;
      if(awayScore>homeScore){
        output[away].wins += 1;
        output[away].awayWins += 1;
      }
    }
  });

  return output;
}

function getOpponentStrengthStatsForTable(tableRows){
  const standingLookup={};
  (tableRows||[]).forEach(row=>{
    const key=normaliseTeamName(row.Team);
    if(key) standingLookup[key]=row;
  });

  const output={};
  Object.keys(standingLookup).forEach(key=>{
    output[key]={points:0,goalDifference:0,goalsFor:0};
  });

  getCompetitionMatches().forEach(match=>{
    if(!isPlayedMatch(match)) return;

    const home=normaliseTeamName(match.HomeTeam);
    const away=normaliseTeamName(match.AwayTeam);

    if(output[home] && standingLookup[away]){
      output[home].points += safeNumber(standingLookup[away].Points);
      output[home].goalDifference += safeNumber(standingLookup[away].GoalDifference);
      output[home].goalsFor += safeNumber(standingLookup[away].GoalsFor);
    }

    if(output[away] && standingLookup[home]){
      output[away].points += safeNumber(standingLookup[home].Points);
      output[away].goalDifference += safeNumber(standingLookup[home].GoalDifference);
      output[away].goalsFor += safeNumber(standingLookup[home].GoalsFor);
    }
  });

  return output;
}

function getMiniTableRank(tiedTeams){
  const rules=['headToHeadPoints','headToHeadGoalDifference','headToHeadGoalsFor','headToHeadAwayGoals'];
  const rows=[...(tiedTeams||[])];
  const ranked=rows.sort((a,b)=>{
    for(const metric of rules){
      const result=compareStandingMetric(a,b,metric,tiedTeams);
      if(result!==0) return result;
    }
    return String(a.Team||'').localeCompare(String(b.Team||''));
  });

  const output={};
  ranked.forEach((item,index)=>{
    output[normaliseTeamName(item.Team)]=index;
  });
  return output;
}

function getHeadToHeadWinner(a,b){
  const rows=[{Team:a},{Team:b}];
  const stats=getHeadToHeadStatsForTie(rows);
  const aKey=normaliseTeamName(a), bKey=normaliseTeamName(b);
  const aStats=stats[aKey] || {};
  const bStats=stats[bKey] || {};

  if((aStats.points||0)!==(bStats.points||0)) return (aStats.points||0)>(bStats.points||0)?a:b;
  if((aStats.goalDifference||0)!==(bStats.goalDifference||0)) return (aStats.goalDifference||0)>(bStats.goalDifference||0)?a:b;
  if((aStats.goalsFor||0)!==(bStats.goalsFor||0)) return (aStats.goalsFor||0)>(bStats.goalsFor||0)?a:b;
  if((aStats.awayGoals||0)!==(bStats.awayGoals||0)) return (aStats.awayGoals||0)>(bStats.awayGoals||0)?a:b;

  return '';
}
function renderCompetitionCategoryNav(){ const nav=$('competitionCategoryNav'); if(!nav||!appData?.competitions) return; const home=`<div class="competition-category ${isHomePage()?'is-active':''}"><button type="button" class="category-button" onclick="goHomePage()"><span class="category-icon">🏠</span><span class="category-name">Home</span></button></div>`; nav.innerHTML=home+getCompetitionCategories().map(cat=>{ const comps=getUniqueCompetitionsForCategory(cat.key); const active=!isHomePage()&&comps.some(c=>normaliseCompetitionName(c['Competition Name'])===normaliseCompetitionName(appData.selectedCompetition?.['Competition Name'])&&getCompetitionCategoryKey(c)===getCompetitionCategoryKey(appData.selectedCompetition||{})); const items=comps.length?comps.map(comp=>{ const latest=getLatestSeasonForCompetition(comp); const slug=makeCompetitionSlug(latest); const isActive=!isHomePage()&&normaliseCompetitionName(comp['Competition Name'])===normaliseCompetitionName(appData.selectedCompetition?.['Competition Name'])&&getCompetitionCategoryKey(comp)===getCompetitionCategoryKey(appData.selectedCompetition||{}); return `<button type="button" class="category-menu-item ${isActive?'active-item':''}" onclick="selectCompetitionFromCategory('${escapeAttr(slug)}')"><span>${escapeHTML(comp['Competition Name']||'Competition')}</span>${isActive?'<strong>Current</strong>':''}</button>`; }).join(''):`<div class="category-empty">No competitions yet</div>`; return `<div class="competition-category ${active?'is-active':''} ${comps.length?'':'is-empty'}"><button type="button" class="category-button" onclick="toggleCompetitionCategory('${escapeAttr(cat.key)}')"><span class="category-icon">${cat.icon}</span><span class="category-name">${escapeHTML(cat.label)}</span><span class="category-arrow">⌄</span></button><div class="category-menu" data-category-menu="${escapeAttr(cat.key)}"><div class="category-menu-title"><span>${cat.icon}</span><strong>${escapeHTML(cat.label)}</strong></div>${items}</div></div>`; }).join(''); }
function getCompetitionCategories(){ return [{key:'england',label:'England',icon:'🏴󠁧󠁢󠁥󠁮󠁧󠁿'},{key:'italy',label:'Italy',icon:'🇮🇹'},{key:'spain',label:'Spain',icon:'🇪🇸'},{key:'germany',label:'Germany',icon:'🇩🇪'},{key:'france',label:'France',icon:'🇫🇷'},{key:'europe',label:'Europe',icon:'🇪🇺'},{key:'world',label:'World',icon:'🌍'},{key:'national-teams',label:'National Teams',icon:'🏆'}]; }
function getUniqueCompetitionsForCategory(key){ const map=new Map(); (appData.competitions||[]).filter(c=>getCompetitionCategoryKey(c)===key).forEach(c=>{ const k=`${key}|${normaliseCompetitionName(c['Competition Name'])}`; if(!map.has(k)||compareSeasonsDesc(c.Year,map.get(k).Year)<0) map.set(k,c); }); return Array.from(map.values()).sort((a,b)=>getCompetitionPriority(key,a)-getCompetitionPriority(key,b)||String(a['Competition Name']||'').localeCompare(String(b['Competition Name']||''))); }
function getLatestSeasonForCompetition(comp){ const key=getCompetitionCategoryKey(comp), name=normaliseCompetitionName(comp['Competition Name']); return (appData.competitions||[]).filter(c=>getCompetitionCategoryKey(c)===key&&normaliseCompetitionName(c['Competition Name'])===name).sort((a,b)=>compareSeasonsDesc(a.Year,b.Year))[0]||comp; }
function toggleCompetitionCategory(key){ const nav=$('competitionCategoryNav'); if(!nav) return; const menu=nav.querySelector(`[data-category-menu="${key}"]`); nav.querySelectorAll('.category-menu').forEach(m=>{ if(m!==menu)m.classList.remove('open'); }); menu?.classList.toggle('open'); }
window.toggleCompetitionCategory=toggleCompetitionCategory;
async function selectCompetitionFromCategory(slug){ $('competitionCategoryNav')?.querySelectorAll('.category-menu').forEach(m=>m.classList.remove('open')); resetFilters(); updateUrlCompetition(slug); await loadCompetition(slug); setActiveTab('nextUp'); window.scrollTo({top:0,behavior:'smooth'}); }
window.selectCompetitionFromCategory=selectCompetitionFromCategory;
async function goHomePage(){ $('competitionCategoryNav')?.querySelectorAll('.category-menu').forEach(m=>m.classList.remove('open')); resetFilters(); updateUrlCompetition(''); await loadCompetition(''); window.scrollTo({top:0,behavior:'smooth'}); }
window.goHomePage=goHomePage;
function resetFilters(){ currentSearch=''; currentGroup=''; currentRound=''; if($('searchInput')) $('searchInput').value=''; if($('groupFilter')) $('groupFilter').value=''; if($('roundFilter')) $('roundFilter').value=''; }
function jumpToSection(section){ if(section==='myGames'&&isHomePage()){ currentHomeTab='myGames'; renderHomeTab(); $('homeSection')?.scrollIntoView({behavior:'smooth',block:'start'}); return; } if(isHomePage()){ currentHomeTab='allGames'; renderHomeTab(); window.scrollTo({top:0,behavior:'smooth'}); return; } const map={home:'homeSection',nextUp:'nextUpSection',myGames:'homeSection',results:'resultsSection',fixtures:'fixturesSection',standings:'standingsSection',stats:'statsSection'}; $(map[section]||section)?.scrollIntoView({behavior:'smooth',block:'start'}); }
function setActiveTab(view){ document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); }
function updateUrlCompetition(slug){ const url=new URL(window.location.href); if(!slug||slug==='home') url.searchParams.delete('competition'); else url.searchParams.set('competition',slug); window.history.replaceState({},'',url.toString()); }
function getCompetitionCategoryKey(comp){ const region=normaliseRegion(comp.Region); if(['england','italy','spain','germany','france','europe','world'].includes(region)) return region; if(['national teams','national-teams','international','africa','south america','north america','asia'].includes(region)) return 'national-teams'; const c=String(comp.Competition||comp.CompetitionLabel||comp['Competition Name']||'').toLowerCase(); if(c.includes('premier league')||c.includes('fa cup')||c.includes('carabao')||c.includes('community shield'))return'england'; if(c.includes('serie a')||c.includes('coppa')||c.includes('supercoppa'))return'italy'; if(c.includes('la liga')||c.includes('copa del rey')||c.includes('supercopa'))return'spain'; if(c.includes('bundesliga')||c.includes('dfb')||c.includes('dfl'))return'germany'; if(c.includes('ligue 1')||c.includes('trophee')||c.includes('trophée')||c.includes('coupe de france'))return'france'; if(c.includes('champions league')||c.includes('europa league')||c.includes('conference league')||c.includes('uefa super cup'))return'europe'; if(c.includes('world cup')||c.includes('afcon')||c.includes('euro')||c.includes('copa america'))return'national-teams'; return'world'; }
function getCompetitionPriority(key,comp){ const n=String(comp['Competition Name']||comp.Competition||'').toLowerCase(); const map={england:['premier league','fa cup','carabao cup','community shield','championship'],italy:['serie a','coppa italia','italian super cup','supercoppa'],spain:['la liga','copa del rey','supercopa'],germany:['bundesliga','dfb-pokal','dfl-supercup'],france:['ligue 1','coupe de france','trophee des champions'],europe:['champions league','europa league','conference league','uefa super cup'],world:['world cup','club world cup','intercontinental cup'],'national-teams':['world cup','euro','nations league','afcon','copa america','asian cup','gold cup']}; const list=map[key]||[]; for(let i=0;i<list.length;i++) if(n.includes(list[i])) return i; return 999; }
function compareHomeMatches(a,b){ return timeSortValue(normaliseKickoffTime(a.Time))-timeSortValue(normaliseKickoffTime(b.Time))||compareCompetitionPriority(a,b)||String(a.HomeTeam||'').localeCompare(String(b.HomeTeam||'')); }
function compareCompetitionPriority(a,b){ const order=['england','italy','spain','germany','france','europe','world','national-teams']; const ak=getCompetitionCategoryKey(a), bk=getCompetitionCategoryKey(b); return (order.indexOf(ak)===-1?999:order.indexOf(ak))-(order.indexOf(bk)===-1?999:order.indexOf(bk))||getCompetitionPriority(ak,{'Competition Name':a.Competition||a.CompetitionLabel||''})-getCompetitionPriority(bk,{'Competition Name':b.Competition||b.CompetitionLabel||''}); }
function compareCompetitionNamePriority(a,b,grouped){ return compareCompetitionPriority(grouped[a][0]||{},grouped[b][0]||{})||a.localeCompare(b); }
function compareCompetitionNamePriorityFromName(groupName,a,b){ const key={England:'england',Italy:'italy',Spain:'spain',Germany:'germany',France:'france',Europe:'europe',World:'world','National Teams':'national-teams'}[groupName]||'world'; return getCompetitionPriority(key,{'Competition Name':a})-getCompetitionPriority(key,{'Competition Name':b})||a.localeCompare(b); }
/*
  My Games ordering ONLY (Global Games keeps using compareCompetitionPriority
  and is untouched by any of this).

  Priority is: Cups before Leagues, then within each of those,
  France > Germany > Spain > Italy > England (Europe / World /
  National Teams competitions - which are neither a domestic cup nor
  one of the 5 domestic leagues - are kept after England, in their
  existing relative order, since that case wasn't specified).
*/
const MY_GAMES_COUNTRY_ORDER = ['france','germany','spain','italy','england','europe','world','national-teams'];
const MY_GAMES_LEAGUE_NAME_KEYWORDS = ['premier league','serie a','la liga','bundesliga','ligue 1','championship'];
const MY_GAMES_CUP_NAME_KEYWORDS = ['cup','coppa','copa','pokal','coupe','trophee','trophée','shield','supercoppa','supercopa','supercup','super cup'];

function isCupCompetition(m){
  const name = String(m.Competition||m.CompetitionLabel||'').toLowerCase();
  if(MY_GAMES_LEAGUE_NAME_KEYWORDS.some(k=>name.includes(k))) return false;
  return MY_GAMES_CUP_NAME_KEYWORDS.some(k=>name.includes(k));
}

function getMyGamesGroupLabel(m){ return ({england:'England',italy:'Italy',spain:'Spain',germany:'Germany',france:'France',europe:'Europe',world:'World','national-teams':'National Teams'}[getCompetitionCategoryKey(m)]||'World'); }

function compareMyGamesMatches(a,b){
  const aCup = isCupCompetition(a) ? 0 : 1;
  const bCup = isCupCompetition(b) ? 0 : 1;
  if(aCup !== bCup) return aCup - bCup;

  const ak = getCompetitionCategoryKey(a), bk = getCompetitionCategoryKey(b);
  const ai = MY_GAMES_COUNTRY_ORDER.indexOf(ak), bi = MY_GAMES_COUNTRY_ORDER.indexOf(bk);
  const aIdx = ai===-1?999:ai, bIdx = bi===-1?999:bi;
  if(aIdx !== bIdx) return aIdx - bIdx;

  return matchDateSortValue(a)-matchDateSortValue(b) || String(a.HomeTeam||'').localeCompare(String(b.HomeTeam||''));
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
