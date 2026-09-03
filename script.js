const API\_URL = '[https://script.google.com/macros/s/AKfycbwGK-Qg0o1UwBzU6np-y9\_XA9KefEiuqGmEVax7kfT2cees6WD5zwBz4iCGHSYt5CwQ/exec](https://script.google.com/macros/s/AKfycbwGK-Qg0o1UwBzU6np-y9_XA9KefEiuqGmEVax7kfT2cees6WD5zwBz4iCGHSYt5CwQ/exec)';
const HUB\_SPREADSHEET\_ID = '1XpJYhVzkPLqj\_xFBpUGYzY4Jn8hTmGvbFbTGJCEOKw0';
const MY\_GAMES\_NATIONAL\_TEAMS = new Set([
&#x20; 'Portugal','Spain','France','England','Italy','Netherlands',
&#x20; 'Germany','Morocco','Brazil','Argentina'
].map(normaliseTeamName));

let appData = null;
let playerImageLookup = new Map();
let playerTeamsLookup = new Map();
let teamLogoLookup = new Map();
let activePlayerProfileName='';
let activePlayerSeason='';
const competitionDetailCache = new Map();
let currentCompetition = new URLSearchParams(window\.location.search).get('competition') || '';
let currentSearch = '';
let currentGroup = '';
let currentRound = '';
let selectedDateKey = '';
let currentHomeTab = 'allGames';
let expandedStats = { topScorers:false, topAssists:false, cleanSheets:false, yellowCards:false, redCards:false };
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

async function init(){
&#x20; setLoadingState();
&#x20; bindEvents();
&#x20; try{ await loadCompetition(currentCompetition); }
&#x20; catch(error){ console.error(error); showError('Could not load competition data. Please check the Apps Script backend.'); }
}

/\* =========================================================
&#x20;  MAIN DATA LOADER

&#x20;  Home page:
&#x20;    Apps Script API (?action=home) -> Global Games hub sheet,
&#x20;    already filtered into "All games" + "My Games" (favourite
&#x20;    teams) by the backend.

&#x20;  Competition page:
&#x20;    Apps Script API (?action=competitions) -> resolves the
&#x20;    selected competition's own Sheet ID, then
&#x20;    (?action=competitionDetail) reads that competition's
&#x20;    spreadsheet (Fixtures, Standings, Goals, Assists, Yellow
&#x20;    Cards, Red Cards, Clean Sheets) server-side.

&#x20;  Both paths also read the Website Hub's Players + Logos tabs
&#x20;  via (?action=hubData), for player photos and team badges.

&#x20;  Everything goes through the Apps Script backend rather than
&#x20;  reading sheets directly from the browser, since a
&#x20;  server-side read is always immune to any regular filter
&#x20;  applied in the sheet - a filter only affects direct browser
&#x20;  reads (like gviz), never SpreadsheetApp reads.
\========================================================= \*/

let hubDataCache = null;
let competitionsListCache = null;

async function loadCompetition(competitionParam){

&#x20; appData = {
&#x20;   matches:[], playoffs:[], allMatches:[], myGames:[],
&#x20;   standings:[], stats:[], competitions:[],
&#x20;   players:[], playerTeams:[],
&#x20;   selectedCompetition:null, site:{}
&#x20; };

&#x20; if(!hubDataCache){
&#x20;   const hubResponse = await fetch(\`${API\_URL}?action=hubData&v=${Date.now()}\`, { cache:'no-store' }).catch(()=>null);
&#x20;   hubDataCache = (hubResponse && hubResponse.ok) ? await hubResponse.json().catch(()=>null) : null;
&#x20; }
&#x20; const hubData = hubDataCache;

&#x20; appData.players = (hubData && hubData.players) || [];
&#x20; teamLogoLookup = buildTeamLogoLookup((hubData && hubData.logos) || []);

&#x20; if(!competitionParam){
&#x20;   await loadHomeData();
&#x20; } else {
&#x20;   await loadCompetitionData(competitionParam);
&#x20; }

&#x20; playerImageLookup = buildPlayerImageLookup(appData.players);
&#x20; playerTeamsLookup = buildPlayerTeamsLookup(appData.playerTeams);

&#x20; const selected = appData.selectedCompetition || appData.site || {};
&#x20; currentCompetition = makeCompetitionSlug(selected);
&#x20; if(!selectedDateKey) selectedDateKey = getTodayKey();
&#x20; expandedStats = { topScorers:false, topAssists:false, cleanSheets:false, yellowCards:false, redCards:false };
&#x20; populateCompetitionDropdowns();
&#x20; populateFilters();
&#x20; renderAll();
}

async function loadHomeData(){
&#x20; const response = await fetch(\`${API\_URL}?action=home&v=${Date.now()}\`, { cache:'no-store' });
&#x20; if(!response.ok) throw new Error(\`Backend error: ${response.status}\`);
&#x20; const data = await response.json();
&#x20; if(data.error) throw new Error(data.error);

&#x20; appData.allMatches = (data.allGames||[]).map(mapApiMatchToPascal);
&#x20; appData.myGames = (data.myGames||[]).map(mapApiMatchToPascal);
&#x20; appData.competitions = (data.competitions||[]).map(mapApiCompetitionToPascal);

&#x20; // The deployed home endpoint can temporarily serve an older Global Games
&#x20; // snapshot after a hub rebuild. Keep Nations League visible by falling back
&#x20; // to the same dedicated Fixtures source used by its competition page.
&#x20; await mergeMissingHomeCompetition('Nations League');
&#x20; mergeNationalTeamFavouritesIntoMyGames();
}

function mergeNationalTeamFavouritesIntoMyGames(){
&#x20; const nationalTeamMatches = appData.allMatches.filter(match => {
&#x20;   if(getCompetitionCategoryKey(match) !== 'national-teams') return false;
&#x20;   return MY\_GAMES\_NATIONAL\_TEAMS.has(normaliseTeamName(match.HomeTeam)) ||
&#x20;     MY\_GAMES\_NATIONAL\_TEAMS.has(normaliseTeamName(match.AwayTeam));
&#x20; });
&#x20; appData.myGames = dedupeMatchArray(appData.myGames.concat(nationalTeamMatches));
}

async function mergeMissingHomeCompetition(competitionName){
&#x20; const wanted = normaliseCompetitionName(competitionName);
&#x20; const alreadyIncluded = appData.allMatches.some(match =>
&#x20;   normaliseCompetitionName(match.Competition) === wanted
&#x20; );
&#x20; if(alreadyIncluded) return;

&#x20; const competition = appData.competitions
&#x20;   .filter(comp => normaliseCompetitionName(comp['Competition Name']) === wanted)
&#x20;   .sort((a,b) => compareSeasonsDesc(a.Year,b.Year))[0];
&#x20; const sheetId = String(competition?.['Sheet ID'] || '').trim();
&#x20; if(!competition || !sheetId) return;

&#x20; try{
&#x20;   const response = await fetch(\`${API\_URL}?action=competitionDetail&sheetId=${encodeURIComponent(sheetId)}&v=${Date.now()}\`, { cache:'no-store' });
&#x20;   if(!response.ok) return;
&#x20;   const detail = await response.json();
&#x20;   if(detail.error) return;

&#x20;   const matches = parseFixturesTable(detail.fixtures || []).map(match => ({
&#x20;     ...match,
&#x20;     Competition: competition['Competition Name'],
&#x20;     Year: competition.Year,
&#x20;     Region: competition.Region,
&#x20;     CompetitionType: competition['Competition Type']
&#x20;   }));
&#x20;   appData.allMatches = dedupeMatchArray(appData.allMatches.concat(matches));
&#x20; } catch(error){
&#x20;   console.warn(\`Could not load ${competitionName} home fallback.\`, error);
&#x20; }
}

async function loadCompetitionData(slug){
&#x20; if(!competitionsListCache){
&#x20;   const response = await fetch(\`${API\_URL}?action=competitions&v=${Date.now()}\`, { cache:'no-store' });
&#x20;   if(!response.ok) throw new Error(\`Backend error: ${response.status}\`);
&#x20;   const data = await response.json();
&#x20;   if(data.error) throw new Error(data.error);
&#x20;   competitionsListCache = (data.competitions||[]).map(mapApiCompetitionToPascal);
&#x20; }

&#x20; const competitions = competitionsListCache;
&#x20; appData.competitions = competitions;

&#x20; const selected = competitions.find(c => makeCompetitionSlug(c) === slug);
&#x20; if(!selected){
&#x20;   throw new Error('Competition not found: ' + slug);
&#x20; }

&#x20; appData.selectedCompetition = selected;
&#x20; appData.site = {
&#x20;   competition: selected['Competition Name'],
&#x20;   year: selected.Year,
&#x20;   logoUrl: selected['Logo URL'],
&#x20;   region: selected.Region,
&#x20;   competitionType: selected['Competition Type'] || ''
&#x20; };

&#x20; const sheetId = selected['Sheet ID'];
&#x20; if(!sheetId){
&#x20;   throw new Error('No Sheet ID configured for this competition.');
&#x20; }

&#x20; const detailResponse = await fetch(\`${API\_URL}?action=competitionDetail&sheetId=${encodeURIComponent(sheetId)}&v=${Date.now()}\`, { cache:'no-store' });
&#x20; if(!detailResponse.ok) throw new Error(\`Backend error: ${detailResponse.status}\`);
&#x20; const detail = await detailResponse.json();
&#x20; if(detail.error) throw new Error(detail.error);

&#x20; appData.matches = parseFixturesTable(detail.fixtures || []);
&#x20; appData.playoffs = [];
&#x20; appData.standings = parseStandingsTable(detail.standings || [], appData);
&#x20; appData.stats = mergeStatsTables({
&#x20;   Goals: detail.goals || [],
&#x20;   Assists: detail.assists || [],
&#x20;   YellowCards: detail.yellowCards || [],
&#x20;   RedCards: detail.redCards || [],
&#x20;   CleanSheets: detail.cleanSheets || []
&#x20; });
}
function bindEvents(){
&#x20; $('seasonSelect')?.addEventListener('change', async e => { resetFilters(); updateUrlCompetition(e.target.value); await loadCompetition(e.target.value); });
&#x20; $('jumpSelect')?.addEventListener('change', e => jumpToSection(e.target.value));
&#x20; $('searchInput')?.addEventListener('input', e => { currentSearch = e.target.value.toLowerCase().trim(); renderAll(); });
&#x20; $('groupFilter')?.addEventListener('change', e => { currentGroup = e.target.value; renderAll(); });
&#x20; $('roundFilter')?.addEventListener('change', e => { currentRound = e.target.value; renderAll(); });
&#x20; $('clearFilters')?.addEventListener('click', () => { resetFilters(); renderAll(); });
&#x20; $('backToTop')?.addEventListener('click', () => window\.scrollTo({top:0,behavior:'smooth'}));
&#x20; $('masterSearchInput')?.addEventListener('input', e => renderMasterSearchResults(e.target.value));
&#x20; $('masterSearchInput')?.addEventListener('focus', e => renderMasterSearchResults(e.target.value));
&#x20; $('masterSearchClear')?.addEventListener('click', clearMasterSearch);
&#x20; document.addEventListener('click', event => {
&#x20;   if(event.target.closest('[data-view]')){ const view = event.target.closest('[data-view]').dataset.view; setActiveTab(view); jumpToSection(view); }
&#x20;   if(event.target.closest('[data-home-tab]')){ currentHomeTab = event.target.closest('[data-home-tab]').dataset.homeTab || 'allGames'; renderHomeTab(); }
&#x20;   const nav = $('competitionCategoryNav'); if(nav && !nav.contains(event.target)) nav.querySelectorAll('.category-menu').forEach(menu=>menu.classList.remove('open'));
&#x20; });
}

function setLoadingState(){
&#x20; setText('competitionTitle','Loading...'); setText('competitionSubtitle','Loading competition data');
&#x20; ['homeGamesList','myGamesList','scoreboardList','resultsList','fixturesList','standingsContainer'].forEach(id=>setHTML(id,'\<div class="empty">Loading...\</div>'));
}
function renderAll(){
&#x20; if(!appData) return;
&#x20; document.body.classList.toggle('is-home-page', isHomePage());
&#x20; document.body.classList.toggle('is-competition-page', !isHomePage());
&#x20; renderHeader(); renderDateTabs();
&#x20; if(isHomePage()){ renderHomeGames(); renderMyGames(); renderHomeTab(); return; }
&#x20; renderScoreboard(); renderResults(); renderFixtures(); renderStandings(); renderStats();
}
function isHomePage(){ return !new URLSearchParams(window\.location.search).get('competition'); }
function renderHeader(){
&#x20; const site = appData.site || {}; const selected = appData.selectedCompetition || {};
&#x20; if(isHomePage()){ setText('siteSubtitle','Football results centre'); setText('competitionTitle','Football'); setText('competitionSubtitle','All games across every competition'); return; }
&#x20; const name = selected['Competition Name'] || site.competition || 'Competition'; const year = selected.Year || site.year || ''; const logo = selected['Logo URL'] || site.logoUrl || '';
&#x20; setText('competitionTitle',name); setText('competitionSubtitle',year ? \`${name} ${year}\` : name); setText('siteSubtitle',year ? \`${name} ${year}\` : 'Football results centre');
&#x20; const logoEl = $('competitionLogo'); if(logoEl){ logoEl.style.display = logo ? 'block' : 'none'; if(logo){ logoEl.src = logo; logoEl.alt = \`${name} logo\`; } }
}
function populateCompetitionDropdowns(){ renderCompetitionCategoryNav(); populateSeasonDropdown(); }
function populateSeasonDropdown(){
&#x20; const seasonSelect=$('seasonSelect'), seasonWrap=$('seasonSwitcherWrap');
&#x20; if(!seasonSelect || !seasonWrap || isHomePage() || !appData?.selectedCompetition){ seasonWrap?.classList.add('is-hidden'); return; }
&#x20; const selected=appData.selectedCompetition; const selectedName=normaliseCompetitionName(selected['Competition Name']); const selectedRegion=normaliseRegion(selected.Region);
&#x20; const seasons=(appData.competitions||[]).filter(c=>normaliseCompetitionName(c['Competition Name'])===selectedName && normaliseRegion(c.Region)===selectedRegion).sort((a,b)=>compareSeasonsDesc(a.Year,b.Year));
&#x20; if(seasons.length<=1){ seasonWrap.classList.add('is-hidden'); seasonSelect.innerHTML=''; return; }
&#x20; seasonWrap.classList.remove('is-hidden');
&#x20; seasonSelect.innerHTML=seasons.map(c=>\`\<option value="${escapeAttr(makeCompetitionSlug(c))}" ${makeCompetitionSlug(c)===currentCompetition?'selected':''}>${escapeHTML(c.Year||'Season')}\</option>\`).join('');
}
function populateFilters(){ populateGroupDropdown(); populateRoundDropdown(); }
/\* =========================================================
&#x20;  SHEET READING HELPERS
\========================================================= \*/

function tableToObjects(table){
&#x20; if(!table || !Array.isArray(table.cols) || !Array.isArray(table.rows)) return [];
&#x20; const labels = table.cols.map(col => String(col?.label||'').trim());
&#x20; return table.rows.map(row=>{
&#x20;   const obj={};
&#x20;   labels.forEach((label,index)=>{
&#x20;     if(!label) return;
&#x20;     const cell = row?.c?.[index];
&#x20;     obj[label] = cell?.f ?? cell?.v ?? '';
&#x20;   });
&#x20;   return obj;
&#x20; });
}

function buildTeamLogoLookup(rows){
&#x20; const lookup = new Map();
&#x20; rows.forEach(row=>{
&#x20;   const name = String(row['Teams']||row['Team']||'').trim();
&#x20;   const url = String(row['Logo URL']||'').trim();
&#x20;   if(name && url) lookup.set(normaliseTeamName(name), url);
&#x20; });
&#x20; return lookup;
}

function isPresent(value){
&#x20; return value !== undefined && value !== null && value !== '';
}

