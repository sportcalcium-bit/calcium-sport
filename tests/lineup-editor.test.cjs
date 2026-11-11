const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');

const token = 'test-only-editor-key-with-32-characters';
const headers = ['Team','Season','Formation','Slot','Player Name','Player ID'];
const slotAt = i => i < 11 ? 'XI' + (i + 1) : i < 20 ? 'BENCH' + (i - 10) : 'OUT' + (i - 19);
const squad = (team, season, formation, count, ids = false) =>
  Array.from({length:count}, (_, i) => [team,season,formation,slotAt(i),
    (i === 0 ? 'André ' : 'Player ') + (i + 1), ids ? team.toLowerCase() + '-id-' + i : '']);

function mockBackend() {
  const cells = [headers, ...squad('Juventus','2027','4-3-3',30), ...squad('Brazil','2027','4-3-2003',26,true),
    ...squad('Juventus','2028','4-4-2',30)];
  cells[1][5] = '#REF!';
  cells[30][4] = '';
  const batches = [];
  const control = {busy:false, fail:false, locked:false, authorized:true};
  const sheet = {
    getLastRow: () => cells.length, getSheetId: () => 42,
    getRange: (start, col, count, width) => ({
      getFormula: () => '=ARRAYFORMULA(example)',
      getFormulas: () => Array.from({length:count}, () => Array(width).fill('')),
      getDisplayValues: () => cells.slice(start - 1,start + count - 1).map(row => row.slice(col - 1,col + width - 1))
    })
  };
  const context = vm.createContext({
    console:{error(){}},
    SpreadsheetApp:{openById:() => ({getSheetByName:name => name === 'Default Lineups' ? sheet : null})},
    PropertiesService:{getScriptProperties:() => ({getProperty:key => key === 'LINEUP_SPREADSHEET_ID' ? 'mock-sheet-id' : control.authorized ? token : null})},
    Utilities:{DigestAlgorithm:{SHA_256:1}, Charset:{UTF_8:1},
      computeDigest:(_, value) => [...crypto.createHash('sha256').update(value).digest()]},
    LockService:{getScriptLock:() => ({
      tryLock(){if(control.busy || control.locked) return false; return control.locked = true},
      releaseLock(){control.locked = false}
    })},
    Sheets:{Spreadsheets:{batchUpdate({requests}) {
      assert.equal(control.locked,true);
      if(control.fail) throw Error('Simulated Sheets error');
      batches.push(requests);
      for(const {updateCells:{start, rows, fields}} of requests) {
        assert.equal(fields,'userEnteredValue');
        assert.equal(start.sheetId,42);
        assert.ok([2,4,5].includes(start.columnIndex));
        cells[start.rowIndex][start.columnIndex] = rows[0].values[0].userEnteredValue?.stringValue ?? '';
      }
    }}},
    ContentService:{createTextOutput:text => ({setMimeType:() => text}), MimeType:{JSON:1}}
  });
  vm.runInContext(fs.readFileSync('apps-script/lineup-editor/Code.gs','utf8'),context);
  const get = () => JSON.parse(vm.runInContext('doGet()',context));
  const post = data => {
    context.event = {postData:{contents:JSON.stringify(data)}};
    return JSON.parse(vm.runInContext('doPost(event)',context));
  };
  return {get, post, control, cells, batches};
}
const forTeam = (backend,team,season='2027') => backend.get().lineups.filter(r => r.team === team && r.season === season);
const revision = rows => JSON.stringify(rows.map(r => [r.formation,r.playerName,r.playerId]));
const payload = (rows,formation = '3-4-2-1') => ({
  team:rows[0].team, season:rows[0].season, formation, token, base:revision(rows), order:rows.map((_, i) => i)
});
const swap = (order,a,b) => { [order[a],order[b]] = [order[b],order[a]]; };

test('club and national swaps write formation, name and explicit IDs atomically within the scope', () => {
  const backend = mockBackend();
  const nextSeason = forTeam(backend,'Juventus','2028');
  for(const team of ['Juventus','Brazil']) {
    const initial = forTeam(backend,team);
    assert.equal(initial[0].formation,'4-3-3');
    assert.notEqual(initial[0].playerId,'#REF!');
    const change = payload(initial);
    swap(change.order,0,17); // Any position can play goalkeeper.
    swap(change.order,4,23);
    swap(change.order,11,24);
    swap(change.order,5,6);
    if(team === 'Juventus') swap(change.order,2,29); // Move a player into an empty slot.
    const saved = backend.post(change);
    assert.equal(saved.success,true);
    assert.deepEqual(saved.lineups,forTeam(backend,team));
    assert.deepEqual(saved.lineups.map(r => [r.playerName,r.playerId]),
      change.order.map(i => [initial[i].playerName,initial[i].playerId]));
    assert.deepEqual(saved.lineups.map(r => r.slot),initial.map(r => r.slot));
    assert.ok(saved.lineups.every(r => r.formation === '3-4-2-1'));
  }
  assert.equal(backend.batches.length,2);
  assert.equal(backend.batches[0].some(r => r.updateCells.start.columnIndex === 5),false);
  assert.equal(backend.batches[1].some(r => r.updateCells.start.columnIndex === 5),true);
  assert.deepEqual(forTeam(backend,'Juventus','2028'),nextSeason);
});

test('rejects anonymous, invalid, busy, stale and failed writes without changing the sheet', () => {
  const backend = mockBackend();
  const rows = forTeam(backend,'Juventus');
  const change = payload(rows);
  swap(change.order,0,11);
  assert.equal(backend.post({...change,token:''}).code,'permission');
  backend.control.authorized = false;
  assert.equal(backend.post(change).code,'permission');
  backend.control.authorized = true;
  assert.equal(backend.post({...change,order:rows.map(() => 0)}).code,'invalid');
  assert.equal(backend.post({...change,formation:'=SUM(1,2)'}).code,'invalid');
  backend.control.busy = true;
  assert.equal(backend.post(change).code,'busy');
  backend.control.busy = false;
  backend.control.fail = true;
  assert.equal(backend.post(change).code,'unavailable');
  assert.equal(backend.control.locked,false);
  assert.deepEqual(forTeam(backend,'Juventus'),rows);
  assert.equal(backend.batches.length,0);
  backend.control.fail = false;
  assert.equal(backend.post(change).success,true);
  const competing = payload(rows,'5-4-1');
  assert.equal(backend.post(competing).code,'conflict');
  assert.equal(backend.batches.length,1);
});

test('formation changes keep goalkeeper, defense and forward lines where possible', () => {
  const ctx = vm.createContext({window:{location:{search:''}},document:{addEventListener(){},getElementById(){return null}},navigator:{},URLSearchParams});
  for(const file of ['script.js','lineup-editor.js']) vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
  for(const shape of ['3-5-2','4-2-3-1','5-4-1','4-4-2']){
    const order = [...vm.runInContext(`lineupFormationOrder(LINEUP_SLOTS.map((_,i)=>i),'4-3-3','${shape}')`,ctx)];
    assert.equal(order[0],0);
    assert.equal(new Set(order).size,30);
    assert.deepEqual(order.slice(11),Array.from({length:19},(_,i)=>i+11));
    const [defense] = shape.split('-').map(Number);
    assert.deepEqual(order.slice(1,1+Math.min(4,defense)),[1,2,3,4].slice(0,defense));
    assert.equal(order[11-Number(shape.at(-1))],8);
  }
});

module.exports = {mockBackend,token};
