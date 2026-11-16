const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = vm.createContext({
  console, URLSearchParams, navigator:{},
  window:{location:{search:''}},
  document:{addEventListener(){}}, setTimeout, clearTimeout
});
vm.runInContext(fs.readFileSync('script.js','utf8'),context);
const run = code => vm.runInContext(code,context);
context.matches = [
  {MatchID:'serie-weekend',Competition:'Serie A',Date:'01/11/2026',Time:'19:45',HomeTeam:'AC Milan',AwayTeam:'Napoli'},
  {MatchID:'english-cup',Competition:'Carabao Cup',Date:'27/10/2026',Time:'20:00'},
  {MatchID:'serie-midweek-late',Competition:'Serie A',Date:'28/10/2026',Time:'19:45',HomeTeam:'Napoli'},
  {MatchID:'german-cup',Competition:'DFB Pokal',Date:'28/10/2026',Time:'19:45'},
  {MatchID:'serie-midweek-early',Competition:'Serie A',Date:'27/10/2026',Time:'19:45',HomeTeam:'Bologna'},
  {MatchID:'europe',Competition:'UEFA Champions League',Date:'28/10/2026',Time:'20:00'},
  {MatchID:'french-midweek',Competition:'Ligue 1',Date:'29/10/2026',Time:'20:00'},
  {MatchID:'english-weekend',Competition:'Premier League',Date:'31/10/2026',Time:'12:30'}
];
assert.equal(run(`matches.slice().sort(compareMyGamesMatches).map(m=>m.MatchID).join(',')`),
  'europe,french-midweek,german-cup,serie-midweek-early,serie-midweek-late,english-cup,serie-weekend,english-weekend');
for(const date of ['2026-10-30','2026-10-31','2026-11-01','2026-11-02']){
  context.fixture = {Competition:'Serie A',Date:date};
  assert.equal(run('isMyGamesMidweekLeagueMatch(fixture)'),false);
  assert.equal(run('getMyGamesPriorityTier(fixture)'),23);
}
for(const date of ['2026-10-27','2026-10-28','2026-10-29']){
  context.fixture = {Competition:'Serie A',Date:date};
  assert.equal(run('getMyGamesPriorityTier(fixture)'),13);
}
context.fixture = {Competition:'Serie A',Date:''};
assert.equal(run('isMyGamesMidweekLeagueMatch(fixture)'),false);
for(const fixture of [
  {Competition:'UEFA Nations League',Region:'Europe'},
  {Competition:'FIFA World Cup',Region:'World'},
  {Competition:'CONMEBOL World Cup Qualifiers'},
  {Competition:'Copa América',Region:'World'},
  {Competition:'AFC Asian Cup',Region:'World'},
  {Competition:'International Friendly',Region:'Europe'},
  {Competition:'Other tournament',Region:'National Teams'}
]){
  context.fixture = fixture;
  assert.equal(run('isMyGamesNationalTeamMatch(fixture)'),true,fixture.Competition);
}
for(const fixture of [
  {Competition:'FIFA Club World Cup'},
  {Competition:'FIFA Intercontinental Cup',Region:'International'},
  {Competition:'AFC Champions League Elite',Region:'Asia'},
  {Competition:'CONCACAF Champions Cup',Region:'North America'},
  {Competition:'Copa Libertadores',Region:'South America'},
  {Competition:'UEFA Champions League',Region:'Europe'},
  {Competition:'Club Friendlies',Region:'International'}
]){
  context.fixture = fixture;
  assert.equal(run('isMyGamesNationalTeamMatch(fixture)'),false,fixture.Competition);
}

async function testMissingClubFixtures(){
  context.feed = {
    competitions:[
      {name:'La Liga',year:2026,sheetId:'old-spain'},
      {name:'La Liga',year:2027,sheetId:'spain',region:'Spain'},
      {name:'Bundesliga',year:2027,sheetId:'germany',region:'Germany'},
      {name:'Ligue 1',year:2027,sheetId:'france',region:'France'},
      {name:'UEFA Champions League',year:2027,sheetId:'ucl',region:'Europe'}
    ],
    allGames:[{matchId:'old-game',competition:'La Liga',year:2026,date:'2026-04-12',homeTeam:'Barcelona',awayTeam:'Valencia'}],
    myGames:[
      {matchId:'existing',competition:'Serie A',homeTeam:'Inter',awayTeam:'Napoli'},
      {matchId:'bayern',competition:'Bundesliga',homeTeam:'Hamburger SV',awayTeam:'Bayern'}
    ]
  };
  const row = (id,home,away,date)=>({'Match ID':id,Home:home,Away:away,Date:date});
  const sheets = {
    spain:[
      row('madrid','Real Madrid','Osasuna','21/11/2026'),
      row('atletico','Mallorca','Atlético Madrid','22/11/2026'),
      row('barcelona','Real Sociedad','Barcelona','22/11/2026'),
      row('other','Elche','Sevilla','20/11/2026')
    ],
    germany:[row('bayern','Hamburger SV','Bayern','22/11/2026')],
    france:[row('psg','Clermont','PSG','20/11/2026')],
    'old-spain':[row('old-madrid','Real Madrid','Valencia','12/04/2026')],
    ucl:[row('ucl-bayern','Bayern','PSG','25/11/2026')]
  };
  const requested = [];
  context.fetch = async url=>{
    const params = new URL(url).searchParams;
    if(params.get('action') === 'home') return {ok:true,json:async()=>context.feed};
    const sheet = params.get('sheetId');
    requested.push(sheet);
    return {ok:true,json:async()=>({fixtures:sheets[sheet]})};
  };
  run("appData = {}; const ids = matches => matches.map(match=>match.MatchID).join(',');");
  await run('loadHomeData()');
  assert.deepEqual(requested.sort(),['france','germany','old-spain','spain','ucl']);
  assert.equal(run('ids(appData.myGames)'),'existing,bayern,old-game,old-madrid,madrid,atletico,barcelona,psg,ucl-bayern');
  assert.equal(run('ids(appData.allMatches)'),'old-game');
  assert.equal(run("appData.myGames.find(match=>match.MatchID==='bayern').Date"),'2026-11-22');
  assert.equal(run("appData.myGames.find(match=>match.MatchID==='ucl-bayern').Date"),'2026-11-25');
  assert.equal(run("appData.myGames.find(match=>match.MatchID==='existing').Date"),'');
}
testMissingClubFixtures().catch(error=>{console.error(error);process.exitCode=1;});
