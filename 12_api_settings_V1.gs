/** === Script-level props (для власника скрипту як дефолт) === */
const PROP = {
  DB_FOLDER_ID: 'DB_FOLDER_ID',
  ACTIVE_YEAR: 'ACTIVE_YEAR',
  CACHE_DASHBOARD: 'CACHE_DASHBOARD'
};

const MONO_SETTINGS_PROP = {
  TOKEN: 'MONO_TOKEN',
  ENABLED: 'MONO_ENABLED',
  MCC_MAP: 'MONO_MCC_MAP',
  CACHE_TTL_HOURS: 'CACHE_TTL_HOURS'
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

function getMonobankSettings() {
  const store = PropertiesService.getScriptProperties();
  const token = String(store.getProperty(MONO_SETTINGS_PROP.TOKEN) || '').trim();
  const enabled = String(store.getProperty(MONO_SETTINGS_PROP.ENABLED) || 'true').toLowerCase() !== 'false';
  const ttlRaw = Number(store.getProperty(MONO_SETTINGS_PROP.CACHE_TTL_HOURS) || '6');
  const cacheTtlHours = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 6;
  let accountsUpdatedAt = '';
  let jarsUpdatedAt = '';
  try {
    const accCache = readJson('monobank_accounts.json');
    accountsUpdatedAt = accCache && accCache.updatedAt ? accCache.updatedAt : '';
  } catch (err) {}
  try {
    const jarCache = readJson('monobank_jars.json');
    jarsUpdatedAt = jarCache && jarCache.updatedAt ? jarCache.updatedAt : '';
  } catch (err) {}
  return {
    enabled: enabled,
    hasToken: !!token,
    tokenMasked: token ? token.replace(/.(?=.{4})/g, '•') : '',
    cacheTtlHours: cacheTtlHours,
    accountsCachedAt: accountsUpdatedAt,
    jarsCachedAt: jarsUpdatedAt
  };
}

function updateMonobankSettings(payload) {
  payload = payload || {};
  const store = PropertiesService.getScriptProperties();
  if (Object.prototype.hasOwnProperty.call(payload, 'token')) {
    const token = String(payload.token || '').trim();
    if (token) {
      store.setProperty(MONO_SETTINGS_PROP.TOKEN, token);
    } else {
      store.deleteProperty(MONO_SETTINGS_PROP.TOKEN);
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    const enabled = !!payload.enabled;
    store.setProperty(MONO_SETTINGS_PROP.ENABLED, enabled ? 'true' : 'false');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'cacheTtlHours')) {
    const ttl = Number(payload.cacheTtlHours);
    if (Number.isFinite(ttl) && ttl > 0) {
      store.setProperty(MONO_SETTINGS_PROP.CACHE_TTL_HOURS, String(ttl));
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'mccMap')) {
    let raw = payload.mccMap;
    if (typeof raw === 'object') {
      try { raw = JSON.stringify(raw); } catch (err) { raw = '{}'; }
    }
    store.setProperty(MONO_SETTINGS_PROP.MCC_MAP, String(raw || '{}'));
  }
  return getMonobankSettings();
}