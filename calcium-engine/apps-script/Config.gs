const CALCIUM_ENGINE_DB_ID = '15uzus4vyP3-hzjsa2Q4eRYczAlHwWJCdNzs_Z2_ypGc';
const CALCIUM_EXISTING_FACT_API_URL = 'https://script.google.com/macros/s/AKfycbwGK-Qg0o1UwBzU6np-y9_XA9KefEiuqGmEVax7kfT2cees6WD5zwBz4iCGHSYt5CwQ/exec';

/**
 * PUBLIC WRAPPERS
 * Apps Script hides functions ending in "_" from the Run dropdown,
 * so use these two functions from the editor.
 */
function configureCalciumEngine() {
  return configureCalciumEngine_();
}

function testCalciumEngineConfig() {
  return testCalciumEngineConfig_();
}

/**
 * Internal configuration implementation.
 */
function configureCalciumEngine_() {
  PropertiesService.getScriptProperties().setProperties({
    CALCIUM_ENGINE_SPREADSHEET_ID: CALCIUM_ENGINE_DB_ID,
    CALCIUM_FACT_API_URL: CALCIUM_EXISTING_FACT_API_URL
  }, false);

  const setup = setupEngine_();
  clearEntityCatalogCache_();

  return {
    ok: true,
    configured: true,
    engineSpreadsheetId: CALCIUM_ENGINE_DB_ID,
    factsApiUrl: CALCIUM_EXISTING_FACT_API_URL,
    setup: setup
  };
}

/**
 * Internal quick editor test.
 */
function testCalciumEngineConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    engineSpreadsheetId: props.getProperty('CALCIUM_ENGINE_SPREADSHEET_ID'),
    factsApiUrl: props.getProperty('CALCIUM_FACT_API_URL'),
    spreadsheetTitle: engineSpreadsheet_().getName(),
    entityCatalogCounts: (function(){
      const catalog = getEntityCatalog_();
      return { entities: catalog.entities.length, relationships: catalog.relationships.length };
    })()
  };
}
