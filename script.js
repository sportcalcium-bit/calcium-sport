const API_URL = 'https://script.google.com/macros/s/AKfycbyFU-9M16UBls1YvTZfXxCDGLFBT2CL1qvTH7S_pmdHCD6kSeQpHQlQW_gg6r5vhfjOZA/exec';

let appData = null;
function $(id){
  return document.getElementById(id);
}

let playerImageLookup = new Map();
let playerTeamsLookup = new Map();

function $(id){
  return document.getElementById(id);
}
function normalisePlayerName(value){

  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9 ]/g,"")
    .trim()
    .replace(/\s+/g," ");

}
function showError(message){

  console.error(message);

  const title =
    $("competitionTitle");

  if(title){
    title.textContent =
      "Error";
  }


  const subtitle =
    $("competitionSubtitle");

  if(subtitle){
    subtitle.textContent =
      message;
  }

}

let activeCompetition = null;
let currentView = 'nextUp';

let currentRound = '';
let currentGroup = '';

let selectedSeason = '';

let globalMatchesCache = [];
let competitionMatchesCache = [];

let currentTeamProfile = null;
let currentPlayerProfile = null;

const FIXTURE_VERSION = 'FINAL_FIX_2026_08_23';


/* =========================================================
   INITIAL LOAD
========================================================= */

document.addEventListener(
  'DOMContentLoaded',
  function(){

    initialiseSite();

  }
);



async function initialiseSite(){

  try{

    await loadApplicationData();

    setupNavigation();

    setupFilters();

    renderCompetition();

    renderAllSections();


  }catch(error){

    console.error(
      'Calcium Sport initialisation failed:',
      error
    );

    showError(
      'Unable to load website data'
    );

  }

}



/* =========================================================
   LOAD API DATA
========================================================= */


async function loadApplicationData(){

  const params =
    new URLSearchParams(
      window.location.search
    );


  const competitionSlug =
    params.get('competition') || '';



  const response =
    await fetch(
      API_URL +
      '?competition=' +
      encodeURIComponent(
        competitionSlug
      ) +
      '&v=' +
      Date.now()
    );


  if(!response.ok){

    throw new Error(
      'API failed ' + response.status
    );

  }



  appData =
    await response.json();



  if(!appData){

    throw new Error(
      'Empty API response'
    );

  }



  activeCompetition =
    appData.selectedCompetition ||
    null;



  globalMatchesCache =
    Array.isArray(appData.matches)
      ? appData.matches
      : [];



  competitionMatchesCache =
    getCompetitionMatches();


function loadGoogleVisualizationTable(spreadsheetId, sheetName){

  return new Promise((resolve,reject)=>{

    const callbackName =
      "calciumGViz_" + Date.now();


    window[callbackName] = function(response){

      delete window[callbackName];

      try{

        resolve(response.table);

      }catch(error){

        reject(error);

      }

    };


    const script =
      document.createElement("script");


    script.src =
      "https://docs.google.com/spreadsheets/d/"
      + spreadsheetId
      + "/gviz/tq?sheet="
      + encodeURIComponent(sheetName)
      + "&tqx=responseHandler:"
      + callbackName;


    script.onerror = function(){

      delete window[callbackName];

      reject(
        new Error(
          "Google Visualization failed"
        )
      );

    };


    document.head.appendChild(script);


  });

}
  await hydrateFixturesFromSheet(
    appData
  );


  competitionMatchesCache =
    getCompetitionMatches();



  buildPlayerLookups();


}



/* =========================================================
   PLAYER LOOKUPS
========================================================= */


function buildPlayerLookups(){

  playerImageLookup =
    new Map();


  playerTeamsLookup =
    new Map();



  if(
    Array.isArray(
      appData.players
    )
  ){

    appData.players.forEach(
      player=>{

        const name =
          player['Player Name'] ||
          player.Player ||
          player.Name ||
          '';


        const image =
          player.Image ||
          player.Photo ||
          player['Image URL'] ||
          '';


        if(name){

          playerImageLookup.set(
            normalisePlayerName(name),
            image
          );

        }

      }
    );

  }



  if(
    Array.isArray(
      appData.playerTeams
    )
  ){

    appData.playerTeams.forEach(
      row=>{

        const player =
          row['Player Name'] ||
          row.Player ||
          '';


        if(player){

          playerTeamsLookup.set(
            normalisePlayerName(player),
            row
          );

        }

      }
    );

  }

}
/* =========================================================
   MATCH ENGINE - FINAL FIX
   Handles:
   - API matches
   - Global Games
   - New Fixtures sheet format
   - Old competitions
========================================================= */


