const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('script.js','utf8');
const context=vm.createContext({console,URLSearchParams,navigator:{},window:{location:{search:''}},document:{addEventListener(){},getElementById(){return null}},setTimeout,clearTimeout});
vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
const registry=JSON.parse(fs.readFileSync('tests/fixtures/player-identities.json','utf8'));
context.fixture=registry;
run(`appData={playerTeams:fixture.slice(0,12).map(r=>({'Player ID':r.id,'Player Name':r.name,Team:r.team,Position:r.position,'Start Date':'01/08/2026','End Date':'','Team Type':'Club',Status:'Active'})),players:[],allEvents:[],matches:[],allMatches:[]};playerTeamsLookup=buildPlayerTeamsLookup(appData.playerTeams);playerAliasLookup=buildPlayerAliasLookup();`);
assert.equal(run('playerTeamsLookup.size'),12);
for(const player of registry.slice(0,12)){
  context.player=player;
  assert.equal(run('playerReference(player.name,player.team)'),'@'+player.id);
  assert.equal(run('getPlayerSeasonRows("@"+player.id,2027).length'),1);
  assert.equal(run('getPlayerSeasonRows("@"+player.id,2027)[0].team'),player.team);
  assert.equal(run('getPlayerImageUrl("@"+player.id)'),player.imageUrl);
  const html=run('renderPlayerProfile("@"+player.id,2027)');
  assert(html.includes(player.name));assert(!html.includes('@CS-P'));
  const counterpart=registry.find(r=>r.name===player.name&&r.id!==player.id);
  if(counterpart)assert(!html.includes('>'+counterpart.team+'<'));
}
for(const name of ['Tyler Roberts','David López','Rodri','Jacobo','Arthur','Vitinha']){
  context.name=name;
  assert.equal(run('canonicalPlayerKey(name).startsWith("ambiguous:")'),true);
  assert.equal(run('getPlayerImageUrl(name)'),'');
  assert.equal(run('findSearchPlayers(getMasterSearchItems().players,name).length'),name==='Jacobo'?3:2);
}
assert.equal(run('playerReference(" RODRI ","Real Betis")'),'@CS-P0006');
assert.equal(run('playerReference("D. López","Girona")'),'@CS-P0003');
assert.equal(run('playerReference("Jacobo","A Coruña")'),'@CS-P0013');
assert.equal(run('getPlayerSeasonRows("Rodri",2027).length'),0);
run(`appData.allEvents=[{MatchID:'1',Event:'Goal',Player:'Rodri',Team:'Man City'},{MatchID:'1',Event:'Goal',Player:'Rodri',Team:'Betis'},{MatchID:'1',Event:'Yellow Card',Player:'Rodri',Team:'Betis'},{MatchID:'1',Event:'Goal',Player:'Someone',Team:'Man City',Detail:'Assist: Rodri'}];`);
assert.deepEqual(JSON.parse(run('JSON.stringify(getPlayerMatchStats({MatchID:"1"},"@CS-P0005"))')),{goals:1,assists:1,yellow:0,red:0});
assert.deepEqual(JSON.parse(run('JSON.stringify(getPlayerMatchStats({MatchID:"1"},"@CS-P0006"))')),{goals:1,assists:0,yellow:1,red:0});
assert.match(run('lineupPlayerButton("Tyler Roberts","Wolves",2027)'),/@CS-P0002/);
assert.match(run('renderPlayerLink("Tyler Roberts","","Birmingham")'),/@CS-P0001/);
assert.match(run('renderEventDetail("Assist: Rodri","Betis")'),/@CS-P0006/);
assert.equal(run('canonicalPlayerKey("David Raya")'),'david raya');
console.log('Passed: 13 stable identities, unchanged visible names, team-specific profiles/photos/lineups, three Jacobos, aliases, and isolated match statistics.');
