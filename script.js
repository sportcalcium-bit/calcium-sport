const API_URL = 'https://script.google.com/macros/s/AKfycbyFU-9M16UBls1YvTZfXxCDGLFBT2CL1qvTH7S_pmdHCD6kSeQpHQlQW_gg6r5vhfjOZA/exec';

let allMatches = [];
let allStandings = [];
let allStats = [];
let activeFilter = 'all';

const fallbackLogo = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="%23f2f4f7"/><text x="40" y="48" text-anchor="middle" font-size="24" font-family="Arial" font-weight="700" fill="%23667085">FC</text></svg>';

async function init(){
  try{
    const res = await fetch(API_URL);
    const data = await res.json();
    allMatches = data.matches || [];
    allStandings = data.standings || [];
    allStats = data.stats || [];
    applySite(data.site || {});
    renderFeaturedMatch();
    renderMatches();
    renderStandings();
    renderStats();
    bindControls();
  }catch(error){
    document.getElementById('matchesGrid').innerHTML = `<div class="empty">Could not load the Google Sheet data. Check your Apps Script deployment URL.</div>`;
    console.error(error);
  }
}

function applySite(site){
  document.title = site.siteTitle || 'Calcium Sport Results';
  document.getElementById('siteTitle').textContent = site.siteTitle || 'Calcium Sport';
  document.getElementById('tagline').textContent = site.tagline || 'World Cup 2026 results, fixtures, standings and stats';
  document.getElementById('competitionName').textContent = site.competition || 'FIFA World Cup 2026';
}

function bindControls(){
  document.getElementById('searchInput').addEventListener('input', renderMatches);
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderMatches();
    });
  });
}

function renderFeaturedMatch(){
  const featured = allMatches.find(m => String(m.Featured).toLowerCase() === 'yes') || allMatches.find(m => m.Status === 'FT') || allMatches[0];
  const el = document.getElementById('featuredMatch');
  if(!featured){
    el.innerHTML = '<div class="skeleton">No featured match yet.</div>';
    return;
  }
  el.innerHTML = `
    <div class="featured-label"><span>${safe(featured.Round || featured.Competition)}</span><span class="status ${statusClass(featured.Status)}">${safe(featured.Status || 'Scheduled')}</span></div>
    <div class="featured-teams">
      <div class="featured-team">
        <img class="team-logo" src="${logo(featured.HomeLogo)}" onerror="this.src=fallbackLogo" alt="">
        <strong>${safe(featured.HomeTeam)}</strong>
      </div>
      <div class="featured-score">${scoreLine(featured)}</div>
      <div class="featured-team">
        <img class="team-logo" src="${logo(featured.AwayLogo)}" onerror="this.src=fallbackLogo" alt="">
        <strong>${safe(featured.AwayTeam)}</strong>
      </div>
    </div>
    <div class="match-extra">${safe(featured.Date || '')}${featured.Stadium ? ' · ' + safe(featured.Stadium) : ''}</div>
  `;
}

function renderMatches(){
  const query = document.getElementById('searchInput').value.toLowerCase().trim();
  let matches = allMatches.filter(m => {
    const haystack = `${m.HomeTeam} ${m.AwayTeam} ${m.Round} ${m.Competition} ${m.Status}`.toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    const matchesFilter = activeFilter === 'all' || m.Status === activeFilter;
    return matchesSearch && matchesFilter;
  });

  document.getElementById('matchCount').textContent = `${matches.length} matches`;
  const grid = document.getElementById('matchesGrid');
  if(!matches.length){
    grid.innerHTML = '<div class="empty">No matches found.</div>';
    return;
  }

  grid.innerHTML = matches.map(match => `
    <article class="match-card">
      <div class="match-meta">
        <span>${safe(match.Round || match.Competition)}</span>
        <span class="status ${statusClass(match.Status)}">${safe(match.Status || 'Scheduled')}</span>
      </div>
      <div class="match-teams">
        <div class="team-row">
          <img src="${logo(match.HomeLogo)}" onerror="this.src=fallbackLogo" alt="">
          <strong>${safe(match.HomeTeam)}</strong>
          <span class="score">${safe(match.HomeScore)}</span>
        </div>
        <div class="team-row">
          <img src="${logo(match.AwayLogo)}" onerror="this.src=fallbackLogo" alt="">
          <strong>${safe(match.AwayTeam)}</strong>
          <span class="score">${safe(match.AwayScore)}</span>
        </div>
      </div>
      <div class="match-extra">
        ${safe(match.Date || '')}${match.Stadium ? '<br>' + safe(match.Stadium) : ''}${match.Scorers ? '<br>' + safe(match.Scorers) : ''}
      </div>
    </article>
  `).join('');
}

