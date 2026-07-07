const API_URL = 'https://script.google.com/macros/s/AKfycbyFU-9M16UBls1YvTZfXxCDGLFBT2CL1qvTH7S_pmdHCD6kSeQpHQlQW_gg6r5vhfjOZA/exec';

let appData = null;
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
function populateGroupDropdown(){ const select=$('groupFilter'); if(!select) return; const groups=[...new Set((appData.standings||[]).map(r=>r.Group).filter(Boolean))]; select.innerHTML=`<option value="">All groups/tables</option>${groups.map(g=>`<option value="${escapeAttr(g)}">${escapeHTML(g)}</option>`).join('')}`; if(currentGroup&&groups.includes(currentGroup)) select.value=currentGroup; }
function populateRoundDropdown(){ const select=$('roundFilter'); if(!select) return; const rounds=[...new Set(getCompetitionMatches().map(m=>String(m.Round||'').trim()).filter(Boolean))].sort((a,b)=>roundSortValue(a)-roundSortValue(b)); select.innerHTML=`<option value="">All rounds</option>${rounds.map(r=>`<option value="${escapeAttr(r)}">${escapeHTML(formatRoundLabel(r))}</option>`).join('')}`; if(currentRound&&rounds.includes(currentRound)) select.value=currentRound; else currentRound=''; }
function renderDateTabs(){
  const container=$('dateTabs'); if(!container) return;
  const today=new Date(); const yesterday=addDays(today,-1); const tomorrow=addDays(today,1);
  const dates=[{key:dateToKey(yesterday),dayLabel:'Yesterday',shortDate:formatShortDateFromDate(yesterday)},{key:dateToKey(today),dayLabel:'Today',shortDate:formatShortDateFromDate(today)},{key:dateToKey(tomorrow),dayLabel:'Tomorrow',shortDate:formatShortDateFromDate(tomorrow)}];
  const buttons=dates.map(item=>`<button type="button" class="${item.key===selectedDateKey?'active':''}" onclick="selectDateTab('${escapeAttr(item.key)}')"><span>${escapeHTML(item.dayLabel)}</span><strong>${escapeHTML(item.shortDate)}</strong></button>`).join('');
  const customActive=dates.some(item=>item.key===selectedDateKey)?'':'active'; const picked=selectedDateKey||getTodayKey();
  container.innerHTML=`${buttons}<div class="date-picker-button ${customActive}"><span>📅</span><span>Pick a date</span><input type="date" value="${escapeAttr(picked)}" onchange="pickHomeDate(this.value)"></div>`;
} 
container.querySelectorAll('.date-picker-button').forEach(button => {
    const input = button.querySelector('input[type="date"]');
    if (!input) return;

    button.addEventListener('click', () => {
        if (input.showPicker) {
            input.showPicker();
        } else {
            input.click();
        }
    });
});
window.selectDateTab = key => { selectedDateKey=key; renderDateTabs(); renderHomeGames(); renderMyGames(); renderHomeTab(); };
window.pickHomeDate = value => { if(value){ selectedDateKey=value; renderDateTabs(); renderHomeGames(); renderMyGames(); renderHomeTab(); } };
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
function renderHomeMatchRow(match){ const score=match.Status==='FT'?renderScoreText(match):'- : -'; const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:''; return `<article class="home-match-row" ${click}><div class="score-team-home-name">${escapeHTML(match.HomeTeam)}</div><div class="score-team-home-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="home-match-score">${score}</div><div class="score-team-away-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="score-team-away-name">${escapeHTML(match.AwayTeam)}</div></article>`; }
function renderHomeTab(){ const allPanel=$('allGamesPanel'), myPanel=$('myGamesPanel'), jump=$('jumpSelect'); document.querySelectorAll('[data-home-tab]').forEach(b=>b.classList.toggle('active',b.dataset.homeTab===currentHomeTab)); allPanel?.classList.toggle('hidden',currentHomeTab!=='allGames'); myPanel?.classList.toggle('hidden',currentHomeTab!=='myGames'); if(jump&&isHomePage()) jump.value=currentHomeTab==='myGames'?'myGames':'nextUp'; }
function renderMyGames(){
  const all=Array.isArray(appData?.myGames)?appData.myGames:[]; const selected=parseDateOnly(selectedDateKey)||new Date(); const weekStart=getMonday(selected); const weekEnd=addDays(weekStart,6);
  const weekMatches=all.filter(match=>{ const d=parseDateOnly(match.Date); if(!d) return false; const cd=new Date(d.getFullYear(),d.getMonth(),d.getDate()); return cd>=weekStart && cd<=weekEnd; }).sort(compareMyGamesMatches);
  setText('myGamesTitle', getSeasonWeekLabel(selected)); setText('myGamesSubtitle', getWeekRangeLabel(selected)); setText('myGamesCount', weekMatches.length);
  if(!weekMatches.length){ setHTML('myGamesList','<div class="empty home-empty">No My Games found for this week.</div>'); return; }
  const grouped=groupBy(weekMatches, m=>getMyGamesGroupLabel(m)); const order=['England','Italy','Spain','Germany','France','Europe','World','National Teams'];
  const html=Object.keys(grouped).sort((a,b)=>(order.indexOf(a)===-1?999:order.indexOf(a))-(order.indexOf(b)===-1?999:order.indexOf(b))||a.localeCompare(b)).map(groupName=>{
    const leagues=groupBy(grouped[groupName], m=>m.Competition||'Competition');
    return Object.keys(leagues).sort((a,b)=>compareCompetitionNamePriorityFromName(groupName,a,b)).map(league=>`<section class="my-games-league-card"><div class="my-games-league-head"><span class="my-games-region">${escapeHTML(groupName)}</span><strong class="my-games-league-name">${escapeHTML(league)}</strong></div>${leagues[league].sort(compareMyGamesMatches).map(renderMyGamesRow).join('')}</section>`).join('');
  }).join('');
  setHTML('myGamesList', html);
}
function renderMyGamesRow(match){ const p=formatScoreboardDateParts(match.Date,match.Time); const score=match.Status==='FT'?renderScoreText(match):'- : -'; const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:''; return `<article class="my-games-match" ${click}><div class="my-games-date"><span>${escapeHTML(p.date)}</span><span>${escapeHTML(p.time)}</span></div><div class="my-games-team-name home">${escapeHTML(match.HomeTeam)}</div><div class="my-games-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="my-games-score">${score}</div><div class="my-games-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="my-games-team-name away">${escapeHTML(match.AwayTeam)}</div><div class="my-games-status">${escapeHTML(match.Status||'Scheduled')}</div></article>`; }
function renderScoreboard(){ const matches=getFilteredMatches(); if(!matches.length){ setHTML('scoreboardList','<div class="empty">No matches found.</div>'); return; } const round=getNextUpRound(matches); if(!round){ setHTML('scoreboardList','<div class="empty">No matches found.</div>'); return; } const rows=matches.filter(m=>normaliseText(m.Round||'')===normaliseText(round)).sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); const scheduled=rows.some(m=>m.Status!=='FT'); setHTML('scoreboardList',`${scheduled?'':'<div class="season-complete-note">Season completed. Showing the last round played.</div>'}<section class="round-block"><div class="round-heading">${escapeHTML(formatRoundLabel(round))}</div>${rows.map(renderScoreboardRow).join('')}</section>`); }
function renderScoreboardRow(match){ const p=formatScoreboardDateParts(match.Date,match.Time); const score=match.Status==='FT'?renderScoreText(match):'- : -'; const click=match.MatchID?`onclick="openMatchDetail('${escapeAttr(match.MatchID)}')"`:''; return `<article class="scoreboard-row ${match.MatchID?'is-clickable':''}" ${click}><div class="scoreboard-date"><span class="scoreboard-date-main">${escapeHTML(p.date)}</span><span class="scoreboard-time-main">${escapeHTML(p.time)}</span></div><div class="score-team-home-name">${escapeHTML(match.HomeTeam)}</div><div class="score-team-home-logo">${renderTeamLogo(match.HomeLogo,match.HomeTeam)}</div><div class="scoreboard-score">${score}</div><div class="score-team-away-logo">${renderTeamLogo(match.AwayLogo,match.AwayTeam)}</div><div class="score-team-away-name">${escapeHTML(match.AwayTeam)}</div></article>`; }
function renderResults(){ const results=getFilteredMatches().filter(m=>m.Status==='FT').sort((a,b)=>matchDateSortValue(b)-matchDateSortValue(a)); setHTML('resultsList',results.length?renderGroupedScoreboard(results):'<div class="empty">No results found.</div>'); setText('resultsCount',`${results.length} matches`); }
function renderFixtures(){ const fixtures=getFilteredMatches().filter(m=>m.Status!=='FT').sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); setHTML('fixturesList',fixtures.length?renderGroupedScoreboard(fixtures):'<div class="empty">No scheduled games found.</div>'); setText('fixturesCount',`${fixtures.length} matches`); }
function renderGroupedScoreboard(matches){ const grouped=groupBy(matches,m=>formatRoundLabel(m.Round)); return Object.keys(grouped).map(round=>`<section class="round-block"><div class="round-heading">${escapeHTML(round)}</div>${grouped[round].map(renderScoreboardRow).join('')}</section>`).join(''); }
function renderStandings(){
  const standings=getFilteredStandings(); 
  if(!standings.length){
    setHTML('standingsContainer','<div class="empty">No standings found.</div>'); 
    return; 
  }

  const groups=groupBy(standings,r=>r.Group||'Table');

  const orderedGroups = Object.keys(groups).sort((a, b) =>
  a.localeCompare(b, undefined, { numeric: true })
);

const html = orderedGroups.map(groupName => {
    const rows=[...groups[groupName]].sort(compareStandingRows); 
    const isGroupStage=isGroupStageCompetition();

    const legend = isLeaguePhaseCompetition()
      ? '<div class="qualification-note"><span class="note-dot qualified"></span> Top 8 qualify to Round of 16 <span class="note-dot ucl"></span> 9–24 qualify to Play-off <span class="note-dot eliminated"></span> 25–36 eliminated</div>'
      : (
          isGroupStage
            ? '<div class="qualification-note"><span class="note-dot qualified"></span> Top 2 qualify <span class="note-dot eliminated"></span> Bottom 2 eliminated</div>'
            : renderLeagueLegend()
        );

    return `<section class="table-card"><div class="table-card-header"><h3>${escapeHTML(groupName)}</h3><span>${rows.length} teams</span></div><div class="standings-table-wrap"><table class="standings-table"><thead><tr><th>#</th><th>Team</th><th>PT</th><th>GW</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th></tr></thead><tbody>${rows.map((team,i)=>`<tr><td><span class="rank-badge ${getRankClass(i,rows.length,isGroupStage)}">${i+1}</span></td><td class="team-cell">${renderTeamLogo(team.Logo,team.Team)}<span>${escapeHTML(team.Team)}</span></td><td><strong>${safeNumber(team.Points)}</strong></td><td>${safeNumber(team.Played)}</td><td>${safeNumber(team.Won)}</td><td>${safeNumber(team.Drawn)}</td><td>${safeNumber(team.Lost)}</td><td>${safeNumber(team.GoalsFor)}</td><td>${safeNumber(team.GoalsAgainst)}</td><td>${formatGoalDifference(team.GoalDifference)}</td></tr>`).join('')}</tbody></table></div>${legend}</section>`;
  }).join('');

  setHTML('standingsContainer',html);
}
function renderStats(){ const stats=getFilteredStats(); renderStatList('topScorers',stats,'Goals','topScorers'); renderStatList('topAssists',stats,'Assists','topAssists'); renderStatList('cleanSheets',stats,'CleanSheets','cleanSheets'); renderStatList('yellowCards',stats,'YellowCards','yellowCards'); renderStatList('redCards',stats,'RedCards','redCards'); }
function renderStatList(id,stats,key,expandKey){ const all=stats.filter(r=>Number(r[key])>0).sort((a,b)=>Number(b[key])-Number(a[key])||String(a.Player||'').localeCompare(String(b.Player||''))); if(!all.length){ setHTML(id,'<div class="empty">No data yet.</div>'); return; } const visible=expandedStats[expandKey]?all:all.slice(0,3); const rows=visible.map((r,i)=>`<div class="stat-row"><span class="stat-rank">${i+1}</span><span class="stat-player">${renderTeamLogo(r.Logo,r.Team)}<span class="stat-player-name" title="${escapeAttr(r.Player)}">${escapeHTML(r.Player)}</span></span><strong class="stat-value">${safeNumber(r[key])}</strong></div>`).join(''); const btn=all.length>3?`<button class="stat-toggle" type="button" onclick="toggleStatList('${expandKey}')">${expandedStats[expandKey]?'Show less':`See more (${all.length})`}</button>`:''; setHTML(id,rows+btn); }
window.toggleStatList = key => { expandedStats[key]=!expandedStats[key]; renderStats(); };
function renderTeamLogo(url,teamName){ if(!url) return '<span class="team-logo team-logo-empty"></span>'; return `<span class="team-logo"><img src="${escapeAttr(url)}" alt="${escapeAttr(teamName||'Team logo')}" loading="lazy"></span>`; }
function openMatchDetail(matchId){ const unique=dedupeMatchArray(getGlobalMatches().concat(getCompetitionMatches()).concat(Array.isArray(appData?.myGames)?appData.myGames:[])); const match=unique.find(m=>m.MatchID===matchId||m.ID===matchId); if(!match) return; const modal=$('matchModal'), content=$('matchDetailContent'); if(!modal||!content) return; content.innerHTML=renderMatchDetail(match); modal.classList.remove('hidden'); document.body.classList.add('modal-open'); }
window.openMatchDetail=openMatchDetail;
function closeMatchModal(){ $('matchModal')?.classList.add('hidden'); document.body.classList.remove('modal-open'); }
window.closeMatchModal=closeMatchModal;
function renderMatchDetail(match){ const events=getMatchEvents(match.MatchID||match.ID); const youtube=match.YouTubeURL||match.YoutubeURL||match.HighlightsURL||''; const penalty=getPenaltyWinnerText(match); const motm=getMatchMOTM(match); return `<section class="match-hero"><div class="match-date-main">${escapeHTML(formatFullDateTime(match.Date,match.Time))}</div><div class="match-main-teams"><div class="match-main-team"><div class="match-main-logo">${match.HomeLogo?`<img src="${escapeAttr(match.HomeLogo)}" alt="">`:''}</div><strong>${escapeHTML(match.HomeTeam)}</strong></div><div class="match-main-score"><div>${renderScoreText(match)}</div>${penalty?`<span>${escapeHTML(penalty)}</span>`:''}</div><div class="match-main-team"><div class="match-main-logo">${match.AwayLogo?`<img src="${escapeAttr(match.AwayLogo)}" alt="">`:''}</div><strong>${escapeHTML(match.AwayTeam)}</strong></div></div></section><section class="venue-row"><span>🏟️ Venue:</span><strong>${escapeHTML(match.Venue||match.Stadium||'Venue unavailable')}</strong></section><section class="event-section">${renderTimelineEvents(events,match)}</section>${motm?`<section class="motm-row"><span>⭐ Man of the Match:</span><strong>${escapeHTML(motm)}</strong></section>`:''}${renderHighlights(youtube)}`; }
function getMatchEvents(matchId){ const seen=new Set(); return (appData.allEvents||[]).filter(e=>e.MatchID===matchId).filter(e=>{ const key=[e.MatchID,e.Half,e.Minute,e.Team,e.Event,e.Player,e.Detail].join('|').toLowerCase(); if(seen.has(key)) return false; seen.add(key); return true; }).sort((a,b)=>Number(a.Minute||0)-Number(b.Minute||0)); }
function renderHalfEvents(title,events,match){ if(!events.length) return `<div class="half-block"><div class="half-title">${escapeHTML(title)}</div><div class="empty">No events.</div></div>`; let liveHome=0, liveAway=0; const rows=events.map(e=>{ if(isGoalEvent(e)){ if(sameTeam(e.Team,match.HomeTeam)) liveHome++; if(sameTeam(e.Team,match.AwayTeam)) liveAway++; } return renderEventRow(e,match,liveHome,liveAway); }).join(''); return `<div class="half-block"><div class="half-title">${escapeHTML(title)}</div>${rows}</div>`; }
function renderEventRow(event,match,liveHome,liveAway){ const side=sameTeam(event.Team,match.HomeTeam)?'event-home':'event-away'; return `<div class="event-row ${side}"><div class="event-minute">${escapeHTML(event.Minute)}'</div><div class="event-content">${getEventLabel(event,liveHome,liveAway)}</div></div>`; }
function getEventLabel(event,liveHome,liveAway){ const type=String(event.Event||'').toLowerCase().trim(), detail=String(event.Detail||'').trim(), player=String(event.Player||'').trim(); const cleanDetail=cleanEventDetail(detail); const detailText=cleanDetail?` (${escapeHTML(cleanDetail)})`:''; if(type==='goal') return `<span class="goal-pill">⚽ ${liveHome} - ${liveAway}</span><strong>${escapeHTML(player)}${detailText}</strong>`; if(type==='yellow card') return `<span>🟨</span><strong>${escapeHTML(player)}${detailText}</strong>`; if(type==='red card') return `<span>🟥</span><strong>${escapeHTML(player)}${detailText}</strong>`; if(type==='penalty missed'||type==='missed penalty') return `<span>❌</span><strong>${escapeHTML(player)} (Penalty missed)</strong>`; return `<span>•</span><strong>${escapeHTML(player)}${detailText}</strong>`; }