function mapApiMatchToPascal(match){
&#x20; const home = match.homeTeam || '';
&#x20; const away = match.awayTeam || '';
&#x20; return {
&#x20;   MatchID: match.matchId || \`${home}-${away}-${match.date}\`,
&#x20;   Competition: match.competition || '',
&#x20;   Year: match.year || '',
&#x20;   Region: match.region || '',
&#x20;   CompetitionType: match.competitionType || '',
&#x20;   Round: match.round || '',
&#x20;   Date: match.date || '',
&#x20;   Time: match.time || '',
&#x20;   HomeTeam: home,
&#x20;   AwayTeam: away,
&#x20;   HomeScore: isPresent(match.homeScore) ? match.homeScore : '',
&#x20;   AwayScore: isPresent(match.awayScore) ? match.awayScore : '',
&#x20;   HomePens: isPresent(match.homePens) ? match.homePens : '',
&#x20;   AwayPens: isPresent(match.awayPens) ? match.awayPens : '',
&#x20;   Venue: match.venue || '',
&#x20;   YouTubeURL: match.youtube || '',
&#x20;   Status: match.status || '',
&#x20;   HomeLogo: teamLogoLookup.get(normaliseTeamName(home)) || '',
&#x20;   AwayLogo: teamLogoLookup.get(normaliseTeamName(away)) || ''
&#x20; };
}

function mapApiCompetitionToPascal(comp){
&#x20; return {
&#x20;   'Competition Name': comp.name || '',
&#x20;   Year: comp.year || '',
&#x20;   'Sheet ID': comp.sheetId || '',
&#x20;   Region: comp.region || '',
&#x20;   'Logo URL': comp.logo || '',
&#x20;   'Competition Type': comp.type || '',
&#x20;   Active: comp.active || ''
&#x20; };
}

function splitScoreText(text){
&#x20; const match = String(text||'').trim().match(/^(\d+)\s\*-\s\*(\d+)$/);
&#x20; return match ? {home:match[1], away:match[2]} : {home:'', away:''};
}

function parseFixturesTable(rows){
&#x20; return (rows||[]).map((row,index)=>{
&#x20;   const home = String(row['Home']||'').trim();
&#x20;   const away = String(row['Away']||'').trim();
&#x20;   if(!home || !away) return null;

&#x20;   const fallback = splitScoreText(row['S']);
&#x20;   const homeScore = String(row['HG']??'').trim() || fallback.home;
&#x20;   const awayScore = String(row['AG']??'').trim() || fallback.away;
&#x20;   const homePens = String(row['HP']??'').trim();
&#x20;   const awayPens = String(row['AP']??'').trim();
&#x20;   const matchId = String(row['Match ID']||'').trim() || \`${home}-${away}-${index}\`;

&#x20;   return {
&#x20;     MatchID: matchId,
&#x20;     Round: String(row['R']||'').trim(),
&#x20;     HomeTeam: home,
&#x20;     AwayTeam: away,
&#x20;     HomeScore: homeScore,
&#x20;     AwayScore: awayScore,
&#x20;     HomePens: homePens,
&#x20;     AwayPens: awayPens,
&#x20;     Date: row['Date']||'',
&#x20;     Time: row['Time']||'',
&#x20;     Venue: row['Venue']||'',
&#x20;     YouTubeURL: row['YouTube URL']||'',
&#x20;     Status: (homeScore!=='' && awayScore!=='') ? 'FT' : 'Scheduled',
&#x20;     HomeLogo: teamLogoLookup.get(normaliseTeamName(home))||'',
&#x20;     AwayLogo: teamLogoLookup.get(normaliseTeamName(away))||''
&#x20;   };
&#x20; }).filter(Boolean);
}