function renderStandings(){
  const groups = groupBy(allStandings, 'Group');
  const grid = document.getElementById('tablesGrid');
  const groupNames = Object.keys(groups).filter(Boolean);
  if(!groupNames.length){
    grid.innerHTML = '<div class="empty">No standings found.</div>';
    return;
  }
  grid.innerHTML = groupNames.map(group => {
    const rows = groups[group];
    return `
      <article class="table-card">
        <h3>${safe(group)}</h3>
        <table>
          <thead><tr><th>#</th><th>Team</th><th>P</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>
            ${rows.map((row,index) => `
              <tr>
                <td>${index + 1}</td>
                <td><div class="team-cell"><img src="${logo(row.Logo)}" onerror="this.src=fallbackLogo" alt="">${safe(row.Team)}</div></td>
                <td>${safe(row.Played)}</td>
                <td>${safe(row.GoalDifference)}</td>
                <td><strong>${safe(row.Points)}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </article>
    `;
  }).join('');
}

function renderStats(){
  const scorers = [...allStats].filter(s => Number(s.Goals) > 0).sort((a,b) => Number(b.Goals) - Number(a.Goals)).slice(0,10);
  const assists = [...allStats].filter(s => Number(s.Assists) > 0).sort((a,b) => Number(b.Assists) - Number(a.Assists)).slice(0,10);
  const yellowCards = [...allStats].filter(s => Number(s.YellowCards) > 0).sort((a,b) => Number(b.YellowCards) - Number(a.YellowCards)).slice(0,10);
  const redCards = [...allStats].filter(s => Number(s.RedCards) > 0).sort((a,b) => Number(b.RedCards) - Number(a.RedCards)).slice(0,10);

  document.getElementById('topScorers').innerHTML = renderStatRows(scorers, 'Goals');
  document.getElementById('topAssists').innerHTML = renderStatRows(assists, 'Assists');
  document.getElementById('topYellowCards').innerHTML = renderStatRows(yellowCards, 'YellowCards');
  document.getElementById('topRedCards').innerHTML = renderStatRows(redCards, 'RedCards');
}

function renderStatRows(rows, key){
  if(!rows.length) return '<div class="empty">No data yet.</div>';
  return rows.map(row => `
    <div class="stat-row">
      <img src="${logo(row.Logo)}" onerror="this.src=fallbackLogo" alt="">
      <div>
        <div class="stat-name">${safe(row.Player)}</div>
        <div class="stat-team">${safe(row.Team)}</div>
      </div>
      <div class="stat-number">${safe(row[key])}</div>
    </div>
  `).join('');
}

function scoreLine(m){
  if(m.Status === 'FT') return `${safe(m.HomeScore)}-${safe(m.AwayScore)}`;
  return 'vs';
}
function statusClass(status){return String(status || 'Scheduled').replace(/\s+/g,'');}
function logo(value){return value || fallbackLogo;}
function safe(value){return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function groupBy(rows,key){return rows.reduce((acc,row) => {const value = row[key] || 'Other';(acc[value] ||= []).push(row);return acc;},{});}

init();
