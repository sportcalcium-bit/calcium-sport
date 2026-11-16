const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ctx = vm.createContext({
  console, URLSearchParams, navigator:{}, window:{location:{search:''}},
  document:{addEventListener(){}}, setTimeout, clearTimeout, output:{}
});
vm.runInContext(fs.readFileSync(__dirname+'/../script.js','utf8'),ctx);
const run = code => vm.runInContext(code,ctx);

for(const [instant,key] of [['2026-03-29T01:59:59Z','2026-03-28'],['2026-03-29T02:00:00Z','2026-03-29'],['2026-10-25T02:59:59Z','2026-10-24'],['2026-10-25T03:00:00Z','2026-10-25'],['2026-11-02T02:59:59Z','2026-11-01']]){
 ctx.instant=instant;assert.equal(run('dateToKey(getMyGamesSnapshotDate(new Date(instant)))'),key);
}
for(const [instant,next] of [['2026-03-28T12:00:00Z','2026-03-29T02:00:00.000Z'],['2026-10-24T12:00:00Z','2026-10-25T03:00:00.000Z']]){
 ctx.instant=instant;assert.equal(run('new Date(getNextMyGamesRefresh(new Date(instant))).toISOString()'),next);
}

ctx.games = [
  ['UKR-SPA-17112026','Nations League','Ukraine','Spain','17/11/2026','17:00',2,2],
  ['ENG-SWE-17112026','Nations League','England','Sweden','Date(2026,10,17)','Date(1899,11,30,19,45,0)',0,2],
  ['GER-NET-17112026','Nations League','Germany','Netherlands','17.11.2026 19:45','',2,2],
  ['POR-CZE-17112026','Nations League','Portugal','Czech Republic','2026-11-17T19:45:00Z','',4,0],
  ['CLE-PSG-20112026','Ligue 1','Clermont','PSG','20/11/2026','19:45',0,2],
  ['HAM-BAY-21112026','Bundesliga','Hamburger SV','Bayern','21/11/2026','14:30',0,3],
  ['earlier-club','Ligue 1','PSG','Toulouse','16/11/2026','09:00','',''],
  ['same-day-club','Ligue 1','PSG','Lille','17/11/2026','09:00','',''],
  ['following-monday','Ligue 1','PSG','Lens','23/11/2026','19:45','',''],
  ['missing','Nations League','England','France','17.11','16:00',1,1]
].map(([matchId,competition,homeTeam,awayTeam,date,time,homeScore,awayScore])=>({
  matchId,competition,homeTeam,awayTeam,date,time,homeScore,awayScore,year:2027,
  status:homeScore === '' ? 'Scheduled' : 'FT'
}));
ctx.fetch = async url=>url.includes('action=home')
  ? {ok:true,json:async()=>({
      myGames:ctx.games,
      competitions:[{name:'Nations League',year:2027,sheetId:'nations'}]
    })}
  : {ok:true,json:async()=>({fixtures:[
      {'Match ID':'UKR-SPA-17112026',Home:'Ukraine',Away:'Spain',Date:'Date(2026,10,17)',Time:'17:00'}
    ]})};

async function verifyFixtureDates(){
  await run('appData = {}; loadHomeData()');
  run(`
    selectedDateKey = '2026-11-16';
    setHTML = setText = (id,value) => output[id] = value;
    renderMyGames();
  `);
  const blocks = [...ctx.output.myGamesList.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/g)]
    .map(([,body])=>({
      day:body.match(/<span>([^<]+)<\/span>/)[1],
      games:[...body.matchAll(/openMatchDetail\('([^']+)'\)/g)].map(([,id])=>id)
    }));
  assert.deepEqual(blocks.map(({day})=>day),[
    'Monday 16.11','Tuesday 17.11','Wednesday 18.11','Thursday 19.11',
    'Friday 20.11','Saturday 21.11','Sunday 22.11'
  ]);
  assert.deepEqual(blocks[0].games,['earlier-club']);
  assert.deepEqual(blocks[1].games,[
    'UKR-SPA-17112026','ENG-SWE-17112026','GER-NET-17112026','POR-CZE-17112026','same-day-club'
  ]);
  assert.deepEqual(blocks[4].games,['CLE-PSG-20112026']);
  assert.deepEqual(blocks[5].games,['HAM-BAY-21112026']);
  assert.equal(ctx.output.myGamesPlayedValue,6);
  assert.equal(ctx.output.myGamesScheduledValue,2);
  assert.equal(run('appData.myGames[0].HomeScore'),2);
  assert.equal(run('appData.myGames[0].Status'),'FT');
  run("selectedDateKey = '2026-11-23'; renderMyGames()");
  assert.match(ctx.output.myGamesList,/Monday 23.11[\s\S]*following-monday/);

  for(const [input,expected] of [
    ['2026-12-31T23:45:00-02:00',{date:'2027-01-01',time:'01:45'}],
    ['2026-07-01T23:45:00Z',{date:'2026-07-02',time:'00:45'}],
    ['2026-12-31T23:45:00',{date:'2026-12-31',time:'23:45'}],
    ['Date(2026,10,17,19,45,0)',{date:'2026-11-17',time:'19:45'}],
    ['31/02/2026',null],
    ['17.11',null],
    ['',null]
  ]){
    ctx.input = input;
    assert.deepEqual(JSON.parse(run('JSON.stringify(parseMyGamesFixtureDate(input))')),expected);
  }
}
verifyFixtureDates().catch(error=>{console.error(error);process.exitCode=1;});
