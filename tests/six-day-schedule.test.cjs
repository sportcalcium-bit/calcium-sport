const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let clock='2026-11-02T03:00:00Z',saved={};
class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));} static now(){return new Date(clock).getTime();}}
const elements={myGamesDailyStats:{innerHTML:''}};
const ctx=vm.createContext({Date:Clock,console,URLSearchParams,navigator:{},window:{location:{search:''}},document:{addEventListener(){},getElementById:id=>elements[id]},setTimeout,clearTimeout,localStorage:{getItem:k=>saved[k]||null,setItem:(k,v)=>saved[k]=v}});
vm.runInContext(fs.readFileSync(__dirname+'/../script.js','utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
for(const [n,expected] of [[24,[4,4,4,4,4,4]],[29,[5,5,4,5,5,5]],[30,[5,5,5,5,5,5]]]){
 assert.deepEqual(JSON.parse(run('JSON.stringify(computeDayQuotas('+n+',MONDAY_TO_SUNDAY_DISPLAY_ORDER))')),Object.fromEntries(['Monday','Tuesday','Wednesday','Thursday','Friday','Sunday'].map((d,i)=>[d,expected[i]])));
}
for(const [instant,key] of [['2026-03-29T01:59:59Z','2026-03-28'],['2026-03-29T02:00:00Z','2026-03-29'],['2026-10-25T02:59:59Z','2026-10-24'],['2026-10-25T03:00:00Z','2026-10-25'],['2026-11-02T02:59:59Z','2026-11-01']]){
 ctx.instant=instant;assert.equal(run('dateToKey(getMyGamesSnapshotDate(new Date(instant)))'),key);
}
for(const [instant,next] of [['2026-03-28T12:00:00Z','2026-03-29T02:00:00.000Z'],['2026-10-24T12:00:00Z','2026-10-25T03:00:00.000Z']]){
 ctx.instant=instant;assert.equal(run('new Date(getNextMyGamesRefresh(new Date(instant))).toISOString()'),next);
}
for(const tuesdayPlayed of [3,5]){
 saved={};clock='2026-11-02T03:00:00Z';
 ctx.matches=Array.from({length:24},(_,i)=>({MatchID:String(i),Status:'Scheduled',Date:'2026-11-03',Competition:'Serie A'}));
 run('var week=parseDateOnly("2026-11-02"); var plan=buildFrozenCurrentMyGamesAssignment(matches,week)');
 ctx.matches.slice(0,4).forEach(m=>m.Status='FT');
 clock='2026-11-03T03:00:00Z';run('plan=buildFrozenCurrentMyGamesAssignment(matches,week)');
 ctx.matches.slice(4,4+tuesdayPlayed).forEach(m=>m.Status='FT');
 const before=run('JSON.stringify(assignmentMapToStoredObject(buildFrozenCurrentMyGamesAssignment(matches,week)))');
 assert.equal(run('JSON.stringify(assignmentMapToStoredObject(plan))'),before);
 clock='2026-11-04T03:00:00Z';run('plan=buildFrozenCurrentMyGamesAssignment(matches,week)');
 const counts=JSON.parse(run('JSON.stringify(Object.fromEntries(MONDAY_TO_SUNDAY_DISPLAY_ORDER.map(d=>[d,[...plan].filter(([m,day])=>day===d&&!isPlayedMatch(m)).length])))'));
 assert.deepEqual(counts,tuesdayPlayed===3?{Monday:0,Tuesday:0,Wednesday:4,Thursday:4,Friday:4,Sunday:5}:{Monday:0,Tuesday:0,Wednesday:3,Thursday:4,Friday:4,Sunday:4});
 const once=JSON.stringify(saved);run('buildFrozenCurrentMyGamesAssignment(matches,week)');assert.equal(JSON.stringify(saved),once);
 assert.equal(run('[...plan.values()].includes("Saturday")'),false);
 run('renderMyGamesDailyCounters(plan)');assert.equal((elements.myGamesDailyStats.innerHTML.match(/my-games-stat-label/g)||[]).length,6);assert.ok(!elements.myGamesDailyStats.innerHTML.includes('Sat'));
 clock='2026-11-07T03:00:00Z';assert.equal(run('getEligibleMyGamesDays(week,getMyGamesSnapshotDate()).join()'),'Sunday');
 clock='2026-11-09T02:59:59Z';assert.equal(run('dateToKey(getMyGamesWeekStart(getMyGamesSnapshotDate()))'),'2026-11-02');
 clock='2026-11-09T03:00:00Z';assert.equal(run('dateToKey(getMyGamesWeekStart(getMyGamesSnapshotDate()))'),'2026-11-09');
}
console.log('PASS: quotas 24/29/30, under/overplay, freeze, idempotence, Saturday omission, DST and week boundaries');

// Upgrade a v3 snapshot without losing completed matches or score data.
saved={};clock='2026-11-04T03:00:00Z';
ctx.matches=[{MatchID:'done',Status:'FT',HomeScore:2,AwayScore:1},{MatchID:'pending',Status:'NS'}];
run(`saveMyGamesScheduleStore({version:3,weeks:{'2026-11-02':{snapshots:{'2026-11-04':{assignments:{done:'Monday',pending:'Saturday'},playedAtSnapshot:{done:true,pending:false}}}}}})`);
const resultBefore=JSON.stringify(ctx.matches);
run('plan=buildFrozenCurrentMyGamesAssignment(matches,week)');
assert.equal(run('plan.get(matches[0])'),'Monday');
assert.notEqual(run('plan.get(matches[1])'),'Saturday');
assert.equal(JSON.stringify(ctx.matches),resultBefore);
const historic=run('JSON.stringify(assignmentMapToStoredObject(plan))');
clock='2026-11-09T03:00:00Z';
assert.equal(run('JSON.stringify(assignmentMapToStoredObject(buildMyGamesDayAssignment(matches,week,false)))'),historic);
console.log('PASS: v3 migration, completed results and past-week history');
