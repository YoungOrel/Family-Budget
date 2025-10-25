/** === Script-level props (для власника скрипту як дефолт) === */
const PROP = {
  DB_FOLDER_ID: 'DB_FOLDER_ID',
  ACTIVE_YEAR: 'ACTIVE_YEAR',
  CACHE_DASHBOARD: 'CACHE_DASHBOARD'
};

function getScriptSettings() {
  const p = PropertiesService.getScriptProperties().getProperties();
  return {
    dbFolderIdDefault: p[PROP.DB_FOLDER_ID] || '',
    activeYearDefault: Number(p[PROP.ACTIVE_YEAR] || new Date().getFullYear()),
    cacheDashboardDefault: String(p[PROP.CACHE_DASHBOARD] || 'TRUE').toUpperCase() === 'TRUE'
  };
}

/** === User-level props (для КОЖНОГО користувача окремо) === */
const UPROP = {
  DB_FOLDER_ID: 'DB_FOLDER_ID_USER'
};

function getUserSettings() {
  const up = PropertiesService.getUserProperties().getProperties();
  const sp = getScriptSettings();
  return {
    dbFolderId: up[UPROP.DB_FOLDER_ID] || sp.dbFolderIdDefault || '',
    activeYear: sp.activeYearDefault,
    cacheDashboard: sp.cacheDashboardDefault
  };
}

function setUserDbFolderId(folderId) {
  PropertiesService.getUserProperties().setProperty(UPROP.DB_FOLDER_ID, folderId);
  return { ok: true, folderId };
}

function apiInitDb(year) {
  return initDbYear(year);
}