const LINEUP_SLOTS = [
  ...Array.from({length:11}, (_, i) => 'XI' + (i + 1)),
  ...Array.from({length:9}, (_, i) => 'BENCH' + (i + 1)),
  ...Array.from({length:10}, (_, i) => 'OUT' + (i + 1))
];
const LINEUP_FORMATIONS = ['4-3-3','4-2-3-1','4-4-2','4-1-4-1','4-3-2-1','4-2-2-2','4-5-1',
  '3-5-2','3-4-3','3-4-2-1','3-4-1-2','5-3-2','5-4-1','5-2-3'];
let lineupDraft = null;
let lineupEditorToken = '';
let lineupNotice = '';

function lineupEditorEndpoint(){
  const url = document.querySelector?.('meta[name="calcium-lineup-editor"]')?.content?.trim();
  return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url || '') ? url : '';
}

function lineupScope(team, season){
  return (defaultLineupsCache || []).filter(r => sameTeam(r.team,team) && normaliseProfileSeason(r.season) === season);
}

function editableLineup(team, season){
  const slots = lineupScope(team,season).filter(r => LINEUP_SLOTS.includes(r.slot));
  const map = new Map(slots.map(r => [r.slot,r]));
  if(slots.length !== map.size || LINEUP_SLOTS.slice(0,11).some(slot => !map.has(slot))) return null;
  const rows = LINEUP_SLOTS.flatMap(slot => map.has(slot) ? [map.get(slot)] : []);
  if(rows.some(r => r.team !== rows[0].team || r.season !== rows[0].season)) return null;
  const keys = rows.filter(r => r.playerName).map(r => (r.playerId || r.playerName).toLowerCase());
  return new Set(keys).size === keys.length ? rows : null;
}

function lineupRevision(rows){
  return JSON.stringify(rows.map(r => [r.formation, r.playerName, r.playerId]));
}

function lineupChanged(){
  return !!lineupDraft && (lineupDraft.formation !== lineupDraft.rows[0].formation ||
    lineupDraft.order.some((source, slot) => {
      const a = lineupDraft.rows[source], b = lineupDraft.rows[slot];
      return a.playerId !== b.playerId || a.playerName !== b.playerName;
    }));
}

function renderLineupActions(team, season){
  if(!lineupEditorEndpoint()) return '';
  if(lineupDraft){
    if(lineupDraft.saving) return '<button type="button" disabled>Saving…</button>';
    return (lineupChanged() ? '<button type="button" class="lineup-save" onclick="requestLineupSave()">Save</button>' : '') +
      '<button type="button" onclick="cancelLineupEdit()">' + (lineupChanged() ? 'Discard' : 'Cancel') + '</button>';
  }
  if(defaultLineupsPromise || defaultLineupsError || !lineupShape(editableLineup(team,season)?.[0]?.formation || '')) return '';
  return '<button type="button" onclick="beginLineupEdit()" aria-label="Edit">Edit</button>';
}

function renderLineupEditorUI(focus){
  const actions = $('lineupActions');
  const section = $('defaultLineup');
  if(!actions || !section) return;
  const {team, season} = actions.dataset;
  section.outerHTML = renderDefaultTeamLineup(team,season);
  actions.innerHTML = renderLineupActions(team,season);
  if(focus) document.querySelector(focus)?.focus();
}

function beginLineupEdit(){
  const {team, season} = $('lineupActions').dataset;
  const rows = editableLineup(team,season);
  if(lineupDraft || defaultLineupsPromise || defaultLineupsError || !lineupEditorEndpoint() || !rows || !lineupShape(rows[0].formation)) return;
  lineupNotice = '';
  lineupDraft = {team, season, rows, formation: rows[0].formation || '4-3-3', order: rows.map((_, i) => i)};
  renderLineupEditorUI('#lineupFormation');
}

function leaveLineupEdit(){
  if(lineupDraft?.saving) return false;
  if(lineupChanged() && !window.confirm('Discard the unsaved lineup changes?')) return false;
  if(lineupDraft?.latest) defaultLineupsCache = lineupDraft.latest;
  lineupDraft = null;
  lineupNotice = '';
  return true;
}

