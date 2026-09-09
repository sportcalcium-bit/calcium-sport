const CS_RESOLVER_CACHE_SECONDS = 300;

/**
 * Resolves free football text into Calcium Sport entities.
 *
 * Primary source: the existing Calcium Sport Facts API.
 * Configure Script Property CALCIUM_FACT_API_URL.
 *
 * The resolver intentionally tolerates different row/header shapes because
 * the website hub has evolved over time. It searches common player/team/
 * manager field names and normalises names before matching.
 */
function resolveEntitiesFromText_(text, entityHints) {
  const raw = clean_(text);
  const hints = normalizeEntities_(entityHints || []);
  const catalog = getEntityCatalog_();
  const found = [];
  const seen = new Set();

  function add(entity) {
    if (!entity || !clean_(entity.name)) return;
    const normalized = {
      type: clean_(entity.type || 'TEAM').toUpperCase(),
      name: clean_(entity.name),
      id: clean_(entity.id),
      role: clean_(entity.role)
    };
    const key = entityKey_(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    found.push(normalized);
  }

  hints.forEach(add);

  const haystack = ' ' + normalizeKey_(raw) + ' ';
  catalog.entities.forEach(entity => {
    const aliases = [entity.name].concat(entity.aliases || []).map(normalizeKey_).filter(Boolean);
    const match = aliases.some(alias => alias.length >= 3 && haystack.includes(' ' + alias + ' '));
    if (match) add(entity);
  });

  // Entity-relationship expansion: if a player/manager is mentioned, attach
  // their current team automatically. This is central to Calcium Sport memory.
  found.slice().forEach(entity => {
    if (!['PLAYER','MANAGER'].includes(entity.type)) return;
    const relation = catalog.relationships.find(r =>
      r.fromType === entity.type &&
      (normalizeKey_(r.fromId) === normalizeKey_(entity.id) || normalizeKey_(r.fromName) === normalizeKey_(entity.name)) &&
      r.toType === 'TEAM'
    );
    if (relation) add({ type: 'TEAM', name: relation.toName, id: relation.toId || '', role: entity.type === 'PLAYER' ? 'PLAYER_TEAM' : 'MANAGER_TEAM' });
  });

  return found;
}

function getEntityCatalog_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('CS_ENTITY_CATALOG_V1');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const catalog = { entities: [], relationships: [], fetchedAt: new Date().toISOString() };
  const byKey = new Map();

  function addEntity(type, name, id, aliases) {
    name = clean_(name);
    if (!name) return null;
    const entity = { type: type, name: name, id: clean_(id), aliases: (aliases || []).map(clean_).filter(Boolean) };
    const key = entityKey_(entity);
    if (!byKey.has(key)) {
      byKey.set(key, entity);
      catalog.entities.push(entity);
    } else {
      const existing = byKey.get(key);
      existing.aliases = Array.from(new Set((existing.aliases || []).concat(entity.aliases || [])));
    }
    return byKey.get(key);
  }

  function addRelationship(fromType, fromName, fromId, toType, toName, toId) {
    if (!clean_(fromName) || !clean_(toName)) return;
    catalog.relationships.push({
      fromType: fromType, fromName: clean_(fromName), fromId: clean_(fromId),
      toType: toType, toName: clean_(toName), toId: clean_(toId)
    });
  }

  const hub = fetchFactAction_('hubData');
  const hubPlayers = arrayFromPayload_(hub, ['players','Players']);
  const hubLogos = arrayFromPayload_(hub, ['logos','Logos','teams','Teams']);

  hubLogos.forEach(row => {
    const team = firstField_(row, ['Teams','Team','team','Name','name','Club','club']);
    const teamId = firstField_(row, ['Team ID','TeamID','teamId','id','ID']);
    addEntity('TEAM', team, teamId, []);
  });

  hubPlayers.forEach(row => {
    const player = firstField_(row, ['Player','Player Name','Name','player','playerName','name']);
    const playerId = firstField_(row, ['Player ID','PlayerID','playerId','id','ID']);
    const team = firstField_(row, ['Team','Club','Current Team','team','club','currentTeam']);
    const teamId = firstField_(row, ['Team ID','TeamID','teamId','clubId']);
    const aliases = [firstField_(row, ['Short Name','Display Name','Known As','shortName','displayName','knownAs'])].filter(Boolean);
    addEntity('PLAYER', player, playerId, aliases);
    if (team) {
      addEntity('TEAM', team, teamId, []);
      addRelationship('PLAYER', player, playerId, 'TEAM', team, teamId);
    }
  });

  // Optional manager endpoints. If an action does not exist, it is simply ignored.
  ['managers','availableManagers','managerData'].forEach(action => {
    const payload = fetchFactAction_(action, true);
    const rows = flattenLikelyRows_(payload);
    rows.forEach(row => {
      const manager = firstField_(row, ['Manager','Manager Name','Name','manager','managerName','name']);
      const managerId = firstField_(row, ['Manager ID','ManagerID','managerId','id','ID']);
      const team = firstField_(row, ['Team','Club','Current Team','team','club','currentTeam']);
      const teamId = firstField_(row, ['Team ID','TeamID','teamId','clubId']);
      if (!manager) return;
      addEntity('MANAGER', manager, managerId, []);
      if (team && !/available|free agent|unattached/i.test(team)) {
        addEntity('TEAM', team, teamId, []);
        addRelationship('MANAGER', manager, managerId, 'TEAM', team, teamId);
      }
    });
  });

  // Competitions from the existing competition listing endpoint.
  const competitionPayload = fetchFactAction_('competitions', true);
  const competitionRows = arrayFromPayload_(competitionPayload, ['competitions','Competitions']);
  competitionRows.forEach(row => {
    const name = firstField_(row, ['Competition Name','Competition','Name','competitionName','competition','name']);
    const id = firstField_(row, ['Sheet ID','Competition ID','competitionId','id','ID']);
    addEntity('COMPETITION', name, id, []);
  });

  // CacheService has a size limit. If the catalog is too large, skip cache rather than fail.
  try {
    const serialized = JSON.stringify(catalog);
    if (serialized.length < 90000) cache.put('CS_ENTITY_CATALOG_V1', serialized, CS_RESOLVER_CACHE_SECONDS);
  } catch (e) {}
  return catalog;
}

