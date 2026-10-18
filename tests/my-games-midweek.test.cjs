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
assert.equal(run(`JSON.stringify(computeDayQuotas(26,MONDAY_TO_SUNDAY_DISPLAY_ORDER))`),
  '{"Monday":4,"Tuesday":4,"Wednesday":3,"Thursday":4,"Friday":4,"Saturday":3,"Sunday":4}');
assert.equal(run('buildMyGamesBaselineAssignment(matches).size'),8);
run(`const frozen = {assignments:{'serie-weekend':'Monday','serie-midweek-early':'Friday'}};
  const restored = storedObjectToAssignmentMap(frozen.assignments,matches);
  if(restored.get(matches[0])!=='Monday' || restored.get(matches[4])!=='Friday') throw Error('Frozen days changed');`);
console.log('My Games midweek ordering, weekend boundaries, country priority, quotas and frozen assignments passed.');
