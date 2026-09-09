const CS_ENGINE_VERSION = '1.0.0';
const CS_SHEETS = {
  EVENTS: 'Engine Events',
  STORYLINES: 'Engine Storylines',
  LINKS: 'Engine Entity Links'
};

const EVENT_HEADERS = [
  'Event ID','Occurred At','Created At','Type','Title','Summary','Details',
  'Status','Confidence','Lifecycle','Source','Created By','Entities JSON',
  'Storyline IDs JSON','Supersedes Event ID','Metadata JSON'
];

const STORYLINE_HEADERS = [
  'Storyline ID','Title','Summary','Type','Status','Importance','Momentum',
  'Started At','Last Updated At','Entities JSON','Event IDs JSON','Tags JSON',
  'Resolution','Metadata JSON'
];

const LINK_HEADERS = [
  'Entity Key','Entity Type','Entity Name','Entity ID','Record Type','Record ID',
  'Occurred At','Status','Lifecycle'
];

function doGet(e) {
  try {
    const action = clean_(e && e.parameter && e.parameter.action) || 'health';
    switch (action) {
      case 'health':
        return json_({ ok: true, engine: 'Calcium Sport Engine', version: CS_ENGINE_VERSION, now: new Date().toISOString() });
      case 'context':
        return json_(getContext_(e.parameter));
      case 'events':
        return json_({ events: queryEvents_(e.parameter || {}) });
      case 'storylines':
        return json_({ storylines: queryStorylines_(e.parameter || {}) });
      case 'entity':
        return json_(getEntity_(e.parameter || {}));
      default:
        return json_({ error: 'Unknown action: ' + action }, 400);
    }
  } catch (err) {
    return json_({ error: String(err && err.message ? err.message : err) }, 500);
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = clean_(body.action) || clean_(e && e.parameter && e.parameter.action);
    switch (action) {
      case 'remember':
        return json_(remember_(body));
      case 'createStoryline':
        return json_(createStoryline_(body));
      case 'updateStoryline':
        return json_(updateStoryline_(body));
      case 'resolveRumour':
        return json_(resolveRumour_(body));
      case 'setup':
        return json_(setupEngine_());
      default:
        return json_({ error: 'Unknown action: ' + action }, 400);
    }
  } catch (err) {
    return json_({ error: String(err && err.message ? err.message : err) }, 500);
  }
}

function setupEngine_() {
  const ss = engineSpreadsheet_();
  ensureSheet_(ss, CS_SHEETS.EVENTS, EVENT_HEADERS);
  ensureSheet_(ss, CS_SHEETS.STORYLINES, STORYLINE_HEADERS);
  ensureSheet_(ss, CS_SHEETS.LINKS, LINK_HEADERS);
  return { ok: true, spreadsheetId: ss.getId(), sheets: Object.values(CS_SHEETS) };
}

function remember_(body) {
  setupEngine_();
  const text = clean_(body.text);
  if (!text) throw new Error('remember requires text');

  const createdBy = enum_(clean_(body.createdBy) || 'USER', ['USER','FACT_API','ENGINE','MEDIA'], 'createdBy');
  const status = enum_(clean_(body.status) || 'CONFIRMED', ['CONFIRMED','RUMOUR','OPINION'], 'status');
  const lifecycle = enum_(clean_(body.lifecycle) || 'ACTIVE', ['ACTIVE','DORMANT','RESOLVED','CLOSED_FALSE'], 'lifecycle');
  const confidence = normalizeConfidence_(status, body.confidence, lifecycle);
  const occurredAt = normalizeDate_(body.occurredAt) || new Date().toISOString();
  const entities = normalizeEntities_(body.entities || body.entityHints || []);
  if (!entities.length) throw new Error('remember requires at least one linked entity');

  const event = {
    id: clean_(body.id) || id_('evt'),
    occurredAt: occurredAt,
    createdAt: new Date().toISOString(),
    type: clean_(body.type) || inferEventType_(text, status),
    title: clean_(body.title) || makeTitle_(text),
    summary: clean_(body.summary) || text,
    details: clean_(body.details) || '',
    status: status,
    confidence: confidence,
    lifecycle: lifecycle,
    source: clean_(body.source) || (createdBy === 'USER' ? 'User' : ''),
    createdBy: createdBy,
    entities: entities,
    storylineIds: arrayStrings_(body.storylineIds),
    supersedesEventId: clean_(body.supersedesEventId),
    metadata: object_(body.metadata)
  };

  appendEvent_(event);
  appendLinksForEvent_(event);
  attachEventToStorylines_(event);
  return { ok: true, event: event };
}

