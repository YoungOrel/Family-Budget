/** === Визначення папки БД для поточного користувача === */
function ensureUserDbFolder() {
  let { dbFolderId } = getUserSettings();
  if (dbFolderId) {
    try { DriveApp.getFolderById(dbFolderId); return dbFolderId; } catch(e) { /* падаємо вниз і створюємо */ }
  }
  // створюємо дефолтну папку в My Drive користувача
  const folder = DriveApp.createFolder('HomeBudget_DB');
  setUserDbFolderId(folder.getId());
  return folder.getId();
}

function _dbFolder() {
  const id = ensureUserDbFolder();
  return DriveApp.getFolderById(id);
}

/** === JSON I/O у папці користувача === */
function readJson(name) {
  const folder = _dbFolder();
  const it = folder.getFilesByName(name);
  if (!it.hasNext()) return null;
  const file = it.next();
  return JSON.parse(file.getBlob().getDataAsString('UTF-8'));
}

/** Повертає ISO-дату останнього оновлення файлу у папці користувача, або '' */
function fileUpdatedAt(name){
  const folder = _dbFolder();
  const it = folder.getFilesByName(name);
  if (!it.hasNext()) return '';
  try {
    const f = it.next();
    const dt = f.getLastUpdated();
    return dt ? Utilities.formatDate(dt, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss'Z'") : '';
  } catch(e){ return ''; }
}

function writeJson(name, obj) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = _dbFolder();
    const it = folder.getFilesByName(name);
    while (it.hasNext()) it.next().setTrashed(true);
    folder.createFile(name, JSON.stringify(obj, null, 2), MimeType.PLAIN_TEXT);
    return { ok: true, name };
  } finally {
    lock.releaseLock();
  }
}

/** === Імена файлів по роках === */
function txFile(year){ return `transactions_${year}.json`; }
function budgetsFile(year){ return `budgets_${year}.json`; }
function balancesFile(year){ return `balances_${year}.json`; } // резерв