function getCompetitionMatches(){

  const directMatches =
    Array.isArray(appData?.matches)
      ? appData.matches
      : [];


  const playoffMatches =
    Array.isArray(appData?.playoffs)
      ? appData.playoffs
      : [];



  const matches =
    dedupeMatchArray(
      directMatches.concat(
        playoffMatches
      )
    );



  if(matches.length){

    return matches;

  }



  /*
    Fallback:
    If backend returns no competition matches,
    search global games.
  */


  const global =
    getGlobalMatches();



  const selected =
    appData?.selectedCompetition ||
    {};



  const competitionName =
    normaliseText(
      selected['Competition Name'] ||
      selected.name ||
      ''
    );



  const year =
    String(
      selected.Year ||
      selected.year ||
      ''
    );



  return dedupeMatchArray(

    global.filter(

      match=>{


        const sameCompetition =

          normaliseText(
            match.Competition ||
            match.competition ||
            ''
          )
          === competitionName;



        const sameYear =

          !year ||
          String(
            match.Year ||
            match.year ||
            ''
          ) === year;



        return (
          sameCompetition &&
          sameYear
        );

      }

    )

  );

}





function getGlobalMatches(){


  if(!appData){

    return [];

  }



  const matches =

    Array.isArray(
      appData.matches
    )

      ? appData.matches

      : [];



  return matches.map(

    match=>({

      ...match,


      HomeTeam:

        match.HomeTeam ||

        match.homeTeam ||

        match.home ||

        '',



      AwayTeam:

        match.AwayTeam ||

        match.awayTeam ||

        match.away ||

        '',



      Date:

        match.Date ||

        match.date ||

        '',



      Time:

        match.Time ||

        match.time ||

        '',



      Competition:

        match.Competition ||

        match.competition ||

        '',



      Year:

        match.Year ||

        match.year ||

        ''

    })

  );

}





function dedupeMatchArray(matches){


  const seen =
    new Set();


  return matches.filter(

    match=>{


      const id =

        match.MatchID ||

        match.matchId ||

        match.ID ||


        [

          match.HomeTeam ||
          match.homeTeam,

          match.AwayTeam ||
          match.awayTeam,

          match.Date ||
          match.date

        ].join('|');



      if(seen.has(id)){

        return false;

      }



      seen.add(id);


      return true;


    }

  );

}







/* =========================================================
   MATCH STATUS
========================================================= */


function trulyPlayed(match){


  const status =

    String(

      match.Status ||

      match.status ||

      ''

    )

    .toUpperCase();



  if(status === 'FT'){

    return true;

  }



  return (

    String(
      match.HomeScore ||
      match.homeScore ||
      ''
    ) !== ''


    &&


    String(
      match.AwayScore ||
      match.awayScore ||
      ''
    ) !== ''

  );

}







/* =========================================================
   SCORE PARSER
========================================================= */


function parseScore(score){


  const result = {

    homeScore:'',

    awayScore:'',

    homePens:'',

    awayPens:''

  };



  const value =
    String(score || '')
    .trim();



  if(!value){

    return result;

  }



  const pens =

    value.match(

      /^\((\d+)\)\s*(\d+)\s*-\s*(\d+)\s*\((\d+)\)$/

    );



  if(pens){

    result.homePens =
      pens[1];

    result.homeScore =
      pens[2];

    result.awayScore =
      pens[3];

    result.awayPens =
      pens[4];


    return result;

  }



  const normal =

    value.match(

      /^(\d+)\s*-\s*(\d+)$/

    );



  if(normal){

    result.homeScore =
      normal[1];


    result.awayScore =
      normal[2];

  }



  return result;

}
/* =========================================================
   FIXTURE SHEET READER
   Supports new format:

   R | N | Home | S | Away | HG | AG | HP | AP | Date | Time | Venue | Match ID | YouTube URL

========================================================= */