function createStoryline_(body) {
  setupEngine_();
  const title = clean_(body.title);
  if (!title) throw new Error('createStoryline requires title');
  const entities = normalizeEntities_(body.entities || []);
  if (!entities.length) throw new Error('createStoryline requires entities');
  const now = new Date().toISOString();
  const storyline = {
    id: clean_(body.id) || id_('story'),
    title: title,
    summary: clean_(body.summary),
    type: clean_(body.type) || 'OTHER',
    status: enum_(clean_(body.status) || 'ACTIVE', ['ACTIVE','DORMANT','RESOLVED'], 'status'),
    importance: clampInt_(body.importance, 50),
    momentum: clampInt_(body.momentum, 50),
    startedAt: normalizeDate_(body.startedAt) || now,
    lastUpdatedAt: now,
    entities: entities,
    eventIds: arrayStrings_(body.eventIds),
    tags: arrayStrings_(body.tags),
    resolution: clean_(body.resolution),
    metadata: object_(body.metadata)
  };
  appendStoryline_(storyline);
  appendLinksForStoryline_(storyline);
  return { ok: true, storyline: storyline };
}

function updateStoryline_(body) {
  setupEngine_();
  const id = clean_(body.storylineId || body.id);
  if (!id) throw new Error('updateStoryline requires storylineId');
  const sheet = engineSpreadsheet_().getSheetByName(CS_SHEETS.STORYLINES);
  const rows = rowsAsObjects_(sheet);
  const idx = rows.findIndex(r => clean_(r['Storyline ID']) === id);
  if (idx < 0) throw new Error('Storyline not found: ' + id);
  const current = storylineFromRow_(rows[idx]);
  const merged = {
    ...current,
    title: body.title !== undefined ? clean_(body.title) : current.title,
    summary: body.summary !== undefined ? clean_(body.summary) : current.summary,
    type: body.type !== undefined ? clean_(body.type) : current.type,
    status: body.status !== undefined ? enum_(clean_(body.status), ['ACTIVE','DORMANT','RESOLVED'], 'status') : current.status,
    importance: body.importance !== undefined ? clampInt_(body.importance, current.importance) : current.importance,
    momentum: body.momentum !== undefined ? clampInt_(body.momentum, current.momentum) : current.momentum,
    entities: body.entities !== undefined ? normalizeEntities_(body.entities) : current.entities,
    eventIds: body.eventIds !== undefined ? arrayStrings_(body.eventIds) : current.eventIds,
    tags: body.tags !== undefined ? arrayStrings_(body.tags) : current.tags,
    resolution: body.resolution !== undefined ? clean_(body.resolution) : current.resolution,
    metadata: body.metadata !== undefined ? object_(body.metadata) : current.metadata,
    lastUpdatedAt: new Date().toISOString()
  };
  sheet.getRange(idx + 2, 1, 1, STORYLINE_HEADERS.length).setValues([storylineToRow_(merged)]);
  rebuildLinksForRecord_('STORYLINE', id, merged.entities, merged.lastUpdatedAt, merged.status, merged.status);
  return { ok: true, storyline: merged };
}

