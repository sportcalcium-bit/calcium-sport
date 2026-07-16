const API_URL = 'https://script.google.com/macros/s/AKfycbyFU-9M16UBls1YvTZfXxCDGLFBT2CL1qvTH7S_pmdHCD6kSeQpHQlQW_gg6r5vhfjOZA/exec';

let appData = null;
let playerImageLookup = new Map();
let playerTeamsLookup = new Map();
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

async function loadCompetition(competitionParam){
  const url = competitionParam ? `${API_URL}?competition=${encodeURIComponent(competitionParam)}&v=${Date.now()}` : `${API_URL}?mode=home&v=${Date.now()}`;
  const response = await fetch(url, { cache:'no-store' });
  if(!response.ok) throw new Error(`Backend error: ${response.status}`);
  appData = await response.json();
  if(appData.error) throw new Error(appData.error);
  playerImageLookup = buildPlayerImageLookup(appData.players);
  playerTeamsLookup = buildPlayerTeamsLookup(appData.playerTeams);
  await repairMalformedStandingsFromSheet(appData);
  const selected = appData.selectedCompetition || appData.site || {};
  currentCompetition = makeCompetitionSlug(selected);
  if(!selectedDateKey) selectedDateKey = getTodayKey();
  expandedStats = { topScorers:false, topAssists:false, cleanSheets:false, yellowCards:false, redCards:false };
  populateCompetitionDropdowns();
  populateFilters();
  renderAll();
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
    script.src=`${base}?tqx=responseHandler:${encodeURIComponent(callback)}&sheet=${encodeURIComponent(sheetName)}&v=${Date.now()}`;
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

  const today = new Date();
  const yesterday = addDays(today,-1);
  const tomorrow = addDays(today,1);

  const dates = [
    {key:dateToKey(yesterday),dayLabel:'Yesterday',shortDate:formatShortDateFromDate(yesterday)},
    {key:dateToKey(today),dayLabel:'Today',shortDate:formatShortDateFromDate(today)},
    {key:dateToKey(tomorrow),dayLabel:'Tomorrow',shortDate:formatShortDateFromDate(tomorrow)}
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

function renderHomeGames(){
  const matches=getGlobalMatches().filter(m=>getDateKey(m.Date)===selectedDateKey).sort(compareHomeMatches);
  setText('homeMatchCount', matches.length); setText('homeAllGamesTitle', `All games (${matches.length})`);
  if(!matches.length){ setHTML('homeGamesList','<div class="empty home-empty">No games scheduled on this date.</div>'); return; }
  const timeGroups=groupBy(matches, m=>normaliseKickoffTime(m.Time));
  const html=Object.keys(timeGroups).sort((a,b)=>timeSortValue(a)-timeSortValue(b)).map(time=>{
    const competitionGroups=groupBy(timeGroups[time].sort(compareHomeMatches), m=>m.CompetitionLabel || m.Competition || 'Competition');
    return `<section class="home-time-block"><div class="home-time-heading">${escapeHTML(time||'Scheduled')}</div>${Object.keys(competitionGroups).sort((a,b)=>compareCompetitionNamePriority(a,b,competitionGroups)).map(name=>`<section class="home-competition-block"><div class="home-competition-mini-title"><span>${escapeHTML(getRegionForCompetition(competitionGroups[name][0]))}</span><strong>${escapeHTML(name)}</strong></div>${competitionGroups[name].map(renderHomeMatchRow).join('')}</section>`).join('')}</section>`;
  }).join('');
  setHTML('homeGamesList', html);
}
function renderHomeMatchRow(match){ const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:''; return `<article class="home-match-row" ${click}><div class="score-team-home-name">${escapeHTML(match.HomeTeam)}</div><div class="score-team-home-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="home-match-score compact-match-score">${renderCompactMatchScore(match)}</div><div class="score-team-away-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="score-team-away-name">${escapeHTML(match.AwayTeam)}</div></article>`; }
function renderMyGamesRow(match){ const p=formatScoreboardDateParts(match.Date,match.Time); const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:''; return `<article class="my-games-match" ${click}><div class="my-games-date"><span>${escapeHTML(p.date)}</span><span>${escapeHTML(p.time)}</span></div><div class="my-games-team-name home">${escapeHTML(match.HomeTeam)}</div><div class="my-games-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="my-games-score compact-match-score">${renderCompactMatchScore(match)}</div><div class="my-games-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="my-games-team-name away">${escapeHTML(match.AwayTeam)}</div><div class="my-games-status">${escapeHTML(match.Status||'Scheduled')}</div></article>`; }
function getMatchCompetitionContext(match){
  const competitionName=String(match.Competition||match['Competition Name']||appData?.selectedCompetition?.['Competition Name']||appData?.site?.competition||'Competition').trim();
  const year=String(match.Year||match.Season||appData?.selectedCompetition?.Year||appData?.site?.year||'').trim();
  const lower=competitionName.toLowerCase();
  let region=String(match.Region||appData?.selectedCompetition?.Region||'').trim();
  let icon='🌍', label='WORLD';

  if(lower.includes('champions league')||lower.includes('europa league')||lower.includes('conference league')||lower.includes('uefa super cup')){
    icon='🇪🇺'; label='EUROPE';
  }else if(lower.includes('premier league')||lower.includes('fa cup')||lower.includes('carabao')||lower.includes('community shield')||normaliseRegion(region)==='england'){
    icon='🏴'; label='ENGLAND';
  }else if(lower.includes('serie a')||lower.includes('coppa')||lower.includes('supercoppa')||normaliseRegion(region)==='italy'){
    icon='🇮🇹'; label='ITALY';
  }else if(lower.includes('la liga')||lower.includes('copa del rey')||lower.includes('supercopa')||normaliseRegion(region)==='spain'){
    icon='🇪🇸'; label='SPAIN';
  }else if(lower.includes('bundesliga')||lower.includes('dfb')||lower.includes('dfl')||normaliseRegion(region)==='germany'){
    icon='🇩🇪'; label='GERMANY';
  }else if(lower.includes('ligue 1')||lower.includes('coupe de france')||lower.includes('troph')||normaliseRegion(region)==='france'){
    icon='🇫🇷'; label='FRANCE';
  }else if(lower.includes('world cup')||lower.includes('club world cup')||lower.includes('intercontinental cup')){
    icon='🌍'; label='WORLD';
  }else if(region){
    label=region.toUpperCase();
  }

  const competitionLabel = year && !competitionName.includes(year) ? `${competitionName} ${year}` : competitionName;
  const round=String(formatRoundLabel(match.Round||'')).trim();
  return {icon,label,competitionLabel,round};
}
function renderMatchBreadcrumb(match){
  const ctx=getMatchCompetitionContext(match);
  return `<div class="match-breadcrumb">
    <span class="match-breadcrumb-segment"><span>${ctx.icon}</span><strong>${escapeHTML(ctx.label)}</strong></span>
    <span class="match-breadcrumb-arrow">›</span>
    <span class="match-breadcrumb-segment"><strong>${escapeHTML(ctx.competitionLabel.toUpperCase())}</strong></span>
    ${ctx.round?`<span class="match-breadcrumb-arrow">›</span><span class="match-breadcrumb-segment"><strong>${escapeHTML(ctx.round.toUpperCase())}</strong></span>`:''}
  </div>`;
}
function renderEliteTimelineEvents(events,match){
  if(!events.length) return '<div class="empty elite-events-empty">No match events recorded.</div>';
  let liveHome=0,liveAway=0;
  const rows=events.map(event=>{
    if(isGoalEvent(event)){
      if(sameTeam(event.Team,match.HomeTeam)) liveHome++;
      if(sameTeam(event.Team,match.AwayTeam)) liveAway++;
    }
    const isHome=sameTeam(event.Team,match.HomeTeam);
    const label=getEventLabel(event,liveHome,liveAway);
    return `<div class="elite-event-row ${isHome?'elite-event-home':'elite-event-away'}">
      <div class="elite-event-side elite-event-left">${isHome?label:''}</div>
      <div class="elite-event-minute"><span>${escapeHTML(event.Minute)}'</span></div>
      <div class="elite-event-side elite-event-right">${isHome?'':label}</div>
    </div>`;
  }).join('');
  return `<div class="elite-timeline"><div class="elite-events-title">MATCH EVENTS</div>${rows}</div>`;
}

function renderScoreboard(){ const matches=getFilteredMatches(); if(!matches.length){ setHTML('scoreboardList','<div class="empty">No matches found.</div>'); return; } const round=getNextUpRound(matches); if(!round){ setHTML('scoreboardList','<div class="empty">No matches found.</div>'); return; } const rows=matches.filter(m=>normaliseText(m.Round||'')===normaliseText(round)).sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); const scheduled=rows.some(m=>m.Status!=='FT'); setHTML('scoreboardList',`${scheduled?'':'<div class="season-complete-note">Season completed. Showing the last round played.</div>'}<section class="round-block"><div class="round-heading">${escapeHTML(formatRoundLabel(round))}</div>${rows.map(renderScoreboardRow).join('')}</section>`); }
function renderScoreboardRow(match){ const p=formatScoreboardDateParts(match.Date,match.Time); const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:''; return `<article class="scoreboard-row ${match.MatchID?'is-clickable':''}" ${click}><div class="scoreboard-date"><span class="scoreboard-date-main">${escapeHTML(p.date)}</span><span class="scoreboard-time-main">${escapeHTML(p.time)}</span></div><div class="score-team-home-name">${escapeHTML(match.HomeTeam)}</div><div class="score-team-home-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="scoreboard-score compact-match-score">${renderCompactMatchScore(match)}</div><div class="score-team-away-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="score-team-away-name">${escapeHTML(match.AwayTeam)}</div></article>`; }
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
function renderMatchDetail(match,eventsLoading=false){
  const events=getMatchEvents(match.MatchID||match.ID);
  const youtube=match.YouTubeURL||match.YoutubeURL||match.HighlightsURL||'';
  const penalty=getPenaltyWinnerText(match);
  const motm=getMatchMOTM(match);
  const eventContent=eventsLoading?'<div class="empty">Loading goals, assists and cards...</div>':renderEliteTimelineEvents(events,match);
  return `${renderMatchBreadcrumb(match)}
  <section class="match-hero elite-match-hero">
    <div class="match-date-main">${escapeHTML(formatFullDateTime(match.Date,match.Time))}</div>
    <div class="match-main-teams">
      <div class="match-main-team">
        <div class="match-main-logo">${match.HomeLogo?`<img src="${escapeAttr(match.HomeLogo)}" alt="">`:''}</div>
        <strong>${escapeHTML(match.HomeTeam)}</strong>
      </div>
      <div class="match-main-score">
        <div>${renderScoreText(match)}</div>
        ${penalty?`<span class="match-penalty-result">${escapeHTML(penalty)}</span>`:''}
      </div>
      <div class="match-main-team">
        <div class="match-main-logo">${match.AwayLogo?`<img src="${escapeAttr(match.AwayLogo)}" alt="">`:''}</div>
        <strong>${escapeHTML(match.AwayTeam)}</strong>
      </div>
    </div>
  </section>
  <section class="venue-row"><span>🏟️ Venue:</span><strong>${escapeHTML(match.Venue||match.Stadium||'Venue unavailable')}</strong></section>
  <section class="event-section elite-event-section">${eventContent}</section>
  ${motm?`<section class="elite-motm-card"><div class="elite-motm-label">⭐ MAN OF THE MATCH</div><div class="elite-motm-player">${renderPlayerLink(motm)}</div></section>`:''}
  ${renderHighlights(youtube)}`; }
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
function renderHighlights(url){
  const cleanUrl=String(url||'').trim();
  if(!cleanUrl) return '';
  const id=getYouTubeId(cleanUrl);
  if(!id) return `<section class="highlights-card elite-highlights"><div class="highlights-header"><span>📺 MATCH HIGHLIGHTS</span></div><a class="elite-video-link" href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">▶ PLAY HIGHLIGHTS</a></section>`;
  return `<section class="highlights-card elite-highlights">
    <div class="highlights-header"><span>📺 MATCH HIGHLIGHTS</span></div>
    <a class="youtube-preview" href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">
      <img src="https://img.youtube.com/vi/${escapeAttr(id)}/maxresdefault.jpg" alt="YouTube highlights thumbnail" onerror="this.src='https://img.youtube.com/vi/${escapeAttr(id)}/hqdefault.jpg'">
      <span class="elite-youtube-overlay"><span class="elite-play-circle">▶</span><strong>PLAY HIGHLIGHTS</strong></span>
    </a>
  </section>`;
}
function openPlayerProfile(playerName,event){
  event?.stopPropagation?.();
  activePlayerProfileName=String(playerName||'').trim();
  if(!activePlayerProfileName) return;
  activePlayerSeason=String(getCurrentSeasonYear());
  const modal=$('playerModal'),content=$('playerDetailContent');
  if(!modal||!content) return;
  content.innerHTML=renderPlayerProfile(activePlayerProfileName,activePlayerSeason);
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}
window.openPlayerProfile=openPlayerProfile;
function closePlayerProfile(){ $('playerModal')?.classList.add('hidden'); if($('matchModal')?.classList.contains('hidden')&&$('teamModal')?.classList.contains('hidden')) document.body.classList.remove('modal-open'); }
window.closePlayerProfile=closePlayerProfile;
function renderActivePlayerProfile(){ if($('playerDetailContent')) $('playerDetailContent').innerHTML=renderPlayerProfile(activePlayerProfileName,activePlayerSeason); }
function changePlayerSeason(value){ activePlayerSeason=String(value); renderActivePlayerProfile(); }
window.changePlayerSeason=changePlayerSeason;
function getCurrentSeasonYear(date=new Date()){ return date.getMonth()>=7?date.getFullYear()+1:date.getFullYear(); }
function getSeasonYearForDate(value){ const d=parseDateOnly(value); return d?(d.getMonth()>=7?d.getFullYear()+1:d.getFullYear()):''; }
function isPlayedMatch(match){ if(String(match?.Status||'').toUpperCase()==='FT') return true; return match?.HomeScore!==''&&match?.HomeScore!=null&&match?.AwayScore!==''&&match?.AwayScore!=null; }
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
 const players=[],teamsP=new Set(),teams=[],seenT=new Set();
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
function dedupeMatchArray(matches){ const seen=new Set(); return (matches||[]).filter(m=>{ const key=String(m.MatchID||m.ID||'').trim(); if(!key||seen.has(key)) return false; seen.add(key); return true; }); }
function getFilteredMatches(){ let matches=getCompetitionMatches(); if(currentSearch) matches=matches.filter(m=>[m.HomeTeam,m.AwayTeam,m.Round,m.Competition,m.Date,m.Time].join(' ').toLowerCase().includes(currentSearch)); if(currentRound){ const key=normaliseText(currentRound); matches=matches.filter(m=>normaliseText(m.Round)===key); } if(currentGroup){ const key=normaliseText(currentGroup); const teams=(appData.standings||[]).filter(r=>normaliseText(getStandingGroupKey(r))===key).map(r=>normaliseTeamName(r.Team)).filter(Boolean); matches=matches.filter(m=>teams.includes(normaliseTeamName(m.HomeTeam))||teams.includes(normaliseTeamName(m.AwayTeam))||normaliseText(m.Round)===key||normaliseText(m.Round).includes(key)); } return matches; }
function getFilteredStandings(){ let standings=appData.standings||[]; if(currentSearch) standings=standings.filter(r=>[r.Team,r.League,r.Group,r.Competition].join(' ').toLowerCase().includes(currentSearch)); if(currentGroup) standings=standings.filter(r=>normaliseText(getStandingGroupKey(r))===normaliseText(currentGroup)); return standings; }
function getFilteredStats(){ let stats=appData.stats||[]; if(currentSearch) stats=stats.filter(r=>[r.Player,r.Team].join(' ').toLowerCase().includes(currentSearch)); return stats; }
function getNextUpRound(matches){ const ordered=[...matches].sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); const now=Date.now()-86400000; const next=ordered.find(m=>m.Status!=='FT'&&matchDateSortValue(m)>=now); if(next) return next.Round||''; const completed=ordered.filter(m=>m.Status==='FT'&&matchDateSortValue(m)>0).sort((a,b)=>matchDateSortValue(b)-matchDateSortValue(a)); return completed.length?completed[0].Round||'':''; }
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
function compareHomeMatches(a,b){ return timeSortValue(normaliseKickoffTime(a.Time))-timeSortValue(normaliseKickoffTime(b.Time))||compareCompetitionPriority(a,b)||String(a.HomeTeam||'').localeCompare(String(b.HomeTeam||'')); }
function compareCompetitionPriority(a,b){ const order=['england','italy','spain','germany','france','europe','world','national-teams']; const ak=getCompetitionCategoryKey(a), bk=getCompetitionCategoryKey(b); return (order.indexOf(ak)===-1?999:order.indexOf(ak))-(order.indexOf(bk)===-1?999:order.indexOf(bk))||getCompetitionPriority(ak,{'Competition Name':a.Competition||a.CompetitionLabel||''})-getCompetitionPriority(bk,{'Competition Name':b.Competition||b.CompetitionLabel||''}); }
function compareCompetitionNamePriority(a,b,grouped){ return compareCompetitionPriority(grouped[a][0]||{},grouped[b][0]||{})||a.localeCompare(b); }
function compareCompetitionNamePriorityFromName(groupName,a,b){ const key={England:'england',Italy:'italy',Spain:'spain',Germany:'germany',France:'france',Europe:'europe',World:'world','National Teams':'national-teams'}[groupName]||'world'; return getCompetitionPriority(key,{'Competition Name':a})-getCompetitionPriority(key,{'Competition Name':b})||a.localeCompare(b); }
function compareMyGamesMatches(a,b){ return getMyGamesGroupPriority(a)-getMyGamesGroupPriority(b)||compareCompetitionPriority(a,b)||matchDateSortValue(a)-matchDateSortValue(b)||String(a.HomeTeam||'').localeCompare(String(b.HomeTeam||'')); }
function getMyGamesGroupPriority(m){ const order=['England','Italy','Spain','Germany','France','Europe','World','National Teams']; const i=order.indexOf(getMyGamesGroupLabel(m)); return i===-1?999:i; }
function getMyGamesGroupLabel(m){ return ({england:'England',italy:'Italy',spain:'Spain',germany:'Germany',france:'France',europe:'Europe',world:'World','national-teams':'National Teams'}[getCompetitionCategoryKey(m)]||'World'); }
function getRankClass(index,size,isGroup){

  const pos = index + 1;

  // UEFA League Phase (Champions League, Europa League, Conference League)
  if (isLeaguePhaseCompetition()) {
    if (pos <= 8) return 'rank-qualified';
    if (pos <= 24) return 'rank-ucl';
    return 'rank-eliminated';
  }

  // Traditional groups
  if (isGroup) {
    if (size <= 2) return 'rank-neutral';
    return pos <= 2 ? 'rank-qualified' : 'rank-eliminated';
  }

  const league = getLeagueKeyForStandings();

  if (['premier-league','serie-a','la-liga'].includes(league)) {
    if (pos <= 4) return 'rank-ucl';
    if (pos <= 6) return 'rank-uel';
    if (pos <= 8) return 'rank-uecl';
    if (pos >= 18) return 'rank-relegation';
  }

  if (league === 'bundesliga') {
    if (pos <= 4) return 'rank-ucl';
    if (pos <= 6) return 'rank-uel';
    if (pos <= 8) return 'rank-uecl';
    if (pos === 16) return 'rank-playout';
    if (pos >= 17) return 'rank-relegation';
  }

  if (league === 'ligue-1') {
    if (pos <= 3) return 'rank-ucl';
    if (pos <= 5) return 'rank-uel';
    if (pos <= 7) return 'rank-uecl';
    if (pos === 16) return 'rank-playout';
    if (pos >= 17) return 'rank-relegation';
  }

  return 'rank-neutral';
}
function getLeagueKeyForStandings(){ const selected=appData?.selectedCompetition||{}, site=appData?.site||{}; const slug=slugify(normaliseCompetitionName(selected['Competition Name']||selected.competition||site.competition||currentCompetition||'')); if(slug.includes('premier-league'))return'premier-league'; if(slug.includes('serie-a'))return'serie-a'; if(slug.includes('la-liga')||slug.includes('laliga'))return'la-liga'; if(slug.includes('bundesliga'))return'bundesliga'; if(slug.includes('ligue-1'))return'ligue-1'; return''; }
function renderLeagueLegend(){ const league=getLeagueKeyForStandings(); if(!['premier-league','serie-a','la-liga','bundesliga','ligue-1'].includes(league)) return ''; const items=[['ucl','Champions League'],['uel','Europa League'],['uecl','Conference League']]; if(['bundesliga','ligue-1'].includes(league)) items.push(['playout','Play-out relegation']); items.push(['relegation','Relegation']); return `<div class="qualification-note">${items.map(i=>`<span class="note-dot ${i[0]}"></span>${escapeHTML(i[1])}`).join('')}</div>`; }
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
function renderScoreText(m){ const home=safeScore(m.HomeScore), away=safeScore(m.AwayScore); return `${escapeHTML(home)} - ${escapeHTML(away)}`; }
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
window.CALCIUM_SCRIPT_VERSION='7035-elite-match-centre';