async function hydrateFixturesFromSheet(data){


  const competition =

    data?.selectedCompetition;



  if(!competition){

    return;

  }



  const sheetId =

    competition['Sheet ID'] ||

    competition.sheetId ||

    competition.sheetID;



  if(!sheetId){

    console.warn(
      "No fixture spreadsheet ID found"
    );

    return;

  }



  try{


    const table =

      await loadGoogleVisualizationTable(

        sheetId,

        'Fixtures'

      );



    if(

      !table ||

      !table.rows ||

      !table.rows.length

    ){

      console.warn(
        "Fixtures sheet empty"
      );

      return;

    }



    const headers =

      table.cols.map(

        col=>

          String(
            col.label ||
            col.id ||
            ''
          )

          .toLowerCase()

          .replace(
            /[^a-z0-9]/g,
            ''
          )

      );



    function findHeader(...names){


      for(

        const name of names

      ){


        const index =

          headers.indexOf(

            String(name)

            .toLowerCase()

            .replace(
              /[^a-z0-9]/g,
              ''
            )

          );



        if(index >= 0){

          return index;

        }

      }



      return -1;

    }





    let columns = {


      round:

        findHeader(
          'R',
          'Round',
          'Gameweek'
        ),


      order:

        findHeader(
          'N',
          'Order'
        ),


      home:

        findHeader(
          'Home',
          'Home Team'
        ),


      score:

        findHeader(
          'S',
          'Score'
        ),


      away:

        findHeader(
          'Away',
          'Away Team'
        ),


      homeScore:

        findHeader(
          'HG',
          'Home Goals'
        ),


      awayScore:

        findHeader(
          'AG',
          'Away Goals'
        ),


      homePens:

        findHeader(
          'HP',
          'Home Pens'
        ),


      awayPens:

        findHeader(
          'AP',
          'Away Pens'
        ),


      date:

        findHeader(
          'Date'
        ),


      time:

        findHeader(
          'Time'
        ),


      venue:

        findHeader(
          'Venue'
        ),


      matchId:

        findHeader(
          'Match ID',
          'MatchID'
        ),


      youtube:

        findHeader(
          'YouTube URL',
          'Youtube URL'
        )


    };





    /*
      Fallback for your exact sheet layout:

      A R
      B N
      C Home
      D S
      E Away
      J Date
      K Time
      N YouTube URL

    */


    if(

      columns.home < 0

      ||

      columns.away < 0

    ){


      columns = {


        round:0,

        order:1,

        home:2,

        score:3,

        away:4,

        homeScore:5,

        awayScore:6,

        homePens:7,

        awayPens:8,

        date:9,

        time:10,

        venue:11,

        matchId:12,

        youtube:13


      };


    }





    function read(row,index){


      if(index < 0){

        return '';

      }


      const cell =

        row.c[index];



      return cell?.f ||

        cell?.v ||

        '';

    }





    const matches =

      table.rows.map(

        (row,index)=>{


          const home =

            read(
              row,
              columns.home
            );


          const away =

            read(
              row,
              columns.away
            );



          if(
            !home ||
            !away
          ){

            return null;

          }



          const score =

            read(
              row,
              columns.score
            );



          const parsed =

            parseScore(score);




          return {


            MatchID:

              read(
                row,
                columns.matchId
              )

              ||

              `${home}-${away}-${index}`,



            HomeTeam:

              home,


            AwayTeam:

              away,


            Home:

              home,


            Away:

              away,



            Score:

              score,



            HomeScore:

              read(
                row,
                columns.homeScore
              )

              ||

              parsed.homeScore,



            AwayScore:

              read(
                row,
                columns.awayScore
              )

              ||

              parsed.awayScore,



            HomePens:

              read(
                row,
                columns.homePens
              )

              ||

              parsed.homePens,



            AwayPens:

              read(
                row,
                columns.awayPens
              )

              ||

              parsed.awayPens,



            Round:

              read(
                row,
                columns.round
              ),



            FixtureOrder:

              read(
                row,
                columns.order
              ),



            Date:

              read(
                row,
                columns.date
              ),



            Time:

              read(
                row,
                columns.time
              ),



            Venue:

              read(
                row,
                columns.venue
              ),



            YouTubeURL:

              read(
                row,
                columns.youtube
              ),



            Status:

              parsed.homeScore !== ''

              &&

              parsed.awayScore !== ''

                ? "FT"

                : "Scheduled"


          };


        }

      )

      .filter(Boolean);





    if(matches.length){


      data.matches = matches;


      data.playoffs = [];


      console.log(

        "Loaded fixtures:",

        matches.length

      );


    }



  }

  catch(error){


    console.error(

      "Fixture loading failed",

      error

    );


  }


}
/* =========================================================
   MATCH NORMALISATION + FILTER FIXES

   Makes Results / Fixtures / Next Up use:
   HomeTeam
   AwayTeam
   Date
   Time
   Status

========================================================= */