function fetchFactAction_(action, silent) {
  const base = clean_(PropertiesService.getScriptProperties().getProperty('CALCIUM_FACT_API_URL'));
  if (!base) {
    if (silent) return {};
    throw new Error('Set Script Property CALCIUM_FACT_API_URL to the existing Calcium Sport website Apps Script API URL.');
  }
  try {
    const url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'action=' + encodeURIComponent(action) + '&v=' + Date.now();
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      if (silent) return {};
      throw new Error('Facts API action ' + action + ' returned HTTP ' + code);
    }
    const payload = JSON.parse(response.getContentText() || '{}');
    if (payload && payload.error) {
      if (silent) return {};
      throw new Error(payload.error);
    }
    return payload || {};
  } catch (err) {
    if (silent) return {};
    throw err;
  }
}

function arrayFromPayload_(payload, keys) {
  if (!payload || typeof payload !== 'object') return [];
  for (let i = 0; i < keys.length; i++) {
    if (Array.isArray(payload[keys[i]])) return payload[keys[i]];
  }
  return [];
}

function flattenLikelyRows_(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object') return [];
  let out = [];
  Object.keys(payload).forEach(key => {
    const value = payload[key];
    if (Array.isArray(value)) out = out.concat(value.filter(x => x && typeof x === 'object'));
  });
  return out;
}

function firstField_(row, keys) {
  if (!row || typeof row !== 'object') return '';
  for (let i = 0; i < keys.length; i++) {
    const value = row[keys[i]];
    if (value !== undefined && value !== null && clean_(value) !== '') return clean_(value);
  }
  return '';
}

function clearEntityCatalogCache_() {
  CacheService.getScriptCache().remove('CS_ENTITY_CATALOG_V1');
  return { ok: true };
}