function mergeStatsTables(tables){
&#x20; const merged = new Map();

&#x20; function upsert(player, team, key, value){
&#x20;   const cleanPlayer = String(player||'').trim();
&#x20;   if(!cleanPlayer) return;
&#x20;   const mapKey = normalisePlayerName(cleanPlayer) + '|' + normaliseTeamName(team);
&#x20;   if(!merged.has(mapKey)){
&#x20;     merged.set(mapKey, {
&#x20;       Player:cleanPlayer, Team:String(team||'').trim(),
&#x20;       Goals:0, Assists:0, CleanSheets:0, YellowCards:0, RedCards:0,
&#x20;       Logo: teamLogoLookup.get(normaliseTeamName(team))||''
&#x20;     });
&#x20;   }
&#x20;   merged.get(mapKey)[key] = safeNumber(value);
&#x20; }

&#x20; (tables.Goals||[]).forEach(r=>upsert(r['Player'], r['Team'], 'Goals', r['Goals']));
&#x20; (tables.Assists||[]).forEach(r=>upsert(r['Player'], r['Team'], 'Assists', r['Assists']));
&#x20; (tables.YellowCards||[]).forEach(r=>upsert(r['Player'], r['Team'], 'YellowCards', r['Yellow Cards']));
&#x20; (tables.RedCards||[]).forEach(r=>upsert(r['Player'], r['Team'], 'RedCards', r['Red Cards']));
&#x20; (tables.CleanSheets||[]).forEach(r=>upsert(r['Player'], r['Team'], 'CleanSheets', r['Clean Sheets']));

&#x20; return Array.from(merged.values());
}
function loadGoogleVisualizationTable(sheetId,sheetName){
&#x20; return new Promise((resolve,reject)=>{
&#x20;   const callback=\`calciumStandings\_${Date.now()}\_${Math.random().toString(36).slice(2)}\`;
&#x20;   const script=document.createElement('script');
&#x20;   const cleanup=()=>{ clearTimeout(timer); script.remove(); try{ delete window[callback]; }catch(\_error){ window[callback]=undefined; } };
&#x20;   const timer=setTimeout(()=>{ cleanup(); reject(new Error('Standings sheet request timed out.')); },15000);
&#x20;   window[callback]=payload=>{
&#x20;     cleanup();
&#x20;     if(payload?.status!=='ok'||!payload?.table) reject(new Error(payload?.errors?.[0]?.detailed\_message||'Invalid standings sheet response.'));
&#x20;     else resolve(payload.table);
&#x20;   };
&#x20;   script.onerror=()=>{ cleanup(); reject(new Error('Could not load the Standings sheet.')); };
&#x20;   const base=\`[https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq](https://docs.google.com/spreadsheets/d/${encodeURIComponent\(sheetId\)}/gviz/tq)\`;
&#x20;   script.src=\`${base}?tqx=responseHandler:${encodeURIComponent(callback)}&sheet=${encodeURIComponent(sheetName)}&headers=1&v=${Date.now()}\`;
&#x20;   document.head.appendChild(script);
&#x20; });
}
function parseStandingsTable(rows,data){
&#x20; if(!Array.isArray(rows) || !rows.length) return [];
&#x20; const sampleLabels = Object.keys(rows[0]).map(normaliseStandingHeader);
&#x20; if(!sampleLabels.includes('team')) return [];
&#x20; const selected=data?.selectedCompetition||{};
&#x20; const competition=selected['Competition Name']||data?.site?.competition||'';
&#x20; const year=selected.Year||data?.site?.year||'';
&#x20; const region=selected.Region||data?.site?.region||'';
&#x20; const competitionType=selected['Competition Type']||data?.competitionType||data?.site?.competitionType||'';
&#x20; return rows.map(row=>{
&#x20;   const values={};
&#x20;   Object.keys(row).forEach(key=>{
&#x20;     const label=normaliseStandingHeader(key);
&#x20;     if(label) values[label]=row[key]??'';
&#x20;   });
&#x20;   return {
&#x20;     Competition:competition, Year:year, Region:region, CompetitionType:competitionType,
&#x20;     League:values.league||'', Group:values.group||'', Team:values.team||'', Logo:values.logo||'',
&#x20;     Points:safeNumber(values.points), Played:safeNumber(values.played), Won:safeNumber(values.won),
&#x20;     Drawn:safeNumber(values.drawn), Lost:safeNumber(values.lost), GoalsFor:safeNumber(values.goalsFor),
&#x20;     GoalsAgainst:safeNumber(values.goalsAgainst), GoalDifference:safeNumber(values.goalDifference),
&#x20;     AwayGoals:safeNumber(values.awayGoals), AwayWins:safeNumber(values.awayWins),
&#x20;     DisciplinaryPoints:safeNumber(values.disciplinaryPoints), FairPlayPoints:safeNumber(values.fairPlayPoints),
&#x20;     ClubCoefficient:safeNumber(values.clubCoefficient), AccessListRank:safeNumber(values.accessListRank)
&#x20;   };
&#x20; }).filter(row=>String(row\.Team).trim());
}
function normaliseStandingHeader(value){
&#x20; const key=String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
&#x20; return ({
&#x20;   league:'league', group:'group', team:'team', teams:'team', logo:'logo', logourl:'logo',
&#x20;   pt:'points', pts:'points', points:'points',
&#x20;   gw:'played', p:'played', played:'played', matches:'played',
&#x20;   w:'won', won:'won', wins:'won',
&#x20;   d:'drawn', drawn:'drawn', draws:'drawn',
&#x20;   l:'lost', lost:'lost', losses:'lost',
&#x20;   gf:'goalsFor', goalsfor:'goalsFor', goals:'goalsFor',
&#x20;   ga:'goalsAgainst', goalsagainst:'goalsAgainst',
&#x20;   gd:'goalDifference', goaldifference:'goalDifference', goaldiff:'goalDifference',
&#x20;   ag:'awayGoals', awaygoals:'awayGoals',
&#x20;   aw:'awayWins', awaywins:'awayWins',
&#x20;   dp:'disciplinaryPoints', disciplinarypoints:'disciplinaryPoints', discipline:'disciplinaryPoints', fairplay:'fairPlayPoints', fairplaypoints:'fairPlayPoints',
&#x20;   coefficient:'clubCoefficient', clubcoefficient:'clubCoefficient', coeff:'clubCoefficient',
&#x20;   accesslist:'accessListRank', accesslistrank:'accessListRank', nationleagueaccesslist:'accessListRank', nationsleagueaccesslist:'accessListRank'
&#x20; })[key]||'';
}
function formatStandingLeague(league){ const value=String(league||'').trim(); return !value ? '' : /^league\s/i.test(value) ? value : \`League ${value}\`; }
function formatStandingGroup(group){ const value=String(group||'').trim(); return !value ? '' : /^group\s/i.test(value) ? value : \`Group ${value}\`; }
function getStandingGroupKey(row){ const league=formatStandingLeague(row?.League); const group=formatStandingGroup(row?.Group); return [league,group].filter(Boolean).join(' · ') || 'Table'; }
function populateGroupDropdown(){ const select=$('groupFilter'); if(!select) return; const groups=[...new Set((appData.standings||[]).map(getStandingGroupKey).filter(Boolean))]; select.innerHTML=\`\<option value="">All groups/tables\</option>${groups.map(g=>\`\<option value="${escapeAttr(g)}">${escapeHTML(g)}\</option>\`).join('')}\`; if(currentGroup&&groups.includes(currentGroup)) select.value=currentGroup; }
function populateRoundDropdown(){ const select=$('roundFilter'); if(!select) return; const rounds=[...new Set(getCompetitionMatches().map(m=>String(m.Round||'').trim()).filter(Boolean))].sort((a,b)=>roundSortValue(a)-roundSortValue(b)); select.innerHTML=\`\<option value="">All rounds\</option>${rounds.map(r=>\`\<option value="${escapeAttr(r)}">${escapeHTML(formatRoundLabel(r))}\</option>\`).join('')}\`; if(currentRound&&rounds.includes(currentRound)) select.value=currentRound; else currentRound=''; }
function renderDateTabs(){
&#x20; const container = $('dateTabs');
&#x20; if(!container) return;

&#x20; const today = new Date();
&#x20; const thisWeekStart = getWeekStart(today);
&#x20; const lastWeekStart = addDays(thisWeekStart,-7);
&#x20; const nextWeekStart = addDays(thisWeekStart,7);

&#x20; const selected = parseDateOnly(selectedDateKey) || today;
&#x20; const selectedWeekStart = getWeekStart(selected);

&#x20; const weeks = [
&#x20;   {key:dateToKey(lastWeekStart),label:'Last week',start:lastWeekStart},
&#x20;   {key:dateToKey(thisWeekStart),label:'This week',start:thisWeekStart},
&#x20;   {key:dateToKey(nextWeekStart),label:'Next week',start:nextWeekStart}
&#x20; ];

&#x20; const buttons = weeks.map(item=>{
&#x20;   const isActive = dateToKey(selectedWeekStart)===dateToKey(item.start);
&#x20;   return \`
&#x20;   \<button type="button" class="${isActive?'active':''}" onclick="selectDateTab('${escapeAttr(item.key)}')">
&#x20;     \<span>${escapeHTML(item.label)}\</span>
&#x20;     \<strong>${escapeHTML(getWeekRangeLabel(item.start))}\</strong>
&#x20;   \</button>
&#x20; \`;
&#x20; }).join('');

&#x20; const isCustomWeek = !weeks.some(item=>dateToKey(item.start)===dateToKey(selectedWeekStart));
&#x20; const picked = selectedDateKey || getTodayKey();

&#x20; container.innerHTML = \`
&#x20;   ${buttons}
&#x20;   \<div class="date-picker-button ${isCustomWeek?'active':''}" id="datePickerButton">
&#x20;     \<span>📅\</span>
&#x20;     \<span>Pick a week\</span>
&#x20;     \<input id="homeDatePicker" type="date" value="${escapeAttr(picked)}">
&#x20;   \</div>
&#x20; \`;

&#x20; const pickerButton = $('datePickerButton');
&#x20; const input = $('homeDatePicker');

&#x20; if(input){
&#x20;   input.addEventListener('change', e => {
&#x20;     pickHomeDate(e.target.value);
&#x20;   });
&#x20; }

&#x20; if(pickerButton && input){
&#x20;   pickerButton.addEventListener('click', () => {
&#x20;     if(typeof input.showPicker === 'function'){
&#x20;       input.showPicker();
&#x20;     } else {
&#x20;       input.click();
&#x20;     }
&#x20;   });
&#x20; }
}

function selectDateTab(key){
&#x20; if(!key) return;

&#x20; selectedDateKey = key;
&#x20; currentHomeTab = 'allGames';

&#x20; renderDateTabs();
&#x20; renderHomeGames();
&#x20; renderMyGames();
&#x20; renderHomeTab();
}
window\.selectDateTab = selectDateTab;

function pickHomeDate(value){
&#x20; if(!value) return;

&#x20; selectedDateKey = value;
&#x20; currentHomeTab = 'allGames';

&#x20; renderDateTabs();
&#x20; renderHomeGames();
&#x20; renderMyGames();
&#x20; renderHomeTab();
}
window\.pickHomeDate = pickHomeDate;

function renderMatchRowFlat(match){
&#x20; const p = formatScoreboardDateParts(match.Date,match.Time);
&#x20; const score = match.Status==='FT' ? renderScoreText(match) : 'vs';
&#x20; const click = match.MatchID ? \`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"\` : '';
&#x20; const league = match.CompetitionLabel || match.Competition || 'Competition';
&#x20; const statusText = match.Status || 'Scheduled';
&#x20; const statusClass = statusText.trim().toUpperCase()==='FT' ? 'status-ft' : 'status-scheduled';
&#x20; return \`\<article class="my-games-match" ${click}>\<div class="my-games-date">\<span>${escapeHTML(p.date)} - ${escapeHTML(p.time)}\</span>\<span>${escapeHTML(league)}\</span>\</div>\<div class="my-games-team-name home">${escapeHTML(match.HomeTeam)}\</div>\<div class="my-games-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}\</div>\<div class="my-games-score">${score}\</div>\<div class="my-games-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}\</div>\<div class="my-games-team-name away">${escapeHTML(match.AwayTeam)}\</div>\<div class="my-games-status ${statusClass}">${escapeHTML(statusText)}\</div>\</article>\`;
}
function renderHomeGames(){
&#x20; const selected = parseDateOnly(selectedDateKey) || new Date();
&#x20; const weekStart = getWeekStart(selected);
&#x20; const weekEnd = addDays(weekStart,6);

&#x20; const matches = getGlobalMatches().filter(m=>{
&#x20;   const d = parseDateOnly(m.Date);
&#x20;   if(!d) return false;
&#x20;   const cd = new Date(d.getFullYear(),d.getMonth(),d.getDate());
&#x20;   return cd >= weekStart && cd <= weekEnd;
&#x20; }).sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b) || compareCompetitionPriority(a,b));

&#x20; setText('homeMatchCount', matches.length);
&#x20; setText('homeAllGamesTitle', \`All games (${matches.length})\`);

&#x20; if(!matches.length){
&#x20;   setHTML('homeGamesList','\<div class="empty home-empty">No games scheduled this week.\</div>');
&#x20;   return;
&#x20; }

&#x20; const dayGroups = groupBy(matches, m=>getDateKey(m.Date));
&#x20; const html = Object.keys(dayGroups).sort((a,b)=>a.localeCompare(b)).map(dayKey=>{
&#x20;   const dayMatches = dayGroups[dayKey].sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b) || compareCompetitionPriority(a,b));
&#x20;   const dayDate = parseDateOnly(dayKey);
&#x20;   const dayLabel = dayDate ? \`${weekdayNameFromDate(dayDate)} ${formatShortDateFromDate(dayDate).replace(/\\.$/,'')}\` : dayKey;
&#x20;   return \`\<section class="home-time-block">\<div class="home-time-heading">${escapeHTML(dayLabel)}\</div>${dayMatches.map(renderMatchRowFlat).join('')}\</section>\`;
&#x20; }).join('');

&#x20; setHTML('homeGamesList', html);
}
function renderHomeTab(){ const allPanel=$('allGamesPanel'), myPanel=$('myGamesPanel'), jump=$('jumpSelect'); document.querySelectorAll('[data-home-tab]').forEach(b=>b.classList.toggle('active',b.dataset.homeTab===currentHomeTab)); allPanel?.classList.toggle('hidden',currentHomeTab!=='allGames'); myPanel?.classList.toggle('hidden',currentHomeTab!=='myGames'); if(jump&&isHomePage()) jump.value=currentHomeTab==='myGames'?'myGames':'nextUp'; }
const PERSONAL\_DAY\_PRIORITY = ['Friday','Monday','Sunday','Thursday','Tuesday','Wednesday','Saturday'];
const MONDAY\_TO\_SUNDAY\_DISPLAY\_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const WEEKDAY\_NAMES\_BY\_JS\_INDEX = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function weekdayNameFromDate(d){ return WEEKDAY\_NAMES\_BY\_JS\_INDEX[d.getDay()]; }
const WEEKDAY\_OFFSET\_FROM\_WEEK\_START = { Monday:0, Tuesday:1, Wednesday:2, Thursday:3, Friday:4, Saturday:5, Sunday:6 };

/\*
&#x20; My Games dividers are always the 7 real calendar days of the selected
&#x20; week, Monday through Sunday, in that fixed order - every one shown,
&#x20; even if a day ends up with no games.

&#x20; Every match in the week gets slotted into one of those 7 days: sort
&#x20; all of them by real kickoff time, size each day's quota using the
&#x20; Friday/Monday/Sunday/Thursday/Tuesday/Wednesday/Saturday preference
&#x20; (whoever's highest in that order gets any leftover games first), then
&#x20; fill the days STRICTLY in calendar order (Monday's chunk is always the
&#x20; earliest kickoffs, Sunday's the latest). Filling in calendar order -
&#x20; rather than preference order - is what guarantees a later day can
&#x20; never end up holding earlier games than an earlier day.

&#x20; "Played" is simply: does the match have a score / is Status FT. That's
&#x20; it - no separate tracking of when a result was entered.

&#x20; For the current week only: find the first still-unplayed match in
&#x20; real chronological order. Everything before it is confirmed played
&#x20; and keeps its day. Everything from that point on - including any
&#x20; later match that's already played - is re-split evenly across today
&#x20; and the remaining days of the week, still in calendar order. Since
&#x20; this is recomputed fresh from today's real date on every page load,
&#x20; a game still sitting unplayed once its day has passed simply falls
&#x20; into that pool and rolls onto whichever day it lands on next - no
&#x20; scheduled trigger needed.
\*/
function computeDayQuotas(total, dayNames){
&#x20; const dayCount = dayNames.length;
&#x20; if(!dayCount) return {};
&#x20; const base = Math.floor(total/dayCount);
&#x20; const remainder = total % dayCount;
&#x20; const priorityOrder = PERSONAL\_DAY\_PRIORITY.filter(name=>dayNames.includes(name));
&#x20; const remainderDays = new Set(priorityOrder.slice(0, remainder));
&#x20; const quota = {};
&#x20; dayNames.forEach(name=>{ quota[name] = base + (remainderDays.has(name)?1:0); });
&#x20; return quota;
}

function fillDaysInCalendarOrder(sortedMatches, dayNames, quota){
&#x20; const assignment = new Map();
&#x20; let idx = 0;
&#x20; dayNames.forEach(name=>{
&#x20;   for(let n=0; n\<quota[name] && idx\<sortedMatches.length; n++, idx++){
&#x20;     assignment.set(sortedMatches[idx], name);
&#x20;   }
&#x20; });
&#x20; while(idx < sortedMatches.length){
&#x20;   assignment.set(sortedMatches[idx], dayNames[dayNames.length-1]);
&#x20;   idx++;
&#x20; }
&#x20; return assignment;
}

function buildMyGamesDayAssignment(weekMatches, weekStart, isCurrentWeek){

&#x20; const sortedAll = [...weekMatches].sort(compareMyGamesMatches);

&#x20; const baselineQuota = computeDayQuotas(sortedAll.length, MONDAY\_TO\_SUNDAY\_DISPLAY\_ORDER);
&#x20; const baseline = fillDaysInCalendarOrder(sortedAll, MONDAY\_TO\_SUNDAY\_DISPLAY\_ORDER, baselineQuota);

&#x20; if(!isCurrentWeek){
&#x20;   return baseline;
&#x20; }

&#x20; const today = new Date();
&#x20; today.setHours(0,0,0,0);

&#x20; const eligibleDays = MONDAY\_TO\_SUNDAY\_DISPLAY\_ORDER.filter(name=>{
&#x20;   const d = addDays(weekStart, WEEKDAY\_OFFSET\_FROM\_WEEK\_START[name]);
&#x20;   return d.getTime() >= today.getTime();
&#x20; });
&#x20; const finalEligibleDays = eligibleDays.length ? eligibleDays : MONDAY\_TO\_SUNDAY\_DISPLAY\_ORDER.slice();

&#x20; let splitIndex = sortedAll.findIndex(m=>m.Status!=='FT');
&#x20; if(splitIndex===-1) splitIndex = sortedAll.length;

&#x20; const confirmed = sortedAll.slice(0, splitIndex);
&#x20; const pool = sortedAll.slice(splitIndex);

&#x20; const assignment = new Map();
&#x20; confirmed.forEach(m=>assignment.set(m, baseline.get(m)));

&#x20; if(pool.length){
&#x20;   const poolQuota = computeDayQuotas(pool.length, finalEligibleDays);
&#x20;   const poolAssignment = fillDaysInCalendarOrder(pool, finalEligibleDays, poolQuota);
&#x20;   poolAssignment.forEach((name,m)=>assignment.set(m,name));
&#x20; }

&#x20; return assignment;

}

function getMyGamesWeekStart(date){
&#x20; // Same Monday-start week as getWeekStart, EXCEPT: a Monday itself is
&#x20; // treated as belonging to the PREVIOUS week's block, since a Monday
&#x20; // night fixture is the tail end of the previous weekend's gameweek,
&#x20; // not the start of a new one. Only used for My Games grouping - the
&#x20; // shared date-tab labels and Global Games still use plain
&#x20; // getWeekStart/getWeekRangeLabel, untouched.
&#x20; const normalStart = getWeekStart(date);
&#x20; return date.getDay()===1 ? addDays(normalStart,-7) : normalStart;
}

function renderMyGames(){
&#x20; const all=Array.isArray(appData?.myGames)?appData.myGames:[];
&#x20; const selected=parseDateOnly(selectedDateKey)||new Date();
&#x20; const weekStart=getWeekStart(selected);
&#x20; // The My Games match window runs one day later than the visible label
&#x20; // (Tuesday through the FOLLOWING Monday) so a Monday night fixture is
&#x20; // grouped with the gameweek that's ending, not the one about to start.
&#x20; // The "This week / 24/08 - 30/08" label itself is untouched.
&#x20; const matchWindowStart = addDays(weekStart,1);
&#x20; const matchWindowEnd = addDays(weekStart,7);

&#x20; const currentWeekStart = getMyGamesWeekStart(new Date());
&#x20; const isCurrentWeek = dateToKey(weekStart)===dateToKey(currentWeekStart);
&#x20; const isPastWeek = weekStart.getTime() < currentWeekStart.getTime();

&#x20; let weekMatches=all.filter(match=>{
&#x20;   const d=parseDateOnly(match.Date);
&#x20;   if(!d) return false;
&#x20;   const cd=new Date(d.getFullYear(),d.getMonth(),d.getDate());
&#x20;   return cd>=matchWindowStart && cd<=matchWindowEnd;
&#x20; });

&#x20; if(isCurrentWeek){
&#x20;   // Carry forward anything from an earlier week that's still not marked
&#x20;   // played, so it never gets stuck in the past and forgotten.
&#x20;   const overdue = all.filter(match=>{
&#x20;     if(match.Status==='FT') return false;
&#x20;     const d=parseDateOnly(match.Date);
&#x20;     if(!d) return false;
&#x20;     const cd=new Date(d.getFullYear(),d.getMonth(),d.getDate());
&#x20;     return cd < matchWindowStart;
&#x20;   });
&#x20;   weekMatches = overdue.concat(weekMatches);
&#x20; } else if(isPastWeek){
&#x20;   // Unplayed matches from a past week have moved to the current week's
&#x20;   // list instead, so don't show them here too.
&#x20;   weekMatches = weekMatches.filter(match=>match.Status==='FT');
&#x20; }

&#x20; setText('myGamesTitle', getSeasonWeekLabel(selected));
&#x20; setText('myGamesSubtitle', getWeekRangeLabel(selected));
&#x20; const myGamesPlayedCount = weekMatches.filter(isPlayedMatch).length;
&#x20; const myGamesScheduledCount = weekMatches.length - myGamesPlayedCount;
&#x20; setText('myGamesTotalValue', weekMatches.length);
&#x20; setText('myGamesPlayedValue', myGamesPlayedCount);
&#x20; setText('myGamesScheduledValue', myGamesScheduledCount);

&#x20; if(!weekMatches.length){
&#x20;   setHTML('myGamesList','\<div class="empty home-empty">No My Games found for this week.\</div>');
&#x20;   return;
&#x20; }

&#x20; const dayAssignment = buildMyGamesDayAssignment(weekMatches, weekStart, isCurrentWeek);

&#x20; const dayGroups = new Map();
&#x20; MONDAY\_TO\_SUNDAY\_DISPLAY\_ORDER.forEach(name=>dayGroups.set(name, []));
&#x20; weekMatches.forEach(match=>{
&#x20;   const dayName = dayAssignment.get(match) || 'Monday';
&#x20;   dayGroups.get(dayName).push(match);
&#x20; });

&#x20; const html = MONDAY\_TO\_SUNDAY\_DISPLAY\_ORDER.map(dayName=>{
&#x20;   const dayDate = addDays(weekStart, WEEKDAY\_OFFSET\_FROM\_WEEK\_START[dayName]);
&#x20;   const label = \`${dayName} ${formatShortDateFromDate(dayDate).replace(/\\.$/,'')}\`;
&#x20;   const dayMatches = dayGroups.get(dayName).sort(compareMyGamesMatches);
&#x20;   const body = dayMatches.length ? dayMatches.map(renderMatchRowFlat).join('') : '\<div class="empty home-empty">No games.\</div>';
&#x20;   return \`\<section class="home-time-block">\<div class="home-time-heading">${escapeHTML(label)}\</div>${body}\</section>\`;
&#x20; }).join('');

&#x20; setHTML('myGamesList', html);
}
function renderScoreboard(){ const matches=getFilteredMatches(); if(!matches.length){ setHTML('scoreboardList','\<div class="empty">No matches found.\</div>'); return; } const round=getNextUpRound(matches); if(!round){ setHTML('scoreboardList','\<div class="empty">No matches found.\</div>'); return; } const rows=matches.filter(m=>normaliseText(m.Round||'')===normaliseText(round)).sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); const scheduled=rows.some(m=>m.Status!=='FT'); setHTML('scoreboardList',\`${scheduled?'':'\<div class="season-complete-note">Season completed. Showing the last round played.\</div>'}\<section class="round-block">\<div class="round-heading">${escapeHTML(formatRoundLabel(round))}\</div>${rows.map(renderScoreboardRow).join('')}\</section>\`); }
function renderScoreboardRow(match){ const p=formatScoreboardDateParts(match.Date,match.Time); const score=match.Status==='FT'?renderScoreText(match):'vs'; const click=match.MatchID?\`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"\`:''; return \`\<article class="scoreboard-row ${match.MatchID?'is-clickable':''}" ${click}>\<div class="scoreboard-date">\<span class="scoreboard-date-main">${escapeHTML(p.date)}\</span>\<span class="scoreboard-time-main">${escapeHTML(p.time)}\</span>\</div>\<div class="score-team-home-name">${escapeHTML(match.HomeTeam)}\</div>\<div class="score-team-home-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}\</div>\<div class="scoreboard-score">${score}\</div>\<div class="score-team-away-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}\</div>\<div class="score-team-away-name">${escapeHTML(match.AwayTeam)}\</div>\</article>\`; }
function renderResults(){ const results=getFilteredMatches().filter(m=>m.Status==='FT').sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); setHTML('resultsList',results.length?renderGroupedScoreboard(results):'\<div class="empty">No results found.\</div>'); setText('resultsCount',\`${results.length} matches\`); }
function renderFixtures(){ const fixtures=getFilteredMatches().filter(m=>m.Status!=='FT').sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); setHTML('fixturesList',fixtures.length?renderGroupedScoreboard(fixtures):'\<div class="empty">No scheduled games found.\</div>'); setText('fixturesCount',\`${fixtures.length} matches\`); }
function renderGroupedScoreboard(matches){ const grouped=groupBy(matches,m=>formatRoundLabel(m.Round)); return Object.keys(grouped).map(round=>\`\<section class="round-block">\<div class="round-heading">${escapeHTML(round)}\</div>${grouped[round].map(renderScoreboardRow).join('')}\</section>\`).join(''); }
function renderStandings(){
&#x20; const standings=getFilteredStandings();&#x20;
&#x20; if(!standings.length){
&#x20;   setHTML('standingsContainer','\<div class="empty">No standings found.\</div>');&#x20;
&#x20;   return;&#x20;
&#x20; }

&#x20; const groups=groupBy(standings,getStandingGroupKey);

&#x20; const orderedGroups = Object.keys(groups).sort((a, b) =>
&#x20; a.localeCompare(b, undefined, { numeric: true })
);

const html = orderedGroups.map(groupName => {
&#x20;   const rows=[...groups[groupName]].sort(compareStandingRows);&#x20;
&#x20;   const isGroupStage=isGroupStageCompetition();

&#x20;   const legend = getCompetitionLegend(isGroupStage);

&#x20;   return \`\<section class="table-card">\<div class="table-card-header">\<h3>${escapeHTML(groupName)}\</h3>\<span>${rows.length} teams\</span>\</div>\<div class="standings-table-wrap">\<table class="standings-table">\<thead>\<tr>\<th>#\</th>\<th>Team\</th>\<th>PT\</th>\<th>GW\</th>\<th>W\</th>\<th>D\</th>\<th>L\</th>\<th>GF\</th>\<th>GA\</th>\<th>GD\</th>\</tr>\</thead>\<tbody>${rows.map((team,i)=>{const zone=getRankClass(i,rows.length,isGroupStage,team,groupName);return \`\<tr class="standing-row standing-row-${zone.replace('rank-','')}">\<td>\<span class="rank-badge ${zone}">${i+1}\</span>\</td>\<td class="team-cell">\<div class="standing-team-content">${renderTeamLogo(getStandingTeamLogo(team),team.Team)}\<span class="standing-team-name">${escapeHTML(team.Team)}\</span>\</div>\</td>\<td class="standings-points">\<strong>${safeNumber(team.Points)}\</strong>\</td>\<td>${safeNumber(team.Played)}\</td>\<td>${safeNumber(team.Won)}\</td>\<td>${safeNumber(team.Drawn)}\</td>\<td>${safeNumber(team.Lost)}\</td>\<td>${safeNumber(team.GoalsFor)}\</td>\<td>${safeNumber(team.GoalsAgainst)}\</td>\<td>${formatGoalDifference(team.GoalDifference)}\</td>\</tr>\`;}).join('')}\</tbody>\</table>\</div>${legend}\</section>\`;
&#x20; }).join('');

&#x20; setHTML('standingsContainer',html);
}
function renderStats(){ const stats=getFilteredStats(); renderStatList('topScorers',stats,'Goals','topScorers'); renderStatList('topAssists',stats,'Assists','topAssists'); renderStatList('cleanSheets',stats,'CleanSheets','cleanSheets'); renderStatList('yellowCards',stats,'YellowCards','yellowCards'); renderStatList('redCards',stats,'RedCards','redCards'); }
function renderStatList(id,stats,key,expandKey){ const all=stats.filter(r=>Number(r[key])>0).sort((a,b)=>Number(b[key])-Number(a[key])||String(a.Player||'').localeCompare(String(b.Player||''))); if(!all.length){ setHTML(id,'\<div class="empty">No data yet.\</div>'); return; } const visible=expandedStats[expandKey]?all:all.slice(0,3); const rows=visible.map((r,i)=>\`\<div class="stat-row">\<span class="stat-rank">${i+1}\</span>\<span class="stat-player">${renderTeamLogo(r.Logo,r.Team)}${renderPlayerLink(r.Player,'stat-player-name')}\</span>\<strong class="stat-value">${safeNumber(r[key])}\</strong>\</div>\`).join(''); const btn=all.length>3?\`\<button class="stat-toggle" type="button" onclick="toggleStatList('${expandKey}')">${expandedStats[expandKey]?'Show less':\`See more (${all.length})\`}\</button>\`:''; setHTML(id,rows+btn); }
window\.toggleStatList = key => { expandedStats[key]=!expandedStats[key]; renderStats(); };
function renderTeamLogo(url,teamName){ if(!url) return '\<span class="team-logo team-logo-empty">\</span>'; return \`\<span class="team-logo">\<img src="${escapeAttr(url)}" alt="${escapeAttr(teamName||'Team logo')}" loading="lazy">\</span>\`; }
function buildPlayerImageLookup(players){
&#x20; const lookup=new Map();
&#x20; if(!Array.isArray(players)) return lookup;
&#x20; players.forEach(row=>{
&#x20;   const name=String(row?.['Player Name']??row?.Player??row?.Name??row?.[0]??'').trim();
&#x20;   const imageUrl=String(row?.['Player Image URL']??row?.ImageURL??row?.['Image URL']??row?.[1]??'').trim();
&#x20;   const key=normalisePlayerName(name);
&#x20;   if(key&&!lookup.has(key)) lookup.set(key,imageUrl);
&#x20; });
&#x20; return lookup;
}
function buildPlayerTeamsLookup(rows){
&#x20; const lookup=new Map();
&#x20; if(!Array.isArray(rows)) return lookup;
&#x20; rows.forEach(row=>{
&#x20;   const name=String(row?.['Player Name']??row?.Player??row?.[0]??'').trim();
&#x20;   const team=String(row?.Team??row?.[1]??'').trim();
&#x20;   if(!name||!team) return;
&#x20;   const key=normalisePlayerName(name);
&#x20;   if(!lookup.has(key)) lookup.set(key,[]);
&#x20;   lookup.get(key).push({playerName:name,team,teamType:String(row?.['Team Type']??row?.TeamType??row?.[2]??'').trim(),startDate:String(row?.['Start Date']??row?.StartDate??row?.[3]??'').trim(),endDate:String(row?.['End Date']??row?.EndDate??row?.[4]??'').trim(),includeGames:String(row?.['Include Games']??row?.IncludeGames??row?.[5]??'Yes').trim()});
&#x20; });
&#x20; return lookup;
}
function normalisePlayerName(value){
&#x20; return String(value||'')
&#x20;   .normalize('NFKD')
&#x20;   .replace(/[\u0300-\u036f]/g,'')
&#x20;   .replace(/^\s\*[•\\-–—]\s\*/,'')
&#x20;   .replace(/^\s\*\\+\s\*/,'')
&#x20;   .replace(/^\s\*\d+(?:\\+\d+)?\s\*['’]?\s\*/,'')
&#x20;   .replace(/\\(\s\*\d+(?:\\+\d+)?\s\*['’]?\s\*\\)/g,'')
&#x20;   .replace(/\s+\d+(?:\\+\d+)?\s\*['’]?\s\*$/,'')
&#x20;   .replace(/\s\*OG\s\*$/i,'')
&#x20;   .replace(/P\s\*$/i,'')
&#x20;   .replace(/\s+/g,' ')
&#x20;   .trim()
&#x20;   .toLocaleLowerCase();
}
function getPlayerImageUrl(playerName){ return playerImageLookup.get(normalisePlayerName(playerName))||''; }
function renderPlayerImage(playerName){
&#x20; const name=String(playerName||'').trim()||'Player';
&#x20; const imageUrl=getPlayerImageUrl(name)||'player-placeholder.svg';
&#x20; return \`\<span class="player-photo">\<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='player-placeholder.svg'">\</span>\`;
}
function renderPlayerLink(playerName,nameClass=''){
&#x20; const name=String(playerName||'').trim();
&#x20; if(!name) return '';
&#x20; return \`\<button class="player-link ${escapeAttr(nameClass)}" type="button" onclick="openPlayerProfile('${escapeAttr(name)}',event)" title="Open ${escapeAttr(name)} profile">${renderPlayerImage(name)}\<span>${escapeHTML(name)}\</span>\</button>\`;
}
async function openMatchDetail(matchId){
&#x20; const unique=dedupeMatchArray(getGlobalMatches().concat(getCompetitionMatches()).concat(Array.isArray(appData?.myGames)?appData.myGames:[]));
&#x20; const match=unique.find(m=>m.MatchID===matchId||m.ID===matchId);
&#x20; if(!match) return;
&#x20; const modal=$('matchModal'),content=$('matchDetailContent');
&#x20; if(!modal||!content) return;
&#x20; const hasEvents=getMatchEvents(match.MatchID||match.ID).length>0;
&#x20; content.innerHTML=renderMatchDetail(match,!hasEvents&&isHomePage());
&#x20; modal.classList.remove('hidden');
&#x20; document.body.classList.add('modal-open');
&#x20; if(!hasEvents&&isHomePage()){
&#x20;   await loadCompetitionDetailsForMatch(match);
&#x20;   if(!modal.classList.contains('hidden')) content.innerHTML=renderMatchDetail(match,false);
&#x20; }
}
window\.openMatchDetail=openMatchDetail;
function closeMatchModal(){ $('matchModal')?.classList.add('hidden'); document.body.classList.remove('modal-open'); }
window\.closeMatchModal=closeMatchModal;
function renderMatchDetail(match,eventsLoading=false){ const events=getMatchEvents(match.MatchID||match.ID); const youtube=match.YouTubeURL||match.YoutubeURL||match.HighlightsURL||''; const penalty=getPenaltyWinnerText(match); const motm=getMatchMOTM(match); const eventContent=eventsLoading?'\<div class="empty">Loading goals, assists and cards...\</div>':renderTimelineEvents(events,match); return \`\<section class="match-hero">\<div class="match-date-main">${escapeHTML(formatFullDateTime(match.Date,match.Time))}\</div>\<div class="match-main-teams">\<div class="match-main-team">\<div class="match-main-logo">${match.HomeLogo?\`\<img src="${escapeAttr(match.HomeLogo)}" alt="">\`:''}\</div>\<strong>${escapeHTML(match.HomeTeam)}\</strong>\</div>\<div class="match-main-score">\<div>${renderScoreText(match)}\</div>${penalty?\`\<span>${escapeHTML(penalty)}\</span>\`:''}\</div>\<div class="match-main-team">\<div class="match-main-logo">${match.AwayLogo?\`\<img src="${escapeAttr(match.AwayLogo)}" alt="">\`:''}\</div>\<strong>${escapeHTML(match.AwayTeam)}\</strong>\</div>\</div>\</section>\<section class="venue-row">\<span>🏟️ Venue:\</span>\<strong>${escapeHTML(match.Venue||match.Stadium||'Venue unavailable')}\</strong>\</section>\<section class="event-section">${eventContent}\</section>${motm?\`\<section class="motm-row">\<span>⭐ Man of the Match:\</span>${renderPlayerLink(motm)}\</section>\`:''}${renderHighlights(youtube)}\`; }
async function loadCompetitionDetailsForMatch(match){
&#x20; const slug=resolveMatchCompetitionSlug(match);
&#x20; if(!slug) return;
&#x20; let detail=competitionDetailCache.get(slug);
&#x20; if(!detail){
&#x20;   try{
&#x20;     const response=await fetch(\`${API\_URL}?competition=${encodeURIComponent(slug)}&v=${Date.now()}\`,{cache:'no-store'});
&#x20;     if(!response.ok) return;
&#x20;     detail=await response.json();
&#x20;     if(detail?.error) return;
&#x20;     competitionDetailCache.set(slug,detail);
&#x20;   }catch(error){ console.warn('Could not load match events for the home popup.',error); return; }
&#x20; }
&#x20; appData.allEvents=mergeUniqueEvents(appData.allEvents,detail.allEvents||detail.events||[]);
&#x20; appData.matchData=(appData.matchData||[]).concat(detail.matchData||detail.data||[]);
}
function resolveMatchCompetitionSlug(match){
&#x20; const direct=String(match.CompetitionSlug||match.Slug||'').trim();
&#x20; if(direct) return direct;
&#x20; const matchName=normaliseCompetitionName(match.Competition||match['Competition Name']||'');
&#x20; const matchYear=String(match.Year||match.Season||'').trim();
&#x20; const candidates=(appData?.competitions||[]).filter(comp=>{
&#x20;   const candidateName=normaliseCompetitionName(comp['Competition Name']||comp.Competition);
&#x20;   return candidateName===matchName||candidateName.includes(matchName)||matchName.includes(candidateName);
&#x20; });
&#x20; const selected=candidates.find(comp=>!matchYear||String(comp.Year||'').trim()===matchYear)||candidates[0];
&#x20; if(selected) return makeCompetitionSlug(selected);
&#x20; return matchName?slugify(\`${matchName} ${matchYear}\`.trim()):'';
}
function mergeUniqueEvents(first,second){
&#x20; const seen=new Set();
&#x20; return ([]).concat(Array.isArray(first)?first:[],Array.isArray(second)?second:[]).filter(event=>{
&#x20;   const key=[event.MatchID,event.Half,event.Minute,event.Team,event.Event,event.Player,event.Detail].join('|').toLowerCase();
&#x20;   if(seen.has(key)) return false;
&#x20;   seen.add(key);
&#x20;   return true;
&#x20; });
}
function getMatchEvents(matchId){ const targetId=String(matchId||'').trim(); const seen=new Set(); return (appData.allEvents||[]).filter(e=>String(e.MatchID||e['Match ID']||e.ID||'').trim()===targetId).filter(e=>{ const key=[e.MatchID,e.Half,e.Minute,e.Team,e.Event,e.Player,e.Detail].join('|').toLowerCase(); if(seen.has(key)) return false; seen.add(key); return true; }).sort((a,b)=>Number(a.Minute||0)-Number(b.Minute||0)); }
function renderHalfEvents(title,events,match){ if(!events.length) return \`\<div class="half-block">\<div class="half-title">${escapeHTML(title)}\</div>\<div class="empty">No events.\</div>\</div>\`; let liveHome=0, liveAway=0; const rows=events.map(e=>{ if(isGoalEvent(e)){ if(sameTeam(e.Team,match.HomeTeam)) liveHome++; if(sameTeam(e.Team,match.AwayTeam)) liveAway++; } return renderEventRow(e,match,liveHome,liveAway); }).join(''); return \`\<div class="half-block">\<div class="half-title">${escapeHTML(title)}\</div>${rows}\</div>\`; }
function renderEventRow(event,match,liveHome,liveAway){ const side=sameTeam(event.Team,match.HomeTeam)?'event-home':'event-away'; return \`\<div class="event-row ${side}">\<div class="event-minute">${escapeHTML(event.Minute)}'\</div>\<div class="event-content">${getEventLabel(event,liveHome,liveAway)}\</div>\</div>\`; }
function getEventLabel(event,liveHome,liveAway){
&#x20; const type=String(event.Event||'').toLowerCase().trim(), detail=String(event.Detail||'').trim(), player=String(event.Player||'').trim();
&#x20; const playerLabel=renderPlayerLink(player);
&#x20; const detailLabel=renderEventDetail(detail);
&#x20; if(type==='goal') return \`\<span class="goal-pill">⚽ ${liveHome} - ${liveAway}\</span>${playerLabel}${detailLabel}\`;
&#x20; if(type==='yellow card') return \`\<span>🟨\</span>${playerLabel}${detailLabel}\`;
&#x20; if(type==='red card') return \`\<span>🟥\</span>${playerLabel}${detailLabel}\`;
&#x20; if(type==='penalty missed'||type==='missed penalty') return \`\<span>❌\</span>${playerLabel}\<span class="event-detail">(Penalty missed)\</span>\`;
&#x20; return \`\<span>•\</span>${playerLabel}${detailLabel}\`;
}
function renderEventDetail(detail){
&#x20; const cleanDetail=cleanEventDetail(detail);
&#x20; if(!cleanDetail) return '';
&#x20; const assist=String(detail||'').match(/(?:^|,\s\*)Assist:\s\*(.+)$/i)?.[1]?.trim();
&#x20; if(assist) return \`\<span class="event-detail event-assist">(Assist: ${renderPlayerLink(assist)})\</span>\`;
&#x20; return \`\<span class="event-detail">(${escapeHTML(cleanDetail)})\</span>\`;
}

function renderTimelineEvents(events,match){ if(!events.length) return '\<div class="empty">No events.\</div>'; let liveHome=0, liveAway=0; const rows=events.map(e=>{ if(isGoalEvent(e)){ if(sameTeam(e.Team,match.HomeTeam)) liveHome++; if(sameTeam(e.Team,match.AwayTeam)) liveAway++; } return renderEventRow(e,match,liveHome,liveAway); }).join(''); return \`\<div class="timeline-block">${rows}\</div>\`; }
function cleanEventDetail(detail){ const text=String(detail||'').trim(); if(!text) return ''; return text.replace(/^Assist:\s\*/i,'').replace(/^Penalty,\s\*Assist:\s\*/i,'Penalty, ').replace(/,\s\*Assist:\s\*/i,', '); }
function getMatchMOTM(match){ if(match.MOTM) return match.MOTM; const matchId=match.MatchID||match.ID; const row=(appData.matchData||appData.data||[]).find(item=>(item.MatchID||item['Match ID'])===matchId); return row ? (row\.MOTM || row\.Motm || '') : ''; }
function renderHighlights(url){ const cleanUrl=String(url||'').trim(); if(!cleanUrl) return ''; const id=getYouTubeId(cleanUrl); if(!id) return \`\<section class="highlights-card">\<div class="highlights-header">\<span>📺 Highlights\</span>\<a href="${escapeAttr(cleanUrl)}" target="\_blank" rel="noopener noreferrer">Open video\</a>\</div>\</section>\`; return \`\<section class="highlights-card">\<div class="highlights-header">\<span>📺 Highlights\</span>\<a href="${escapeAttr(cleanUrl)}" target="\_blank" rel="noopener noreferrer">Open on YouTube\</a>\</div>\<a class="youtube-preview" href="${escapeAttr(cleanUrl)}" target="\_blank" rel="noopener noreferrer">\<img src="[https://img.youtube.com/vi/${escapeAttr(id)}/maxresdefault.jpg](https://img.youtube.com/vi/${escapeAttr\(id\)}/maxresdefault.jpg)" alt="YouTube highlights thumbnail" onerror="this.src='[https://img.youtube.com/vi/${escapeAttr(id)}/hqdefault.jpg](https://img.youtube.com/vi/${escapeAttr\(id\)}/hqdefault.jpg)'">\<span class="youtube-play">▶\</span>\</a>\</section>\`; }
function getYouTubeId(url){ const text=String(url||'').trim(); const patterns=[/youtube\\.com\\/watch\\?v=([^&]+)/i,/youtu\\.be\\/([^?&]+)/i,/youtube\\.com\\/shorts\\/([^?&]+)/i,/youtube\\.com\\/embed\\/([^?&]+)/i]; for(const p of patterns){ const m=text.match(p); if(m?.[1]) return m[1]; } return ''; }

function openPlayerProfile(playerName,event){
&#x20; event?.stopPropagation?.(); activePlayerProfileName=String(playerName||'').trim(); activePlayerSeason=String(getCurrentSeasonYear());
&#x20; renderActivePlayerProfile(); $('playerModal')?.classList.remove('hidden'); document.body.classList.add('modal-open');
}
window\.openPlayerProfile=openPlayerProfile;
function closePlayerProfile(){ $('playerModal')?.classList.add('hidden'); if($('matchModal')?.classList.contains('hidden')&&$('teamModal')?.classList.contains('hidden')) document.body.classList.remove('modal-open'); }
window\.closePlayerProfile=closePlayerProfile;
function renderActivePlayerProfile(){ if($('playerDetailContent')) $('playerDetailContent').innerHTML=renderPlayerProfile(activePlayerProfileName,activePlayerSeason); }
function changePlayerSeason(value){ activePlayerSeason=String(value); renderActivePlayerProfile(); }
window\.changePlayerSeason=changePlayerSeason;
function getCurrentSeasonYear(date=new Date()){ return date.getMonth()>=7?date.getFullYear()+1:date.getFullYear(); }
function getSeasonYearForDate(value){ const d=parseDateOnly(value); return d?(d.getMonth()>=7?d.getFullYear()+1:d.getFullYear()):''; }
function isPlayedMatch(match){
&#x20; if(String(match?.Status||'').toUpperCase()==='FT') return true;
&#x20; const home=String(match?.HomeScore??'').trim();
&#x20; const away=String(match?.AwayScore??'').trim();
&#x20; return /^\d+$/.test(home) && /^\d+$/.test(away);
}
function renderPlayerProfile(playerName,seasonYear=getCurrentSeasonYear()){
&#x20; const name=String(playerName||'').trim(),assignments=playerTeamsLookup.get(normalisePlayerName(name))||[],allMatches=getPlayerMatches(assignments,name);
&#x20; const current=String(getCurrentSeasonYear()),seasons=[...new Set(allMatches.map(x=>String(getSeasonYearForDate(x.match.Date))).filter(Boolean))];
&#x20; if(!seasons.includes(current)) seasons.push(current); seasons.sort((a,b)=>Number(b)-Number(a));
&#x20; const selected=seasons.includes(String(seasonYear))?String(seasonYear):current,matches=allMatches.filter(x=>String(getSeasonYearForDate(x.match.Date))===selected);
&#x20; const totals=matches.reduce((s,x)=>{s.goals+=x.stats.goals;s.assists+=x.stats.assists;s.yellow+=x.stats.yellow;s.red+=x.stats.red;return s},{goals:0,assists:0,yellow:0,red:0});
&#x20; const national=assignments.find(x=>normaliseText(x.teamType)==='national team'),clubs=assignments.filter(x=>normaliseText(x.teamType)==='club');
&#x20; const teams=assignments.length?assignments.map(renderPlayerTeamAssignment).join(''):'\<div class="empty">Team information has not been added yet.\</div>';
&#x20; const rows=matches.length?matches.map(renderPlayerMatchRow).join(''):'\<div class="empty">No played games are available for this player in this season.\</div>';
&#x20; const options=seasons.map(y=>\`\<option value="${escapeAttr(y)}" ${y===selected?'selected':''}>${escapeHTML(y)}\</option>\`).join('');
&#x20; return \`\<section class="player-profile-hero">\<div class="player-profile-photo">${renderPlayerImage(name)}\</div>\<div class="player-profile-copy">\<div class="eyebrow">Player profile\</div>\<h2>${escapeHTML(name)}\</h2>${national?\`\<p>🌍 ${escapeHTML(national.team)}\</p>\`:''}${clubs.length?\`\<p>${clubs.map(x=>escapeHTML(x.team)).join(' · ')}\</p>\`:''}\</div>\<label class="profile-season-select">\<span>Season\</span>\<select onchange="changePlayerSeason(this.value)">${options}\</select>\</label>\</section>\<section class="player-summary-grid">\<div>\<strong>${matches.length}\</strong>\<span>Games\</span>\</div>\<div>\<strong>${totals.goals}\</strong>\<span>Goals\</span>\</div>\<div>\<strong>${totals.assists}\</strong>\<span>Assists\</span>\</div>\<div>\<strong>${totals.yellow}\</strong>\<span>Yellow\</span>\</div>\<div>\<strong>${totals.red}\</strong>\<span>Red\</span>\</div>\</section>\<section class="player-teams-section">\<h3>Teams\</h3>${teams}\</section>\<section class="player-matches-section">\<h3>Played games · ${escapeHTML(selected)}\</h3>${rows}\</section>\`;
}
function renderPlayerTeamAssignment(item){
&#x20; const dates=item.startDate||item.endDate?\`${item.startDate||'Beginning'} → ${item.endDate||'Present'}\`:'Dates not restricted';
&#x20; return \`\<div class="player-team-row">${renderTeamLogo(findTeamLogo(item.team),item.team)}\<span>\<strong>${escapeHTML(item.team)}\</strong>\<small>${escapeHTML(item.teamType||'Team')} · ${escapeHTML(dates)}\</small>\</span>\</div>\`;
}
function getPlayerMatches(assignments,playerName){
&#x20; if(!assignments.length) return [];
&#x20; const matches=dedupeMatchArray(getGlobalMatches().concat(getCompetitionMatches()).concat(Array.isArray(appData?.myGames)?appData.myGames:[]));
&#x20; return matches.filter(match=>isPlayedMatch(match)&&assignments.some(item=>assignmentIncludesMatch(item,match))).map(match=>({match,stats:getPlayerMatchStats(match,playerName)})).sort((a,b)=>matchDateSortValue(b.match)-matchDateSortValue(a.match));
}
function assignmentIncludesMatch(item,match){
&#x20; if(normaliseText(item.includeGames)==='no') return false;
&#x20; const team=normaliseTeamName(item.team);
&#x20; if(team!==normaliseTeamName(match.HomeTeam)&&team!==normaliseTeamName(match.AwayTeam)) return false;
&#x20; const date=getDateKey(match.Date);
&#x20; if(item.startDate&&date\<getDateKey(item.startDate)) return false;
&#x20; if(item.endDate&&date>getDateKey(item.endDate)) return false;
&#x20; return true;
}
function getPlayerMatchStats(match,playerName){
&#x20; const key=normalisePlayerName(playerName);
&#x20; const totals={goals:0,assists:0,yellow:0,red:0};
&#x20; getMatchEvents(match.MatchID||match.ID).forEach(event=>{
&#x20;   const type=normaliseText(event.Event),player=normalisePlayerName(event.Player);
&#x20;   if(player===key){ if(type==='goal') totals.goals++; if(type==='yellow card') totals.yellow++; if(type==='red card') totals.red++; }
&#x20;   const assist=String(event.Detail||'').match(/(?:^|,\s\*)Assist:\s\*(.+)$/i)?.[1]?.trim();
&#x20;   if(assist&&normalisePlayerName(assist)===key) totals.assists++;
&#x20; });
&#x20; return totals;
}
function renderPlayerMatchRow(item){
&#x20; const match=item.match,s=item.stats,click=match.MatchID?\`onclick="closePlayerProfile();openMatchDetail('${escapeAttr(match.MatchID)}')"\`:'';
&#x20; const badges=[s.goals?\`⚽ ${s.goals}\`:'',s.assists?\`A ${s.assists}\`:'',s.yellow?\`🟨 ${s.yellow}\`:'',s.red?\`🟥 ${s.red}\`:''].filter(Boolean).join(' ');
&#x20; return \`\<button class="player-match-row" type="button" ${click}>\<span class="player-match-date">${escapeHTML(formatScoreboardDateParts(match.Date,match.Time).date)}\</span>\<span class="player-match-teams">\<strong>${escapeHTML(match.HomeTeam)} ${escapeHTML(renderScoreText(match))} ${escapeHTML(match.AwayTeam)}\</strong>\<small>${escapeHTML(match.Competition||match['Competition Name']||match.Round||'')}\</small>\</span>\<span class="player-match-events">${badges||'—'}\</span>\</button>\`;
}

function getMasterSearchItems(){
&#x20;const players=[],seenP=new Set(),teams=[],seenT=new Set();
&#x20;const addP=n=>{n=String(n||'').trim();const k=normalisePlayerName(n);if(n&&!seenP.has(k)){seenP.add(k);players.push(n)}};
&#x20;const addT=n=>{n=String(n||'').trim();const k=normaliseTeamName(n);if(n&&!seenT.has(k)){seenT.add(k);teams.push(n)}};
&#x20;(appData?.players||[]).forEach(r=>addP(r?.['Player Name']??r?.Player??r?.Name??r?.[0]));
&#x20;(appData?.playerTeams||[]).forEach(r=>{addP(r?.['Player Name']??r?.Player??r?.[0]);addT(r?.Team??r?.[1])});
&#x20;getGlobalMatches().concat(getCompetitionMatches()).concat(appData?.myGames||[]).forEach(m=>{addT(m.HomeTeam);addT(m.AwayTeam)});
&#x20;return {players,teams};
}
function renderMasterSearchResults(value){
&#x20;const box=$('masterSearchResults'),q=normaliseText(value); $('masterSearchClear')?.classList.toggle('hidden',!q);
&#x20;if(!box)return;if(!q){box.classList.add('hidden');box.innerHTML='';return}
&#x20;const data=getMasterSearchItems(),players=data.players.filter(n=>normaliseText(n).includes(q)).slice(0,8),teams=data.teams.filter(n=>normaliseText(n).includes(q)).slice(0,8);
&#x20;box.innerHTML=(players.length?\`\<div class="master-search-label">Players\</div>${players.map(n=>\`\<button class="master-search-result" onclick="selectMasterPlayer('${escapeAttr(n)}')">${renderPlayerImage(n)}\<strong>${escapeHTML(n)}\</strong>\</button>\`).join('')}\`:'')+(teams.length?\`\<div class="master-search-label">Teams\</div>${teams.map(n=>\`\<button class="master-search-result" onclick="selectMasterTeam('${escapeAttr(n)}')">${renderTeamLogo(findTeamLogo(n),n)}\<strong>${escapeHTML(n)}\</strong>\</button>\`).join('')}\`:'')+(!players.length&&!teams.length?'\<div class="empty">No players or teams found.\</div>':''); box.classList.remove('hidden');
}
function clearMasterSearch(){if($('masterSearchInput'))$('masterSearchInput').value='';$('masterSearchResults')?.classList.add('hidden');$('masterSearchClear')?.classList.add('hidden')}
window\.clearMasterSearch=clearMasterSearch;
function selectMasterPlayer(n){clearMasterSearch();openPlayerProfile(n)} window\.selectMasterPlayer=selectMasterPlayer;
function selectMasterTeam(n){clearMasterSearch();openTeamProfile(n)} window\.selectMasterTeam=selectMasterTeam;
function openTeamProfile(teamName){if(!$('teamModal')||!$('teamDetailContent'))return;$('teamDetailContent').innerHTML=renderTeamProfile(teamName);$('teamModal').classList.remove('hidden');document.body.classList.add('modal-open')}
window\.openTeamProfile=openTeamProfile;
function closeTeamProfile(){$('teamModal')?.classList.add('hidden');if($('matchModal')?.classList.contains('hidden')&&$('playerModal')?.classList.contains('hidden'))document.body.classList.remove('modal-open')}
window\.closeTeamProfile=closeTeamProfile;
function renderTeamProfile(teamName){
&#x20;const name=String(teamName||'').trim(),key=normaliseTeamName(name);
&#x20;const matches=dedupeMatchArray(getGlobalMatches().concat(getCompetitionMatches()).concat(appData?.myGames||[])).filter(m=>isPlayedMatch(m)&&(normaliseTeamName(m.HomeTeam)===key||normaliseTeamName(m.AwayTeam)===key)).sort((a,b)=>matchDateSortValue(b)-matchDateSortValue(a));
&#x20;const seen=new Set(),squad=[];(appData?.playerTeams||[]).forEach(r=>{const t=String(r?.Team??r?.[1]??''),p=String(r?.['Player Name']??r?.Player??r?.[0]??'').trim(),pk=normalisePlayerName(p);if(p&&normaliseTeamName(t)===key&&!seen.has(pk)){seen.add(pk);squad.push(p)}});
&#x20;const sq=squad.length?squad.sort().map(p=>\`\<button class="team-squad-player" onclick="closeTeamProfile();openPlayerProfile('${escapeAttr(p)}')">${renderPlayerImage(p)}\<strong>${escapeHTML(p)}\</strong>\</button>\`).join(''):'\<div class="empty">No squad players found.\</div>';
&#x20;const games=matches.length?matches.map(m=>\`\<button class="team-profile-match" ${m.MatchID?\`onclick="closeTeamProfile();openMatchDetail('${escapeAttr(m.MatchID)}')"\`:''}>\<span>${escapeHTML(formatScoreboardDateParts(m.Date,m.Time).date)}\</span>\<span>\<strong>${escapeHTML(m.HomeTeam)} ${escapeHTML(renderScoreText(m))} ${escapeHTML(m.AwayTeam)}\</strong>\<small>${escapeHTML(m.Competition||m['Competition Name']||'Competition')}\</small>\</span>\</button>\`).join(''):'\<div class="empty">No played games found.\</div>';
&#x20;return \`\<section class="team-profile-hero">${renderTeamLogo(findTeamLogo(name),name)}\<div>\<div class="eyebrow">Team profile\</div>\<h2>${escapeHTML(name)}\</h2>\</div>\</section>\<section class="team-profile-section">\<h3>Squad\</h3>\<div class="team-squad-grid">${sq}\</div>\</section>\<section class="team-profile-section">\<h3>All played games\</h3>${games}\</section>\`;
}

function getCompetitionMatches(){ return dedupeMatchArray((Array.isArray(appData?.matches)?appData.matches:[]).concat(Array.isArray(appData?.playoffs)?appData.playoffs:[])); }
function getGlobalMatches(){ return dedupeMatchArray(Array.isArray(appData?.allMatches)?appData.allMatches:[]); }
function findTeamLogo(teamName){
&#x20; const team=normaliseTeamName(teamName);
&#x20; const directLogo = teamLogoLookup.get(team);
&#x20; if(directLogo) return directLogo;

&#x20; const matches=getGlobalMatches().concat(getCompetitionMatches()).concat(Array.isArray(appData?.myGames)?appData.myGames:[]);
&#x20; for(const match of matches){
&#x20;   if(normaliseTeamName(match.HomeTeam)===team&&match.HomeLogo) return match.HomeLogo;
&#x20;   if(normaliseTeamName(match.AwayTeam)===team&&match.AwayLogo) return match.AwayLogo;
&#x20; }
&#x20; return '';
}

function getStandingTeamLogo(standing){
&#x20; if(standing?.Logo) return standing.Logo;

&#x20; const team=normaliseTeamName(standing?.Team);
&#x20; if(!team) return '';

&#x20; const directLogo = teamLogoLookup.get(team);
&#x20; if(directLogo) return directLogo;

&#x20; const matches=[]
&#x20;   .concat(Array.isArray(appData?.matches)?appData.matches:[])
&#x20;   .concat(Array.isArray(appData?.playoffs)?appData.playoffs:[])
&#x20;   .concat(Array.isArray(appData?.allMatches)?appData.allMatches:[])
&#x20;   .concat(Array.isArray(appData?.myGames)?appData.myGames:[]);

&#x20; for(const match of matches){
&#x20;   if(normaliseTeamName(match?.HomeTeam)===team&&match?.HomeLogo) return match.HomeLogo;
&#x20;   if(normaliseTeamName(match?.AwayTeam)===team&&match?.AwayLogo) return match.AwayLogo;
&#x20; }

&#x20; return '';
}
function dedupeMatchArray(matches){ const seen=new Set(); return (matches||[]).filter(m=>{ const key=String(m.MatchID||m.ID||'').trim(); if(!key||seen.has(key)) return false; seen.add(key); return true; }); }
function getFilteredMatches(){ let matches=getCompetitionMatches(); if(currentSearch) matches=matches.filter(m=>[m.HomeTeam,m.AwayTeam,m.Round,m.Competition,m.Date,m.Time].join(' ').toLowerCase().includes(currentSearch)); if(currentRound){ const key=normaliseText(currentRound); matches=matches.filter(m=>normaliseText(m.Round)===key); } if(currentGroup){ const key=normaliseText(currentGroup); const teams=(appData.standings||[]).filter(r=>normaliseText(getStandingGroupKey(r))===key).map(r=>normaliseTeamName(r.Team)).filter(Boolean); matches=matches.filter(m=>teams.includes(normaliseTeamName(m.HomeTeam))||teams.includes(normaliseTeamName(m.AwayTeam))||normaliseText(m.Round)===key||normaliseText(m.Round).includes(key)); } return matches; }
function getFilteredStandings(){ let standings=appData.standings||[]; if(currentSearch) standings=standings.filter(r=>[r.Team,r.League,r.Group,r.Competition].join(' ').toLowerCase().includes(currentSearch)); if(currentGroup) standings=standings.filter(r=>normaliseText(getStandingGroupKey(r))===normaliseText(currentGroup)); return standings; }
function getFilteredStats(){ let stats=appData.stats||[]; if(currentSearch) stats=stats.filter(r=>[r.Player,r.Team].join(' ').toLowerCase().includes(currentSearch)); return stats; }
function getNextUpRound(matches){ const ordered=[...matches].sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); const now=Date.now()-86400000; const next=ordered.find(m=>m.Status!=='FT'&&matchDateSortValue(m)>=now); if(next) return next.Round||''; const completed=ordered.filter(m=>m.Status==='FT'&&matchDateSortValue(m)>0).sort((a,b)=>matchDateSortValue(b)-matchDateSortValue(a)); return completed.length?completed[0].Round||'':''; }
const TABLE\_TIEBREAKER\_RULES = {
&#x20; 'premier-league': ['goalDifference','goalsFor','headToHeadPoints','headToHeadAwayGoals'],
&#x20; 'serie-a': ['headToHeadPoints','headToHeadGoalDifference','goalDifference','goalsFor'],
&#x20; 'la-liga': ['headToHeadPoints','headToHeadGoalDifference','goalDifference','goalsFor','fairPlayPoints'],
&#x20; 'bundesliga': ['goalDifference','goalsFor','headToHeadPoints','headToHeadGoalDifference','headToHeadAwayGoals','awayGoals'],
&#x20; 'ligue-1': ['goalDifference','headToHeadPoints','headToHeadGoalDifference','goalsFor','won','awayWins','disciplinaryPoints'],
&#x20; 'champions-league': ['goalDifference','goalsFor','awayGoals','won','awayWins','opponentsPoints','opponentsGoalDifference','opponentsGoalsFor','disciplinaryPoints','clubCoefficient'],
&#x20; 'nations-league': ['headToHeadPoints','headToHeadGoalDifference','headToHeadGoalsFor','goalDifference','goalsFor','awayGoals','won','awayWins','disciplinaryPoints','accessListRank'],
&#x20; 'europa-league-old-groups': ['headToHeadPoints','headToHeadGoalDifference','headToHeadGoalsFor','goalDifference','goalsFor','awayGoals','won','awayWins','disciplinaryPoints','clubCoefficient'],
&#x20; 'conference-league-old-groups': ['headToHeadPoints','headToHeadGoalDifference','headToHeadGoalsFor','goalDifference','goalsFor','awayGoals','won','awayWins','disciplinaryPoints','clubCoefficient'],
&#x20; default: ['goalDifference','goalsFor','goalsAgainst']
};

function compareStandingRows(a,b){
&#x20; const pA=safeNumber(a.Points), pB=safeNumber(b.Points);
&#x20; if(pB!==pA) return pB-pA;

&#x20; const tiedTeams=(appData.standings||[]).filter(r=>
&#x20;   getStandingGroupKey(r)===getStandingGroupKey(a) &&
&#x20;   safeNumber(r.Points)===pA
&#x20; );

&#x20; const ruleKey=getStandingsRuleKey();
&#x20; const rules=TABLE\_TIEBREAKER\_RULES[ruleKey] || TABLE\_TIEBREAKER\_RULES.default;

&#x20; for(const metric of rules){
&#x20;   const result=compareStandingMetric(a,b,metric,tiedTeams);
&#x20;   if(result!==0) return result;
&#x20; }

&#x20; // Final stable fallback for criteria that are not in the sheets yet
&#x20; // such as fair play, UEFA access list, coefficients or drawing lots.
&#x20; return String(a.Team||'').localeCompare(String(b.Team||''));
}

function getStandingsRuleKey(){
&#x20; const selected=appData?.selectedCompetition||{};
&#x20; const site=appData?.site||{};
&#x20; const name=slugify(normaliseCompetitionName(
&#x20;   selected['Competition Name'] || selected.competition || site.competition || currentCompetition || ''
&#x20; ));
&#x20; const type=normaliseText(selected['Competition Type'] || selected.CompetitionType || site.competitionType || appData?.competitionType || '');

&#x20; if(name.includes('premier-league')) return 'premier-league';
&#x20; if(name.includes('serie-a')) return 'serie-a';
&#x20; if(name.includes('la-liga') || name.includes('laliga')) return 'la-liga';
&#x20; if(name.includes('bundesliga')) return 'bundesliga';
&#x20; if(name.includes('ligue-1') || name.includes('ligue1')) return 'ligue-1';
&#x20; if(name.includes('champions-league')) return 'champions-league';
&#x20; if(name.includes('nations-league')) return 'nations-league';

&#x20; // The user's Europa League / Conference League data is the old 8-group format.
&#x20; if(name.includes('europa-league') && !type.includes('league phase')) return 'europa-league-old-groups';
&#x20; if(name.includes('conference-league') && !type.includes('league phase')) return 'conference-league-old-groups';

&#x20; return 'default';
}

function compareStandingMetric(a,b,metric,tiedTeams){
&#x20; const direction = ['disciplinaryPoints','fairPlayPoints','goalsAgainst','accessListRank'].includes(metric) ? 'asc' : 'desc';
&#x20; const aValue = getStandingMetricValue(a,metric,tiedTeams);
&#x20; const bValue = getStandingMetricValue(b,metric,tiedTeams);

&#x20; if(aValue===bValue) return 0;
&#x20; return direction==='asc' ? aValue-bValue : bValue-aValue;
}

function getStandingMetricValue(row,metric,tiedTeams){
&#x20; const teamKey=normaliseTeamName(row\.Team);
&#x20; const h2h=getHeadToHeadStatsForTie(tiedTeams || []);
&#x20; const overall=getOverallMatchStatsForTable(tiedTeams || []);
&#x20; const opponents=getOpponentStrengthStatsForTable(tiedTeams || []);

&#x20; switch(metric){
&#x20;   case 'goalDifference': return safeNumber(row\.GoalDifference);
&#x20;   case 'goalsFor': return safeNumber(row\.GoalsFor);
&#x20;   case 'goalsAgainst': return safeNumber(row\.GoalsAgainst);
&#x20;   case 'won': return safeNumber(row\.Won);
&#x20;   case 'awayGoals': return getOptionalOrCalculated(row,'AwayGoals',overall[teamKey]?.awayGoals);
&#x20;   case 'awayWins': return getOptionalOrCalculated(row,'AwayWins',overall[teamKey]?.awayWins);
&#x20;   case 'disciplinaryPoints': return getOptionalOrCalculated(row,'DisciplinaryPoints',0);
&#x20;   case 'fairPlayPoints': return getOptionalOrCalculated(row,'FairPlayPoints',0);
&#x20;   case 'clubCoefficient': return getOptionalOrCalculated(row,'ClubCoefficient',0);
&#x20;   case 'accessListRank': return getOptionalOrCalculated(row,'AccessListRank',9999);
&#x20;   case 'opponentsPoints': return opponents[teamKey]?.points || 0;
&#x20;   case 'opponentsGoalDifference': return opponents[teamKey]?.goalDifference || 0;
&#x20;   case 'opponentsGoalsFor': return opponents[teamKey]?.goalsFor || 0;
&#x20;       case 'headToHeadPoints':
&#x20;     if(!isHeadToHeadTieReady(tiedTeams || [])) return 0;
&#x20;     return h2h[teamKey]?.points || 0;

&#x20;   case 'headToHeadGoalDifference':
&#x20;     if(!isHeadToHeadTieReady(tiedTeams || [])) return 0;
&#x20;     return h2h[teamKey]?.goalDifference || 0;

&#x20;   case 'headToHeadGoalsFor':
&#x20;     if(!isHeadToHeadTieReady(tiedTeams || [])) return 0;
&#x20;     return h2h[teamKey]?.goalsFor || 0;

&#x20;   case 'headToHeadAwayGoals':
&#x20;     if(!isHeadToHeadTieReady(tiedTeams || [])) return 0;
&#x20;     return h2h[teamKey]?.awayGoals || 0;
&#x20; }
}

function getOptionalOrCalculated(row,key,calculatedValue){
&#x20; const own = Number(row?.[key]);
&#x20; if(Number.isFinite(own) && own !== 0) return own;
&#x20; const calculated = Number(calculatedValue);
&#x20; return Number.isFinite(calculated) ? calculated : 0;
}

function getHeadToHeadStatsForTie(tiedTeams){
&#x20; const keys=(tiedTeams||[]).map(t=>normaliseTeamName(t.Team)).filter(Boolean);
&#x20; const uniqueKeys=[...new Set(keys)];
&#x20; const output={};

&#x20; uniqueKeys.forEach(key=>{
&#x20;   const row=(tiedTeams||[]).find(t=>normaliseTeamName(t.Team)===key) || {};
&#x20;   output[key]={team:row\.Team||'',points:0,goalsFor:0,goalsAgainst:0,goalDifference:0,awayGoals:0,wins:0,awayWins:0,matches:0};
&#x20; });

&#x20; if(uniqueKeys.length<2) return output;

&#x20; getCompetitionMatches().forEach(match=>{
&#x20;   if(!isPlayedMatch(match)) return;

&#x20;   const home=normaliseTeamName(match.HomeTeam);
&#x20;   const away=normaliseTeamName(match.AwayTeam);
&#x20;   if(!output[home] || !output[away]) return;

&#x20;   const homeScore=safeNumber(match.HomeScore);
&#x20;   const awayScore=safeNumber(match.AwayScore);

&#x20;   output[home].matches += 1;
&#x20;   output[away].matches += 1;

&#x20;   output[home].goalsFor += homeScore;
&#x20;   output[home].goalsAgainst += awayScore;
&#x20;   output[home].goalDifference += homeScore-awayScore;

&#x20;   output[away].goalsFor += awayScore;
&#x20;   output[away].goalsAgainst += homeScore;
&#x20;   output[away].goalDifference += awayScore-homeScore;
&#x20;   output[away].awayGoals += awayScore;

&#x20;   if(homeScore>awayScore){
&#x20;     output[home].points += 3;
&#x20;     output[home].wins += 1;
&#x20;   } else if(awayScore>homeScore){
&#x20;     output[away].points += 3;
&#x20;     output[away].wins += 1;
&#x20;     output[away].awayWins += 1;
&#x20;   } else {
&#x20;     output[home].points += 1;
&#x20;     output[away].points += 1;
&#x20;   }
&#x20; });

&#x20; return output;
}
function isHeadToHeadTieReady(tiedTeams){

&#x20; const keys = [...new Set(
&#x20;   (tiedTeams || [])
&#x20;     .map(team => normaliseTeamName(team.Team))
&#x20;     .filter(Boolean)
&#x20; )];

&#x20; if(keys.length < 2){
&#x20;   return false;
&#x20; }

&#x20; let playedHeadToHeadMatches = 0;

&#x20; getCompetitionMatches().forEach(match => {
&#x20;   if(!isPlayedMatch(match)) return;

&#x20;   const home = normaliseTeamName(match.HomeTeam);
&#x20;   const away = normaliseTeamName(match.AwayTeam);

&#x20;   if(keys.includes(home) && keys.includes(away)){
&#x20;     playedHeadToHeadMatches += 1;
&#x20;   }
&#x20; });

&#x20; const competitionKey = getStandingsRuleKey();

&#x20; const doubleRoundRobinCompetitions = [
&#x20;   'serie-a',
&#x20;   'la-liga',
&#x20;   'bundesliga',
&#x20;   'ligue-1',
&#x20;   'premier-league',
&#x20;   'europa-league-old-groups',
&#x20;   'conference-league-old-groups',
&#x20;   'nations-league'
&#x20; ];

&#x20; if(doubleRoundRobinCompetitions.includes(competitionKey)){
&#x20;   const requiredMatches = keys.length \* (keys.length - 1);
&#x20;   return playedHeadToHeadMatches >= requiredMatches;
&#x20; }

&#x20; return playedHeadToHeadMatches > 0;
}
function getOverallMatchStatsForTable(tableRows){
&#x20; const keys=(tableRows||[]).map(row=>normaliseTeamName(row\.Team)).filter(Boolean);
&#x20; const output={};

&#x20; keys.forEach(key=>{
&#x20;   output[key]={awayGoals:0,awayWins:0,wins:0};
&#x20; });

&#x20; getCompetitionMatches().forEach(match=>{
&#x20;   if(!isPlayedMatch(match)) return;

&#x20;   const home=normaliseTeamName(match.HomeTeam);
&#x20;   const away=normaliseTeamName(match.AwayTeam);
&#x20;   if(!output[home] && !output[away]) return;

&#x20;   const homeScore=safeNumber(match.HomeScore);
&#x20;   const awayScore=safeNumber(match.AwayScore);

&#x20;   if(output[home] && homeScore>awayScore) output[home].wins += 1;
&#x20;   if(output[away]){
&#x20;     output[away].awayGoals += awayScore;
&#x20;     if(awayScore>homeScore){
&#x20;       output[away].wins += 1;
&#x20;       output[away].awayWins += 1;
&#x20;     }
&#x20;   }
&#x20; });

&#x20; return output;
}

function getOpponentStrengthStatsForTable(tableRows){
&#x20; const standingLookup={};
&#x20; (tableRows||[]).forEach(row=>{
&#x20;   const key=normaliseTeamName(row\.Team);
&#x20;   if(key) standingLookup[key]=row;
&#x20; });

&#x20; const output={};
&#x20; Object.keys(standingLookup).forEach(key=>{
&#x20;   output[key]={points:0,goalDifference:0,goalsFor:0};
&#x20; });

&#x20; getCompetitionMatches().forEach(match=>{
&#x20;   if(!isPlayedMatch(match)) return;

&#x20;   const home=normaliseTeamName(match.HomeTeam);
&#x20;   const away=normaliseTeamName(match.AwayTeam);

&#x20;   if(output[home] && standingLookup[away]){
&#x20;     output[home].points += safeNumber(standingLookup[away].Points);
&#x20;     output[home].goalDifference += safeNumber(standingLookup[away].GoalDifference);
&#x20;     output[home].goalsFor += safeNumber(standingLookup[away].GoalsFor);
&#x20;   }

&#x20;   if(output[away] && standingLookup[home]){
&#x20;     output[away].points += safeNumber(standingLookup[home].Points);
&#x20;     output[away].goalDifference += safeNumber(standingLookup[home].GoalDifference);
&#x20;     output[away].goalsFor += safeNumber(standingLookup[home].GoalsFor);
&#x20;   }
&#x20; });

&#x20; return output;
}

function getMiniTableRank(tiedTeams){
&#x20; const rules=['headToHeadPoints','headToHeadGoalDifference','headToHeadGoalsFor','headToHeadAwayGoals'];
&#x20; const rows=[...(tiedTeams||[])];
&#x20; const ranked=rows.sort((a,b)=>{
&#x20;   for(const metric of rules){
&#x20;     const result=compareStandingMetric(a,b,metric,tiedTeams);
&#x20;     if(result!==0) return result;
&#x20;   }
&#x20;   return String(a.Team||'').localeCompare(String(b.Team||''));
&#x20; });

&#x20; const output={};
&#x20; ranked.forEach((item,index)=>{
&#x20;   output[normaliseTeamName(item.Team)]=index;
&#x20; });
&#x20; return output;
}

function getHeadToHeadWinner(a,b){
&#x20; const rows=[{Team:a},{Team:b}];
&#x20; const stats=getHeadToHeadStatsForTie(rows);
&#x20; const aKey=normaliseTeamName(a), bKey=normaliseTeamName(b);
&#x20; const aStats=stats[aKey] || {};
&#x20; const bStats=stats[bKey] || {};

&#x20; if((aStats.points||0)!==(bStats.points||0)) return (aStats.points||0)>(bStats.points||0)?a:b;
&#x20; if((aStats.goalDifference||0)!==(bStats.goalDifference||0)) return (aStats.goalDifference||0)>(bStats.goalDifference||0)?a:b;
&#x20; if((aStats.goalsFor||0)!==(bStats.goalsFor||0)) return (aStats.goalsFor||0)>(bStats.goalsFor||0)?a:b;
&#x20; if((aStats.awayGoals||0)!==(bStats.awayGoals||0)) return (aStats.awayGoals||0)>(bStats.awayGoals||0)?a:b;

&#x20; return '';
}
function renderCompetitionCategoryNav(){ const nav=$('competitionCategoryNav'); if(!nav||!appData?.competitions) return; const home=\`\<div class="competition-category ${isHomePage()?'is-active':''}">\<button type="button" class="category-button" onclick="goHomePage()">\<span class="category-icon">🏠\</span>\<span class="category-name">Home\</span>\</button>\</div>\`; nav.innerHTML=home+getCompetitionCategories().map(cat=>{ const comps=getUniqueCompetitionsForCategory(cat.key); const active=!isHomePage()&&comps.some(c=>normaliseCompetitionName(c['Competition Name'])===normaliseCompetitionName(appData.selectedCompetition?.['Competition Name'])&&getCompetitionCategoryKey(c)===getCompetitionCategoryKey(appData.selectedCompetition||{})); const items=comps.length?comps.map(comp=>{ const latest=getLatestSeasonForCompetition(comp); const slug=makeCompetitionSlug(latest); const isActive=!isHomePage()&&normaliseCompetitionName(comp['Competition Name'])===normaliseCompetitionName(appData.selectedCompetition?.['Competition Name'])&&getCompetitionCategoryKey(comp)===getCompetitionCategoryKey(appData.selectedCompetition||{}); return \`\<button type="button" class="category-menu-item ${isActive?'active-item':''}" onclick="selectCompetitionFromCategory('${escapeAttr(slug)}')">\<span>${escapeHTML(comp['Competition Name']||'Competition')}\</span>${isActive?'\<strong>Current\</strong>':''}\</button>\`; }).join(''):\`\<div class="category-empty">No competitions yet\</div>\`; return \`\<div class="competition-category ${active?'is-active':''} ${comps.length?'':'is-empty'}">\<button type="button" class="category-button" onclick="toggleCompetitionCategory('${escapeAttr(cat.key)}')">\<span class="category-icon">${cat.icon}\</span>\<span class="category-name">${escapeHTML(cat.label)}\</span>\<span class="category-arrow">⌄\</span>\</button>\<div class="category-menu" data-category-menu="${escapeAttr(cat.key)}">\<div class="category-menu-title">\<span>${cat.icon}\</span>\<strong>${escapeHTML(cat.label)}\</strong>\</div>${items}\</div>\</div>\`; }).join(''); }
function getCompetitionCategories(){ return [{key:'england',label:'England',icon:'🏴󠁧󠁢󠁥󠁮󠁧󠁿'},{key:'italy',label:'Italy',icon:'🇮🇹'},{key:'spain',label:'Spain',icon:'🇪🇸'},{key:'germany',label:'Germany',icon:'🇩🇪'},{key:'france',label:'France',icon:'🇫🇷'},{key:'europe',label:'Europe',icon:'🇪🇺'},{key:'world',label:'World',icon:'🌍'},{key:'national-teams',label:'National Teams',icon:'🏆'}]; }
function getUniqueCompetitionsForCategory(key){ const map=new Map(); (appData.competitions||[]).filter(c=>getCompetitionCategoryKey(c)===key).forEach(c=>{ const k=\`${key}|${normaliseCompetitionName(c['Competition Name'])}\`; if(!map.has(k)||compareSeasonsDesc(c.Year,map.get(k).Year)<0) map.set(k,c); }); return Array.from(map.values()).sort((a,b)=>getCompetitionPriority(key,a)-getCompetitionPriority(key,b)||String(a['Competition Name']||'').localeCompare(String(b['Competition Name']||''))); }
function getLatestSeasonForCompetition(comp){ const key=getCompetitionCategoryKey(comp), name=normaliseCompetitionName(comp['Competition Name']); return (appData.competitions||[]).filter(c=>getCompetitionCategoryKey(c)===key&&normaliseCompetitionName(c['Competition Name'])===name).sort((a,b)=>compareSeasonsDesc(a.Year,b.Year))[0]||comp; }
function toggleCompetitionCategory(key){ const nav=$('competitionCategoryNav'); if(!nav) return; const menu=nav.querySelector(\`[data-category-menu="${key}"]\`); nav.querySelectorAll('.category-menu').forEach(m=>{ if(m!==menu)m.classList.remove('open'); }); menu?.classList.toggle('open'); }
window\.toggleCompetitionCategory=toggleCompetitionCategory;
async function selectCompetitionFromCategory(slug){ $('competitionCategoryNav')?.querySelectorAll('.category-menu').forEach(m=>m.classList.remove('open')); resetFilters(); updateUrlCompetition(slug); await loadCompetition(slug); setActiveTab('nextUp'); window\.scrollTo({top:0,behavior:'smooth'}); }
window\.selectCompetitionFromCategory=selectCompetitionFromCategory;
async function goHomePage(){ $('competitionCategoryNav')?.querySelectorAll('.category-menu').forEach(m=>m.classList.remove('open')); resetFilters(); updateUrlCompetition(''); await loadCompetition(''); window\.scrollTo({top:0,behavior:'smooth'}); }
window\.goHomePage=goHomePage;
function resetFilters(){ currentSearch=''; currentGroup=''; currentRound=''; if($('searchInput')) $('searchInput').value=''; if($('groupFilter')) $('groupFilter').value=''; if($('roundFilter')) $('roundFilter').value=''; }
function jumpToSection(section){ if(section==='myGames'&&isHomePage()){ currentHomeTab='myGames'; renderHomeTab(); $('homeSection')?.scrollIntoView({behavior:'smooth',block:'start'}); return; } if(isHomePage()){ currentHomeTab='allGames'; renderHomeTab(); window\.scrollTo({top:0,behavior:'smooth'}); return; } const map={home:'homeSection',nextUp:'nextUpSection',myGames:'homeSection',results:'resultsSection',fixtures:'fixturesSection',standings:'standingsSection',stats:'statsSection'}; $(map[section]||section)?.scrollIntoView({behavior:'smooth',block:'start'}); }
function setActiveTab(view){ document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); }
function updateUrlCompetition(slug){ const url=new URL(window\.location.href); if(!slug||slug==='home') url.searchParams.delete('competition'); else url.searchParams.set('competition',slug); window\.history.replaceState({},'',url.toString()); }
function getCompetitionCategoryKey(comp){ const region=normaliseRegion(comp.Region); if(['england','italy','spain','germany','france','europe','world'].includes(region)) return region; if(['national teams','national-teams','international','africa','south america','north america','asia'].includes(region)) return 'national-teams'; const c=String(comp.Competition||comp.CompetitionLabel||comp['Competition Name']||'').toLowerCase(); if(c.includes('premier league')||c.includes('fa cup')||c.includes('carabao')||c.includes('community shield'))return'england'; if(c.includes('serie a')||c.includes('coppa')||c.includes('supercoppa'))return'italy'; if(c.includes('la liga')||c.includes('copa del rey')||c.includes('supercopa'))return'spain'; if(c.includes('bundesliga')||c.includes('dfb')||c.includes('dfl'))return'germany'; if(c.includes('ligue 1')||c.includes('trophee')||c.includes('trophée')||c.includes('coupe de france'))return'france'; if(c.includes('champions league')||c.includes('europa league')||c.includes('conference league')||c.includes('uefa super cup'))return'europe'; if(c.includes('world cup')||c.includes('afcon')||c.includes('euro')||c.includes('copa america'))return'national-teams'; return'world'; }
function getCompetitionPriority(key,comp){ const n=String(comp['Competition Name']||comp.Competition||'').toLowerCase(); const map={england:['premier league','fa cup','carabao cup','community shield','championship'],italy:['serie a','coppa italia','italian super cup','supercoppa'],spain:['la liga','copa del rey','supercopa'],germany:['bundesliga','dfb-pokal','dfl-supercup'],france:['ligue 1','coupe de france','trophee des champions'],europe:['champions league','europa league','conference league','uefa super cup'],world:['world cup','club world cup','intercontinental cup'],'national-teams':['world cup','euro','nations league','afcon','copa america','asian cup','gold cup']}; const list=map[key]||[]; for(let i=0;i\<list.length;i++) if(n.includes(list[i])) return i; return 999; }
function compareHomeMatches(a,b){ return timeSortValue(normaliseKickoffTime(a.Time))-timeSortValue(normaliseKickoffTime(b.Time))||compareCompetitionPriority(a,b)||String(a.HomeTeam||'').localeCompare(String(b.HomeTeam||'')); }
function compareCompetitionPriority(a,b){ const order=['england','italy','spain','germany','france','europe','world','national-teams']; const ak=getCompetitionCategoryKey(a), bk=getCompetitionCategoryKey(b); return (order.indexOf(ak)===-1?999:order.indexOf(ak))-(order.indexOf(bk)===-1?999:order.indexOf(bk))||getCompetitionPriority(ak,{'Competition Name':a.Competition||a.CompetitionLabel||''})-getCompetitionPriority(bk,{'Competition Name':b.Competition||b.CompetitionLabel||''}); }
function compareCompetitionNamePriority(a,b,grouped){ return compareCompetitionPriority(grouped[a][0]||{},grouped[b][0]||{})||a.localeCompare(b); }
function compareCompetitionNamePriorityFromName(groupName,a,b){ const key={England:'england',Italy:'italy',Spain:'spain',Germany:'germany',France:'france',Europe:'europe',World:'world','National Teams':'national-teams'}[groupName]||'world'; return getCompetitionPriority(key,{'Competition Name':a})-getCompetitionPriority(key,{'Competition Name':b})||a.localeCompare(b); }
/\*
&#x20; My Games ordering ONLY (Global Games keeps using compareCompetitionPriority
&#x20; and is untouched by any of this).

&#x20; Priority is: Cups before Leagues, then within each of those,
&#x20; France > Germany > Spain > Italy > England (Europe / World /
&#x20; National Teams competitions - which are neither a domestic cup nor
&#x20; one of the 5 domestic leagues - are kept after England, in their
&#x20; existing relative order, since that case wasn't specified).
\*/
const MY\_GAMES\_COUNTRY\_ORDER = ['france','germany','spain','italy','england','europe','world','national-teams'];
const MY\_GAMES\_LEAGUE\_NAME\_KEYWORDS = ['premier league','serie a','la liga','bundesliga','ligue 1','championship'];
const MY\_GAMES\_CUP\_NAME\_KEYWORDS = ['cup','coppa','copa','pokal','coupe','trophee','trophée','shield','supercoppa','supercopa','supercup','super cup'];

function isCupCompetition(m){
&#x20; const name = String(m.Competition||m.CompetitionLabel||'').toLowerCase();
&#x20; if(MY\_GAMES\_LEAGUE\_NAME\_KEYWORDS.some(k=>name.includes(k))) return false;
&#x20; return MY\_GAMES\_CUP\_NAME\_KEYWORDS.some(k=>name.includes(k));
}

function getMyGamesGroupLabel(m){ return ({england:'England',italy:'Italy',spain:'Spain',germany:'Germany',france:'France',europe:'Europe',world:'World','national-teams':'National Teams'}[getCompetitionCategoryKey(m)]||'World'); }

function compareMyGamesMatches(a,b){
&#x20; const aCup = isCupCompetition(a) ? 0 : 1;
&#x20; const bCup = isCupCompetition(b) ? 0 : 1;
&#x20; if(aCup !== bCup) return aCup - bCup;

&#x20; const ak = getCompetitionCategoryKey(a), bk = getCompetitionCategoryKey(b);
&#x20; const ai = MY\_GAMES\_COUNTRY\_ORDER.indexOf(ak), bi = MY\_GAMES\_COUNTRY\_ORDER.indexOf(bk);
&#x20; const aIdx = ai===-1?999:ai, bIdx = bi===-1?999:bi;
&#x20; if(aIdx !== bIdx) return aIdx - bIdx;

&#x20; return matchDateSortValue(a)-matchDateSortValue(b) || String(a.HomeTeam||'').localeCompare(String(b.HomeTeam||''));
}
function getRankClass(index,size,isGroup,teamRow,groupName){

&#x20; const pos = index + 1;
&#x20; const competitionKey = getStandingsRuleKey();
&#x20; const league = getLeagueKeyForStandings();

&#x20; const competitionName = slugify(normaliseCompetitionName(
&#x20;   appData?.selectedCompetition?.['Competition Name'] ||
&#x20;   appData?.site?.competition ||
&#x20;   currentCompetition ||
&#x20;   ''
&#x20; ));

&#x20; // Champions League league phase
&#x20; if(competitionKey === 'champions-league' || competitionName.includes('champions-league')){
&#x20;   if(pos <= 8) return 'rank-qualified';
&#x20;   if(pos <= 24) return 'rank-uel';
&#x20;   return 'rank-eliminated';
&#x20; }

&#x20; // Europa League and Conference League old 8-group format
&#x20; if(
&#x20;   competitionKey === 'europa-league-old-groups' ||
&#x20;   competitionKey === 'conference-league-old-groups'
&#x20; ){
&#x20;   if(pos <= 2) return 'rank-qualified';
&#x20;   return 'rank-eliminated';
&#x20; }

&#x20; // Nations League
&#x20; if(competitionKey === 'nations-league' || competitionName.includes('nations-league')){

&#x20;   const leagueLabel = getNationsLeagueLevel(teamRow, groupName);

&#x20;   // League A = top 2 green, 3rd red
&#x20;   if(leagueLabel === 'A'){
&#x20;     if(pos <= 2) return 'rank-qualified';
&#x20;     if(pos === 3) return 'rank-eliminated';
&#x20;     return 'rank-neutral';
&#x20;   }

&#x20;   // League B = 1st green, 3rd red
&#x20;   if(leagueLabel === 'B'){
&#x20;     if(pos === 1) return 'rank-qualified';
&#x20;     if(pos === 3) return 'rank-eliminated';
&#x20;     return 'rank-neutral';
&#x20;   }

&#x20;   // League C = 1st green, no 3rd red
&#x20;   if(leagueLabel === 'C'){
&#x20;     if(pos === 1) return 'rank-qualified';
&#x20;     return 'rank-neutral';
&#x20;   }

&#x20;   return 'rank-neutral';
&#x20; }

&#x20; // Generic group stage
&#x20; if(isGroup){
&#x20;   if(size <= 2) return 'rank-neutral';
&#x20;   return pos <= 2 ? 'rank-qualified' : 'rank-eliminated';
&#x20; }

&#x20; // Domestic leagues
&#x20; if(['premier-league','serie-a','la-liga'].includes(league)){
&#x20;   if(pos <= 4) return 'rank-ucl';
&#x20;   if(pos <= 6) return 'rank-uel';
&#x20;   if(pos <= 8) return 'rank-uecl';
&#x20;   if(pos >= 18) return 'rank-relegation';
&#x20; }

&#x20; if(league === 'bundesliga'){
&#x20;   if(pos <= 4) return 'rank-ucl';
&#x20;   if(pos <= 6) return 'rank-uel';
&#x20;   if(pos <= 8) return 'rank-uecl';
&#x20;   if(pos === 16) return 'rank-playout';
&#x20;   if(pos >= 17) return 'rank-relegation';
&#x20; }

&#x20; if(league === 'ligue-1'){

&#x20;   const seasonYear = String(
&#x20;     appData?.selectedCompetition?.Year ||
&#x20;     appData?.site?.year ||
&#x20;     ''
&#x20;   ).trim();

&#x20;   const teamName = normaliseTeamName(teamRow?.Team || '');

&#x20;   // ONE-OFF OVERRIDE: Ligue 1 2026
&#x20;   if(seasonYear === '2026'){

&#x20;     // 1st to 3rd = Champions League
&#x20;     if(pos <= 3) return 'rank-ucl';

&#x20;     // Toulouse = Europa League = orange
&#x20;     if(teamName === normaliseTeamName('Toulouse')){
&#x20;       return 'rank-uel';
&#x20;     }

&#x20;     // AS Monaco + Lyon = Conference League = green
&#x20;     if(
&#x20;       teamName === normaliseTeamName('AS Monaco') ||
&#x20;       teamName === normaliseTeamName('Lyon')
&#x20;     ){
&#x20;       return 'rank-uecl';
&#x20;     }

&#x20;     // Nice = no colour
&#x20;     if(teamName === normaliseTeamName('Nice')){
&#x20;       return 'rank-neutral';
&#x20;     }

&#x20;     // 4th = Europa League normally
&#x20;     if(pos === 4) return 'rank-uel';

&#x20;     if(pos === 16) return 'rank-playout';
&#x20;     if(pos >= 17) return 'rank-relegation';

&#x20;     return 'rank-neutral';
&#x20;   }

&#x20;   // Normal Ligue 1 seasons
&#x20;   if(pos <= 3) return 'rank-ucl';
&#x20;   if(pos <= 5) return 'rank-uel';
&#x20;   if(pos <= 7) return 'rank-uecl';
&#x20;   if(pos === 16) return 'rank-playout';
&#x20;   if(pos >= 17) return 'rank-relegation';
&#x20; }

&#x20; return 'rank-neutral';
}
function getNationsLeagueLevel(teamRow, groupName){

&#x20; const values = [
&#x20;   teamRow?.League,
&#x20;   teamRow?.Group,
&#x20;   groupName
&#x20; ].map(value => String(value || '').trim());

&#x20; const text = values.join(' ').toLowerCase();

&#x20; if(/\bleague\s\*a\b/.test(text)) return 'A';
&#x20; if(/\bleague\s\*b\b/.test(text)) return 'B';
&#x20; if(/\bleague\s\*c\b/.test(text)) return 'C';

&#x20; return '';
}
function getLeagueKeyForStandings(){ const selected=appData?.selectedCompetition||{}, site=appData?.site||{}; const slug=slugify(normaliseCompetitionName(selected['Competition Name']||selected.competition||site.competition||currentCompetition||'')); if(slug.includes('premier-league'))return'premier-league'; if(slug.includes('serie-a'))return'serie-a'; if(slug.includes('la-liga')||slug.includes('laliga'))return'la-liga'; if(slug.includes('bundesliga'))return'bundesliga'; if(slug.includes('ligue-1'))return'ligue-1'; return''; }
function renderLeagueLegend(){

&#x20; const league = getLeagueKeyForStandings();

&#x20; if(!['premier-league','serie-a','la-liga','bundesliga','ligue-1'].includes(league)){
&#x20;   return '';
&#x20; }

&#x20; const seasonYear = String(
&#x20;   appData?.selectedCompetition?.Year ||
&#x20;   appData?.site?.year ||
&#x20;   ''
&#x20; ).trim();

&#x20; if(league === 'ligue-1' && seasonYear === '2026'){
&#x20;   return \`\<div class="qualification-note">
&#x20;     \<span class="note-dot ucl">\</span> Champions League
&#x20;     \<span class="note-dot uel">\</span> Europa League
&#x20;     \<span class="note-dot uecl">\</span> Conference League
&#x20;     \<span class="note-dot playout">\</span> Play-out relegation
&#x20;     \<span class="note-dot relegation">\</span> Relegation
&#x20;   \</div>\`;
&#x20; }

&#x20; const items = [
&#x20;   ['ucl','Champions League'],
&#x20;   ['uel','Europa League'],
&#x20;   ['uecl','Conference League']
&#x20; ];

&#x20; if(['bundesliga','ligue-1'].includes(league)){
&#x20;   items.push(['playout','Play-out relegation']);
&#x20; }

&#x20; items.push(['relegation','Relegation']);

&#x20; return \`\<div class="qualification-note">${items.map(i =>
&#x20;   \`\<span class="note-dot ${i[0]}">\</span>${escapeHTML(i[1])}\`
&#x20; ).join('')}\</div>\`;
}
function getCompetitionLegend(isGroupStage){

&#x20; const competitionKey = getStandingsRuleKey();
&#x20; const competitionName = slugify(normaliseCompetitionName(
&#x20;   appData?.selectedCompetition?.['Competition Name'] ||
&#x20;   appData?.site?.competition ||
&#x20;   currentCompetition ||
&#x20;   ''
&#x20; ));

&#x20; if(competitionKey === 'champions-league' || competitionName.includes('champions-league')){
&#x20;   return '\<div class="qualification-note">\<span class="note-dot qualified">\</span> 1–8 Round of 16 \<span class="note-dot uel">\</span> 9–24 Play-off \<span class="note-dot eliminated">\</span> 25–36 eliminated\</div>';
&#x20; }

&#x20; if(
&#x20;   competitionKey === 'europa-league-old-groups' ||
&#x20;   competitionKey === 'conference-league-old-groups'
&#x20; ){
&#x20;   return '\<div class="qualification-note">\<span class="note-dot qualified">\</span> Top 2 qualify \<span class="note-dot eliminated">\</span> Bottom 2 eliminated\</div>';
&#x20; }

&#x20; if(competitionKey === 'nations-league' || competitionName.includes('nations-league')){
&#x20;   return '\<div class="qualification-note">\<span class="note-dot qualified">\</span> Green = qualification / promotion \<span class="note-dot eliminated">\</span> Red = relegation / eliminated\</div>';
&#x20; }

&#x20; if(isGroupStage){
&#x20;   return '\<div class="qualification-note">\<span class="note-dot qualified">\</span> Top 2 qualify \<span class="note-dot eliminated">\</span> Bottom 2 eliminated\</div>';
&#x20; }

&#x20; return renderLeagueLegend();
}
function getCurrentCompetitionType(){
&#x20; const selected=appData?.selectedCompetition||{};
&#x20; const site=appData?.site||{};
&#x20; return String(selected['Competition Type'] || selected.CompetitionType || appData?.competitionType || site.competitionType || '').toLowerCase();
}

function isGroupStageCompetition(){
&#x20; const type = getCurrentCompetitionType();
&#x20; return type.includes('group') && !type.includes('league phase');
}

function isLeaguePhaseCompetition(){
&#x20; const type = getCurrentCompetitionType();
&#x20; const name = slugify(normaliseCompetitionName(appData?.selectedCompetition?.['Competition Name'] || appData?.site?.competition || currentCompetition || ''));
&#x20; return type.includes('league phase') || name.includes('champions-league');
}
function getRegionForCompetition(m){ return String(m.Region||'World').toUpperCase(); }
function getDateKey(v){ const d=parseDateOnly(v); return d?dateToKey(d):''; }
function parseDateOnly(v){ if(v instanceof Date) return new Date(v.getFullYear(),v.getMonth(),v.getDate()); const t=String(v||'').trim(); if(!t)return null; if(/^\d{4}-\d{2}-\d{2}$/.test(t)){ const p=t.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); } if(/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(t)){ const p=t.split(/[./-]/); return new Date(+p[2],+p[1]-1,+p[0]); } const fallback=new Date(t); if(!isNaN(fallback)) return new Date(fallback.getFullYear(),fallback.getMonth(),fallback.getDate()); return null; }
function matchDateSortValue(m){ const d=parseDateOnly(m.Date); if(!d)return 0; const p=String(m.Time||'00:00').trim().split(':'); d.setHours(+p[0]||0,+p[1]||0,0,0); return d.getTime(); }
function formatScoreboardDateParts(date,time){ const d=parseDateOnly(date); return {date:d?formatShortDateFromDate(d).replace(/\\.$/,''):String(date||'').trim(), time:String(time||'').trim()}; }
function formatFullDateTime(date,time){ const d=parseDateOnly(date); return [d?d.toLocaleDateString('en-GB'):String(date||'').trim(),String(time||'').trim()].filter(Boolean).join(' '); }
function dateToKey(d){ return \`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}\`; }
function getTodayKey(){ return dateToKey(new Date()); }
function addDays(date,days){ const d=new Date(date); d.setDate(d.getDate()+days); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
function getWeekStart(date){ const d=new Date(date.getFullYear(),date.getMonth(),date.getDate()); const day=d.getDay(); d.setDate(d.getDate()+(day===0?-6:1-day)); return d; }
function getWeekRangeLabel(date){ const start=getWeekStart(date), end=addDays(start,6); return \`${formatMyGamesDate(start)} - ${formatMyGamesDate(end)}\`; }
function getSeasonWeekLabel(date){ const selected=new Date(date.getFullYear(),date.getMonth(),date.getDate()); let y=selected.getMonth()>=7?selected.getFullYear():selected.getFullYear()-1; let first=getFirstWeekStartOfAugust(y); if(selected\<first){ y--; first=getFirstWeekStartOfAugust(y); } return \`Week ${Math.max(1,Math.floor((selected-first)/604800000)+1)}\`; }
function getFirstWeekStartOfAugust(y){ const d=new Date(y,7,1); const day=d.getDay(); d.setDate(d.getDate()+(day===1?0:(8-day)%7)); return d; }
function formatShortDateFromDate(d){ return \`${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.\`; }
function formatMyGamesDate(d){ return \`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}\`; }
function normaliseKickoffTime(v){ return String(v||'').trim()||'Scheduled'; }
function timeSortValue(v){ const m=String(v||'').trim().match(/^(\d{1,2}):(\d{2})$/); return m?(+m[1]\*60)+(+m[2]):99999; }
function renderScoreText(m){ const hp=String(m.HomePens||'').trim(), ap=String(m.AwayPens||'').trim(), home=safeScore(m.HomeScore), away=safeScore(m.AwayScore); return hp&&ap?\`(${escapeHTML(hp)}) ${escapeHTML(home)} - ${escapeHTML(away)} (${escapeHTML(ap)})\`:\`${escapeHTML(home)} - ${escapeHTML(away)}\`; }
function getPenaltyWinnerText(m){ const hp=Number(m.HomePens), ap=Number(m.AwayPens); if(!Number.isFinite(hp)||!Number.isFinite(ap))return''; if(hp>ap)return\`${m.HomeTeam} win ${hp}-${ap} on penalties\`; if(ap>hp)return\`${m.AwayTeam} win ${ap}-${hp} on penalties\`; return''; }
function isGoalEvent(e){ return String(e.Event||'').toLowerCase().trim()==='goal'; }
function sameTeam(a,b){ return normaliseTeamName(a)===normaliseTeamName(b); }
function getHalfNumber(v){ const t=String(v||'').toLowerCase().trim(); if(t==='1'||t.includes('1st')||t.includes('first'))return 1; if(t==='2'||t.includes('2nd')||t.includes('second'))return 2; return 0; }
function makeCompetitionSlug(comp){ return slugify(\`${comp['Competition Name']||comp.competition||''} ${comp.Year||comp.year||''}\`.trim()); }
function slugify(v){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function normaliseText(v){ return String(v||'').toLowerCase().trim().replace(/\s+/g,' '); }
function normaliseTeamName(v){ return String(v||'').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\\([a-z]{2,4}\\)/gi,'').replace(/[^a-z0-9\s]/gi,'').replace(/\s+/g,' ').trim(); }
function normaliseCompetitionName(v){ return normaliseText(v); }
function normaliseRegion(v){ return String(v||'').toLowerCase().trim().replace(/\_/g,' ').replace(/\s+/g,' '); }
function compareSeasonsDesc(a,b){ const ay=extractSeasonStartYear(a), by=extractSeasonStartYear(b); return by!==ay?by-ay:String(b||'').localeCompare(String(a||'')); }
function extractSeasonStartYear(v){ const m=String(v||'').match(/\d{4}/); return m?Number(m[0]):0; }
function roundSortValue(v){ const t=String(v||'').toLowerCase().trim(); if(/^\d+$/.test(t))return Number(t); if(t.includes('final')&&!t.includes('semi')&&!t.includes('quarter'))return 100; if(t.includes('semi'))return 90; if(t.includes('quarter'))return 80; if(t.includes('16'))return 70; if(t.includes('32'))return 60; return 0; }
function formatRoundLabel(v){ const t=String(v||'').trim(); if(!t)return'MATCHES'; if(/^\d+$/.test(t))return\`ROUND ${t}\`; return t.toUpperCase(); }
function groupBy(items,fn){ return items.reduce((acc,item)=>{ const key=fn(item); (acc[key] ||= []).push(item); return acc; },{}); }
function setText(id,value){ const el=$(id); if(el) el.textContent=value; }
function setHTML(id,value){ const el=$(id); if(el) el.innerHTML=value; }
function showError(message){ setText('competitionTitle','Error'); setText('competitionSubtitle',message); setHTML('homeGamesList',\`\<div class="empty">${escapeHTML(message)}\</div>\`); setHTML('scoreboardList',\`\<div class="empty">${escapeHTML(message)}\</div>\`); }
function safeNumber(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
function safeScore(v){ return v===''||v===undefined||v===null?'-':v; }
function formatGoalDifference(v){ const n=Number(v); if(!Number.isFinite(n))return'0'; return n>0?\`+${n}\`:String(n); }
function escapeHTML(v){ return String(v??'').replace(/&/g,'&amp;').replace(/\</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function escapeAttr(v){ return escapeHTML(v); }
window\.CALCIUM\_SCRIPT\_VERSION='7089-standings-logo-sheet-fix';
if ("serviceWorker" in navigator) {
&#x20; window\.addEventListener("load", () => {
&#x20;   navigator.serviceWorker
&#x20;     .register("./service-worker.js")
&#x20;     .then(() => {
&#x20;       console.log("Calcium Sport PWA ready");
&#x20;     })
&#x20;     .catch(error => {
&#x20;       console.error("Service Worker registration failed:", error);
&#x20;     });
&#x20; });
}