function parseScore(score){


  const result = {

    homeScore:'',
    awayScore:'',
    homePens:'',
    awayPens:''

  };



  if(!score){

    return result;

  }



  const text = String(score).trim();




  const penaltyMatch =

    text.match(

      /^\((\d+)\)\s*(\d+)\s*-\s*(\d+)\s*\((\d+)\)$/

    );



  if(penaltyMatch){


    result.homePens =

      penaltyMatch[1];


    result.homeScore =

      penaltyMatch[2];


    result.awayScore =

      penaltyMatch[3];


    result.awayPens =

      penaltyMatch[4];


    return result;


  }





  const normalMatch =

    text.match(

      /^(\d+)\s*-\s*(\d+)$/

    );



  if(normalMatch){


    result.homeScore =

      normalMatch[1];


    result.awayScore =

      normalMatch[2];


  }



  return result;


}







function trulyPlayed(match){


  const status =

    String(

      match.Status ||

      match.status ||

      ''

    )

    .toUpperCase();



  if(status === 'FT'){

    return true;

  }



  return (

    String(

      match.HomeScore ||

      match.homeScore ||

      ''

    ) !== ''

    &&

    String(

      match.AwayScore ||

      match.awayScore ||

      ''

    ) !== ''

  );


}







function getGlobalMatches(){


  if(!appData){

    return [];

  }



  const matches =

    Array.isArray(appData.matches)

      ?

      appData.matches

      :

      [];





  return matches.map(match=>({


    ...match,



    HomeTeam:

      match.HomeTeam ||

      match.homeTeam ||

      match.Home ||

      '',



    AwayTeam:

      match.AwayTeam ||

      match.awayTeam ||

      match.Away ||

      '',



    HomeScore:

      match.HomeScore ||

      match.homeScore ||

      '',



    AwayScore:

      match.AwayScore ||

      match.awayScore ||

      '',



    Date:

      match.Date ||

      match.date ||

      '',



    Time:

      match.Time ||

      match.time ||

      '',



    Competition:

      match.Competition ||

      match.competition ||

      '',



    Year:

      match.Year ||

      match.year ||

      ''


  }));


}







function getCompetitionMatches(){



  if(!appData){

    return [];

  }



  let matches = [];




  if(

    Array.isArray(appData.matches)

  ){


    matches =

      appData.matches;


  }





  if(

    Array.isArray(appData.playoffs)

  ){


    matches =

      matches.concat(

        appData.playoffs

      );


  }





  return dedupeMatchArray(matches);


}







function getFilteredMatches(){



  let matches =

    getCompetitionMatches();




  if(!matches.length){

    return [];

  }




  const search =

    String(

      currentSearch ||

      ''

    )

    .toLowerCase();





  if(search){


    matches =

      matches.filter(match=>{


        return (

          String(match.HomeTeam || '')

          .toLowerCase()

          .includes(search)



          ||

          String(match.AwayTeam || '')

          .toLowerCase()

          .includes(search)



          ||

          String(match.Round || '')

          .toLowerCase()

          .includes(search)

        );


      });


  }





  if(currentRound){


    matches =

      matches.filter(match=>{


        return String(

          match.Round ||

          match.round ||

          ''

        )

        ===

        String(currentRound);



      });


  }





  return matches;


}
