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
// National-team ordering and the scheduling quotas still use their existing rules.
assert.ok(run(`compareMyGamesMatches({Competition:'Friendlies',Date:'2026-10-27'}, {Competition:'Nations League',Date:'2026-10-28'}) < 0`));
assert.equal(run(`JSON.stringify(computeDayQuotas(26,MY_GAMES_PLAY_DAYS))`),
  '{"Monday":5,"Tuesday":4,"Wednesday":4,"Thursday":4,"Friday":4,"Sunday":5}');

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

const storage = new Map();
context.localStorage = {
  getItem:key=>storage.get(key) ?? null,
  setItem:(key,value)=>storage.set(key,value)
};
context.fixtures = [
  {MatchID:'early',Competition:'Nations League',Date:'2026-11-17',Status:'Scheduled'},
  {MatchID:'same-day',Competition:'Nations League',Date:'2026-11-15',Status:'Scheduled'},
  {MatchID:'at-cutoff',Competition:'Premier League',Date:'2026-11-16',Status:'NS'},
  {MatchID:'club-1',Competition:'Premier League',Date:'2026-11-14',Status:'NS'},
  {MatchID:'club-2',Competition:'Premier League',Date:'2026-11-14',Status:'NS'},
  {MatchID:'club-3',Competition:'Premier League',Date:'2026-11-15',Status:'NS'},
  {MatchID:'club-4',Competition:'Premier League',Date:'2026-11-15',Status:'NS'},
  {MatchID:'club-5',Competition:'Premier League',Date:'2026-11-16',Status:'NS'},
  {MatchID:'later-national',Competition:'Nations League',Date:'2026-11-20',Status:'Scheduled'},
  {MatchID:'next-club',Competition:'FIFA Club World Cup',Date:'2026-11-21',Status:'NS'},
  {MatchID:'unknown',Competition:'Friendlies',Date:'2026-11-14',Status:'FT'}
];
run(`
  const nov12 = new Date('2026-11-12T09:00:00Z');
  const nov13 = new Date('2026-11-13T03:00:00Z');
  const week15 = parseDateOnly('2026-11-09');
  const week16 = parseDateOnly('2026-11-16');
  const ids = matches => matches.map(match=>match.MatchID).join(',');
  const weekFixtures = (week,key) => getMyGamesWeekMatches(fixtures,week,loadMyGamesScheduleStore(),key);
  const plan = (week,key) => Object.fromEntries(
    [...buildMyGamesDayAssignment(weekFixtures(week,key),week,parseDateOnly(key),loadMyGamesScheduleStore())]
      .map(([match,day])=>[match.MatchID,day])
  );
  observeMyGamesResults(fixtures,nov12);
`);
assert.equal(run("getWeekRangeLabel(week15)"),'09/11 - 15/11');
assert.equal(run("dateToKey(getMyGamesKickoffWeekStart(parseDateOnly('2026-11-16')))"),'2026-11-09');
assert.equal(run("dateToKey(getMyGamesKickoffWeekStart(parseDateOnly('2026-11-17')))"),'2026-11-16');
assert.equal(run("dateToKey(getMyGamesSnapshotDate(new Date('2026-11-13T02:59:59Z')))"),'2026-11-12');
assert.equal(run("getNextMyGamesRefresh(new Date('2026-07-01T01:59:00Z'))"),Date.parse('2026-07-01T02:00:00Z'));
const before = JSON.stringify(run("plan(week15,'2026-11-12')"));
assert.match(run("ids(weekFixtures(week16,'2026-11-12'))"),/early/);
context.fixtures[0].Status = context.fixtures[1].Status = 'FT';
run("observeMyGamesResults(fixtures,new Date('2026-11-13T02:59:00Z'))");
assert.equal(JSON.stringify(run("plan(week15,'2026-11-12')")),before);
assert.match(run("ids(weekFixtures(week16,'2026-11-12'))"),/early/);

context.fixtures[2].Status = 'FT';
run("myGamesScheduleStore = undefined; observeMyGamesResults(fixtures,nov13)");
const revised = run("plan(week15,'2026-11-13')");
assert.equal(revised.early,'2026-11-12');
assert.equal(revised['same-day'],'2026-11-12');
assert.equal(revised['at-cutoff'],'2026-11-12');
assert.equal(revised.unknown,'');
assert.equal(run("ids(weekFixtures(week16,'2026-11-13'))"),'later-national,next-club');
const counts = Object.values(revised).filter(date=>date >= '2026-11-13').sort();
assert.deepEqual(counts,['2026-11-13','2026-11-13','2026-11-15','2026-11-15','2026-11-15']);
const future = run("plan(week16,'2026-11-13')");
assert.ok(future['later-national'] <= future['next-club']);