function resolveRumour_(body) {
  setupEngine_();
  const id = clean_(body.eventId || body.id);
  if (!id) throw new Error('resolveRumour requires eventId');
  const sheet = engineSpreadsheet_().getSheetByName(CS_SHEETS.EVENTS);
  const rows = rowsAsObjects_(sheet);
  const idx = rows.findIndex(r => clean_(r['Event ID']) === id);
  if (idx < 0) throw new Error('Event not found: ' + id);
  const current = eventFromRow_(rows[idx]);
  if (current.status !== 'RUMOUR') throw new Error('Event is not a rumour');
  const confirmed = body.confirmed === true || clean_(body.outcome).toUpperCase() === 'CONFIRMED';
  const closedFalse = body.confirmed === false || ['FALSE','DISPROVED','CLOSED_FALSE'].includes(clean_(body.outcome).toUpperCase());
  const next = { ...current };
  if (confirmed) {
    next.status = 'CONFIRMED'; next.confidence = 100; next.lifecycle = 'RESOLVED';
  } else if (closedFalse) {
    next.confidence = 0; next.lifecycle = 'CLOSED_FALSE';
  } else {
    next.lifecycle = 'RESOLVED';
  }
  next.metadata = { ...object_(next.metadata), resolution: clean_(body.reason || body.outcome), resolvedAt: new Date().toISOString() };
  sheet.getRange(idx + 2, 1, 1, EVENT_HEADERS.length).setValues([eventToRow_(next)]);
  rebuildLinksForRecord_('EVENT', id, next.entities, next.occurredAt, next.status, next.lifecycle);
  return { ok: true, event: next };
}

function getContext_(params) {
  setupEngine_();
  const entities = splitCsv_(params.entities || params.entity || '');
  if (!entities.length) throw new Error('context requires entities');
  const limit = Math.min(Math.max(parseInt(params.limit || '50', 10) || 50, 1), 200);
  const eventMap = new Map();
  const storylineMap = new Map();
  entities.forEach(name => {
    queryEvents_({ entity: name, limit: limit }).forEach(e => eventMap.set(e.id, e));
    queryStorylines_({ entity: name, limit: limit }).forEach(s => storylineMap.set(s.id, s));
  });
  const events = Array.from(eventMap.values()).sort((a,b)=>String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, limit);
  const storylines = Array.from(storylineMap.values()).sort((a,b)=> (b.importance + b.momentum) - (a.importance + a.momentum)).slice(0, limit);
  return { entities: entities, events: events, storylines: storylines };
}

function getEntity_(params) {
  const name = clean_(params.name || params.entity);
  if (!name) throw new Error('entity requires name');
  return { name: name, context: getContext_({ entities: name, limit: params.limit || 100 }) };
}

function queryEvents_(params) {
  setupEngine_();
  const entity = clean_(params.entity);
  const status = clean_(params.status).toUpperCase();
  const lifecycle = clean_(params.lifecycle).toUpperCase();
  const limit = Math.min(Math.max(parseInt(params.limit || '100', 10) || 100, 1), 500);
  const allowedIds = entity ? linkedRecordIds_(entity, 'EVENT') : null;
  const rows = rowsAsObjects_(engineSpreadsheet_().getSheetByName(CS_SHEETS.EVENTS));
  return rows.map(eventFromRow_).filter(e => {
    if (allowedIds && !allowedIds.has(e.id)) return false;
    if (status && e.status !== status) return false;
    if (lifecycle && e.lifecycle !== lifecycle) return false;
    return true;
  }).sort((a,b)=>String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, limit);
}

function queryStorylines_(params) {
  setupEngine_();
  const entity = clean_(params.entity);
  const status = clean_(params.status).toUpperCase();
  const limit = Math.min(Math.max(parseInt(params.limit || '100', 10) || 100, 1), 500);
  const allowedIds = entity ? linkedRecordIds_(entity, 'STORYLINE') : null;
  const rows = rowsAsObjects_(engineSpreadsheet_().getSheetByName(CS_SHEETS.STORYLINES));
  return rows.map(storylineFromRow_).filter(s => {
    if (allowedIds && !allowedIds.has(s.id)) return false;
    if (status && s.status !== status) return false;
    return true;
  }).sort((a,b)=>String(b.lastUpdatedAt).localeCompare(String(a.lastUpdatedAt))).slice(0, limit);
}

function appendEvent_(e) {
  engineSpreadsheet_().getSheetByName(CS_SHEETS.EVENTS).appendRow(eventToRow_(e));
}

function appendStoryline_(s) {
  engineSpreadsheet_().getSheetByName(CS_SHEETS.STORYLINES).appendRow(storylineToRow_(s));
}

function appendLinksForEvent_(e) {
  appendLinks_('EVENT', e.id, e.entities, e.occurredAt, e.status, e.lifecycle);
}

