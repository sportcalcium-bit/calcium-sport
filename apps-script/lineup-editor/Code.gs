const LINEUP_HEADERS = ['Team', 'Season', 'Formation', 'Slot', 'Player Name', 'Player ID'];
const LINEUP_SLOTS = [
  ...Array.from({length: 11}, (_, i) => 'XI' + (i + 1)),
  ...Array.from({length: 9}, (_, i) => 'BENCH' + (i + 1)),
  ...Array.from({length: 10}, (_, i) => 'OUT' + (i + 1))
];

function doGet() {
  return lineupResponse_(() => ({
    success: true,
    lineups: lineupTable_().rows.map(lineupPublicRow_)
  }));
}

function doPost(event) {
  return lineupResponse_(() => {
    const body = event?.postData?.contents;
    if (!body || body.length > 8192) lineupFail_('invalid');
    let data;
    try { data = JSON.parse(body); } catch (_) { lineupFail_('invalid'); }
    const secret = PropertiesService.getScriptProperties().getProperty('LINEUP_EDITOR_TOKEN');
    if (!secret || secret.length < 32 || typeof data?.token !== 'string' ||
        !lineupEqual_(lineupDigest_(data.token), lineupDigest_(secret))) lineupFail_('permission');

    const {team, season, base, formation, order} = data;
    if (typeof team !== 'string' || !team || typeof season !== 'string' || !season ||
        typeof base !== 'string' || !lineupFormation_(formation) ||
        !Array.isArray(order) || order.length < 11 || order.length > LINEUP_SLOTS.length ||
        new Set(order).size !== order.length ||
        order.some(i => !Number.isInteger(i) || i < 0 || i >= order.length)) lineupFail_('invalid');

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) lineupFail_('busy');
    try {
      const {workbookId, sheet, rows, derivesIds, idFormula} = lineupTable_();
      const slots = rows.filter(r => r.team === team && r.season === season && LINEUP_SLOTS.includes(r.slot));
      const bySlot = new Map(slots.map(r => [r.slot, r]));
      if (slots.length !== bySlot.size || LINEUP_SLOTS.slice(0, 11).some(slot => !bySlot.has(slot))) lineupFail_('schema');
      const current = LINEUP_SLOTS.flatMap(slot => bySlot.has(slot) ? [bySlot.get(slot)] : []);
      if (current.length !== order.length) lineupFail_('conflict');
      const names = current.map(r => r.playerName);
      const ids = current.filter(r => r.playerName).map(r => (r.playerId || r.playerName).toLowerCase());
      if (new Set(ids).size !== ids.length) lineupFail_('schema');
      if (lineupRevision_(current) !== base) lineupFail_('conflict');

      const minRow = Math.min(...current.map(r => r.row));
      const maxRow = Math.max(...current.map(r => r.row));
      const formulas = sheet.getRange(minRow, 3, maxRow - minRow + 1, 4).getFormulas();
      if (current.some(r => {
        const [shape, , name, id] = formulas[r.row - minRow];
        return shape || name || (id && r.row !== 2);
      })) lineupFail_('schema');

      const requests = [];
      const updated = current.map((r, i) => {
        const player = current[order[i]];
        if (r.rawFormation !== formation) requests.push(lineupCell_(sheet.getSheetId(), r.row, 2, formation));
        if (names[i] !== player.playerName) requests.push(lineupCell_(sheet.getSheetId(), r.row, 4, player.playerName));
        if (!derivesIds && r.explicitId !== player.explicitId) {
          if (r.row === 2 && idFormula) lineupFail_('schema');
          requests.push(lineupCell_(sheet.getSheetId(), r.row, 5, player.explicitId));
        }
        return {...lineupPublicRow_(r), formation, playerName: player.playerName, playerId: player.playerId};
      });
      if (requests.length) Sheets.Spreadsheets.batchUpdate({requests}, workbookId);
      return {success: true, lineups: updated, revision: lineupRevision_(updated)};
    } finally {
      lock.releaseLock();
    }
  });
}

function lineupTable_() {
  const workbookId = PropertiesService.getScriptProperties().getProperty('LINEUP_SPREADSHEET_ID');
  if (!workbookId) lineupFail_('unavailable');
  const book = SpreadsheetApp.openById(workbookId);
  const sheet = book.getSheetByName('Default Lineups');
  const [headers, ...values] = sheet.getRange(1, 1, sheet.getLastRow(), LINEUP_HEADERS.length).getDisplayValues();
  if (LINEUP_HEADERS.some((header, i) => headers[i] !== header)) lineupFail_('schema');
  const idFormula = sheet.getRange('F2').getFormula();
  if (idFormula && !/^=ARRAYFORMULA\(/i.test(idFormula)) lineupFail_('schema');
  const derivesIds = !!idFormula && values[0]?.[5] !== '#REF!';
  const keys = book.getSheetByName('Player Identity Keys');
  const identities = keys && keys.getLastRow() > 1
    ? new Map(keys.getRange(2, 1, keys.getLastRow() - 1, 2).getDisplayValues())
    : new Map();
  const rows = values.map((cells, i) => {
    const [team, season, rawFormation, slot, playerName, cellId] = cells.map(value => value.trim());
    const explicitId = derivesIds || (i === 0 && idFormula) ? '' : cellId;
    const key = playerName.replace(/ +/g, ' ') + '|' + team.replace(/ +/g, ' ');
    const fallbackId = identities.get(key.toLowerCase()) || playerName.toLowerCase().replace(/\s+/g, '-');
    // Sheets parsed some imported formations as dates such as 4-3-2003.
    const dateShape = rawFormation.replace(/^([1-5]-[1-5])-200([1-5])$/, '$1-$2');
    const formation = lineupFormation_(dateShape) ? dateShape : rawFormation;
    const playerId = playerName ? explicitId || (derivesIds && cellId) || fallbackId : '';
    return {team, season, formation, slot: slot.toUpperCase(), playerName, playerId,
      row: i + 2, rawFormation, explicitId};
  }).filter(r => r.team && r.season && r.slot);
  return {workbookId, sheet, rows, derivesIds, idFormula};
}

function lineupPublicRow_({team, season, formation, slot, playerName, playerId}) {
  return {team, season, formation, slot, playerName, playerId};
}

function lineupRevision_(rows) {
  // The client sends this exact snapshot as a JSON string. The sheet is public read data.
  return JSON.stringify(rows.map(r => [r.formation, r.playerName, r.playerId]));
}

function lineupFormation_(value) {
  return typeof value === 'string' && /^[1-5](?:-[1-5]){1,3}$/.test(value) &&
    value.split('-').reduce((sum, n) => sum + Number(n), 0) === 10;
}

function lineupCell_(sheetId, row, column, value) {
  return {updateCells: {
    start: {sheetId, rowIndex: row - 1, columnIndex: column},
    rows: [{values: [value ? {userEnteredValue: {stringValue: value}} : {}]}],
    fields: 'userEnteredValue'
  }};
}

function lineupDigest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
}

function lineupEqual_(left, right) {
  return left.reduce((difference, byte, i) => difference | (byte ^ right[i]), 0) === 0;
}

function lineupFail_(code) {
  const error = new Error(code);
  error.lineupCode = code;
  throw error;
}

function lineupResponse_(operation) {
  let response;
  try {
    response = operation();
  } catch (error) {
    response = {success: false, code: error.lineupCode || 'unavailable'};
    if (!error.lineupCode) console.error('Lineup operation failed', error);
  }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}