context.output = {};
run(`
  appData = {myGames:fixtures};
  selectedDateKey = '2026-11-11';
  getMyGamesSnapshotDate = () => parseDateOnly('2026-11-13');
  setHTML = setText = (id,value) => output[id] = value;
  renderMyGames();
`);
const blocks = [...context.output.myGamesList.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/g)]
  .map(([,body])=>({
    day:body.match(/<span>([^<]+)<\/span>/)[1],
    games:[...body.matchAll(/openMatchDetail\('([^']+)'\)/g)].map(([,id])=>id)
  }));
assert.deepEqual(blocks.map(({day})=>day),[
  'Monday 09.11','Tuesday 10.11','Wednesday 11.11','Thursday 12.11','Friday 13.11',
  'Saturday 14.11','Sunday 15.11','Played · date unavailable'
]);
assert.deepEqual(blocks[3].games,['same-day','early','at-cutoff']);
assert.equal(context.output.myGamesPlayedValue,4);
assert.equal(context.output.myGamesScheduledValue,5);
console.log('My Games priority, chronological days, London cutoff, frozen plan, Monday ownership and early completions passed.');

run(`
  myGamesScheduleStore = {results:{},weeks:{},lastObservation:''};
  getMyGamesSnapshotDate = now => {
    const clock = getLondonClock(now);
    return clock.hour < 3 ? addDays(clock.date,-1) : clock.date;
  };
  const weekend = [
    {MatchID:'saturday-play',Date:'2026-11-17',Competition:'Serie A',Status:'NS'},
    {MatchID:'monday-play',Date:'2026-11-24',Competition:'Serie A',Status:'NS'}
  ];
  observeMyGamesResults(weekend,new Date('2026-11-14T10:00:00Z'));
  weekend[0].Status = 'FT';
  observeMyGamesResults(weekend,new Date('2026-11-14T12:00:00Z'));
  observeMyGamesResults(weekend,new Date('2026-11-16T10:00:00Z'));
  weekend[1].Status = 'FT';
  observeMyGamesResults(weekend,new Date('2026-11-17T03:00:00Z'));
  const recordedWeekend = getMyGamesWeekMatches(weekend,week15,loadMyGamesScheduleStore(),'2026-11-17');
  const weekendPlan = buildMyGamesDayAssignment(recordedWeekend,week15,parseDateOnly('2026-11-17'),loadMyGamesScheduleStore());
`);
assert.equal(run("weekendPlan.get(weekend[0])"),'2026-11-14');
assert.equal(run("weekendPlan.has(weekend[1])"),false);
assert.equal(run("ids(getMyGamesWeekMatches(weekend,week16,loadMyGamesScheduleStore(),'2026-11-17'))"),'monday-play');
assert.equal(run("getMyGamesRecordedDate(weekend[1],loadMyGamesScheduleStore(),'2026-11-17')"),'2026-11-16');

run(`
  const week16Fixtures = [
    {MatchID:'previous-week',Competition:'Nations League',Date:'2026-11-16',Status:'NS'},
    {MatchID:'first-in-week',Competition:'Nations League',Date:'2026-11-17',Status:'NS'},
    {MatchID:'following-monday',Competition:'Serie A',Date:'2026-11-23',Status:'NS'},
    {MatchID:'following-tuesday',Competition:'Premier League',Date:'2026-11-24',Status:'NS'}
  ];
  const fixtureStore = {
    results:{}, lastObservation:'',
    weeks:{'2026-11-16':{day:'2026-11-16',assignments:{'following-monday':'2026-11-23'}}}
  };
  const nov16 = parseDateOnly('2026-11-16');
  const selectedFixtures = getMyGamesWeekMatches(week16Fixtures,week16,fixtureStore,'2026-11-16');
  const corrected = buildMyGamesDayAssignment(selectedFixtures,week16,nov16,fixtureStore);
  getMyGamesSnapshotDate = () => nov16;
  myGamesScheduleStore = fixtureStore;
  appData = {myGames:[]};
  selectedDateKey = '2026-11-16';
  renderMyGames();
`);
assert.equal(run('ids(selectedFixtures)'),'first-in-week,following-monday');
assert.ok(run("[...corrected.values()].every(date=>date >= '2026-11-16' && date <= '2026-11-22' && date !== '2026-11-21')"));
assert.equal(context.output.myGamesSubtitle,'16/11 - 22/11');
assert.deepEqual([...context.output.myGamesList.matchAll(/<span>(\w+ \d\d\.\d\d)<\/span>/g)].map(([,day])=>day),
  ['Monday 16.11','Tuesday 17.11','Wednesday 18.11','Thursday 19.11','Friday 20.11','Saturday 21.11','Sunday 22.11']);
assert.equal([...context.output.myGamesList.matchAll(/No games\./g)].length,7);