function appendLinksForStoryline_(s) {
  appendLinks_('STORYLINE', s.id, s.entities, s.lastUpdatedAt, s.status, s.status);
}

function appendLinks_(recordType, recordId, entities, occurredAt, status, lifecycle) {
  const sheet = engineSpreadsheet_().getSheetByName(CS_SHEETS.LINKS);
  const rows = entities.map(entity => [entityKey_(entity), entity.type, entity.name, entity.id || '', recordType, recordId, occurredAt || '', status || '', lifecycle || '']);
  if (rows.length) sheet.getRange(sheet.getLastRow()+1,1,rows.length,LINK_HEADERS.length).setValues(rows);
}

function rebuildLinksForRecord_(recordType, recordId, entities, occurredAt, status, lifecycle) {
  const sheet = engineSpreadsheet_().getSheetByName(CS_SHEETS.LINKS);
  const data = sheet.getDataRange().getValues();
  const kept = data.filter((row, i) => i === 0 || !(clean_(row[4]) === recordType && clean_(row[5]) === recordId));
  sheet.clearContents();
  sheet.getRange(1,1,kept.length,LINK_HEADERS.length).setValues(kept);
  appendLinks_(recordType, recordId, entities, occurredAt, status, lifecycle);
}

function linkedRecordIds_(entityName, recordType) {
  const key = normalizeKey_(entityName);
  const rows = rowsAsObjects_(engineSpreadsheet_().getSheetByName(CS_SHEETS.LINKS));
  return new Set(rows.filter(r => clean_(r['Record Type']) === recordType && (normalizeKey_(r['Entity Name']) === key || normalizeKey_(r['Entity ID']) === key)).map(r => clean_(r['Record ID'])));
}

function attachEventToStorylines_(event) {
  if (!event.storylineIds.length) return;
  event.storylineIds.forEach(id => {
    try {
      const current = queryStorylines_({}).find(s => s.id === id);
      if (!current) return;
      const ids = Array.from(new Set((current.eventIds || []).concat(event.id)));
      updateStoryline_({ storylineId: id, eventIds: ids, momentum: Math.min(100, (current.momentum || 0) + 3) });
    } catch (err) {}
  });
}

function eventToRow_(e) {
  return [e.id,e.occurredAt,e.createdAt,e.type,e.title,e.summary,e.details,e.status,e.confidence,e.lifecycle,e.source,e.createdBy,JSON.stringify(e.entities||[]),JSON.stringify(e.storylineIds||[]),e.supersedesEventId||'',JSON.stringify(e.metadata||{})];
}
function eventFromRow_(r) {
  return { id: clean_(r['Event ID']), occurredAt: clean_(r['Occurred At']), createdAt: clean_(r['Created At']), type: clean_(r['Type']), title: clean_(r['Title']), summary: clean_(r['Summary']), details: clean_(r['Details']), status: clean_(r['Status']), confidence: Number(r['Confidence']||0), lifecycle: clean_(r['Lifecycle']), source: clean_(r['Source']), createdBy: clean_(r['Created By']), entities: parseJson_(r['Entities JSON'], []), storylineIds: parseJson_(r['Storyline IDs JSON'], []), supersedesEventId: clean_(r['Supersedes Event ID']), metadata: parseJson_(r['Metadata JSON'], {}) };
}
function storylineToRow_(s) {
  return [s.id,s.title,s.summary,s.type,s.status,s.importance,s.momentum,s.startedAt,s.lastUpdatedAt,JSON.stringify(s.entities||[]),JSON.stringify(s.eventIds||[]),JSON.stringify(s.tags||[]),s.resolution||'',JSON.stringify(s.metadata||{})];
}
function storylineFromRow_(r) {
  return { id: clean_(r['Storyline ID']), title: clean_(r['Title']), summary: clean_(r['Summary']), type: clean_(r['Type']), status: clean_(r['Status']), importance: Number(r['Importance']||0), momentum: Number(r['Momentum']||0), startedAt: clean_(r['Started At']), lastUpdatedAt: clean_(r['Last Updated At']), entities: parseJson_(r['Entities JSON'], []), eventIds: parseJson_(r['Event IDs JSON'], []), tags: parseJson_(r['Tags JSON'], []), resolution: clean_(r['Resolution']), metadata: parseJson_(r['Metadata JSON'], {}) };
}