function cancelLineupEdit(){
  if(leaveLineupEdit()) renderLineupEditorUI('#lineupActions button');
}

window.addEventListener?.('beforeunload', event => {
  if(lineupChanged() || lineupDraft?.saving){
    event.preventDefault();
    event.returnValue = '';
  }
});

function lineupDialog(title, body){
  const dialog = document.createElement('dialog');
  dialog.className = 'lineup-dialog';
  dialog.setAttribute('aria-labelledby','lineupDialogTitle');
  dialog.innerHTML = '<h3 id="lineupDialogTitle">' + escapeHTML(title) + '</h3>' + body;
  dialog.addEventListener('close', () => dialog.remove(), {once:true});
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

function lineupSlotLabel(i, formation){
  if(i === 0) return 'Starting XI · Goalkeeper';
  if(i < 11){
    const lines = lineupShape(formation);
    const roles = lines.length === 4 ? ['Defense','Midfield','Attacking midfield','Forwards'] :
      lines.length === 3 ? ['Defense','Midfield','Forwards'] : ['Defense','Forwards'];
    let position = i;
    for(const [line, count] of lines.entries()){
      if(position <= count) return 'Starting XI · ' + roles[line] + ' ' + position;
      position -= count;
    }
  }
  if(i < 20) return 'Substitutes · Slot ' + (i - 10);
  return 'Not Called Up · Slot ' + (i - 19);
}

function lineupRef(player, team){
  const identity = identityFromRef(player?.playerId);
  return identity ? '@' + identity.id : playerReference(player?.playerName,team);
}

function chooseLineupPlayer(slot){
  const draft = lineupDraft;
  if(!draft || draft.saving) return;
  const current = draft.rows[draft.order[slot]];
  const label = i => lineupSlotLabel(LINEUP_SLOTS.indexOf(draft.rows[i].slot),draft.formation);
  const dialog = lineupDialog(label(slot), `
    <p>Swap ${escapeHTML(current.playerName || 'this empty slot')} with a squad player.</p>
    <label for="lineupSearch">Search squad</label><input id="lineupSearch" type="search" autofocus autocomplete="off">
    <div class="lineup-player-choices"></div>
    <form method="dialog"><button type="submit">Cancel</button></form>`);
  const search = dialog.querySelector('input');
  const results = dialog.querySelector('.lineup-player-choices');
  const searchKey = value => value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
  const render = () => {
    const query = searchKey(search.value);
    results.innerHTML = draft.order.map((source,i) => {
      const player = draft.rows[source];
      if(i === slot || !player.playerName || !searchKey(player.playerName).includes(query)) return '';
      return `<button type="button" data-slot="${i}">${renderPlayerImage(lineupRef(player,draft.team))}
        <span><strong>${escapeHTML(player.playerName)}</strong><small>${label(i)}</small></span></button>`;
    }).join('') || '<p role="status">No matching players.</p>';
  };
  search.addEventListener('input',render);
  results.addEventListener('click',event => {
    const button = event.target.closest('[data-slot]');
    if(!button || lineupDraft !== draft || draft.saving) return;
    const other = Number(button.dataset.slot);
    [draft.order[slot],draft.order[other]] = [draft.order[other],draft.order[slot]];
    lineupNotice = '';
    dialog.close();
    renderLineupEditorUI('[data-lineup-slot="' + slot + '"]');
  });
  render();
}

function lineupShape(formation){
  const lines = formation.split('-').map(Number);
  return lines.length >= 2 && lines.length <= 4 && lines.every(n => Number.isInteger(n) && n > 0 && n <= 5)
    && lines.reduce((a,b) => a+b,0) === 10 ? lines : null;
}

function lineupFormationOrder(order, before, after){
  // Keep the goalkeeper and players in their defensive, midfield and forward lines where space permits.
  const zones = lines => {
    const positions = [[],[],[]];
    let index = 1;
    lines.forEach((count, line) => {
      const zone = line === 0 ? 0 : line === lines.length - 1 ? 2 : 1;
      for(let i = 0; i < count; i++) positions[zone].push(index++);
    });
    return positions;
  };
  const oldZones = zones(lineupShape(before)), newZones = zones(lineupShape(after));
  const next = order.slice(), unused = [], open = [];
  oldZones.forEach((slots, zone) => {
    const targets = newZones[zone];
    const retained = Math.min(slots.length,targets.length);
    for(let i = 0; i < retained; i++) next[targets[i]] = order[slots[i]];
    unused.push(...slots.slice(retained).map(i => order[i]));
    open.push(...targets.slice(retained));
  });
  open.forEach((slot,i) => { next[slot] = unused[i]; });
  return next;
}

function chooseLineupFormation(){
  const draft = lineupDraft;
  if(!draft || draft.saving) return;
  const options = [...new Set([draft.formation,...LINEUP_FORMATIONS])];
  const dialog = lineupDialog('Choose formation', `
    <label for="lineupShape">Formation</label>
    <select id="lineupShape" autofocus>${options.map(shape => `<option>${escapeHTML(shape)}</option>`).join('')}</select>
    <form method="dialog"><button type="submit">Cancel</button></form>`);
  dialog.querySelector('select').addEventListener('change',event => {
    if(lineupDraft !== draft) return;
    const formation = event.target.value;
    draft.order = lineupFormationOrder(draft.order,draft.formation,formation);
    draft.formation = formation;
    lineupNotice = '';
    dialog.close();
    renderLineupEditorUI('#lineupFormation');
  });
}

function requestLineupSave(){
  if(!lineupChanged() || lineupDraft.saving) return;
  if(lineupEditorToken) return saveLineup(lineupEditorToken);
  const dialog = lineupDialog('Save lineup', `
    <form>
      <label for="lineupEditorKey">Editor key</label>
      <input id="lineupEditorKey" type="password" required autocomplete="off" autofocus>
      <div class="lineup-dialog-actions"><button type="submit">Save</button>
      <button type="submit" formmethod="dialog" formnovalidate>Cancel</button></div>
    </form>`);
  dialog.querySelector('form').addEventListener('submit', event => {
    if(event.submitter?.formMethod === 'dialog') return;
    event.preventDefault();
    const token = dialog.querySelector('input').value;
    dialog.close();
    saveLineup(token);
  });
}

async function saveLineup(token){
  const draft = lineupDraft;
  const endpoint = lineupEditorEndpoint();
  if(!endpoint || !draft || draft.saving || !lineupChanged()) return;
  draft.saving = true;
  lineupNotice = 'Saving lineup…';
  renderLineupEditorUI();
  const {team, season} = draft.rows[0];
  const expected = draft.order.map(source => ({...draft.rows[source], formation:draft.formation}));
  const accept = rows => {
    defaultLineupsCache = defaultLineupsCache.filter(r =>
      !(r.team === team && r.season === season && LINEUP_SLOTS.includes(r.slot))).concat(rows);
    lineupEditorToken = token;
    lineupDraft = null;
    lineupNotice = 'Lineup saved.';
  };
  try {
    const response = await fetch(endpoint,{
      method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'}, credentials:'omit',
      cache:'no-store', signal:AbortSignal.timeout(25000),
      body:JSON.stringify({team,season,token,base:lineupRevision(draft.rows),formation:draft.formation,order:draft.order})
    });
    if(!response.ok) throw new Error('network');
    const result = await response.json();
    if(!result.success) throw new Error(result.code);
    if(!Array.isArray(result.lineups) || result.lineups.some((r,i) =>
      r.team !== team || r.season !== season || r.slot !== draft.rows[i]?.slot) ||
      lineupRevision(result.lineups) !== lineupRevision(expected)) throw new Error('network');
    accept(result.lineups);
  } catch(error) {
    if(error.message === 'permission'){
      lineupEditorToken = '';
      lineupNotice = 'Editor key rejected. Your draft is still here. Click Save to try another key.';
    } else if(error.message === 'busy'){
      lineupNotice = 'Another save is running. Your draft is still here. Try Save again in a moment.';
    } else {
      // Recover if Sheets committed the batch but the response was lost.
      const latest = await fetchDefaultLineups(endpoint).catch(() => null);
      const rows = latest && draft.rows.map(({slot}) =>
        latest.find(r => r.team === team && r.season === season && r.slot === slot));
      if(rows?.every(Boolean) && lineupRevision(rows) === lineupRevision(expected)){
        accept(rows);
      } else if(error.message === 'conflict'){
        draft.latest = latest;
        lineupNotice = latest
          ? 'This lineup changed since you opened it. Discard your draft to load the latest lineup.'
          : 'This lineup changed since you opened it. Reopen the team after discarding to load the latest lineup.';
      } else if(error.message === 'schema'){
        lineupNotice = 'The sheet layout prevented the save. Your draft is still here.';
      } else {
        lineupNotice = 'The save could not be confirmed. Your draft is still here. Check your connection and try Save again.';
      }
    }
  } finally {
    draft.saving = false;
    renderLineupEditorUI('#lineupActions button');
  }
}

async function fetchDefaultLineups(endpoint){
  const url = endpoint || (API_URL + '?action=defaultLineups');
  const response = await fetch(url + (endpoint ? '?' : '&') + 'v=' + Date.now(),{
    cache:'no-store', signal:typeof AbortSignal === 'undefined' ? undefined : AbortSignal.timeout(15000)
  });
  if(!response.ok) throw new Error('Lineup API HTTP ' + response.status);
  const data = await response.json();
  if(!data.success || !Array.isArray(data.lineups)) throw new Error('Invalid lineup API response');
  return data.lineups;
}
async function loadDefaultLineups(){
  const endpoint = lineupEditorEndpoint();
  if(defaultLineupsCache && !endpoint) return defaultLineupsCache;
  if(!defaultLineupsPromise){
    defaultLineupsError=false;
    defaultLineupsPromise=fetchDefaultLineups(endpoint)
      .then(rows => (defaultLineupsCache=rows))
      .catch(err=>{console.warn('Default lineups unavailable:',err);defaultLineupsError=true;return null})
      .finally(()=>{defaultLineupsPromise=null});
  }
  return defaultLineupsPromise;
}
function renderLineupPlayer(player,teamName,season,slot,editing){
  if(typeof player === 'string') player = {playerName:player};
  const playerName = player?.playerName || '';
  if(!playerName && !editing) return '<span class="lineup-empty">—</span>';
  const ref = lineupRef(player,teamName);
  const content = playerName ? renderPlayerImage(ref) + '<span>' + escapeHTML(playerName) + '</span>' : '<span>Empty slot</span>';
  if(editing){
    return `<button type="button" class="lineup-player lineup-editable" data-lineup-slot="${slot}" ${lineupDraft.saving ? 'disabled' : ''}
      onclick="chooseLineupPlayer(${slot})" aria-label="${escapeAttr((playerName || 'Empty slot') + ', ' + lineupSlotLabel(LINEUP_SLOTS.indexOf(lineupDraft.rows[slot].slot),lineupDraft.formation) + ', choose replacement')}">${content}</button>`;
  }
  const jsName=escapeAttr(JSON.stringify(ref));
  const jsTeam=escapeAttr(JSON.stringify(teamName));
  const jsSeason=escapeAttr(JSON.stringify(String(season)));
  return `<button type="button" class="lineup-player " onclick="closeTeamProfile();openPlayerProfile(${jsName},null,${jsSeason},${jsTeam})">${content}</button>`;
}
function renderDefaultTeamLineup(teamName,season='2027'){
  season=normaliseProfileSeason(season);
  if(!defaultLineupsCache || defaultLineupsError) return defaultLineupsError
    ? '<div class="empty" role="status">Default lineup could not be loaded. Reopen the team profile to retry.</div>'
    : '<div class="lineup-loading" role="status">Loading default lineup…</div>';
  const rows=lineupScope(teamName,season);
  if(!rows.length)return `<section class="team-profile-section"><h3>Default Lineup · ${escapeHTML(season)}</h3><div class="empty">No default lineup available for this season.</div></section>`;
  const slots=new Map(rows.map(r=>[String(r.slot).toUpperCase().trim(),r]));
  const editing=!!lineupDraft && sameTeam(lineupDraft.team,teamName) && lineupDraft.season===season;
  const formation=editing ? lineupDraft.formation : String(rows[0].formation||'4-3-3').trim();
  const lines=lineupShape(formation);
  if(!lines)return '<div class="empty">Invalid formation data.</div>';
  const button = index => {
    const slot = LINEUP_SLOTS[index];
    const draftIndex = editing ? lineupDraft.rows.findIndex(row => row.slot === slot) : -1;
    return draftIndex >= 0
      ? renderLineupPlayer(lineupDraft.rows[lineupDraft.order[draftIndex]],teamName,season,draftIndex,true)
      : renderLineupPlayer(slots.get(slot),teamName,season,index,false);
  };
  let index=1;
  const outfield=lines.map(count=>
    `<div class="lineup-pitch-row">${Array.from({length:count},()=>button(index++)).join('')}</div>`);
  const isCompact = LINEUP_SLOTS.slice(20,26).every(slot => slots.has(slot)) &&
    LINEUP_SLOTS.slice(26).every(slot => !slots.has(slot));
  const outCount = isCompact ? 6 : 10;
  const renderList=(start,count)=>`<div class="lineup-list">${Array.from({length:count},(_,i)=>
    `<div class="lineup-list-item"><span class="lineup-number">${i+1}</span>${button(start+i)}</div>`).join('')}</div>`;
  const title = 'Starting XI — ' + escapeHTML(formation);
  return `<section id="defaultLineup" class="team-profile-section default-lineup-section${editing ? ' lineup-editing' : ''}">
    <h3>Default Lineup · ${escapeHTML(season)} <small>${escapeHTML(formation)}</small></h3>
    ${lineupNotice ? `<p class="lineup-notice" role="status">${escapeHTML(lineupNotice)}</p>` : ''}
    ${editing ? '<p class="lineup-edit-hint">Choose a formation or select a squad slot to swap players.</p>' : ''}
    <h4>${editing ? `<button id="lineupFormation" type="button" onclick="chooseLineupFormation()" ${lineupDraft.saving?'disabled':''}>${title} <span aria-hidden="true">▾</span></button>` : title}</h4>
    <div class="lineup-pitch-scroll"><div class="lineup-pitch" style="--lineup-columns:${Math.max(...lines)}" aria-label="${escapeAttr(formation)} formation, goalkeeper to forwards"><div class="lineup-pitch-markings"></div>
      <div class="lineup-pitch-row lineup-goalkeeper">${button(0)}</div>
      ${outfield.join('')}</div></div>
    <div class="lineup-lists"><div><h4>Substitutes (9)</h4>${renderList(11,9)}</div><div><h4>Not Called Up (${outCount})</h4>${renderList(20,outCount)}</div></div>
  </section>`;
}

const closeReadOnlyTeamProfile = closeTeamProfile;
closeTeamProfile = function(){
  if(!leaveLineupEdit()) return false;
  const content = $('teamDetailContent');
  if(content) content.profileToken = null;
  closeReadOnlyTeamProfile();
  return true;
};
window.closeTeamProfile = closeTeamProfile;

backToTeamGame = function(matchId){
  if(closeTeamProfile()) openMatchDetail(matchId);
};
window.backToTeamGame = backToTeamGame;

$('teamModal')?.addEventListener('click', event => {
  // The legacy full-squad links open player profiles immediately after closing this modal.
  if(lineupDraft && event.target.closest('.team-squad-grid button') && !leaveLineupEdit()){
    event.stopImmediatePropagation();
  }
}, true);