function renderTimelineEvents(events,match){ if(!events.length) return '<div class="empty">No events.</div>'; let liveHome=0, liveAway=0; const rows=events.map(e=>{ if(isGoalEvent(e)){ if(sameTeam(e.Team,match.HomeTeam)) liveHome++; if(sameTeam(e.Team,match.AwayTeam)) liveAway++; } return renderEventRow(e,match,liveHome,liveAway); }).join(''); return `<div class="timeline-block">${rows}</div>`; }
function cleanEventDetail(detail){ const text=String(detail||'').trim(); if(!text) return ''; return text.replace(/^Assist:\s*/i,'').replace(/^Penalty,\s*Assist:\s*/i,'Penalty, ').replace(/,\s*Assist:\s*/i,', '); }
function getMatchMOTM(match){ if(match.MOTM) return match.MOTM; const matchId=match.MatchID||match.ID; const row=(appData.matchData||appData.data||[]).find(item=>(item.MatchID||item['Match ID'])===matchId); return row ? (row.MOTM || row.Motm || '') : ''; }
function renderHighlights(url){ const cleanUrl=String(url||'').trim(); if(!cleanUrl) return ''; const id=getYouTubeId(cleanUrl); if(!id) return `<section class="highlights-card"><div class="highlights-header"><span>📺 Highlights</span><a href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">Open video</a></div></section>`; return `<section class="highlights-card"><div class="highlights-header"><span>📺 Highlights</span><a href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">Open on YouTube</a></div><a class="youtube-preview" href="${escapeAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer"><img src="https://img.youtube.com/vi/${escapeAttr(id)}/maxresdefault.jpg" alt="YouTube highlights thumbnail" onerror="this.src='https://img.youtube.com/vi/${escapeAttr(id)}/hqdefault.jpg'"><span class="youtube-play">▶</span></a></section>`; }
function getYouTubeId(url){ const text=String(url||'').trim(); const patterns=[/youtube\.com\/watch\?v=([^&]+)/i,/youtu\.be\/([^?&]+)/i,/youtube\.com\/shorts\/([^?&]+)/i,/youtube\.com\/embed\/([^?&]+)/i]; for(const p of patterns){ const m=text.match(p); if(m?.[1]) return m[1]; } return ''; }
function getCompetitionMatches(){ return dedupeMatchArray((Array.isArray(appData?.matches)?appData.matches:[]).concat(Array.isArray(appData?.playoffs)?appData.playoffs:[])); }
function getGlobalMatches(){ return dedupeMatchArray(Array.isArray(appData?.allMatches)?appData.allMatches:[]); }
function dedupeMatchArray(matches){ const seen=new Set(); return (matches||[]).filter(m=>{ const key=String(m.MatchID||m.ID||'').trim(); if(!key||seen.has(key)) return false; seen.add(key); return true; }); }
function getFilteredMatches(){ let matches=getCompetitionMatches(); if(currentSearch) matches=matches.filter(m=>[m.HomeTeam,m.AwayTeam,m.Round,m.Competition,m.Date,m.Time].join(' ').toLowerCase().includes(currentSearch)); if(currentRound){ const key=normaliseText(currentRound); matches=matches.filter(m=>normaliseText(m.Round)===key); } if(currentGroup){ const key=normaliseText(currentGroup); const teams=(appData.standings||[]).filter(r=>normaliseText(r.Group)===key).map(r=>normaliseTeamName(r.Team)).filter(Boolean); matches=matches.filter(m=>teams.includes(normaliseTeamName(m.HomeTeam))||teams.includes(normaliseTeamName(m.AwayTeam))||normaliseText(m.Round)===key||normaliseText(m.Round).includes(key)); } return matches; }
function getFilteredStandings(){ let standings=appData.standings||[]; if(currentSearch) standings=standings.filter(r=>[r.Team,r.Group,r.Competition].join(' ').toLowerCase().includes(currentSearch)); if(currentGroup) standings=standings.filter(r=>normaliseText(r.Group)===normaliseText(currentGroup)); return standings; }
function getFilteredStats(){ let stats=appData.stats||[]; if(currentSearch) stats=stats.filter(r=>[r.Player,r.Team].join(' ').toLowerCase().includes(currentSearch)); return stats; }
function getNextUpRound(matches){ const ordered=[...matches].sort((a,b)=>matchDateSortValue(a)-matchDateSortValue(b)); const now=Date.now()-86400000; const next=ordered.find(m=>m.Status!=='FT'&&matchDateSortValue(m)>=now); if(next) return next.Round||''; const completed=ordered.filter(m=>m.Status==='FT'&&matchDateSortValue(m)>0).sort((a,b)=>matchDateSortValue(b)-matchDateSortValue(a)); return completed.length?completed[0].Round||'':''; }
function compareStandingRows(a,b){
  const pA=safeNumber(a.Points), pB=safeNumber(b.Points);
  if(pB!==pA) return pB-pA;

  const tiedTeams=(appData.standings||[]).filter(r=>
    String(r.Group||'')===String(a.Group||'') &&
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
function escapeHTML(v){ return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function escapeAttr(v){ return escapeHTML(v); }
window.CALCIUM_SCRIPT_VERSION='7001-match-popup-motm-youtube';