function normalizeEntities_(items) {
  if (!Array.isArray(items)) items = splitCsv_(String(items || ''));
  const out = [];
  const seen = new Set();
  items.forEach(item => {
    let entity;
    if (typeof item === 'string') entity = { type: 'TEAM', name: clean_(item), id: '' };
    else entity = { type: clean_(item.type || 'TEAM').toUpperCase(), name: clean_(item.name || item.id), id: clean_(item.id), role: clean_(item.role) };
    if (!entity.name) return;
    if (!['TEAM','PLAYER','MANAGER','COMPETITION','MATCH','STORYLINE'].includes(entity.type)) entity.type = 'TEAM';
    const key = entityKey_(entity);
    if (seen.has(key)) return;
    seen.add(key); out.push(entity);
  });
  return out;
}

function inferEventType_(text, status) {
  const t = text.toLowerCase();
  if (status === 'RUMOUR') return 'RUMOUR';
  if (status === 'OPINION') return 'OPINION';
  if (/sack|dismiss|fired|left the club/.test(t)) return 'SACKING';
  if (/appoint|hired|new manager|head coach/.test(t)) return 'APPOINTMENT';
  if (/interview|press conference/.test(t)) return 'INTERVIEW';
  if (/said|quote|responded|replied/.test(t)) return 'QUOTE';
  if (/injur|out for|knock/.test(t)) return 'INJURY';
  if (/performed|performance|brilliant|poor|excellent|terrible|man of the match/.test(t)) return 'PERFORMANCE';
  return 'OTHER';
}

function normalizeConfidence_(status, raw, lifecycle) {
  if (status === 'CONFIRMED') return 100;
  if (status === 'RUMOUR' && lifecycle === 'CLOSED_FALSE') return 0;
  let n = Number(raw);
  if (!Number.isFinite(n)) n = status === 'RUMOUR' ? 50 : 10;
  if (status === 'RUMOUR') return Math.max(25, Math.min(75, Math.round(n)));
  return Math.max(0, Math.min(25, Math.round(n)));
}

function engineSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = clean_(props.getProperty('CALCIUM_ENGINE_SPREADSHEET_ID'));
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Set Script Property CALCIUM_ENGINE_SPREADSHEET_ID to the dedicated engine spreadsheet ID.');
  return active;
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1,1,1,headers.length).setValues([headers]);
  const current = sheet.getRange(1,1,1,headers.length).getValues()[0];
  if (current.join('|') !== headers.join('|')) sheet.getRange(1,1,1,headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function rowsAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(clean_);
  return values.slice(1).filter(row => row.some(v => clean_(v) !== '')).map(row => {
    const o = {}; headers.forEach((h,i)=>o[h]=row[i]); return o;
  });
}

function parseBody_(e) {
  const raw = e && e.postData && e.postData.contents;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (err) { throw new Error('POST body must be valid JSON'); }
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function parseJson_(v, fallback) { try { return v ? JSON.parse(String(v)) : fallback; } catch (e) { return fallback; } }
function clean_(v) { return v === undefined || v === null ? '' : String(v).trim(); }
function enum_(v, allowed, field) { if (!allowed.includes(v)) throw new Error(field + ' must be one of: ' + allowed.join(', ')); return v; }
function splitCsv_(v) { return clean_(v).split(',').map(clean_).filter(Boolean); }
function arrayStrings_(v) { if (!v) return []; return (Array.isArray(v) ? v : splitCsv_(v)).map(clean_).filter(Boolean); }
function object_(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function normalizeDate_(v) { if (!v) return ''; const d = new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString(); }
function clampInt_(v, fallback) { let n = Number(v); if (!Number.isFinite(n)) n = fallback; return Math.max(0, Math.min(100, Math.round(n))); }
function id_(prefix) { return prefix + '_' + Utilities.getUuid().replace(/-/g,'').slice(0,20); }
function normalizeKey_(v) { return clean_(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function entityKey_(e) { return e.type + ':' + normalizeKey_(e.id || e.name); }
function makeTitle_(text) { return text.length <= 110 ? text : text.slice(0,107) + '...'; }
