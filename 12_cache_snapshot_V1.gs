/** 12_cache_snapshot.gs
 * Персистентні снапшоти дашборду:
 * - writeDashboardSnapshot_(year, monthKey, model)
 * - readDashboardSnapshot_(year, monthKey)
 * - rebuildSnapshotForMonth({year, month})  // перерахувати і записати
 * - getDashboardSnapshot({year, month})     // читати снапшот або створити, якщо нема
 * - touchDirtyMonth(year, monthKey)         // позначити місяць «брудним»
 * - rebuildDirty({year})                    // перебудувати всі «брудні» місяці
 *
 * Снапшот-файли: dashboard_<year>_<monthKey>.json  (наприклад, dashboard_2025_2025-09.json)
 */

function snapshotFileName_(year, monthKey){
  return `dashboard_${year}_${monthKey}.json`;
}

function writeDashboardSnapshot_(year, monthKey, model){
  const name = snapshotFileName_(year, monthKey);
  writeJson(name, model);
  // прибираємо dirty-мітку, якщо була
  clearDirtyMonth_(year, monthKey);
}

function readDashboardSnapshot_(year, monthKey){
  const name = snapshotFileName_(year, monthKey);
  return readJson(name); // може повернути null/undefined якщо файлу нема
}

/** Публічне: перерахувати і записати снапшот вибраного місяця */
function rebuildSnapshotForMonth({year, month}){
  const y = Number(year || getUserSettings().activeYear);
  const monthKey = month || toMonthKey_(new Date());
  const activeMonths = listActiveMonths({ year: y });

  const model = _computeDashboardInternal({ year: y, monthKey, plannedMonths: activeMonths });
  model._snapshot = { rebuiltAt: new Date().toISOString() };
  writeDashboardSnapshot_(y, monthKey, model);

  // перебудуємо і попередній, якщо існує в активних
  const prevKey = (function () {
    const { y: y0, m } = parseMonthKey_(monthKey);
    return toMonthKey_(new Date(y0, m - 2, 1));
  })();
  if (activeMonths.includes(prevKey)) {
    const prevModel = _computeDashboardInternal({ year: y, monthKey: prevKey, plannedMonths: activeMonths });
    prevModel._snapshot = { rebuiltAt: new Date().toISOString() };
    writeDashboardSnapshot_(y, prevKey, prevModel);
  }
  return model;
}


/** Публічне: прочитати снапшот; якщо нема — обчислити і створити */
function getDashboardSnapshot({year, month}){
  const y = Number(year || getUserSettings().activeYear);
  const activeMonths = listActiveMonths({ year: y });
  const monthKey = month || (activeMonths[activeMonths.length - 1] || toMonthKey_(new Date()));

  if (isDirtyMonth_(y, monthKey)) {
    return rebuildSnapshotForMonth({ year: y, month: monthKey });
  }

  const snap = readDashboardSnapshot_(y, monthKey);
  if (snap) { snap._cached = true; return snap; }

  const model = _computeDashboardInternal({ year: y, monthKey, plannedMonths: activeMonths });
  model._snapshot = { initialBuildAt: new Date().toISOString() };
  writeDashboardSnapshot_(y, monthKey, model);
  model._cached = false;
  return model;
}


/* ===== Dirty-механіка через User Properties ===== */
function dirtyKey_(year){ return `DIRTY_MONTHS_${year}`; }

function isDirtyMonth_(year, monthKey){
  const prop = PropertiesService.getUserProperties().getProperty(dirtyKey_(year));
  if (!prop) return false;
  try {
    const arr = JSON.parse(prop);
    return Array.isArray(arr) && arr.includes(monthKey);
  } catch(_) { return false; }
}

function touchDirtyMonth(year, monthKey){
  const y = Number(year || getUserSettings().activeYear);
  const key = dirtyKey_(y);
  const store = PropertiesService.getUserProperties();
  let arr = [];
  const prev = store.getProperty(key);
  if (prev) { try { arr = JSON.parse(prev) || []; } catch(_) { arr = []; } }
  if (!arr.includes(monthKey)) arr.push(monthKey);
  store.setProperty(key, JSON.stringify(arr));
}

/** позначає dirty і сусідній місяць (для MoM) */
function touchDirtyForMonthAndPrev({year, month}){
  const y = Number(year || getUserSettings().activeYear);
  const monthKey = month || toMonthKey_(new Date());
  touchDirtyMonth(y, monthKey);
  const { y: yy, m } = parseMonthKey_(monthKey);
  const prevKey = toMonthKey_(new Date(yy, m - 2, 1));
  touchDirtyMonth(y, prevKey);
}

function clearDirtyMonth_(year, monthKey){
  const key = dirtyKey_(year);
  const store = PropertiesService.getUserProperties();
  const prev = store.getProperty(key);
  if (!prev) return;
  try {
    let arr = JSON.parse(prev) || [];
    arr = arr.filter(x => x !== monthKey);
    store.setProperty(key, JSON.stringify(arr));
  } catch(_) {}
}

/** Перебудувати всі позначені «брудні» місяці року */
function rebuildDirty({year}){
  const y = Number(year || getUserSettings().activeYear);
  const key = dirtyKey_(y);
  const store = PropertiesService.getUserProperties();
  const prop = store.getProperty(key);
  if (!prop) return { rebuilt: [] };
  let arr = [];
  try { arr = JSON.parse(prop) || []; } catch(_) { arr = []; }
  const out = [];
  arr.forEach(mk => {
    out.push(rebuildSnapshotForMonth({ year: y, month: mk }).monthKey);
  });
  store.deleteProperty(key);
  return { rebuilt: out };
}

/** Одноразово зібрати снапшоти для всіх запланованих місяців активного року */
function buildSnapshotsNow(){
  const y = Number(getUserSettings().activeYear);
  const months = listActiveMonths({ year: y });
  months.forEach(mk => { rebuildSnapshotForMonth({ year: y, month: mk }); });
  return { year: y, built: months };
}

/** Зібрати снапшоти для конкретного року (наприклад, 2025) */
function buildAllSnapshotsForYear(year){
  const y = Number(year || getUserSettings().activeYear);
  const months = listActiveMonths({ year: y });
  months.forEach(mk => { rebuildSnapshotForMonth({ year: y, month: mk }); });
  return { year: y, built: months };
}