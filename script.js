const API_URL = 'https://script.google.com/macros/s/AKfycbyFU-9M16UBls1YvTZfXxCDGLFBT2CL1qvTH7S_pmdHCD6kSeQpHQlQW_gg6r5vhfjOZA/exec';

let appData = null;
let playerImageLookup = new Map();
let playerTeamsLookup = new Map();
const competitionDetailCache = new Map();
let playerProfileHomeIndexPromise = null;
let currentCompetition = new URLSearchParams(window.location.search).get('competition') || '';
let currentSearch = '';
let currentGroup = '';
let currentRound = '';
let selectedDateKey = '';
let currentHomeTab = 'allGames';
let homeRefreshInFlight = false;
let competitionRefreshInFlight = false;
let homeCompetitionRefreshCursor = 0;
let myGamesDailyTimer = null;
const HOME_REFRESH_INTERVAL_MS = 12000;
const HOME_REFRESH_BATCH_SIZE = 6;
const RESULT_CHRONOLOGY_STORAGE_KEY = 'calcium.resultChronology.v1';
const MY_GAMES_PLANNER_STORAGE_KEY = 'calcium.myGamesPlanner.v2';
let expandedStats = { topScorers:false, topAssists:false, cleanSheets:false, yellowCards:false, redCards:false };
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

async function init(){
  setLoadingState();
  bindEvents();
  try{
    await loadCompetition(currentCompetition);
    if(isHomePage()){
      window.setInterval(refreshHomeLiveData,HOME_REFRESH_INTERVAL_MS);
      scheduleMyGamesDailyRedistribution();
    }else{
      window.setInterval(refreshCompetitionLiveData,HOME_REFRESH_INTERVAL_MS);
    }
  }
  catch(error){ console.error(error); showError('Could not load competition data. Please check the Apps Script backend.'); }
}

async function loadCompetition(competitionParam){
  const url = competitionParam ? `${API_URL}?competition=${encodeURIComponent(competitionParam)}&v=${Date.now()}` : `${API_URL}?mode=home&v=${Date.now()}`;
  const response = await fetch(url, { cache:'no-store' });
  if(!response.ok) throw new Error(`Backend error: ${response.status}`);
  appData = await response.json();
  if(appData.error) throw new Error(appData.error);
  await hydrateFixturesFromSheet(appData);
  playerProfileHomeIndexPromise = null;
  playerImageLookup = buildPlayerImageLookup(appData.players);
  playerTeamsLookup = buildPlayerTeamsLookup(appData.playerTeams);
  await repairMalformedStandingsFromSheet(appData);
  await hydrateExternalCleanSheetLeaders(appData);
  const selected = appData.selectedCompetition || appData.site || {};
  currentCompetition = makeCompetitionSlug(selected);
  if(!selectedDateKey) selectedDateKey = dateToKey(getMonday(new Date()));
  expandedStats = { topScorers:false, topAssists:false, cleanSheets:false, yellowCards:false, redCards:false };
  populateCompetitionDropdowns();
  populateFilters();
  renderAll();
  if(isHomePage()) refreshHomeLiveData();
}

function bindEvents(){
  $('seasonSelect')?.addEventListener('change', async e => { resetFilters(); updateUrlCompetition(e.target.value); await loadCompetition(e.target.value); });
  $('jumpSelect')?.addEventListener('change', e => jumpToSection(e.target.value));
  $('searchInput')?.addEventListener('input', e => { currentSearch = e.target.value.toLowerCase().trim(); renderAll(); });
  $('groupFilter')?.addEventListener('change', e => { currentGroup = e.target.value; renderAll(); });
  $('roundFilter')?.addEventListener('change', e => { currentRound = e.target.value; renderAll(); });
  $('clearFilters')?.addEventListener('click', () => { resetFilters(); renderAll(); });
  $('backToTop')?.addEventListener('click', () => window.scrollTo({top:0,behavior:'smooth'}));
  document.addEventListener('click', event => {
    if(event.target.closest('[data-view]')){ const view = event.target.closest('[data-view]').dataset.view; setActiveTab(view); jumpToSection(view); }
    if(event.target.closest('[data-home-tab]')){ currentHomeTab = event.target.closest('[data-home-tab]').dataset.homeTab || 'allGames'; renderHomeTab(); }
    const nav = $('competitionCategoryNav'); if(nav && !nav.contains(event.target)) nav.querySelectorAll('.category-menu').forEach(menu=>menu.classList.remove('open'));
  });
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden){
      refreshMyGamesDailyPlanIfNeeded();
      refreshHomeLiveData();
    }
  });
  window.addEventListener('focus', () => {
    refreshMyGamesDailyPlanIfNeeded();
    refreshHomeLiveData();
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
async function repairMalformedStandingsFromSheet(data){
  if(!hasShiftedLeagueStandings(data?.standings)) return;
  const sheetId=String(data?.selectedCompetition?.['Sheet ID']||'').trim();
  if(!sheetId) return;
  try{
    const table=await loadGoogleVisualizationTable(sheetId,'Standings');
    const recovered=parseStandingsTable(table,data);
    if(recovered.length) data.standings=recovered;
  } catch(error){
    console.warn('Could not recover standings directly from the Standings sheet.',error);
  }
}
async function hydrateExternalCleanSheetLeaders(data){
  const sheetId=String(data?.selectedCompetition?.['Sheet ID']||'').trim();
  if(!sheetId) return;
  try{
    const table=await loadGoogleVisualizationTable(sheetId,'Clean Sheets');
    const leaders=parseCleanSheetLeadersTable(table);
    const stats=Array.isArray(data.stats)?data.stats.map(row=>({...row,CleanSheets:0})):[];
    const playerRows=new Map(stats.map(row=>[normalisePlayerName(row?.Player),row]).filter(([key])=>key));
    leaders.forEach(leader=>{
      const key=normalisePlayerName(leader.Player);
      if(!key) return;
      let row=playerRows.get(key);
      if(!row){
        row={Player:leader.Player,Team:leader.Team,Logo:'',Goals:0,Assists:0,CleanSheets:0,YellowCards:0,RedCards:0};
        stats.push(row);
        playerRows.set(key,row);
      }
      row.Player=leader.Player||row.Player;
      row.Team=leader.Team||row.Team;
      row.Logo=findTeamLogoForStats(data,row.Team)||row.Logo||'';
      row.CleanSheets=safeNumber(leader.CleanSheets);
    });
    data.stats=stats;
  } catch(error){
    console.info('Using legacy match-level clean sheets for this competition.',error);
  }
}
function parseCleanSheetLeadersTable(table){
  const labels=(table?.cols||[]).map(col=>normaliseCleanSheetHeader(col?.label));
  if(!labels.includes('player')||!labels.includes('cleanSheets')) return [];
  return (table?.rows||[]).map(row=>{
    const values={};
    labels.forEach((label,index)=>{ if(label) values[label]=row?.c?.[index]?.v??''; });
    return {
      Rank:safeNumber(values.rank),
      Player:String(values.player||'').trim(),
      Team:String(values.team||'').trim(),
      CleanSheets:safeNumber(values.cleanSheets)
    };
  }).filter(row=>row.Player&&row.CleanSheets>0);
}
function normaliseCleanSheetHeader(value){
  const key=String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  return ({rank:'rank',player:'player',name:'player',team:'team',club:'team',cleansheet:'cleanSheets',cleansheets:'cleanSheets'})[key]||'';
}
function findTeamLogoForStats(data,teamName){
  const key=normaliseTeamName(teamName);
  if(!key) return '';
  const stat=(data?.stats||[]).find(row=>normaliseTeamName(row?.Team)===key&&row?.Logo);
  if(stat) return stat.Logo;
  const standing=(data?.standings||[]).find(row=>normaliseTeamName(row?.Team)===key&&row?.Logo);
  if(standing) return standing.Logo;
  const match=(data?.matches||[]).find(row=>
    (normaliseTeamName(row?.HomeTeam)===key&&row?.HomeLogo)||
    (normaliseTeamName(row?.AwayTeam)===key&&row?.AwayLogo)
  );
  if(!match) return '';
  return normaliseTeamName(match.HomeTeam)===key?match.HomeLogo:match.AwayLogo;
}
function hasShiftedLeagueStandings(rows){
  if(!Array.isArray(rows)||rows.length<2||rows.some(row=>String(row?.League||'').trim())) return false;
  const shifted=rows.filter(row=>/^[A-D]$/i.test(String(row?.Team||'').trim())&&/^(?:group\s*)?[A-D]$/i.test(String(row?.Group||'').trim())).length;
  return shifted/rows.length>=0.75;
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
function parseStandingsTable(table,data){
  const labels=(table?.cols||[]).map(col=>normaliseStandingHeader(col?.label));
  if(!labels.includes('team')) return [];
  const selected=data?.selectedCompetition||{};
  const competition=selected['Competition Name']||data?.site?.competition||'';
  const year=selected.Year||data?.site?.year||'';
  const region=selected.Region||data?.site?.region||'';
  const competitionType=selected['Competition Type']||data?.competitionType||data?.site?.competitionType||'';
  return (table?.rows||[]).map(row=>{
    const values={};
    labels.forEach((label,index)=>{ if(label) values[label]=row?.c?.[index]?.v??''; });
    return {
      Competition:competition, Year:year, Region:region, CompetitionType:competitionType,
      League:values.league||'', Group:values.group||'', Team:values.team||'', Logo:values.logo||'',
      Points:safeNumber(values.points), Played:safeNumber(values.played), Won:safeNumber(values.won),
      Drawn:safeNumber(values.drawn), Lost:safeNumber(values.lost), GoalsFor:safeNumber(values.goalsFor),
      GoalsAgainst:safeNumber(values.goalsAgainst), GoalDifference:safeNumber(values.goalDifference)
    };
  }).filter(row=>String(row.Team).trim());
}
function normaliseStandingHeader(value){
  const key=String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  return ({league:'league',group:'group',team:'team',logo:'logo',logourl:'logo',pt:'points',points:'points',gw:'played',played:'played',w:'won',won:'won',d:'drawn',drawn:'drawn',l:'lost',lost:'lost',gf:'goalsFor',goalsfor:'goalsFor',ga:'goalsAgainst',goalsagainst:'goalsAgainst',gd:'goalDifference',goaldifference:'goalDifference'})[key]||'';
}
function formatStandingLeague(league){ const value=String(league||'').trim(); return !value ? '' : /^league\s/i.test(value) ? value : `League ${value}`; }
function formatStandingGroup(group){ const value=String(group||'').trim(); return !value ? '' : /^group\s/i.test(value) ? value : `Group ${value}`; }
function getStandingGroupKey(row){ const league=formatStandingLeague(row?.League); const group=formatStandingGroup(row?.Group); return [league,group].filter(Boolean).join(' · ') || 'Table'; }
function populateGroupDropdown(){ const select=$('groupFilter'); if(!select) return; const groups=[...new Set((appData.standings||[]).map(getStandingGroupKey).filter(Boolean))]; select.innerHTML=`<option value="">All groups/tables</option>${groups.map(g=>`<option value="${escapeAttr(g)}">${escapeHTML(g)}</option>`).join('')}`; if(currentGroup&&groups.includes(currentGroup)) select.value=currentGroup; }
function populateRoundDropdown(){ const select=$('roundFilter'); if(!select) return; const rounds=[...new Set(getCompetitionMatches().map(m=>String(m.Round||'').trim()).filter(Boolean))].sort((a,b)=>roundSortValue(a)-roundSortValue(b)); select.innerHTML=`<option value="">All rounds</option>${rounds.map(r=>`<option value="${escapeAttr(r)}">${escapeHTML(formatRoundLabel(r))}</option>`).join('')}`; if(currentRound&&rounds.includes(currentRound)) select.value=currentRound; else currentRound=''; }
function renderDateTabs(){
  const container = $('dateTabs');
  if(!container) return;

  const thisWeek = getMonday(new Date());
  const lastWeek = addDays(thisWeek,-7);
  const nextWeek = addDays(thisWeek,7);

  const dates = [
    {key:dateToKey(lastWeek),dayLabel:'Last week',shortDate:getWeekRangeLabel(lastWeek)},
    {key:dateToKey(thisWeek),dayLabel:'This week',shortDate:getWeekRangeLabel(thisWeek)},
    {key:dateToKey(nextWeek),dayLabel:'Next week',shortDate:getWeekRangeLabel(nextWeek)}
  ];

  const buttons = dates.map(item=>`
    <button type="button" class="${item.key===selectedDateKey?'active':''}" onclick="selectDateTab('${escapeAttr(item.key)}')">
      <span>${escapeHTML(item.dayLabel)}</span>
      <strong>${escapeHTML(item.shortDate)}</strong>
    </button>
  `).join('');

  const customActive = dates.some(item=>item.key===selectedDateKey) ? '' : 'active';
  const picked = selectedDateKey || getTodayKey();

  container.innerHTML = `
    ${buttons}
    <div class="date-picker-button ${customActive}" id="datePickerButton">
      <span>📅</span>
      <span>Pick a date</span>
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
  homeCompetitionRefreshCursor = 0;
  refreshHomeLiveData();
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
  homeCompetitionRefreshCursor = 0;
  refreshHomeLiveData();
}
window.pickHomeDate = pickHomeDate;

function renderHomeGames(){
  const selected=parseDateOnly(selectedDateKey)||new Date();
  const weekStart=getMonday(selected), weekEnd=addDays(weekStart,6);
  const matches=getGlobalMatches().filter(match=>{
    const date=parseDateOnly(match.Date);
    return date&&date>=weekStart&&date<=weekEnd;
  }).sort(compareHomeMatches);
  setText('homeMatchCount', matches.length); setText('homeAllGamesTitle', `All games (${matches.length})`);
  const plan=buildHomeWeeklyPlan(matches,weekStart);
  setHTML('homeGamesList',`<div class="home-week-planner">${plan.map(renderHomeWeekDay).join('')}</div>`);
}
function buildHomeWeeklyPlan(matches,weekStart){
  const names=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const days=Array.from({length:7},(_,index)=>{
    const date=addDays(weekStart,index);
    return {date,key:dateToKey(date),name:names[index],matches:[]};
  });
  const dayLookup=new Map(days.map(day=>[day.key,day]));
  matches.forEach(match=>dayLookup.get(getDateKey(match.Date))?.matches.push(match));
  days.forEach(day=>day.matches.sort(compareHomeMatches));
  return days;
}
function renderHomeWeekDay(day){
  const isToday=day.key===getTodayKey();
  const count=day.matches.length;
  const rows=count?renderHomeDayMatches(day.matches):'<div class="empty my-games-day-empty">No games scheduled.</div>';
  return `<section class="my-games-day-card ${isToday?'is-today':''}">
    <div class="my-games-day-head">
      <div><span class="my-games-day-name">${escapeHTML(day.name)}</span><strong>${escapeHTML(formatMyGamesDate(day.date))}</strong></div>
      <div class="my-games-day-counts">
        ${isToday?'<span class="my-games-today-pill">Today</span>':''}
        <span>${count} ${count===1?'game':'games'}</span>
      </div>
    </div>
    <div class="home-week-day-list">${rows}</div>
  </section>`;
}
function renderHomeDayMatches(matches){
  const timeGroups=groupBy(matches, m=>normaliseKickoffTime(m.Time));
  return Object.keys(timeGroups).sort((a,b)=>timeSortValue(a)-timeSortValue(b)).map(time=>{
    const competitionGroups=groupBy(timeGroups[time].sort(compareHomeMatches), m=>m.CompetitionLabel || m.Competition || 'Competition');
    return `<section class="home-time-block"><div class="home-time-heading">${escapeHTML(time||'Scheduled')}</div>${Object.keys(competitionGroups).sort((a,b)=>compareCompetitionNamePriority(a,b,competitionGroups)).map(name=>`<section class="home-competition-block"><div class="home-competition-mini-title"><span>${escapeHTML(getRegionForCompetition(competitionGroups[name][0]))}</span><strong>${escapeHTML(name)}</strong></div>${competitionGroups[name].map(renderHomeMatchRow).join('')}</section>`).join('')}</section>`;
  }).join('');
}
function renderHomeMatchRow(match){ const score=match.Status==='FT'?renderScoreText(match):'VS'; const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:''; return `<article class="home-match-row" ${click}><div class="score-team-home-name">${escapeHTML(match.HomeTeam)}</div><div class="score-team-home-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="home-match-score">${score}</div><div class="score-team-away-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="score-team-away-name">${escapeHTML(match.AwayTeam)}</div></article>`; }
function renderHomeTab(){ const allPanel=$('allGamesPanel'), myPanel=$('myGamesPanel'), jump=$('jumpSelect'); document.querySelectorAll('[data-home-tab]').forEach(b=>b.classList.toggle('active',b.dataset.homeTab===currentHomeTab)); allPanel?.classList.toggle('hidden',currentHomeTab!=='allGames'); myPanel?.classList.toggle('hidden',currentHomeTab!=='myGames'); if(jump&&isHomePage()) jump.value=currentHomeTab==='myGames'?'myGames':'nextUp'; }

function getMyGamesGameweekKey(match){
  const round=normaliseText(match?.Round||'');
  const gameweek=round.match(/(?:game\s*week|gw)\s*(\d+)/);
  if(!gameweek) return '';

  const competition=normaliseText(
    match?.CompetitionSlug||
    match?.Competition||
    match?.CompetitionLabel||
    match?.['Competition Name']||
    ''
  );
  if(!competition) return '';

  const season=normaliseText(match?.Year||match?.Season||'');
  return [competition,season,gameweek[1]].join('|');
}

function getMyGamesAssignedWeekStart(match,matches){
  const date=parseDateOnly(match?.Date);
  if(!date) return null;

  const calendarWeekStart=getMonday(date);
  if(date.getDay()!==1) return calendarWeekStart;

  const gameweekKey=getMyGamesGameweekKey(match);
  if(!gameweekKey) return calendarWeekStart;

  const previousWeekStart=addDays(calendarWeekStart,-7);
  const previousWeekEnd=addDays(calendarWeekStart,-1);
  const belongsToPreviousWeek=(matches||[]).some(other=>{
    if(other===match||getMyGamesGameweekKey(other)!==gameweekKey) return false;
    const otherDate=parseDateOnly(other?.Date);
    return otherDate&&otherDate>=previousWeekStart&&otherDate<=previousWeekEnd;
  });

  return belongsToPreviousWeek?previousWeekStart:calendarWeekStart;
}

function isMatchInMyGamesWeek(match,matches,weekStart){
  const assignedWeekStart=getMyGamesAssignedWeekStart(match,matches);
  return assignedWeekStart&&dateToKey(assignedWeekStart)===dateToKey(weekStart);
}

function getMyGamesCanonicalFixtureKey_(match){
  const date=getDateKey(match?.Date);
  const home=normaliseTeamName(match?.HomeTeam);
  const away=normaliseTeamName(match?.AwayTeam);
  return date&&home&&away?[date,home,away].join('|'):'';
}

function enrichMyGamesWithCanonicalFixtures_(matches,fixtures){
  const canonicalById=new Map();
  const canonicalByFixture=new Map();

  (fixtures||[]).forEach(fixture=>{
    const id=String(fixture?.MatchID||fixture?.ID||'').trim();
    const key=getMyGamesCanonicalFixtureKey_(fixture);
    if(id) canonicalById.set(id,fixture);
    if(key) canonicalByFixture.set(key,fixture);
  });

  const canonicalFields=[
    'MatchID','ID','Date','Time','Round','CompetitionSlug','Competition',
    'CompetitionLabel','Competition Name','Year','Season','HomeTeam','AwayTeam',
    'HomeLogo','AwayLogo'
  ];

  return (matches||[]).map(match=>{
    const id=String(match?.MatchID||match?.ID||'').trim();
    const key=getMyGamesCanonicalFixtureKey_(match);
    const fixture=(id&&canonicalById.get(id))||(key&&canonicalByFixture.get(key));
    if(!fixture) return match;

    const enriched={...match};
    canonicalFields.forEach(field=>{
      const value=fixture[field];
      if(value===undefined||value===null) return;
      if(typeof value==='string'&&!value.trim()) return;
      enriched[field]=value;
    });
    return enriched;
  });
}

function renderMyGames(){
  const rawMyGames=Array.isArray(appData?.myGames)?appData.myGames:[];
  const canonicalFixtures=dedupeMatchArray(
    getGlobalMatches().concat(getCompetitionMatches())
  );
  const myGamesBase=enrichMyGamesWithCanonicalFixtures_(rawMyGames,canonicalFixtures);
  const unresolvedDatedFixtures=canonicalFixtures
    .filter(match=>getDateKey(match.Date)&&isUnresolvedFixtureSlot(match));
  const all=dedupeMatchArray(myGamesBase.concat(unresolvedDatedFixtures));

  const selected=parseDateOnly(selectedDateKey)||new Date();
  const weekStart=getMonday(selected);
  const weekMatches=all
    .filter(match=>isMatchInMyGamesWeek(match,all,weekStart))
    .sort(compareMyGamesChronology);

  setText('myGamesTitle',getSeasonWeekLabel(selected));
  setText('myGamesSubtitle',getWeekRangeLabel(selected));
  setText('myGamesCount',weekMatches.length);

  if(!weekMatches.length){
    setHTML('myGamesList','<div class="empty home-empty">No My Games found for this week.</div>');
    return;
  }

  const plan=buildMyGamesWeeklyPlan(weekMatches,weekStart);
  const playedCount=weekMatches.filter(isMyGamePlayed).length;
  const remainingCount=weekMatches.length-playedCount;

  const summary=`<section class="my-games-planner-summary">
    <div><strong>${weekMatches.length}</strong><span>Total games</span></div>
    <div><strong>${playedCount}</strong><span>Played</span></div>
    <div><strong>${remainingCount}</strong><span>Remaining</span></div>
  </section>`;

  setHTML('myGamesList',summary+`<div class="my-games-week-planner">${plan.map(renderMyGamesDay).join('')}</div>`);
}

function refreshHomeLiveData(){
  if(!isHomePage()||homeRefreshInFlight) return;
  homeRefreshInFlight=true;
  enrichHomeMyGamesFromCompetitionDetails()
    .then(updated=>{
      if(updated){
        renderHomeGames();
        renderMyGames();
        renderHomeTab();
      }
    })
    .catch(error=>console.warn('Could not refresh current Home/My Games results.',error))
    .finally(()=>{ homeRefreshInFlight=false; });
}

async function refreshCompetitionLiveData(){
  if(isHomePage()||competitionRefreshInFlight||!currentCompetition) return;
  competitionRefreshInFlight=true;
  try{
    const response=await fetch(
      `${API_URL}?competition=${encodeURIComponent(currentCompetition)}&v=${Date.now()}`,
      {cache:'no-store'}
    );
    if(!response.ok) throw new Error(`Backend error: ${response.status}`);
    const freshData=await response.json();
    if(freshData.error) throw new Error(freshData.error);
    await hydrateFixturesFromSheet(freshData);

    const previousSignature=getCompetitionLiveSignature(appData);
    const freshSignature=getCompetitionLiveSignature(freshData);
    if(previousSignature===freshSignature) return;

    appData=freshData;
    playerProfileHomeIndexPromise=null;
    playerImageLookup=buildPlayerImageLookup(appData.players);
    playerTeamsLookup=buildPlayerTeamsLookup(appData.playerTeams);
    await repairMalformedStandingsFromSheet(appData);
    await hydrateExternalCleanSheetLeaders(appData);
    populateCompetitionDropdowns();
    populateFilters();
    renderAll();
  }catch(error){
    console.warn('Could not refresh current competition results.',error);
  }finally{
    competitionRefreshInFlight=false;
  }
}

function getCompetitionLiveSignature(data){
  return JSON.stringify({
    matches:Array.isArray(data?.matches)?data.matches:[],
    playoffs:Array.isArray(data?.playoffs)?data.playoffs:[],
    standings:Array.isArray(data?.standings)?data.standings:[],
    stats:Array.isArray(data?.stats)?data.stats:[],
    assistLeaders:Array.isArray(data?.assistLeaders)?data.assistLeaders:[],
    cleanSheetLeaders:Array.isArray(data?.cleanSheetLeaders)?data.cleanSheetLeaders:[]
  });
}

function scheduleMyGamesDailyRedistribution(){
  if(myGamesDailyTimer) window.clearTimeout(myGamesDailyTimer);
  if(!isHomePage()) return;
  const now=new Date();
  const nextRun=new Date(now);
  nextRun.setDate(now.getDate()+1);
  nextRun.setHours(0,1,0,0);
  myGamesDailyTimer=window.setTimeout(()=>{
    advanceMyGamesSelectedWeek();
    renderAll();
    scheduleMyGamesDailyRedistribution();
  },Math.max(1000,nextRun.getTime()-now.getTime()));
}

function advanceMyGamesSelectedWeek(){
  const selected=parseDateOnly(selectedDateKey);
  if(!selected) return;
  const yesterday=addDays(new Date(),-1);
  if(dateToKey(getMonday(selected))===dateToKey(getMonday(yesterday))){
    selectedDateKey=dateToKey(getMonday(new Date()));
  }
}

function refreshMyGamesDailyPlanIfNeeded(){
  if(!isHomePage()||!appData) return;
  const selected=parseDateOnly(selectedDateKey);
  if(!selected) return;
  const weekKey=dateToKey(getMonday(selected));
  if(weekKey!==dateToKey(getMonday(new Date()))) return;
  const state=readMyGamesPlannerState();
  if(state[weekKey]?.planDate===getTodayKey()) return;
  advanceMyGamesSelectedWeek();
  renderAll();
}

function sameMatchIgnoringTime_(left,right){
  const leftId=String(left?.MatchID||left?.ID||'').trim();
  const rightId=String(right?.MatchID||right?.ID||'').trim();
  if(leftId&&rightId&&leftId===rightId) return true;
  return getDateKey(left?.Date)===getDateKey(right?.Date)
    &&normaliseTeamName(left?.HomeTeam)===normaliseTeamName(right?.HomeTeam)
    &&normaliseTeamName(left?.AwayTeam)===normaliseTeamName(right?.AwayTeam);
}

function mergeFreshMatchRecords_(current,fresh,options={}){
  const merged=[...(Array.isArray(current)?current:[])];
  (Array.isArray(fresh)?fresh:[]).forEach(next=>{
    const index=merged.findIndex(saved=>sameMatchIgnoringTime_(saved,next));
    if(index>=0){
      const saved=merged[index];
      const combined={...saved,...next};
      merged[index]=combined;
    }else if(options.addAll||(options.addUnresolved&&isUnresolvedFixtureSlot(next))){
      merged.push(next);
    }
  });
  return dedupeMatchArray(merged);
}

function enrichHomeMyGamesFromCompetitionDetails(){
  const baseMyGames=Array.isArray(appData?.myGames)?appData.myGames:[];
  const baseAllMatches=Array.isArray(appData?.allMatches)?appData.allMatches:[];
  const selected=parseDateOnly(selectedDateKey||getTodayKey())||new Date();
  const weekStart=getMonday(selected);
  const refreshSource=baseMyGames.concat(baseAllMatches);
  const weekly=refreshSource.filter(match=>
    isMatchInMyGamesWeek(match,refreshSource,weekStart)
  );
  const allSlugs=[...new Set(weekly.map(resolveMatchCompetitionSlug).filter(Boolean))];
  if(!allSlugs.length) return Promise.resolve(false);

  const batchSize=Math.min(HOME_REFRESH_BATCH_SIZE,allSlugs.length);
  const slugs=Array.from(
    {length:batchSize},
    (_,offset)=>allSlugs[(homeCompetitionRefreshCursor+offset)%allSlugs.length]
  );
  homeCompetitionRefreshCursor=(homeCompetitionRefreshCursor+batchSize)%allSlugs.length;

  return Promise.all(slugs.map(async slug=>{
    try{
      const response=await fetch(API_URL+'?competition='+encodeURIComponent(slug)+'&v='+Date.now(),{cache:'no-store'});
      if(!response.ok) return null;
      const detail=await response.json();
      if(!detail||detail.error) return null;
      competitionDetailCache.set(slug,detail);
      return detail;
    }catch(error){
      console.warn('Could not refresh competition '+slug+'.',error);
      return null;
    }
  })).then(details=>{
    const validDetails=details.filter(Boolean);
    const allFreshMatches=validDetails.flatMap(detail=>
      (Array.isArray(detail.matches)?detail.matches:[])
        .concat(Array.isArray(detail.playoffs)?detail.playoffs:[])
    );
    const refreshGroupingSource=refreshSource.concat(allFreshMatches);
    const freshWeekMatches=allFreshMatches.filter(match=>
      isMatchInMyGamesWeek(match,refreshGroupingSource,weekStart)
    );
    if(!freshWeekMatches.length) return false;

    validDetails.forEach(detail=>{
      appData.allEvents=mergeUniqueEvents(appData.allEvents,detail.allEvents||detail.events||[]);
    });
    appData.allMatches=mergeFreshMatchRecords_(baseAllMatches,freshWeekMatches,{
      addAll:true
    });
    appData.myGames=mergeFreshMatchRecords_(baseMyGames,freshWeekMatches,{
      addUnresolved:true
    });
    return true;
  });
}
function buildMyGamesWeeklyPlan(matches,weekStart){
  const names=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const days=Array.from({length:7},(_,index)=>({
    index,date:addDays(weekStart,index),key:dateToKey(addDays(weekStart,index)),
    name:names[index],completed:[],scheduled:[]
  }));
  const orderedMatches=[...matches].sort(compareMyGamesChronology);

  const capacities=getBalancedMyGamesCounts(orderedMatches.length,[0,1,2,3,4,5,6]);
  let cursor=0;
  const original=new Map();

  days.forEach((day,index)=>{
    for(let i=0;i<(capacities[index]||0)&&cursor<orderedMatches.length;i++,cursor++){
      original.set(getMyGameIdentity(orderedMatches[cursor]),index);
    }
  });

  const today=parseDateOnly(getTodayKey());
  const isCurrentWeek=today&&today>=weekStart&&today<=addDays(weekStart,6);
  const currentDayIndex=isCurrentWeek?Math.floor((today-weekStart)/86400000):-1;
  const completed=orderedMatches.filter(isMyGamePlayed);
  const remaining=orderedMatches.filter(match=>!isMyGamePlayed(match));
  const scheduleFingerprint=getMyGamesScheduleFingerprint(orderedMatches);

  if(isCurrentWeek){
    const plannerState=readMyGamesPlannerState();
    const weekKey=dateToKey(weekStart);
    const todayKey=getTodayKey();
    const savedWeek=plannerState[weekKey]&&typeof plannerState[weekKey]==='object'
      ?plannerState[weekKey]
      :null;
    const playedDays={...(savedWeek?.playedDays||{})};
    let scheduledDays={...(savedWeek?.scheduledDays||{})};
    const completedKeys=new Set(completed.map(getMyGamesPlannerMatchKey));

    Object.keys(playedDays).forEach(key=>{
      const index=Number(playedDays[key]);
      if(!completedKeys.has(key)||!Number.isInteger(index)||index<0||index>currentDayIndex){
        delete playedDays[key];
      }
    });

    const unassigned=completed.filter(match=>playedDays[getMyGamesPlannerMatchKey(match)]===undefined);

    if(!savedWeek){
      const elapsed=[];
      for(let index=0;index<currentDayIndex;index++) elapsed.push(index);
      if(!elapsed.length&&unassigned.length) elapsed.push(currentDayIndex);
      const counts=getBalancedMyGamesCounts(unassigned.length,elapsed);
      let completedCursor=0;
      elapsed.forEach(index=>{
        for(let i=0;i<(counts[index]||0)&&completedCursor<unassigned.length;i++,completedCursor++){
          playedDays[getMyGamesPlannerMatchKey(unassigned[completedCursor])]=index;
        }
      });
    }else{
      unassigned.forEach(match=>{
        const key=getMyGamesPlannerMatchKey(match);
        const previousScheduledIndex=Number(savedWeek.scheduledDays?.[key]);
        const wasScheduledBeforeToday=Number.isInteger(previousScheduledIndex)
          &&previousScheduledIndex>=0
          &&previousScheduledIndex<=currentDayIndex;
        playedDays[key]=wasScheduledBeforeToday
          ?previousScheduledIndex
          :(savedWeek.lastSeenDate===todayKey?currentDayIndex:Math.max(0,currentDayIndex-1));
      });
    }

    completed.forEach(match=>{
      const index=playedDays[getMyGamesPlannerMatchKey(match)];
      days[Number.isInteger(index)?index:Math.max(0,currentDayIndex-1)].completed.push(match);
    });

    const remainingKeys=new Set(remaining.map(getMyGamesPlannerMatchKey));
    Object.keys(scheduledDays).forEach(key=>{
      const index=Number(scheduledDays[key]);
      if(!remainingKeys.has(key)||!Number.isInteger(index)||index<currentDayIndex||index>6){
        delete scheduledDays[key];
      }
    });

    const active=[];
    for(let index=currentDayIndex;index<7;index++) active.push(index);

    const needsDailyRedistribution=!savedWeek
      ||savedWeek.planDate!==todayKey
      ||savedWeek.scheduleFingerprint!==scheduleFingerprint;
    if(needsDailyRedistribution){
      scheduledDays={};
      const counts=getBalancedMyGamesCounts(remaining.length,active);
      let remainingCursor=0;
      active.forEach(index=>{
        for(let i=0;i<(counts[index]||0)&&remainingCursor<remaining.length;i++,remainingCursor++){
          scheduledDays[getMyGamesPlannerMatchKey(remaining[remainingCursor])]=index;
        }
      });
    }else{
      const loads={};
      active.forEach(index=>loads[index]=0);
      Object.values(scheduledDays).forEach(value=>{
        const index=Number(value);
        if(loads[index]!==undefined) loads[index]++;
      });
      const targetCounts=getBalancedMyGamesCounts(remaining.length,active);
      remaining
        .filter(match=>scheduledDays[getMyGamesPlannerMatchKey(match)]===undefined)
        .forEach(match=>{
          const target=active.find(index=>loads[index]<(targetCounts[index]||0))
            ??active.slice().sort((a,b)=>loads[a]-loads[b]||a-b)[0]
            ??currentDayIndex;
          scheduledDays[getMyGamesPlannerMatchKey(match)]=target;
          loads[target]=(loads[target]||0)+1;
        });
    }

    remaining.forEach(match=>{
      const index=Number(scheduledDays[getMyGamesPlannerMatchKey(match)]);
      days[Number.isInteger(index)&&index>=currentDayIndex&&index<=6?index:currentDayIndex].scheduled.push(match);
    });

    plannerState[weekKey]={
      planDate:todayKey,
      lastSeenDate:todayKey,
      scheduleFingerprint,
      playedDays,
      scheduledDays
    };
    writeMyGamesPlannerState(plannerState);
  }else{
    orderedMatches.forEach(match=>{
      const originalIndex=original.get(getMyGameIdentity(match))??0;
      if(isMyGamePlayed(match)) days[originalIndex].completed.push(match);
      else days[originalIndex].scheduled.push(match);
    });
  }

  days.forEach(day=>{
    day.completed.sort(compareMyGamesChronology);
    day.scheduled.sort(compareMyGamesChronology);
  });
  return days;
}

function getMyGamesScheduleFingerprint(matches){
  return [...(Array.isArray(matches)?matches:[])]
    .map(match=>[
      getMyGamesPlannerMatchKey(match),
      getDateKey(match?.Date),
      normaliseKickoffTime(match?.Time),
      normaliseText(match?.Round||'')
    ].join('|'))
    .sort()
    .join('||');
}

function getMyGamesPlannerMatchKey(match){
  const stableId=String(match?.MatchID||match?.ID||'').trim();
  return stableId?`id:${stableId}`:`match:${getMyGameIdentity(match)}`;
}

function readMyGamesPlannerState(){
  try{
    const saved=JSON.parse(window.localStorage.getItem(MY_GAMES_PLANNER_STORAGE_KEY)||'{}');
    return saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};
  }catch(error){
    return {};
  }
}

function writeMyGamesPlannerState(state){
  try{
    window.localStorage.setItem(MY_GAMES_PLANNER_STORAGE_KEY,JSON.stringify(state));
  }catch(error){}
}

function getBalancedMyGamesCounts(total,dayIndices){
  const counts={};
  if(!dayIndices.length) return counts;
  const base=Math.floor(total/dayIndices.length), remainder=total%dayIndices.length;
  dayIndices.forEach(index=>counts[index]=base);
  // Extra games follow: Friday, Sunday, Monday, Thursday,
  // Tuesday, Wednesday, Saturday.
  const extraPriority=[4,6,0,3,1,2,5];
  const extraOrder=extraPriority.filter(index=>dayIndices.includes(index));
  for(let i=0;i<remainder;i++) counts[extraOrder[i]]=(counts[extraOrder[i]]||0)+1;
  return counts;
}

function renderMyGamesDay(day){
  const isToday=day.key===getTodayKey();
  const rows=day.completed.map(m=>renderMyGamesPlannerRow(m,true)).join('')
    +day.scheduled.map(m=>renderMyGamesPlannerRow(m,false)).join('');
  return `<section class="my-games-day-card ${isToday?'is-today':''}">
    <div class="my-games-day-head">
      <div><span class="my-games-day-name">${escapeHTML(day.name)}</span><strong>${escapeHTML(formatMyGamesDate(day.date))}</strong></div>
      <div class="my-games-day-counts">
        ${isToday?'<span class="my-games-today-pill">Today</span>':''}
        <span>${day.scheduled.length} to play</span>
        ${day.completed.length?`<span>${day.completed.length} played</span>`:''}
      </div>
    </div>
    <div class="my-games-day-list">${rows||'<div class="empty my-games-day-empty">No games assigned.</div>'}</div>
  </section>`;
}

function renderMyGamesPlannerRow(match,played){
  const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:'';
  const competition=String(match.Competition||match.CompetitionLabel||'Competition');
  const region=getMyGamesGroupLabel(match);
  const score=played?renderScoreText(match):'VS';
  const homeLabel=getMyGamesDisplayTeam(match.HomeTeam);
  const awayLabel=getMyGamesDisplayTeam(match.AwayTeam);
  const homeUnresolved=isUnresolvedTeamLabel(match.HomeTeam);
  const awayUnresolved=isUnresolvedTeamLabel(match.AwayTeam);

  return `<article class="my-games-planner-row ${played?'is-played':''} ${(homeUnresolved||awayUnresolved)?'is-unresolved':''}" ${click}>
    <div class="my-games-planner-meta"><span>${escapeHTML(region)}</span><strong>${escapeHTML(competition)}</strong></div>
    <div class="my-games-planner-match">
      <div class="my-games-team-name home">${escapeHTML(homeLabel)}</div>
      <div class="my-games-logo">${homeUnresolved?'<span class="team-logo team-logo-empty my-games-tbd-logo">?</span>':renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div>
      <div class="my-games-score">${score}</div>
      <div class="my-games-logo">${awayUnresolved?'<span class="team-logo team-logo-empty my-games-tbd-logo">?</span>':renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div>
      <div class="my-games-team-name away">${escapeHTML(awayLabel)}</div>
    </div>
    <div class="my-games-planner-status">${played?'Played':(homeUnresolved||awayUnresolved)?'Pending teams':'To play'}</div>
  </article>`;
}

function isUnresolvedFixtureSlot(match){
  return isUnresolvedTeamLabel(match?.HomeTeam)||isUnresolvedTeamLabel(match?.AwayTeam);
}
function isUnresolvedTeamLabel(value){
  const text=String(value||'').trim();
  if(!text) return true;
  const lower=normaliseText(text);
  return lower==='tbd'||lower==='tbc'||lower==='to be decided'||lower==='to be confirmed'
    ||lower.includes('winner')||lower.includes('loser')||text.includes('/');
}
function getMyGamesDisplayTeam(value){
  const text=String(value||'').trim();
  if(!text) return 'TBD';
  if(text.includes('/')&&!/winner|loser/i.test(text)) return `Winner of ${text}`;
  return text;
}
function isMyGamePlayed(match){
  if(String(match?.Status||'').toUpperCase()==='FT') return true;
  const home=String(match?.HomeScore??'').trim(), away=String(match?.AwayScore??'').trim();
  return /^\d+$/.test(home)&&/^\d+$/.test(away);
}
function getMyGameIdentity(match){
  return [getDateKey(match.Date),String(match.Time||'').trim(),normaliseTeamName(match.HomeTeam),normaliseTeamName(match.AwayTeam),normaliseText(match.Competition||match.CompetitionLabel||'')].join('|');
}
function compareMyGamesChronology(a,b){
  return matchDateSortValue(a)-matchDateSortValue(b)
    ||getFixtureOrderValue(a)-getFixtureOrderValue(b)
    ||String(a.HomeTeam||'').localeCompare(String(b.HomeTeam||''))
    ||String(a.AwayTeam||'').localeCompare(String(b.AwayTeam||''));
}

function renderMyGamesRow(match){ const p=formatScoreboardDateParts(match.Date,match.Time); const score=match.Status==='FT'?renderScoreText(match):'VS'; const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:''; return `<article class="my-games-match" ${click}><div class="my-games-date"><span>${escapeHTML(p.date)}</span><span>${escapeHTML(p.time)}</span></div><div class="my-games-team-name home">${escapeHTML(match.HomeTeam)}</div><div class="my-games-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="my-games-score">${score}</div><div class="my-games-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="my-games-team-name away">${escapeHTML(match.AwayTeam)}</div><div class="my-games-status">${escapeHTML(match.Status||'Scheduled')}</div></article>`; }
function renderScoreboard(){ const matches=getFilteredMatches(); if(!matches.length){ setHTML('scoreboardList','<div class="empty">No matches found.</div>'); return; } const round=getNextUpRound(matches); if(!round){ setHTML('scoreboardList','<div class="empty">No matches found.</div>'); return; } const rows=matches.filter(m=>normaliseText(m.Round||'')===normaliseText(round)); const scheduled=rows.some(m=>m.Status!=='FT'); rows.sort((a,b)=>scheduled?matchDateSortValue(a)-matchDateSortValue(b):matchDateSortValue(b)-matchDateSortValue(a)); setHTML('scoreboardList',`${scheduled?'':'<div class="season-complete-note">Season completed. Showing the last round played.</div>'}<section class="round-block"><div class="round-heading">${escapeHTML(formatRoundLabel(round))}</div>${rows.map(renderScoreboardRow).join('')}</section>`); }
function renderScoreboardRow(match){ const p=formatScoreboardDateParts(match.Date,match.Time); const score=match.Status==='FT'?renderScoreText(match):'VS'; const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:''; return `<article class="scoreboard-row ${match.MatchID?'is-clickable':''}" ${click}><div class="scoreboard-date"><span class="scoreboard-date-main">${escapeHTML(p.date)}</span><span class="scoreboard-time-main">${escapeHTML(p.time)}</span></div><div class="score-team-home-name">${escapeHTML(match.HomeTeam)}</div><div class="score-team-home-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="scoreboard-score">${score}</div><div class="score-team-away-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="score-team-away-name">${escapeHTML(match.AwayTeam)}</div></article>`; }
function renderResults(){ const results=getFilteredMatches().filter(m=>m.Status==='FT').sort((a,b)=>matchDateSortValue(b)-matchDateSortValue(a)||getFixtureOrderValue(a)-getFixtureOrderValue(b)); setHTML('resultsList',results.length?renderGroupedScoreboard(results):'<div class="empty">No results found.</div>'); setText('resultsCount',`${results.length} matches`); }
function renderFixtures(){ const fixtures=getFilteredMatches().filter(m=>m.Status!=='FT').sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)||getFixtureOrderValue(a)-getFixtureOrderValue(b)); setHTML('fixturesList',fixtures.length?renderGroupedScoreboard(fixtures):'<div class="empty">No scheduled games found.</div>'); setText('fixturesCount',`${fixtures.length} matches`); }
function renderGroupedScoreboard(matches){ const grouped=groupBy(matches,m=>formatRoundLabel(m.Round)); return Object.keys(grouped).map(round=>`<section class="round-block"><div class="round-heading">${escapeHTML(round)}</div>${grouped[round].map(renderScoreboardRow).join('')}</section>`).join(''); }
function renderStandings(){
  const standings=getFilteredStandings();
  if(!standings.length){
    setHTML('standingsContainer','<div class="empty">No standings found.</div>');
    return;
  }

  const groups=groupBy(standings,getStandingGroupKey);
  const orderedGroups=Object.keys(groups).sort((a,b)=>
    a.localeCompare(b,undefined,{numeric:true})
  );

  const html=orderedGroups.map(groupName=>{
    const rows=[...groups[groupName]].sort(compareStandingRows);
    const isGroupStage=isGroupStageCompetition();

    const legend=isLeaguePhaseCompetition()
      ? renderQualificationLegend([
          ['rank-qualified','Top 8 qualify to Round of 16'],
          ['rank-ucl','9–24 qualify to Play-off'],
          ['rank-eliminated','25–36 eliminated']
        ])
      : (
          isGroupStage
            ? renderQualificationLegend([
                ['rank-qualified','Top 2 qualify'],
                ['rank-eliminated','Bottom 2 eliminated']
              ])
            : renderLeagueLegend()
        );

    const body=rows.map((team,i)=>{
      const rankClass=getRankClass(i,rows.length,isGroupStage);
      const rowClass='standing-row-'+rankClass.replace(/^rank-/,'');
      return `<tr class="standing-row ${rowClass}">
        <td class="standing-position-cell">
          <div class="standing-position-content">
            ${renderStandingStatusIcon(rankClass)}
            <span class="rank-badge ${rankClass}">${i+1}</span>
          </div>
        </td>
        <td class="team-cell">
          <div class="standing-team-content">
            ${renderTeamLogo(getStandingTeamLogo(team),team.Team)}
            <span class="standing-team-name">${escapeHTML(team.Team)}</span>
          </div>
        </td>
        <td class="standings-points"><strong>${safeNumber(team.Points)}</strong></td>
        <td>${safeNumber(team.Played)}</td>
        <td>${safeNumber(team.Won)}</td>
        <td>${safeNumber(team.Drawn)}</td>
        <td>${safeNumber(team.Lost)}</td>
        <td>${safeNumber(team.GoalsFor)}</td>
        <td>${safeNumber(team.GoalsAgainst)}</td>
        <td>${formatGoalDifference(team.GoalDifference)}</td>
      </tr>`;
    }).join('');

    return `<section class="table-card">
      <div class="table-card-header">
        <h3>${escapeHTML(groupName)}</h3>
        <span>${rows.length} teams</span>
      </div>
      <div class="standings-table-wrap">
        <table class="standings-table">
          <thead>
            <tr><th>#</th><th>Team</th><th>PTS</th><th>GW</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${legend}
    </section>`;
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
function renderMatchDetail(match,eventsLoading=false){ const events=getMatchEvents(match.MatchID||match.ID); const youtube=match.YouTubeURL||match.YoutubeURL||match.HighlightsURL||''; const penalty=getPenaltyWinnerText(match); const motm=getMatchMOTM(match); const eventContent=eventsLoading?'<div class="empty">Loading goals, assists and cards...</div>':renderTimelineEvents(events,match); return `<section class="match-hero"><div class="match-date-main">${escapeHTML(formatFullDateTime(match.Date,match.Time))}</div><div class="match-main-teams"><div class="match-main-team"><div class="match-main-logo">${match.HomeLogo?`<img src="${escapeAttr(match.HomeLogo)}" alt="">`:''}</div><strong>${escapeHTML(match.HomeTeam)}</strong></div><div class="match-main-score"><div>${match.Status==='FT'?(penalty?`${escapeHTML(safeScore(match.HomeScore))} - ${escapeHTML(safeScore(match.AwayScore))}`:renderScoreText(match)):'VS'}</div>${match.Status==='FT'&&penalty?`<span class=\"penalty-result-only\">${escapeHTML(penalty)}</span>`:''}</div><div class="match-main-team"><div class="match-main-logo">${match.AwayLogo?`<img src="${escapeAttr(match.AwayLogo)}" alt="">`:''}</div><strong>${escapeHTML(match.AwayTeam)}</strong></div></div></section><section class="venue-row"><span>🏟️ Venue:</span><strong>${escapeHTML(match.Venue||match.Stadium||'Venue unavailable')}</strong></section><section class="event-section">${eventContent}</section>${motm?`<section class="motm-row"><span>⭐ Man of the Match:</span>${renderPlayerLink(motm)}</section>`:''}${renderHighlights(youtube)}`; }
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
  appData.matches=dedupeMatchArray(
    (Array.isArray(appData.matches)?appData.matches:[])
      .concat(Array.isArray(detail.matches)?detail.matches:[])
      .concat(Array.isArray(detail.playoffs)?detail.playoffs:[])
  );
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
  if(assist) return `<span class="event-detail event-assist">(${renderPlayerLink(assist)})</span>`;
  return `<span class="event-detail">(${escapeHTML(cleanDetail)})</span>`;
}

function renderTimelineEvents(events,match){ if(!events.length) return '<div class="empty">No events.</div>'; let liveHome=0, liveAway=0; const rows=events.map(e=>{ if(isGoalEvent(e)){ if(sameTeam(e.Team,match.HomeTeam)) liveHome++; if(sameTeam(e.Team,match.AwayTeam)) liveAway++; } return renderEventRow(e,match,liveHome,liveAway); }).join(''); return `<div class="timeline-block">${rows}</div>`; }
function cleanEventDetail(detail){ const text=String(detail||'').trim(); if(!text) return ''; return text.replace(/^Assist:\s*/i,'').replace(/^Penalty,\s*Assist:\s*/i,'Penalty, ').replace(/,\s*Assist:\s*/i,', '); }
function getMatchMOTM(match){ if(match.MOTM) return match.MOTM; const matchId=match.MatchID||match.ID; const row=(appData.matchData||appData.data||[]).find(item=>(item.MatchID||item['Match ID'])===matchId); return row ? (row.MOTM || row.Motm || '') : ''; }
function renderHighlights(url){ const cleanUrl=String(url||'').trim(); if(!cleanUrl) return ''; const id=getYouTubeId(cleanUrl); if(!id) return `<section class="highlights-card"><div class="highlights-header"><span>📺 Highlights</span><a href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">Open video</a></div></section>`; return `<section class="highlights-card"><div class="highlights-header"><span>📺 Highlights</span><a href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">Open on YouTube</a></div><a class="youtube-preview" href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer"><img src="https://img.youtube.com/vi/${escapeAttr(id)}/maxresdefault.jpg" alt="YouTube highlights thumbnail" onerror="this.src='https://img.youtube.com/vi/${escapeAttr(id)}/hqdefault.jpg'"><span class="youtube-play">▶</span></a></section>`; }
function getYouTubeId(url){ const text=String(url||'').trim(); const patterns=[/youtube\.com\/watch\?v=([^&]+)/i,/youtu\.be\/([^?&]+)/i,/youtube\.com\/shorts\/([^?&]+)/i,/youtube\.com\/embed\/([^?&]+)/i]; for(const p of patterns){ const m=text.match(p); if(m?.[1]) return m[1]; } return ''; }

async function openPlayerProfile(playerName,event){
  event?.stopPropagation?.();
  const modal=$('playerModal'),content=$('playerDetailContent');
  if(!modal||!content) return;
  content.innerHTML=renderPlayerProfile(playerName);
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  await loadPlayerCompetitionDetails(playerName);
  if(!modal.classList.contains('hidden')) content.innerHTML=renderPlayerProfile(playerName);
}
window.openPlayerProfile=openPlayerProfile;
function closePlayerProfile(){ $('playerModal')?.classList.add('hidden'); if($('matchModal')?.classList.contains('hidden')) document.body.classList.remove('modal-open'); }
window.closePlayerProfile=closePlayerProfile;
function renderPlayerProfile(playerName){
  const name=String(playerName||'').trim();
  const matches=getPlayerMatches(name);
  const totals=matches.reduce((sum,item)=>{
    Object.keys(sum).forEach(key=>{ sum[key]+=item.stats[key]||0; });
    return sum;
  },{goals:0,assists:0,yellow:0,red:0,cleanSheets:0,penaltiesMissed:0,motm:0});
  const currentTeam=matches.find(item=>item.stats.team)?.stats.team||'';
  const currentLogo=currentTeam?findTeamLogo(currentTeam):'';
  const summary=[
    ['⚽','Goals',totals.goals],
    ['👟','Assists',totals.assists],
    ['🟨','Yellow cards',totals.yellow],
    ['🟥','Red cards',totals.red],
    ['🧤','Clean sheets',totals.cleanSheets],
    ['❌','Penalties missed',totals.penaltiesMissed],
    ['⭐','MOTM',totals.motm]
  ].filter(item=>item[2]>0);
  const rows=matches.length?matches.map(renderPlayerMatchRow).join(''):'<div class="empty">No matching games are available for this player.</div>';
  const summaryHTML=summary.length
    ? `<section class="player-summary-grid">${summary.map(item=>`<div><span class="player-stat-icon" aria-hidden="true">${item[0]}</span><strong>${item[2]}</strong><span>${escapeHTML(item[1])}</span></div>`).join('')}</section>`
    : '';
  const teamHTML=currentTeam
    ? `<div class="player-current-team">${renderTeamLogo(currentLogo,currentTeam)}<strong>${escapeHTML(currentTeam)}</strong></div>`
    : '';
  return `<section class="player-profile-hero"><div class="player-profile-identity"><div class="player-profile-photo">${renderPlayerImage(name)}</div><div><div class="eyebrow">Player profile</div><h2>${escapeHTML(name)}</h2></div></div>${teamHTML}</section>${summaryHTML}<section class="player-matches-section"><h3>Games</h3>${rows}</section>`;
}
function renderPlayerTeamAssignment(item){
  const dates=item.startDate||item.endDate?`${item.startDate||'Beginning'} → ${item.endDate||'Present'}`:'Dates not restricted';
  return `<div class="player-team-row">${renderTeamLogo(findTeamLogo(item.team),item.team)}<span><strong>${escapeHTML(item.team)}</strong><small>${escapeHTML(item.teamType||'Team')} · ${escapeHTML(dates)}</small></span></div>`;
}
function getPlayerMatches(playerName){
  const matches=dedupeMatchArray(getGlobalMatches().concat(getCompetitionMatches()).concat(Array.isArray(appData?.myGames)?appData.myGames:[]));
  return matches
    .map(match=>({match,stats:getPlayerMatchStats(match,playerName)}))
    .filter(item=>hasPlayerProfileAppearance(item.stats))
    .sort((a,b)=>matchDateSortValue(b.match)-matchDateSortValue(a.match));
}
async function loadPlayerCompetitionDetails(playerName){
  await loadPlayerProfileHomeIndex();
  const assignments=playerTeamsLookup.get(normalisePlayerName(playerName))||[];
  const discoveredTeams=new Set(
    getPlayerMatches(playerName)
      .map(item=>normaliseTeamName(item.stats.team))
      .filter(Boolean)
  );
  assignments.forEach(item=>discoveredTeams.add(normaliseTeamName(item.team)));
  const matches=dedupeMatchArray(getGlobalMatches().concat(getCompetitionMatches()).concat(Array.isArray(appData?.myGames)?appData.myGames:[]))
    .filter(match=>{
      if(assignments.some(item=>assignmentIncludesMatch(item,match))) return true;
      return discoveredTeams.has(normaliseTeamName(match.HomeTeam))||discoveredTeams.has(normaliseTeamName(match.AwayTeam));
    });
  const pending=new Map();
  matches.forEach(match=>{
    if(getMatchEvents(match.MatchID||match.ID).length) return;
    const slug=resolveMatchCompetitionSlug(match);
    if(slug&&!pending.has(slug)) pending.set(slug,loadCompetitionDetailsForMatch(match));
  });
  await Promise.all(Array.from(pending.values()));
}
async function loadPlayerProfileHomeIndex(){
  if(isHomePage()) return;
  if(playerProfileHomeIndexPromise) return playerProfileHomeIndexPromise;
  playerProfileHomeIndexPromise=(async()=>{
    try{
      const response=await fetch(`${API_URL}?mode=home&v=${Date.now()}`,{cache:'no-store'});
      if(!response.ok) return;
      const homeData=await response.json();
      if(homeData?.error) return;
      appData.allMatches=dedupeMatchArray(
        (Array.isArray(appData?.allMatches)?appData.allMatches:[])
          .concat(Array.isArray(homeData?.allMatches)?homeData.allMatches:[])
          .concat(Array.isArray(homeData?.matches)?homeData.matches:[])
      );
      appData.myGames=dedupeMatchArray(
        (Array.isArray(appData?.myGames)?appData.myGames:[])
          .concat(Array.isArray(homeData?.myGames)?homeData.myGames:[])
      );
    }catch(error){
      console.warn('Could not load the cross-competition player index.',error);
    }
  })();
  return playerProfileHomeIndexPromise;
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
  const totals={goals:0,assists:0,yellow:0,red:0,cleanSheets:0,penaltiesMissed:0,motm:0,team:''};
  const dataRow=getMatchDataRow(match);
  const categories=[
    ['goals','Home Goals','Away Goals'],
    ['assists','Home Assists','Away Assists'],
    ['yellow','Home Yellow Cards','Away Yellow Cards'],
    ['red','Home Red Cards','Away Red Cards'],
    ['penaltiesMissed','Home Missed Penalties','Away Missed Penalties'],
    ['cleanSheets','Home Clean Sheet','Away Clean Sheet']
  ];

  categories.forEach(([stat,homeColumn,awayColumn])=>{
    const hasColumns=dataRow&&(Object.prototype.hasOwnProperty.call(dataRow,homeColumn)||Object.prototype.hasOwnProperty.call(dataRow,awayColumn));
    if(!hasColumns) return;
    [
      [homeColumn,match.HomeTeam],
      [awayColumn,match.AwayTeam]
    ].forEach(([column,team])=>{
      splitPlayerEntries(dataRow[column]).forEach(entry=>{
        if(stat==='goals'&&isOwnGoalPlayerEntry(entry)) return;
        if(normalisePlayerName(entry)!==key) return;
        totals[stat]++;
        if(!totals.team) totals.team=String(team||'').trim();
      });
    });
  });

  getMatchEvents(match.MatchID||match.ID).forEach(event=>{
    const type=normaliseText(event.Event);
    const player=normalisePlayerName(event.Player);
    const eventTeam=String(event.Team||'').trim();
    const dataHas=(columnA,columnB)=>dataRow&&(Object.prototype.hasOwnProperty.call(dataRow,columnA)||Object.prototype.hasOwnProperty.call(dataRow,columnB));
    if(player===key){
      if(type==='goal'&&!dataHas('Home Goals','Away Goals')&&!isOwnGoalEvent(event)) totals.goals++;
      if(type==='yellow card'&&!dataHas('Home Yellow Cards','Away Yellow Cards')) totals.yellow++;
      if(type==='red card'&&!dataHas('Home Red Cards','Away Red Cards')) totals.red++;
      if((type==='penalty missed'||type==='missed penalty')&&!dataHas('Home Missed Penalties','Away Missed Penalties')) totals.penaltiesMissed++;
      if(!isOwnGoalEvent(event)&&!totals.team) totals.team=eventTeam;
    }
    const assist=String(event.Detail||'').match(/(?:^|,\s*)Assist:\s*(.+)$/i)?.[1]?.trim();
    if(assist&&normalisePlayerName(assist)===key&&!dataHas('Home Assists','Away Assists')){
      totals.assists++;
      if(!totals.team) totals.team=eventTeam;
    }
  });

  if(normalisePlayerName(getMatchMOTM(match))===key){
    totals.motm=1;
    if(!totals.team) totals.team=inferPlayerTeamFromMatchData(dataRow,match,key);
  }
  return totals;
}
function getMatchDataRow(match){
  const matchId=String(match?.MatchID||match?.ID||'').trim();
  if(!matchId) return null;
  return (appData?.matchData||appData?.data||[]).find(row=>String(row?.MatchID||row?.['Match ID']||row?.ID||'').trim()===matchId)||null;
}
function splitPlayerEntries(value){
  return String(value||'').split(/\r?\n/).map(item=>item.trim()).filter(Boolean);
}
function isOwnGoalPlayerEntry(value){
  return /(?:\(\s*OG\s*\)|\bOG)\s*$/i.test(String(value||'').trim());
}
function isOwnGoalEvent(event){
  return normaliseText(event?.Event).includes('own goal')||isOwnGoalPlayerEntry(event?.Player)||/\bown goal\b/i.test(String(event?.Detail||''));
}
function hasPlayerProfileAppearance(stats){
  return ['goals','assists','yellow','red','cleanSheets','penaltiesMissed','motm'].some(key=>Number(stats?.[key])>0);
}
function inferPlayerTeamFromMatchData(dataRow,match,playerKey){
  if(!dataRow) return '';
  const homeColumns=['Home Goals','Home Assists','Home Yellow Cards','Home Red Cards','Home Missed Penalties','Home Clean Sheet'];
  const awayColumns=['Away Goals','Away Assists','Away Yellow Cards','Away Red Cards','Away Missed Penalties','Away Clean Sheet'];
  const inColumns=columns=>columns.some(column=>splitPlayerEntries(dataRow[column]).some(entry=>!isOwnGoalPlayerEntry(entry)&&normalisePlayerName(entry)===playerKey));
  if(inColumns(homeColumns)) return String(match?.HomeTeam||'').trim();
  if(inColumns(awayColumns)) return String(match?.AwayTeam||'').trim();
  return '';
}
function renderPlayerMatchRow(item){
  const match=item.match,s=item.stats,click=match.MatchID?`onclick="closePlayerProfile();openMatchDetail('${escapeAttr(match.MatchID)}')"`:'';
  const badges=[s.goals?`⚽ ${s.goals}`:'',s.assists?`👟 ${s.assists}`:'',s.yellow?`🟨 ${s.yellow}`:'',s.red?`🟥 ${s.red}`:'',s.cleanSheets?`🧤 ${s.cleanSheets}`:'',s.penaltiesMissed?`❌ ${s.penaltiesMissed}`:'',s.motm?`⭐ ${s.motm}`:''].filter(Boolean).join(' ');
  const played=String(match.Status||'').toUpperCase()==='FT'||(/^\d+$/.test(String(match.HomeScore??'').trim())&&/^\d+$/.test(String(match.AwayScore??'').trim()));
  const score=played?`${safeScore(match.HomeScore)} - ${safeScore(match.AwayScore)}`:'VS';
  return `<button class="player-match-row" type="button" ${click}><span class="player-match-date">${escapeHTML(formatScoreboardDateParts(match.Date,match.Time).date)}</span><span class="player-match-teams"><strong>${escapeHTML(match.HomeTeam)} ${escapeHTML(score)} ${escapeHTML(match.AwayTeam)}</strong><small>${escapeHTML(match.Competition||match['Competition Name']||match.Round||'')}</small></span><span class="player-match-events">${badges||'—'}</span></button>`;
}
function getCompetitionMatches(){
  const matches=dedupeMatchArray((Array.isArray(appData?.matches)?appData.matches:[]).concat(Array.isArray(appData?.playoffs)?appData.playoffs:[]));
  return matches;
}
function getGlobalMatches(){
  const matches=dedupeMatchArray(Array.isArray(appData?.allMatches)?appData.allMatches:[]);
  return matches;
}
function reorderLeagueMatchesByResultChronology(matches){
  const source=Array.isArray(matches)?matches:[];
  if(source.length<2) return source;

  const chronology=readResultChronology();
  const grouped=new Map();
  const result=[...source];
  let chronologyChanged=false;

  source.forEach((match,index)=>{
    const groupKey=getResultChronologyGroupKey(match);
    if(!groupKey) return;
    if(!grouped.has(groupKey)) grouped.set(groupKey,[]);
    grouped.get(groupKey).push({match,index});
  });

  grouped.forEach((entries,groupKey)=>{
    if(entries.length<2) return;

    const slots=[...entries].sort((a,b)=>
      matchDateSortValue(a.match)-matchDateSortValue(b.match) || a.index-b.index
    );
    const recorded=entries.filter(entry=>isMyGamePlayed(entry.match));
    if(!recorded.length) return;

    const recordedIdentities=new Set(recorded.map(entry=>getResultChronologyMatchKey(entry.match,groupKey)));
    const legacyAliases=new Map();
    entries.forEach(entry=>{
      const id=String(entry.match?.MatchID||entry.match?.ID||'').trim();
      if(id) legacyAliases.set(`id:${id}`,getResultChronologyMatchKey(entry.match,groupKey));
    });

    const savedOrder=Array.isArray(chronology[groupKey])?chronology[groupKey]:[];
    const migratedOrder=[];
    savedOrder.forEach(savedIdentity=>{
      const identity=legacyAliases.get(savedIdentity)||savedIdentity;
      if(recordedIdentities.has(identity)&&!migratedOrder.includes(identity)) migratedOrder.push(identity);
    });
    if(JSON.stringify(savedOrder)!==JSON.stringify(migratedOrder)){
      chronology[groupKey]=migratedOrder;
      chronologyChanged=true;
    }else{
      chronology[groupKey]=migratedOrder;
    }

    recorded
      .sort(compareNewlyRecordedMatches)
      .forEach(entry=>{
        const identity=getResultChronologyMatchKey(entry.match,groupKey);
        if(!chronology[groupKey].includes(identity)){
          chronology[groupKey].push(identity);
          chronologyChanged=true;
        }
      });

    const sequenceIndex=new Map(chronology[groupKey].map((identity,index)=>[identity,index]));
    recorded.sort((a,b)=>
      (sequenceIndex.get(getResultChronologyMatchKey(a.match,groupKey))??Number.MAX_SAFE_INTEGER)
      -(sequenceIndex.get(getResultChronologyMatchKey(b.match,groupKey))??Number.MAX_SAFE_INTEGER)
    );
    const pending=entries
      .filter(entry=>!isMyGamePlayed(entry.match))
      .sort((a,b)=>matchDateSortValue(a.match)-matchDateSortValue(b.match) || a.index-b.index);
    const orderedGames=recorded.concat(pending);

    slots.forEach((slot,slotIndex)=>{
      const game=orderedGames[slotIndex]?.match;
      if(!game) return;
      result[slot.index]={
        ...game,
        Date:slot.match.Date,
        Time:slot.match.Time
      };
    });
  });

  if(chronologyChanged) writeResultChronology(chronology);
  return result;
}
function compareNewlyRecordedMatches(a,b){
  const first=getRecordedResultOrder(a.match);
  const second=getRecordedResultOrder(b.match);
  if(first!==null&&second!==null&&first!==second) return first-second;
  if(first!==null&&second===null) return -1;
  if(first===null&&second!==null) return 1;
  return matchDateSortValue(a.match)-matchDateSortValue(b.match) || a.index-b.index;
}
function getRecordedResultOrder(match){
  const orderKeys=['ResultOrder','Result Order','PlayedOrder','Played Order','RecordedOrder','Recorded Order'];
  for(const key of orderKeys){
    const value=Number(match?.[key]);
    if(Number.isFinite(value)&&value>0) return value;
  }
  const timeKeys=['ResultRecordedAt','Result Recorded At','PlayedAt','Played At','ScoreUpdatedAt','Score Updated At'];
  for(const key of timeKeys){
    const value=Date.parse(String(match?.[key]||''));
    if(Number.isFinite(value)) return value;
  }
  return null;
}
function getResultChronologyGroupKey(match){
  const selected=appData?.selectedCompetition||{};
  const competitionType=normaliseText(
    match?.CompetitionType||
    match?.['Competition Type']||
    appData?.competitionType||
    selected?.['Competition Type']||
    appData?.site?.competitionType||
    ''
  );
  const round=normaliseText(match?.Round||'');
  const isGameweek=/gameweek\s*\d+/.test(round);
  const isNumberedLeagueRound=/^(?:round\s*)?\d+$/.test(round)&&competitionType.includes('league');
  if(!round||(!isGameweek&&!isNumberedLeagueRound)) return '';

  const competition=normaliseText(
    match?.Competition||
    match?.CompetitionLabel||
    match?.['Competition Name']||
    selected?.['Competition Name']||
    appData?.site?.competition||
    currentCompetition||
    ''
  );
  const year=normaliseText(match?.Year||selected?.Year||appData?.site?.year||'');
  if(!competition) return '';
  return [competition,year,round].join('|');
}
function getResultChronologyMatchKey(match,groupKey){
  return [
    groupKey,
    normaliseTeamName(match?.HomeTeam),
    normaliseTeamName(match?.AwayTeam)
  ].join('|');
}
function readResultChronology(){
  try{
    const saved=JSON.parse(window.localStorage.getItem(RESULT_CHRONOLOGY_STORAGE_KEY)||'{}');
    return saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};
  }catch(error){
    console.warn('Could not read result chronology.',error);
    return {};
  }
}
function writeResultChronology(chronology){
  try{
    window.localStorage.setItem(RESULT_CHRONOLOGY_STORAGE_KEY,JSON.stringify(chronology));
  }catch(error){
    console.warn('Could not save result chronology.',error);
  }
}
function findTeamLogo(teamName){
  const team=normaliseTeamName(teamName);
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
function dedupeMatchArray(matches){
  const unique=new Map();
  (matches||[]).forEach(match=>{
    if(!match) return;
    const date=getDateKey(match.Date);
    const home=normaliseTeamName(match.HomeTeam);
    const away=normaliseTeamName(match.AwayTeam);
    const time=String(match.Time||'').trim();
    const semanticKey=date&&home&&away?`game|${date}|${time}|${home}|${away}`:`id|${String(match.MatchID||match.ID||'').trim()}`;
    if(!semanticKey||semanticKey==='id|') return;
    const saved=unique.get(semanticKey);
    if(!saved){ unique.set(semanticKey,match); return; }
    const savedEvents=getMatchEvents(saved.MatchID||saved.ID).length;
    const newEvents=getMatchEvents(match.MatchID||match.ID).length;
    if(newEvents>savedEvents) unique.set(semanticKey,{...saved,...match});
    else unique.set(semanticKey,{...match,...saved});
  });
  return Array.from(unique.values());
}
function getFilteredMatches(){ let matches=getCompetitionMatches(); if(currentSearch) matches=matches.filter(m=>[m.HomeTeam,m.AwayTeam,m.Round,m.Competition,m.Date,m.Time].join(' ').toLowerCase().includes(currentSearch)); if(currentRound){ const key=normaliseText(currentRound); matches=matches.filter(m=>normaliseText(m.Round)===key); } if(currentGroup){ const key=normaliseText(currentGroup); const teams=(appData.standings||[]).filter(r=>normaliseText(getStandingGroupKey(r))===key).map(r=>normaliseTeamName(r.Team)).filter(Boolean); matches=matches.filter(m=>teams.includes(normaliseTeamName(m.HomeTeam))||teams.includes(normaliseTeamName(m.AwayTeam))||normaliseText(m.Round)===key||normaliseText(m.Round).includes(key)); } return matches; }
function getFilteredStandings(){ let standings=appData.standings||[]; if(currentSearch) standings=standings.filter(r=>[r.Team,r.League,r.Group,r.Competition].join(' ').toLowerCase().includes(currentSearch)); if(currentGroup) standings=standings.filter(r=>normaliseText(getStandingGroupKey(r))===normaliseText(currentGroup)); return standings; }
function getFilteredStats(){ let stats=appData.stats||[]; if(currentSearch) stats=stats.filter(r=>[r.Player,r.Team].join(' ').toLowerCase().includes(currentSearch)); return stats; }
function getNextUpRound(matches){ const ordered=[...matches].sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)||getFixtureOrderValue(a)-getFixtureOrderValue(b)); const now=Date.now()-86400000; const next=ordered.find(m=>m.Status!=='FT'&&matchDateSortValue(m)>=now); if(next) return next.Round||''; const completed=ordered.filter(m=>m.Status==='FT'&&matchDateSortValue(m)>0).sort((a,b)=>matchDateSortValue(b)-matchDateSortValue(a)); return completed.length?completed[0].Round||'':''; }
function compareStandingRows(a,b){
  const pA=safeNumber(a.Points), pB=safeNumber(b.Points);
  if(pB!==pA) return pB-pA;

  const tiedTeams=(appData.standings||[]).filter(r=>
    getStandingGroupKey(r)===getStandingGroupKey(a) &&
    safeNumber(r.Points)===pA
  );

  if(tiedTeams.length>=3){
    const miniRank=getMiniTableRank(tiedTeams);
    const aRank=miniRank[normaliseTeamName(a.Team)];
    const bRank=miniRank[normaliseTeamName(b.Team)];

    if(aRank!==undefined && bRank!==undefined && aRank!==bRank){
      return aRank-bRank;
    }
  }

  if(tiedTeams.length===2){
    const h=getHeadToHeadWinner(a.Team,b.Team);
    if(h===a.Team) return -1;
    if(h===b.Team) return 1;
  }

  const gdA=safeNumber(a.GoalDifference), gdB=safeNumber(b.GoalDifference);
  if(gdB!==gdA) return gdB-gdA;

  const gfA=safeNumber(a.GoalsFor), gfB=safeNumber(b.GoalsFor);
  if(gfB!==gfA) return gfB-gfA;

  const gaA=safeNumber(a.GoalsAgainst), gaB=safeNumber(b.GoalsAgainst);
  if(gaA!==gaB) return gaA-gaB;

  return String(a.Team||'').localeCompare(String(b.Team||''));
}

function getMiniTableRank(tiedTeams){
  const keys=tiedTeams.map(t=>normaliseTeamName(t.Team));
  const mini={};

  tiedTeams.forEach(t=>{
    const key=normaliseTeamName(t.Team);
    mini[key]={team:t.Team,pts:0,gd:0,gf:0,ga:0};
  });

  getCompetitionMatches().forEach(m=>{
    if(m.Status!=='FT') return;

    const home=normaliseTeamName(m.HomeTeam);
    const away=normaliseTeamName(m.AwayTeam);

    if(!keys.includes(home) || !keys.includes(away)) return;

    const hs=safeNumber(m.HomeScore);
    const as=safeNumber(m.AwayScore);

    mini[home].gf+=hs;
    mini[home].ga+=as;
    mini[home].gd+=hs-as;

    mini[away].gf+=as;
    mini[away].ga+=hs;
    mini[away].gd+=as-hs;

    if(hs>as) mini[home].pts+=3;
    else if(as>hs) mini[away].pts+=3;
    else{
      mini[home].pts+=1;
      mini[away].pts+=1;
    }
  });

  const ranked=Object.values(mini).sort((a,b)=>{
    if(b.pts!==a.pts) return b.pts-a.pts;
    if(b.gd!==a.gd) return b.gd-a.gd;
    if(b.gf!==a.gf) return b.gf-a.gf;
    if(a.ga!==b.ga) return a.ga-b.ga;

    const h=getHeadToHeadWinner(a.team,b.team);
    if(h===a.team) return -1;
    if(h===b.team) return 1;

    return String(a.team||'').localeCompare(String(b.team||''));
  });

  const output={};
  ranked.forEach((item,index)=>{
    output[normaliseTeamName(item.team)]=index;
  });

  return output;
}
function getHeadToHeadWinner(a,b){ const aKey=normaliseTeamName(a), bKey=normaliseTeamName(b); const direct=getCompetitionMatches().filter(m=>m.Status==='FT'&&((normaliseTeamName(m.HomeTeam)===aKey&&normaliseTeamName(m.AwayTeam)===bKey)||(normaliseTeamName(m.HomeTeam)===bKey&&normaliseTeamName(m.AwayTeam)===aKey))); if(!direct.length) return ''; let aPts=0,bPts=0; direct.forEach(m=>{ const home=normaliseTeamName(m.HomeTeam), hs=safeNumber(m.HomeScore), as=safeNumber(m.AwayScore); if(hs===as){aPts++;bPts++;return;} const winner=hs>as?home:normaliseTeamName(m.AwayTeam); if(winner===aKey)aPts+=3; if(winner===bKey)bPts+=3; }); return aPts>bPts?a:bPts>aPts?b:''; }
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
function getFixtureOrderValue(match){
  const raw=match?.N??match?.FixtureOrder??match?.['Fixture Order']??match?.Order??'';
  const value=Number(raw);
  return Number.isFinite(value)&&value>0?value:Number.MAX_SAFE_INTEGER;
}
function compareHomeMatches(a,b){ return timeSortValue(normaliseKickoffTime(a.Time))-timeSortValue(normaliseKickoffTime(b.Time))||getFixtureOrderValue(a)-getFixtureOrderValue(b)||compareCompetitionPriority(a,b)||String(a.HomeTeam||'').localeCompare(String(b.HomeTeam||'')); }
function compareCompetitionPriority(a,b){ const order=['england','italy','spain','germany','france','europe','world','national-teams']; const ak=getCompetitionCategoryKey(a), bk=getCompetitionCategoryKey(b); return (order.indexOf(ak)===-1?999:order.indexOf(ak))-(order.indexOf(bk)===-1?999:order.indexOf(bk))||getCompetitionPriority(ak,{'Competition Name':a.Competition||a.CompetitionLabel||''})-getCompetitionPriority(bk,{'Competition Name':b.Competition||b.CompetitionLabel||''}); }
function compareCompetitionNamePriority(a,b,grouped){ return compareCompetitionPriority(grouped[a][0]||{},grouped[b][0]||{})||a.localeCompare(b); }
function compareCompetitionNamePriorityFromName(groupName,a,b){ const key={England:'england',Italy:'italy',Spain:'spain',Germany:'germany',France:'france',Europe:'europe',World:'world','National Teams':'national-teams'}[groupName]||'world'; return getCompetitionPriority(key,{'Competition Name':a})-getCompetitionPriority(key,{'Competition Name':b})||a.localeCompare(b); }
function compareMyGamesMatches(a,b){ return matchDateSortValue(a)-matchDateSortValue(b)||getFixtureOrderValue(a)-getFixtureOrderValue(b)||getMyGamesGroupPriority(a)-getMyGamesGroupPriority(b)||compareCompetitionPriority(a,b)||String(a.HomeTeam||'').localeCompare(String(b.HomeTeam||'')); }
function getMyGamesGroupPriority(m){ const order=['England','Italy','Spain','Germany','France','Europe','World','National Teams']; const i=order.indexOf(getMyGamesGroupLabel(m)); return i===-1?999:i; }
function getMyGamesGroupLabel(m){ return ({england:'England',italy:'Italy',spain:'Spain',germany:'Germany',france:'France',europe:'Europe',world:'World','national-teams':'National Teams'}[getCompetitionCategoryKey(m)]||'World'); }
function getRankClass(index,size,isGroup){
  const pos=index+1;

  if(isLeaguePhaseCompetition()){
    if(pos<=8)return'rank-qualified';
    if(pos<=24)return'rank-ucl';
    return'rank-eliminated';
  }

  if(isGroup){
    if(size<=2)return'rank-neutral';
    return pos<=2?'rank-qualified':'rank-eliminated';
  }

  const league=getLeagueKeyForStandings();

  if(['premier-league','serie-a','la-liga'].includes(league)){
    if(pos<=4)return'rank-ucl';
    if(pos<=6)return'rank-uel';
    if(pos<=8)return'rank-uecl';
    if(pos>=18)return'rank-relegation';
  }

  if(league==='bundesliga'){
    if(pos<=4)return'rank-ucl';
    if(pos<=6)return'rank-uel';
    if(pos<=8)return'rank-uecl';
    if(pos===16)return'rank-playout';
    if(pos>=17)return'rank-relegation';
  }

  if(league==='ligue-1'){
    if(pos<=3)return'rank-ucl';
    if(pos<=5)return'rank-uel';
    if(pos<=7)return'rank-uecl';
    if(pos===16)return'rank-playout';
    if(pos>=17)return'rank-relegation';
  }

  return'rank-neutral';
}

function getLeagueKeyForStandings(){
  const selected=appData?.selectedCompetition||{},site=appData?.site||{};
  const slug=slugify(normaliseCompetitionName(
    selected['Competition Name']||selected.competition||site.competition||currentCompetition||''
  ));
  if(slug.includes('premier-league'))return'premier-league';
  if(slug.includes('serie-a'))return'serie-a';
  if(slug.includes('la-liga')||slug.includes('laliga'))return'la-liga';
  if(slug.includes('bundesliga'))return'bundesliga';
  if(slug.includes('ligue-1'))return'ligue-1';
  return'';
}

function getSelectedStandingCompetitionLogo(){
  const selected=appData?.selectedCompetition||{},site=appData?.site||{};
  return String(selected['Logo URL']||selected.logoUrl||site.logoUrl||'').trim();
}

function findStandingCompetitionLogo(keywords){
  const wanted=(keywords||[]).map(normaliseCompetitionName).filter(Boolean);
  const competitions=Array.isArray(appData?.competitions)?appData.competitions:[];
  const found=competitions.find(comp=>{
    const name=normaliseCompetitionName(
      comp?.['Competition Name']||comp?.Competition||comp?.competition||''
    );
    return wanted.some(keyword=>name.includes(keyword));
  });
  return String(found?.['Logo URL']||found?.logoUrl||found?.Logo||'').trim();
}

function getLowerLeagueStandingMeta(){
  const league=getLeagueKeyForStandings();
  const lowerLeagues={
    'premier-league':{
      keywords:['championship','efl championship'],
      label:'Championship',
      short:'EFL',
      fallback:'https://commons.wikimedia.org/wiki/Special:FilePath/English%20Football%20League%20Wordmark.svg'
    },
    'serie-a':{keywords:['serie b'],label:'Serie B',short:'B'},
    'la-liga':{keywords:['la liga 2','laliga 2','segunda division','segunda división'],label:'La Liga 2',short:'2'},
    'bundesliga':{keywords:['2. bundesliga','bundesliga 2'],label:'2. Bundesliga',short:'2'},
    'ligue-1':{keywords:['ligue 2'],label:'Ligue 2',short:'L2'}
  };
  const meta=lowerLeagues[league]||{keywords:[],label:'Lower division',short:'↓'};
  return{
    label:meta.label,
    short:meta.short,
    logo:findStandingCompetitionLogo(meta.keywords)||meta.fallback||''
  };
}

function getStandingStatusMeta(rankClass){
  const status=String(rankClass||'rank-neutral').replace(/^rank-/,'');
  const selectedLogo=getSelectedStandingCompetitionLogo();

  if(isLeaguePhaseCompetition()&&['qualified','ucl','eliminated'].includes(status)){
    return{
      label:status==='qualified'?'Qualified':status==='ucl'?'Play-off':'Eliminated',
      short:status==='qualified'?'Q':status==='ucl'?'PO':'×',
      logo:selectedLogo
    };
  }

  if(status==='qualified'){
    return{label:'Qualified',short:'Q',logo:selectedLogo};
  }
  if(status==='eliminated'){
    return{label:'Eliminated',short:'×',logo:selectedLogo};
  }
  if(status==='ucl'){
    return{
      label:'Champions League',
      short:'UCL',
      logo:findStandingCompetitionLogo(['champions league'])||
        'https://commons.wikimedia.org/wiki/Special:FilePath/UEFA%20Champions%20League%20logo.svg'
    };
  }
  if(status==='uel'){
    return{
      label:'Europa League',
      short:'UEL',
      logo:findStandingCompetitionLogo(['europa league'])||
        'https://commons.wikimedia.org/wiki/Special:FilePath/UEFA%20Europa%20league%20logo.svg'
    };
  }
  if(status==='uecl'){
    return{
      label:'Conference League',
      short:'UECL',
      logo:findStandingCompetitionLogo(['conference league'])||
        'https://commons.wikimedia.org/wiki/Special:FilePath/UEFA%20Conference%20League%20full%20logo%20(2024%20version).svg'
    };
  }
  if(status==='playout'||status==='relegation'){
    return getLowerLeagueStandingMeta();
  }
  return{label:'',short:'',logo:''};
}

function renderStandingStatusIcon(rankClass){
  const status=String(rankClass||'rank-neutral').replace(/^rank-/,'');
  if(status==='neutral'){
    return'<span class="standing-status-icon is-empty" aria-hidden="true"></span>';
  }

  const meta=getStandingStatusMeta(rankClass);
  const label=meta.label||'Standing status';
  const fallback=`<span class="standing-status-fallback">${escapeHTML(meta.short||'•')}</span>`;

  if(!meta.logo){
    return`<span class="standing-status-icon standing-status-${escapeAttr(status)}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${fallback}</span>`;
  }

  return`<span class="standing-status-icon standing-status-${escapeAttr(status)} has-image" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><img src="${escapeAttr(meta.logo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'">${fallback}</span>`;
}

function renderQualificationLegend(items){
  return`<div class="qualification-note">${items.map(item=>`<span class="qualification-key">${renderStandingStatusIcon(item[0])}<span>${escapeHTML(item[1])}</span></span>`).join('')}</div>`;
}

function renderLeagueLegend(){
  const league=getLeagueKeyForStandings();
  if(!['premier-league','serie-a','la-liga','bundesliga','ligue-1'].includes(league))return'';
  const items=[
    ['rank-ucl','Champions League'],
    ['rank-uel','Europa League'],
    ['rank-uecl','Conference League']
  ];
  if(['bundesliga','ligue-1'].includes(league)){
    items.push(['rank-playout','Relegation play-out']);
  }
  items.push(['rank-relegation','Relegation']);
  return renderQualificationLegend(items);
}

function isGroupStageCompetition(){
  const type = String(appData.competitionType || appData.site?.competitionType || '').toLowerCase();
  return type.includes('group') && !type.includes('league phase');
}

function isLeaguePhaseCompetition(){
  const type = String(appData.competitionType || appData.site?.competitionType || '').toLowerCase();
  return type.includes('league phase');
}
function getRegionForCompetition(m){ return String(m.Region||'World').toUpperCase(); }
function getDateKey(v){ const d=parseDateOnly(v); return d?dateToKey(d):''; }
function parseDateOnly(v){ if(v instanceof Date) return new Date(v.getFullYear(),v.getMonth(),v.getDate()); const t=String(v||'').trim(); if(!t)return null; if(/^\d{4}-\d{2}-\d{2}$/.test(t)){ const p=t.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); } if(/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(t)){ const p=t.split(/[./-]/); return new Date(+p[2],+p[1]-1,+p[0]); } return null; }
function matchDateSortValue(m){ const d=parseDateOnly(m.Date); if(!d)return 0; const p=String(m.Time||'00:00').trim().split(':'); d.setHours(+p[0]||0,+p[1]||0,0,0); return d.getTime(); }
function formatScoreboardDateParts(date,time){ const d=parseDateOnly(date); return {date:d?formatShortDateFromDate(d).replace(/\.$/,''):String(date||'').trim(), time:String(time||'').trim()}; }
function formatFullDateTime(date,time){ const d=parseDateOnly(date); return [d?d.toLocaleDateString('en-GB'):String(date||'').trim(),String(time||'').trim()].filter(Boolean).join(' '); }
function dateToKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function getTodayKey(){ return dateToKey(new Date()); }
function addDays(date,days){ const d=new Date(date); d.setDate(d.getDate()+days); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
function getMonday(date){ const d=new Date(date.getFullYear(),date.getMonth(),date.getDate()); const day=d.getDay(); d.setDate(d.getDate()+(day===0?-6:1-day)); return d; }
function getWeekRangeLabel(date){ const mon=getMonday(date), sun=addDays(mon,6); return `${formatMyGamesDate(mon)} - ${formatMyGamesDate(sun)}`; }
function getSeasonWeekLabel(date){ const selected=new Date(date.getFullYear(),date.getMonth(),date.getDate()); let y=selected.getMonth()>=7?selected.getFullYear():selected.getFullYear()-1; let first=getFirstMondayOfAugust(y); if(selected<first){ y--; first=getFirstMondayOfAugust(y); } return `Week ${Math.max(1,Math.floor((selected-first)/604800000)+1)}`; }
function getFirstMondayOfAugust(y){ const d=new Date(y,7,1); const day=d.getDay(); d.setDate(d.getDate()+(day===1?0:(8-day)%7)); return d; }
function formatShortDateFromDate(d){ return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.`; }
function formatMyGamesDate(d){ return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function normaliseKickoffTime(v){ return String(v||'').trim()||'Scheduled'; }
function timeSortValue(v){ const m=String(v||'').trim().match(/^(\d{1,2}):(\d{2})$/); return m?(+m[1]*60)+(+m[2]):99999; }
function renderScoreText(m){ const hp=String(m.HomePens||'').trim(), ap=String(m.AwayPens||'').trim(), home=safeScore(m.HomeScore), away=safeScore(m.AwayScore); return hp&&ap?`<span class="penalty-score">(${escapeHTML(hp)})</span> ${escapeHTML(home)} - ${escapeHTML(away)} <span class="penalty-score">(${escapeHTML(ap)})</span>`:`${escapeHTML(home)} - ${escapeHTML(away)}`; }
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
function escapeHTML(v){ return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function escapeAttr(v){ return escapeHTML(v); }
window.CALCIUM_SCRIPT_VERSION='7072-fixtures-header-fix';


function normaliseDirectFixtureHeader(value){
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function directFixtureCellValue(cell){
  if(cell === null || cell === undefined) return '';
  const value = cell.f !== null && cell.f !== undefined ? cell.f : cell.v;
  return String(value === null || value === undefined ? '' : value).trim();
}

function normaliseDirectFixtureTeam(value){
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractDirectFixtureSheetId(value){
  const text=String(value || '').trim();
  const match=text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : text;
}

function getDirectFixtureSheetIdFromCompetition(competition){
  const candidates=[
    competition?.['Sheet ID'],
    competition?.SheetID,
    competition?.sheetId,
    competition?.sheetID,
    competition?.['Spreadsheet ID'],
    competition?.SpreadsheetID,
    competition?.spreadsheetId
  ];
  for(const candidate of candidates){
    const sheetId=extractDirectFixtureSheetId(candidate);
    if(sheetId) return sheetId;
  }
  return '';
}

function resolveDirectFixtureSheetId(data){
  const selectedId=getDirectFixtureSheetIdFromCompetition(data?.selectedCompetition);
  if(selectedId) return selectedId;

  const requestedSlug=new URLSearchParams(window.location.search).get('competition') || '';
  const competitions=Array.isArray(data?.competitions) ? data.competitions : [];
  const selected=competitions.find(competition => makeCompetitionSlug(competition) === requestedSlug);
  return getDirectFixtureSheetIdFromCompetition(selected);
}

/**
 * Reads the new ongoing-competition Fixtures structure directly:
 * R, N (optional), Home, S, Away, Date, Time, Venue, Match ID, YouTube URL.
 *
 * World Cup and Pre-season Friendlies retain their legacy backend format.
 */
async function hydrateFixturesFromSheet(data){
  const sheetId=resolveDirectFixtureSheetId(data);
  if(!sheetId) return;

  try{
    const table=await loadGoogleVisualizationTable(sheetId, 'Fixtures');
    const headers=(table?.cols || []).map(column =>
      normaliseDirectFixtureHeader(column?.label || column?.id || '')
    );
    const findHeader=(...names)=>{
      for(const name of names){
        const index=headers.indexOf(normaliseDirectFixtureHeader(name));
        if(index >= 0) return index;
      }
      return -1;
    };

    const columns={
      round:findHeader('R', 'Round'),
      order:findHeader('N', 'Order', 'Fixture Order'),
      home:findHeader('Home'),
      score:findHeader('S', 'Score'),
      away:findHeader('Away'),
      date:findHeader('Date'),
      time:findHeader('Time'),
      venue:findHeader('Venue'),
      matchId:findHeader('Match ID', 'MatchID'),
      youtube:findHeader('YouTube URL', 'YouTubeURL')
    };

    const hasRequiredHeaders=
      columns.home >= 0 &&
      columns.away >= 0 &&
      columns.date >= 0 &&
      columns.time >= 0;

    // Safe fallback for the exact 14-column ongoing format when GViz omits labels.
    if(!hasRequiredHeaders && (table?.cols || []).length === 14){
      Object.assign(columns, {
        round:0,
        order:1,
        home:2,
        score:3,
        away:4,
        date:9,
        time:10,
        venue:11,
        matchId:12,
        youtube:13
      });
    }

    if(
      columns.home < 0 ||
      columns.away < 0 ||
      columns.date < 0 ||
      columns.time < 0
    ){
      return;
    }

    const read=(row, index)=> index < 0 ? '' : directFixtureCellValue(row?.c?.[index]);
    const oldMatches=[
      ...(Array.isArray(data?.matches) ? data.matches : []),
      ...(Array.isArray(data?.playoffs) ? data.playoffs : [])
    ];
    const oldMatchesByTeams=new Map();

    oldMatches.forEach(match=>{
      const home=normaliseDirectFixtureTeam(match?.Home || match?.HomeTeam);
      const away=normaliseDirectFixtureTeam(match?.Away || match?.AwayTeam);
      if(home || away) oldMatchesByTeams.set(`${home}|${away}`, match);
    });

    const matches=(table?.rows || []).map(row=>{
      const round=read(row, columns.round);
      const order=read(row, columns.order);
      const home=read(row, columns.home);
      const score=read(row, columns.score);
      const away=read(row, columns.away);
      const date=read(row, columns.date);
      const time=read(row, columns.time);

      if(!home && !away) return null;

      const key=`${normaliseDirectFixtureTeam(home)}|${normaliseDirectFixtureTeam(away)}`;
      const match={
        ...(oldMatchesByTeams.get(key) || {}),
        R:round,
        Round:round,
        N:order,
        FixtureOrder:order,
        Home:home,
        HomeTeam:home,
        S:score,
        Score:score,
        Away:away,
        AwayTeam:away,
        Date:date,
        Time:time
      };

      const venue=read(row, columns.venue);
      const matchId=read(row, columns.matchId);
      const youtube=read(row, columns.youtube);

      if(venue) match.Venue=venue;
      if(matchId){
        match.MatchID=matchId;
        match['Match ID']=matchId;
      }
      if(youtube){
        match.YouTubeURL=youtube;
        match['YouTube URL']=youtube;
      }

      return match;
    }).filter(Boolean);

    if(matches.length){
      data.matches=matches;
      data.playoffs=[];
    }
  }catch(error){
    console.warn('Could not load fixtures directly from the Fixtures sheet.', error);
  }
}
