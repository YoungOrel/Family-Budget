/** 13_api_transactions.gs
 * Легкий перегляд транзакцій із фільтрами періоду та пагінацією
 * Виклик: getTransactionsView({ year, from, to, page, size })
 * - from/to: 'YYYY-MM-DD' (обидва включно; можна передати тільки from або тільки to)
 * - page: 1..N (за замовч. 1)
 * - size: кількість на сторінку (за замовч. 50)
 */

/* ===== Константи для перегляду транзакцій ===== */
var TX_VIEW_DEFAULT_SIZE = 50;
var TX_VIEW_MAX_SIZE = 500;

var LINK_KEY_TIME_WINDOW_MINUTES = 5;

function _txEnsureMetaFields_(raw){
  const obj = raw ? Object.assign({}, raw) : {};
  obj.itemId = String(obj.itemId || obj.id || Utilities.getUuid());
  obj.bankId = obj.bankId != null ? String(obj.bankId).trim() : '';
  obj.source = obj.source ? String(obj.source) : (obj.bankId ? 'mono' : 'manual');
  obj.date = obj.date ? String(obj.date) : new Date().toISOString();
  obj.account = obj.account != null ? String(obj.account).trim() : '';
  obj.fund = obj.fund != null ? String(obj.fund).trim() : '';
  obj.category = obj.category != null ? String(obj.category).trim() : '';
  const amountNum = Number(obj.amount);
  obj.amount = Number.isFinite(amountNum) ? amountNum : 0;
  obj.details = obj.details != null ? String(obj.details) : '';
  obj.comment = obj.comment != null ? String(obj.comment) : '';
  obj.mcc = obj.mcc != null ? String(obj.mcc) : '';
  obj.tags = Array.isArray(obj.tags) ? obj.tags.filter(Boolean).map(String) : [];
  obj.isInternal = obj.isInternal === true;
  obj.internalType = obj.internalType ? String(obj.internalType) : null;
  obj.isTransfer = obj.isTransfer === true;
  obj.linkedAccount = obj.linkedAccount != null ? String(obj.linkedAccount).trim() : '';
  obj.linkKey = obj.linkKey ? String(obj.linkKey) : '';
  obj.duplicateOf = obj.duplicateOf ? String(obj.duplicateOf) : null;
  obj.lockedByUser = obj.lockedByUser === true;
  return obj;
}

function _txNormalizeDetails_(value){
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\-_/]+/g, ' ')
    .replace(/[^0-9a-zа-яіїєґёöäüß ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _txComputeLinkKey(tx){
  const obj = _txEnsureMetaFields_(tx);
  const amountAbs = Math.abs(Number(obj.amount) || 0);
  if (amountAbs < 0.0001) return '';
  const dt = new Date(obj.date || new Date());
  if (isNaN(dt.getTime())) return '';
  const minuteStamp = Math.floor(dt.getTime() / 60000);
  const normalizedDetails = _txNormalizeDetails_(obj.details || obj.comment);
  const fromAccount = String(obj.account || '').toLowerCase();
  const toAccount = String(obj.linkedAccount || '').toLowerCase();
  const payload = [fromAccount, toAccount, amountAbs.toFixed(2), minuteStamp, normalizedDetails].join('#');
  try {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, payload);
    return digest.map(function(b){
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
  } catch (err) {
    return Utilities.getUuid();
  }
}

function _txPriorityScore_(tx){
  const obj = _txEnsureMetaFields_(tx);
  let base = 1;
  if (obj.source === 'mono') base = 3;
  else if (obj.source === 'manual') base = 2;
  if (obj.lockedByUser) base += 0.3;
  return base;
}

function _txAmountsMirror_(a, b){
  const ax = Number(a.amount) || 0;
  const bx = Number(b.amount) || 0;
  if (!ax || !bx) return false;
  const diff = Math.abs(Math.abs(ax) - Math.abs(bx));
  if (diff > 0.01) return false;
  return (ax > 0 && bx < 0) || (ax < 0 && bx > 0);
}

function _txDatesClose_(a, b){
  const da = new Date(a.date || new Date());
  const db = new Date(b.date || new Date());
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return false;
  const diff = Math.abs(da.getTime() - db.getTime());
  return diff <= LINK_KEY_TIME_WINDOW_MINUTES * 60 * 1000;
}

function _txInvalidateYearCache_(year, dateStr){
  const y = Number(year);
  if (!y) return;
  if (typeof cacheInvalidate === 'function') {
    try { cacheInvalidate('tx:Y' + y); } catch (err) {}
  }
  if (typeof touchDirtyForMonthAndPrev === 'function' && dateStr){
    try {
      const dt = new Date(dateStr);
      if (!isNaN(dt.getTime())) {
        const mk = Utilities.formatDate(new Date(dt.getFullYear(), dt.getMonth(), 1), Session.getScriptTimeZone(), 'yyyy-MM');
        touchDirtyForMonthAndPrev({ year: y, month: mk });
      }
    } catch (err) {}
  }
}

function _txMergeRecords_(existing, incoming){
  const base = _txEnsureMetaFields_(existing);
  const inc = _txEnsureMetaFields_(incoming);
  const preserveComment = base.lockedByUser && base.comment;
  const preserveTags = base.lockedByUser && Array.isArray(base.tags) && base.tags.length;
  const fields = ['date','account','fund','category','amount','details','mcc','isInternal','internalType','isTransfer','linkedAccount','source'];
  fields.forEach(function(field){
    if (inc[field] != null && inc[field] !== '') {
      if (field === 'comment' && preserveComment) return;
      base[field] = inc[field];
    }
  });
  if (!preserveComment && inc.comment) base.comment = inc.comment;
  base.tags = Array.from(new Set([...(Array.isArray(base.tags)?base.tags:[]), ...(Array.isArray(inc.tags)?inc.tags:[])]));
  base.bankId = inc.bankId || base.bankId;
  base.linkKey = base.linkKey || inc.linkKey || _txComputeLinkKey(base);
  base.duplicateOf = inc.duplicateOf || base.duplicateOf || null;
  return base;
}

function _txInsertRecord_(list, record){
  const arr = Array.isArray(list) ? list : [];
  let entry = _txEnsureMetaFields_(record);
  entry.linkKey = entry.linkKey || _txComputeLinkKey(entry);
  const matches = [];
  for (let i = 0; i < arr.length; i++){
    const existing = _txEnsureMetaFields_(arr[i]);
    const sameBank = entry.bankId && existing.bankId && entry.bankId === existing.bankId;
    const sameLink = !sameBank && entry.linkKey && existing.linkKey && entry.linkKey === existing.linkKey;
    const closeLink = !sameBank && !sameLink && entry.linkKey && existing.linkKey && _txDatesClose_(entry, existing) && Math.abs(Math.abs(existing.amount) - Math.abs(entry.amount)) <= 0.05 && _txNormalizeDetails_(existing.details||existing.comment) === _txNormalizeDetails_(entry.details||entry.comment);
    if (sameBank || sameLink || closeLink){ matches.push({ idx: i, item: existing, matchType: sameBank ? 'bank' : 'link' }); }
  }

  const sameBankMatch = matches.find(function(m){ return m.matchType === 'bank'; });
  if (sameBankMatch){
    const merged = _txMergeRecords_(sameBankMatch.item, entry);
    merged.linkKey = merged.linkKey || _txComputeLinkKey(merged);
    arr[sameBankMatch.idx] = merged;
    return { list: arr, record: merged, added: false };
  }

  if (matches.length){
    let treatedAsDuplicate = false;
    for (let j = 0; j < matches.length; j++){
      const candidate = matches[j].item;
      candidate.linkKey = candidate.linkKey || _txComputeLinkKey(candidate);
      if (_txAmountsMirror_(candidate, entry)){
        candidate.isTransfer = true;
        candidate.isInternal = true;
        candidate.internalType = 'transfer';
        candidate.linkedAccount = candidate.linkedAccount || entry.account || '';
        arr[matches[j].idx] = candidate;
        entry.isTransfer = true;
        entry.isInternal = true;
        entry.internalType = 'transfer';
        entry.linkedAccount = entry.linkedAccount || candidate.account || '';
      } else {
        treatedAsDuplicate = true;
      }
    }

    if (treatedAsDuplicate){
      const group = matches.map(function(m){ return m.item; }).concat([entry]);
      let primary = group[0];
      for (let k = 1; k < group.length; k++){
        const candidate = group[k];
        if (_txPriorityScore_(candidate) > _txPriorityScore_(primary)){
          primary = candidate;
        }
      }
      group.forEach(function(candidate){
        if (candidate.itemId === primary.itemId){
          candidate.duplicateOf = null;
          if (candidate.internalType === 'duplicate') candidate.internalType = null;
        } else {
          candidate.duplicateOf = primary.itemId;
          candidate.internalType = 'duplicate';
        }
      });
      for (let m = 0; m < matches.length; m++){
        const updated = group.find(function(g){ return g.itemId === matches[m].item.itemId; });
        if (updated){ arr[matches[m].idx] = updated; }
      }
      entry = group.find(function(g){ return g.itemId === entry.itemId; }) || entry;
    }
  }

  arr.push(entry);
  return { list: arr, record: entry, added: true };
}

function _txIsReportable_(tx){
  const obj = _txEnsureMetaFields_(tx);
  if (obj.isInternal) return false;
  if (obj.internalType === 'duplicate') return false;
  if (obj.duplicateOf) return false;
  return true;
}

function _txCollectKnownCategories_(){
  if (Array.isArray(_txCollectKnownCategories_._cache)){
    return _txCollectKnownCategories_._cache.slice();
  }
  const categories = new Set();
  const years = _collectTxYears_();
  years.forEach(function(y){
    const list = _readTxListForYear_(y);
    list.forEach(function(it){ if (it && it.category) categories.add(String(it.category).trim()); });
  });
  const arr = Array.from(categories).filter(Boolean).sort();
  _txCollectKnownCategories_._cache = arr.slice();
  return arr;
}

function _txCollectKnownAccounts_(){
  if (Array.isArray(_txCollectKnownAccounts_._cache)){
    return _txCollectKnownAccounts_._cache.slice();
  }
  const accounts = new Set();
  const years = _collectTxYears_();
  years.forEach(function(y){
    const list = _readTxListForYear_(y);
    list.forEach(function(it){ if (it && it.account) accounts.add(String(it.account).trim()); });
  });
  try {
    const cached = readJson('monobank_accounts.json');
    if (cached && Array.isArray(cached.items)){
      cached.items.forEach(function(acc){ if (acc && acc.name) accounts.add(String(acc.name).trim()); });
    }
  } catch (err) {}
  const arr = Array.from(accounts).filter(Boolean).sort();
  _txCollectKnownAccounts_._cache = arr.slice();
  return arr;
}

function _txInvalidateDictionaries_(){
  try { delete _loadUniqueFundsListFromModel_._cache; } catch (err) {}
  try { delete _txCollectKnownCategories_._cache; } catch (err) {}
  try { delete _txCollectKnownAccounts_._cache; } catch (err) {}
  try { delete _collectTxYears_._cache; } catch (err) {}
}

// === SPLIT (рознесення) ======================================================
var SPLIT_MCC_CODE = (PropertiesService.getScriptProperties().getProperty('SPLIT_MCC_CODE') || '9997').trim();
function getTransactionsView(params){
  const u = getUserSettings();
  const y = Number((params && params.year) || u.activeYear);
  const fromStr = params && params.from;
  const toStr   = params && params.to;
  const page    = Math.max(1, Number(params && params.page || 1));
  const size    = Math.min(TX_VIEW_MAX_SIZE, Math.max(10, Number(params && params.size || TX_VIEW_DEFAULT_SIZE)));
  const fundFilter = String((params && params.fund) || '').trim();

  let items = _normalizeTxList_(readJson('tx_' + y + '.json'));
  if (!items.length) {
    items = _normalizeTxList_(readJson(txFile(y)));
  }

  // Фільтр періоду (включно)
  if (fromStr || toStr){
    const from = fromStr ? new Date(fromStr) : new Date('1970-01-01');
    const to   = toStr   ? new Date(toStr)   : new Date('2999-12-31');
    items = items.filter(t => {
      const d = new Date(t.date);
      return d >= from && d <= to;
    });
  }

  if (fundFilter){
    items = items.filter(t => String(t.fund || '').trim() === fundFilter);
  }

  // Сортування новіші спочатку
  items.sort((a,b)=> new Date(b.date) - new Date(a.date));

  // Пагінація
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const start = (page - 1) * size;
  const pageItems = items.slice(start, start + size).map(function(it){ return _txEnsureMetaFields_(it); });

  return {
    meta: { year: y, from: fromStr || null, to: toStr || null, page, size, total, pages },
    items: pageItems
  };
}

function _normalizeTxList_(value){
  if (!value) return [];
  if (Array.isArray(value)) return value.slice();
  if (Array.isArray(value.items)) return value.items.slice();
  return [];
}

function _readTxListForYear_(year){
  const y = Number(year);
  let list = _normalizeTxList_(readJson('tx_' + y + '.json'));
  if (!list.length) {
    list = _normalizeTxList_(readJson(txFile(y)));
  }
  return list;
}

function _writeTxListForYear_(year, list){
  const y = Number(year);
  const normalized = Array.isArray(list) ? list : [];
  writeJson('tx_' + y + '.json', normalized);
  try {
    const legacy = readJson(txFile(y)) || {};
    const envelope = (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) ? legacy : {};
    envelope.items = normalized;
    writeJson(txFile(y), envelope);
  } catch (err) {
    // Відсутній legacy-файл — пропускаємо
  }
}

function _collectTxYears_(){
  if (Array.isArray(_collectTxYears_._cache)) {
    return _collectTxYears_._cache.slice();
  }

  const yearsSet = new Set();
  try {
    const folderId = typeof ensureUserDbFolder === 'function' ? ensureUserDbFolder() : null;
    if (folderId) {
      const folder = DriveApp.getFolderById(folderId);
      const files = folder.getFiles();
      while (files.hasNext()) {
        const name = files.next().getName();
        const m1 = name && name.match(/^tx_(\d{4})\.json$/);
        if (m1) yearsSet.add(Number(m1[1]));
        const m2 = name && name.match(/^transactions_(\d{4})\.json$/);
        if (m2) yearsSet.add(Number(m2[1]));
      }
    }
  } catch (err) {
    Logger.log('TODO: refine tx years listing via Drive metadata: ' + err);
  }

  const now = new Date();
  const u = typeof getUserSettings === 'function' ? getUserSettings() : null;
  const baseYear = Number(u && u.activeYear) || now.getFullYear();
  [baseYear - 1, baseYear, baseYear + 1].forEach(function(y){ if (y) yearsSet.add(y); });

  const out = Array.from(yearsSet).filter(Boolean).sort(function(a,b){ return a - b; });
  _collectTxYears_._cache = out.slice();
  return out;
}

function _loadUniqueFundsListFromModel_(){
  if (Array.isArray(_loadUniqueFundsListFromModel_._cache)) {
    return _loadUniqueFundsListFromModel_._cache.slice();
  }

  const fundsSet = new Set();
  const years = _collectTxYears_();
  years.forEach(function(y){
    const list = _readTxListForYear_(y);
    list.forEach(function(it){
      if (it && it.fund) {
        fundsSet.add(String(it.fund).trim());
      }
    });
  });

  try {
    const settings = typeof getUserSettings === 'function' ? getUserSettings() : null;
    const y = Number(settings && settings.activeYear) || (new Date()).getFullYear();
    const budgets = readJson(budgetsFile(y));
    const visitMonth = function(month){
      if (!month) return;
      if (Array.isArray(month.allocationPlan)) {
        month.allocationPlan.forEach(function(row){ if (row && row.fund) fundsSet.add(String(row.fund).trim()); });
      }
      if (Array.isArray(month.allocations)) {
        month.allocations.forEach(function(row){ if (row && row.fund) fundsSet.add(String(row.fund).trim()); });
      }
    };
    if (budgets){
      if (Array.isArray(budgets.months)) {
        budgets.months.forEach(visitMonth);
      } else {
        Object.keys(budgets || {}).forEach(function(key){
          const val = budgets[key];
          if (val && typeof val === 'object') {
            visitMonth(val);
          }
        });
      }
    }
  } catch (err) {
    Logger.log('TODO: gather funds dictionary from budgets: ' + err);
  }

  const arr = Array.from(fundsSet).filter(Boolean).sort().map(function(v){
    return { value: v, label: v };
  });
  _loadUniqueFundsListFromModel_._cache = arr.slice();
  return arr;
}

/**
 * UA: Побудова payload групи для рознесення за txId або bankId.
 * EN: Build split payload from tx_YYYY.json (group by bankId).
 * args: { txId?:string, bankId?:string }
 * return: { bankId, mainItem, items:[...], mainAmount, funds:[], year, indexMap:{itemId:{year,idx}} }
 */
function txBuildSplitPayload(args){
  args = args || {};
  var txId = String(args.txId||'').trim();
  var bankId = String(args.bankId||'').trim();

  // Визначити рік і запис
  var now = new Date();
  var candidates = (typeof _collectTxYears_ === 'function')
    ? _collectTxYears_()
    : [now.getFullYear(), now.getFullYear()-1];
  var hit=null, hitYear=null, hitIdx=-1;
  candidates.forEach(function(y){
    if (hit) return;
    var list = readJson('tx_' + y + '.json') || [];
    for (var i=0;i<list.length;i++){
      var it = list[i]||{};
      var itId = String(it.itemId||it.id||'').trim();
      var itBank = String(it.bankId||it.id||'').trim(); // груповий ключ
      if ((txId && itId===txId) || (bankId && itBank===bankId)) { hit=it; hitYear=y; hitIdx=i; break; }
    }
  });
  if (!hit) throw new Error('Транзакцію не знайдено');

  bankId = String(hit.bankId||hit.id||'').trim();
  var listY = readJson('tx_' + hitYear + '.json') || [];

  // Зібрати групу
  var group=[]; 
  for (var j=0;j<listY.length;j++){
    var it2=listY[j]||{};
    if (String(it2.bankId||it2.id||'').trim()===bankId){ group.push({ item: it2, year: hitYear, idx: j }); }
  }
  var main=null; group.forEach(function(g){ if(!g.item.isSplitPart){ main=g; } }); if(!main && group.length) main=group[0];

  var mainAmount=Number(main && (main.item.amount||0))||0;

  // Фонди (адаптуй під твій довідник, якщо є утиліта — використай її)
  var funds = (typeof _loadUniqueFundsListFromModel_ === 'function')
    ? _loadUniqueFundsListFromModel_()
    : [];

  var items=group.map(function(g){
    return {
      itemId: String(g.item.itemId||g.item.id||('it_'+g.idx)),
      isSplitPart: !!g.item.isSplitPart,
      date: g.item.date,
      fund: String(g.item.fund||'').trim(),
      amount: Number(g.item.amount||0)||0,
      details: String(g.item.details||'').trim(),
      mcc: String(g.item.mcc||'').trim(),
      descr: String(g.item.descr||'').trim(),
      bankId: bankId
    };
  });

  var indexMap={}; group.forEach(function(g){
    var key=String(g.item.itemId||g.item.id||('it_'+g.idx));
    indexMap[key]={ year:g.year, idx:g.idx };
  });

  return {
    bankId: bankId,
    mainItem: items.find(function(x){ return !x.isSplitPart; }) || items[0],
    items: items,
    mainAmount: mainAmount,
    funds: funds,
    year: hitYear,
    indexMap: indexMap
  };
}

/**
 * UA: Збереження рознесення у tx_YYYY.json + інвалідація кешу.
 * args: { bankId, mainItem, items:[{itemId?,fund,amount,details}], year, indexMap }
 */
function txSaveSplitAllocation(args){
  args = args || {};
  var bankId = String(args.bankId||'').trim();
  var year = Number(args.year);
  var mainItem = args.mainItem || {};
  var parts = Array.isArray(args.items) ? args.items : [];
  var indexMap = args.indexMap || {};
  if (!bankId || !year) throw new Error('Некоректні параметри рознесення');

  var list = readJson('tx_' + year + '.json') || [];

  // Перерахунок
  var addSum = parts.reduce(function(s,it){ return s + (Number(it.amount)||0); }, 0);
  var mainKey = String(mainItem.itemId||mainItem.id||'');
  var mainIdx = (indexMap[mainKey]||{}).idx;
  if (typeof mainIdx !== 'number') throw new Error('Не знайдено основний елемент');

  var main = _txEnsureMetaFields_(list[mainIdx] || {});
  var newMainAmount = Math.max(0, Number(main.amount||0) - addSum);

  // Оновити основний
  main.fund = String(mainItem.fund||main.fund||'').trim();
  main.details = String(mainItem.details||main.details||'').trim();
  main.amount = newMainAmount;
  main.mcc = SPLIT_MCC_CODE;
  main.isSplitPart = false;
  main.bankId = bankId;

  // Прибрати існуючі частини цієї групи (крім main)
  list = list.filter(function(it, idx){
    var same = String(it.bankId||it.id||'').trim() === bankId;
    var isMain = idx === mainIdx;
    return !(same && !isMain);
  });

  // Додати нові частини
  var stamp = (new Date()).toISOString().slice(0,19).replace('T',' ');
  for (var i=0;i<parts.length;i++){
    var p=parts[i]||{};
    var node = {
      id: String(p.itemId||('sp_'+Date.now()+'_'+i)),
      itemId: String(p.itemId||('sp_'+Date.now()+'_'+i)),
      bankId: bankId,
      date: main.date,
      fund: String(p.fund||'').trim(),
      amount: Number(p.amount)||0,
      details: String(p.details||'').trim(),
      mcc: SPLIT_MCC_CODE,
      descr: 'Рознесено — ' + stamp,
      isSplitPart: true,
      parentId: String(main.itemId||main.id||''),
      source: main.source || 'manual',
      tags: []
    };
    list.splice(mainIdx+1+i, 0, _txEnsureMetaFields_(node));
  }

  writeJson('tx_' + year + '.json', list);
  _txInvalidateYearCache_(year, main.date);
  return { ok:true };
}

/**
 * UA: Оновити коментар транзакції у tx_YYYY.json + інвалідація кешу.
 * EN: Update transaction comment.
 * args: { itemId:string, year:number, comment:string }
 */
function updateTransactionComment(args){
  args = args || {};
  var itemId = String(args.itemId||'').trim();
  var year = Number(args.year);
  var comment = String(args.comment||'').trim();
  if (!itemId || !year) throw new Error('Некоректні параметри');

  var list = readJson('tx_' + year + '.json') || [];
  var idx = list.findIndex(function(it){ return String(it.itemId||it.id||'') === itemId; });
  if (idx < 0) throw new Error('Транзакцію не знайдено');

  list[idx].comment = comment;
  list[idx].lockedByUser = true;
  writeJson('tx_' + year + '.json', list);
  _txInvalidateYearCache_(year, list[idx].date);
  return { ok:true };
}

/**
 * UA: Оновити категорію транзакції (валідація проти довідника, якщо є).
 * EN: Update transaction category.
 * args: { itemId:string, year:number, category:string }
 */
function updateTransactionCategory(args){
  args = args || {};
  var itemId = String(args.itemId||'').trim();
  var year = Number(args.year);
  var category = String(args.category||'').trim();
  if (!itemId || !year) throw new Error('Некоректні параметри');

  // TODO: якщо у проекті є довідник категорій — перевір тут валідність category

  var list = readJson('tx_' + year + '.json') || [];
  var idx = list.findIndex(function(it){ return String(it.itemId||it.id||'') === itemId; });
  if (idx < 0) throw new Error('Транзакцію не знайдено');

  list[idx].category = category;
  list[idx].lockedByUser = true;
  writeJson('tx_' + year + '.json', list);
  _txInvalidateYearCache_(year, list[idx].date);
  return { ok:true };
}

function exportTransactionsCsv(payload){
  var items = (payload && payload.items) || [];
  var esc = function(v){ if(v==null) return ''; var s=String(v).replace(/"/g,'""'); return /[",\n]/.test(s)?('"'+s+'"'):s; };
  var head = ['date','fund','category','amount','details','comment'];
  var rows = [head.join(',')];
  items.forEach(function(it){
    rows.push([esc(it.date), esc(it.fund), esc(it.category), esc(it.amount), esc(it.details), esc(it.comment)].join(','));
  });
  return rows.join('\n');
}

/** =========================
 *   MANUAL TRANSACTION API
 *  ========================= */

function createManualTransaction(payload){
  payload = payload || {};
  const dateStr = String(payload.date || '').trim();
  if (!dateStr) throw new Error('Дата є обов\'язковою');
  const account = String(payload.account || '').trim();
  if (!account) throw new Error('Вкажіть рахунок');
  const fund = String(payload.fund || '').trim();
  if (!fund) throw new Error('Вкажіть фонд');
  const category = String(payload.category || '').trim();
  if (!category) throw new Error('Вкажіть категорію');
  const amountValue = Number(payload.amount);
  if (!Number.isFinite(amountValue) || Math.abs(amountValue) < 0.0001){
    throw new Error('Сума має бути ненульовою');
  }
  const tagsInput = Array.isArray(payload.tags)
    ? payload.tags
    : String(payload.tags || '')
        .split(',')
        .map(function(x){ return x.trim(); })
        .filter(Boolean);

  const isTransfer = payload.isTransfer === true || String(payload.isTransfer).toLowerCase() === 'true';
  const linkedAccount = String(payload.linkedAccount || '').trim();
  if (isTransfer && !linkedAccount){
    throw new Error('Для переказу необхідно вказати пов’язаний рахунок');
  }

  const knownFunds = (_loadUniqueFundsListFromModel_() || []).map(function(it){ return it && (it.value || it.label || it); }).filter(Boolean);
  if (knownFunds.length && knownFunds.indexOf(fund) === -1){
    throw new Error('Фонд не знайдено у довіднику');
  }
  const knownAccounts = _txCollectKnownAccounts_();
  if (knownAccounts.length && knownAccounts.indexOf(account) === -1){
    throw new Error('Рахунок не знайдено у довіднику');
  }
  const knownCategories = _txCollectKnownCategories_();
  if (knownCategories.length && knownCategories.indexOf(category) === -1){
    throw new Error('Категорія не знайдена у довіднику');
  }

  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())){
    throw new Error('Некоректна дата');
  }
  const year = dt.getFullYear();
  const itemId = Utilities.getUuid();

  const record = _txEnsureMetaFields_({
    itemId: itemId,
    bankId: String(payload.bankId || '').trim() || itemId,
    source: 'manual',
    date: dt.toISOString(),
    account: account,
    fund: fund,
    category: category,
    amount: amountValue,
    details: String(payload.details || '').trim(),
    comment: String(payload.comment || '').trim(),
    tags: tagsInput,
    mcc: String(payload.mcc || '').trim(),
    isTransfer: isTransfer,
    linkedAccount: linkedAccount,
    isInternal: isTransfer,
    internalType: isTransfer ? 'transfer' : (payload.internalType || null),
    lockedByUser: true
  });
  record.linkKey = _txComputeLinkKey(record);

  const list = _readTxListForYear_(year);
  const res = _txInsertRecord_(list, record);
  _writeTxListForYear_(year, res.list);
  _txInvalidateYearCache_(year, record.date);
  _txInvalidateDictionaries_();

  return {
    ok: true,
    year: year,
    item: res.record,
    added: res.added
  };
}

/** =========================
 *   MONOBANK INTEGRATION
 *  ========================= */

var MONO_PROP_TOKEN = 'MONO_TOKEN';
var MONO_PROP_ENABLED = 'MONO_ENABLED';
var MONO_PROP_MCC_MAP = 'MONO_MCC_MAP';
var MONO_PROP_CACHE_TTL = 'CACHE_TTL_HOURS';

function _monoGetToken_(){
  const store = PropertiesService.getScriptProperties();
  return String(store.getProperty(MONO_PROP_TOKEN) || '').trim();
}

function _monoGetCacheTtlHours_(){
  const store = PropertiesService.getScriptProperties();
  const val = Number(store.getProperty(MONO_PROP_CACHE_TTL) || '6');
  return Number.isFinite(val) && val > 0 ? val : 6;
}

function _monoRequest_(path){
  const token = _monoGetToken_();
  if (!token){
    throw new Error('Monobank API токен не налаштовано. Додайте його в налаштуваннях.');
  }
  const url = 'https://api.monobank.ua' + path;
  const options = {
    method: 'get',
    headers: { 'X-Token': token },
    muteHttpExceptions: true
  };
  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  if (code >= 200 && code < 300){
    const text = res.getContentText();
    return text ? JSON.parse(text) : null;
  }
  if (code === 429){
    throw new Error('Monobank API: забагато запитів. Спробуйте пізніше.');
  }
  let message = '';
  try { message = res.getContentText(); } catch (err) {}
  throw new Error('Monobank API (' + code + '): ' + (message || 'невідома помилка'));
}

function _monoNormalizeAccount_(acc){
  if (!acc) return null;
  const masked = Array.isArray(acc.maskedPan) ? acc.maskedPan.filter(Boolean).join(' ') : '';
  const alias = acc.alias || acc.title || '';
  const baseParts = [];
  if (alias) baseParts.push(alias);
  if (!alias && acc.type) baseParts.push(String(acc.type).toUpperCase());
  if (masked) baseParts.push(masked);
  if (!baseParts.length && acc.iban) baseParts.push(acc.iban);
  if (!baseParts.length && acc.id) baseParts.push(acc.id);
  const name = baseParts.join(' · ');
  return {
    id: acc.id,
    name: name,
    currencyCode: acc.currencyCode,
    type: acc.type || '',
    maskedPan: masked,
    iban: acc.iban || ''
  };
}

function _monoNormalizeJar_(jar){
  if (!jar) return null;
  return {
    id: jar.id,
    title: jar.title || jar.description || jar.id,
    currencyCode: jar.currencyCode,
    goal: jar.goal || null
  };
}

function _monoWriteCache_(name, payload){
  const enriched = Object.assign({}, payload || {}, { updatedAt: new Date().toISOString() });
  writeJson(name, enriched);
  return enriched;
}

function _monoReadCache_(name){
  try {
    return readJson(name);
  } catch (err) {
    return null;
  }
}

function _monoEnsureClientInfo_(force){
  const ttlHours = _monoGetCacheTtlHours_();
  const ttlMs = ttlHours * 60 * 60 * 1000;
  const now = new Date();
  const cachedAccounts = _monoReadCache_('monobank_accounts.json');
  const cachedJars = _monoReadCache_('monobank_jars.json');
  if (!force && cachedAccounts && cachedAccounts.updatedAt){
    const updated = new Date(cachedAccounts.updatedAt);
    if (!isNaN(updated.getTime()) && (now.getTime() - updated.getTime()) <= ttlMs){
      return {
        accounts: cachedAccounts.items || [],
        jars: (cachedJars && cachedJars.items) || [],
        cached: true
      };
    }
  }

  const info = _monoRequest_('/personal/client-info');
  const accounts = Array.isArray(info && info.accounts)
    ? info.accounts.map(_monoNormalizeAccount_).filter(Boolean)
    : [];
  const jars = Array.isArray(info && info.jars)
    ? info.jars.map(_monoNormalizeJar_).filter(Boolean)
    : [];
  _monoWriteCache_('monobank_accounts.json', { items: accounts });
  _monoWriteCache_('monobank_jars.json', { items: jars });
  return { accounts: accounts, jars: jars, cached: false };
}

function listMonoAccounts(){
  const info = _monoEnsureClientInfo_(true);
  return {
    ok: true,
    accounts: info.accounts,
    jars: info.jars,
    refreshed: !info.cached
  };
}

function listMonoJars(){
  const info = _monoEnsureClientInfo_(false);
  return {
    ok: true,
    jars: info.jars,
    accounts: info.accounts,
    cached: info.cached
  };
}

function _monoCategoryFromMcc_(mcc){
  if (!mcc) return '';
  const props = PropertiesService.getScriptProperties();
  const mapJson = props.getProperty(MONO_PROP_MCC_MAP) || '{}';
  let dict = {};
  try { dict = JSON.parse(mapJson); } catch (err) { dict = {}; }
  const key = String(mcc);
  return dict[key] || '';
}

function _monoDetectJar_(tx, jars){
  if (!Array.isArray(jars) || !jars.length) return null;
  const text = (_txNormalizeDetails_(tx.description) + ' ' + _txNormalizeDetails_(tx.comment)).trim();
  if (!text) return null;
  for (let i = 0; i < jars.length; i++){
    const title = _txNormalizeDetails_(jars[i].title);
    if (title && text.indexOf(title) !== -1){
      return jars[i];
    }
  }
  return null;
}

function _monoBuildRecord_(entry, account, jars){
  const ts = Number(entry.time || entry.timestamp || 0) * 1000;
  const dateIso = isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString();
  const amount = Number(entry.amount || 0) / 100;
  const description = String(entry.description || '').trim();
  const comment = String(entry.comment || '').trim();
  const mcc = entry.mcc != null ? String(entry.mcc) : '';
  const jar = _monoDetectJar_(entry, jars);
  const record = _txEnsureMetaFields_({
    itemId: Utilities.getUuid(),
    bankId: String(entry.id || '').trim() || Utilities.getUuid(),
    source: 'mono',
    date: dateIso,
    account: account && account.name ? account.name : (account && account.id) || 'Monobank',
    fund: '',
    category: _monoCategoryFromMcc_(mcc),
    amount: amount,
    details: description,
    comment: comment,
    mcc: mcc,
    tags: ['mono'],
    isTransfer: false,
    isInternal: false,
    internalType: null,
    linkedAccount: '',
    lockedByUser: false
  });
  if (jar){
    record.isInternal = true;
    record.isTransfer = true;
    record.internalType = amount < 0 ? 'jarTopUp' : 'jarWithdraw';
    record.linkedAccount = jar.title;
    record.tags.push('jar');
  } else {
    const details = (description + ' ' + comment).toLowerCase();
    const transferKeywords = ['власн', 'own card', 'між своїми', 'between own'];
    const isTransfer = transferKeywords.some(function(key){ return details.indexOf(key) !== -1; });
    if (isTransfer){
      record.isTransfer = true;
      record.isInternal = true;
      record.internalType = 'transfer';
    }
  }
  record.linkKey = _txComputeLinkKey(record);
  return record;
}

function importMonobankStatement(params){
  params = params || {};
  const now = new Date();
  const from = params.from ? new Date(params.from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = params.to ? new Date(params.to) : now;
  if (isNaN(from.getTime()) || isNaN(to.getTime())){
    throw new Error('Невалідний період для імпорту');
  }
  const fromTs = Math.floor(from.getTime() / 1000);
  const toTs = Math.floor((to.getTime() + 60 * 60 * 24 * 1000) / 1000);

  const info = _monoEnsureClientInfo_(false);
  const accounts = info.accounts || [];
  if (!accounts.length){
    throw new Error('Не знайдено рахунків Monobank. Оновіть довідники у налаштуваннях.');
  }
  const jars = info.jars || [];

  const perYear = {};
  const datesPerYear = {};
  const summary = {
    imported: 0,
    updated: 0,
    duplicates: 0,
    accounts: accounts.map(function(acc){ return { id: acc.id, name: acc.name }; }),
    from: from.toISOString(),
    to: to.toISOString()
  };

  accounts.forEach(function(acc, idx){
    const path = '/personal/statement/' + acc.id + '/' + fromTs + '/' + toTs;
    const statement = _monoRequest_(path) || [];
    if (idx < accounts.length - 1){
      Utilities.sleep(350);
    }
    if (!Array.isArray(statement) || !statement.length) return;
    statement.forEach(function(entry){
      const record = _monoBuildRecord_(entry, acc, jars);
      const dt = new Date(record.date);
      const year = dt.getFullYear();
      if (!perYear[year]){
        perYear[year] = _readTxListForYear_(year);
      }
      const result = _txInsertRecord_(perYear[year], record);
      perYear[year] = result.list;
      if (result.added) summary.imported += 1;
      else summary.updated += 1;
      if (result.record && (result.record.duplicateOf || result.record.internalType === 'duplicate')){
        summary.duplicates += 1;
      }
      datesPerYear[year] = record.date;
    });
  });

  const years = Object.keys(perYear);
  years.forEach(function(year){
    _writeTxListForYear_(Number(year), perYear[year]);
    _txInvalidateYearCache_(Number(year), datesPerYear[year]);
  });
  if (years.length){
    _txInvalidateDictionaries_();
  }

  return Object.assign({ ok: true, years: years.map(Number) }, summary);
}

/** =========================
 *   DEDUP RESOLUTION
 *  ========================= */

function resolveDuplicate(args){
  args = args || {};
  const itemId = String(args.itemId || '').trim();
  const action = String(args.action || '').trim();
  if (!itemId){
    throw new Error('Не передано itemId для операції');
  }
  if (['merge','keepBoth','markInternal'].indexOf(action) === -1){
    throw new Error('Невідома дія для дубля');
  }
  const years = _collectTxYears_();
  let hitYear = null;
  let list = null;
  let idx = -1;
  for (let i = 0; i < years.length; i++){
    const y = years[i];
    const arr = _readTxListForYear_(y);
    const found = arr.findIndex(function(it){ return String(it.itemId || it.id || '') === itemId; });
    if (found !== -1){
      hitYear = y;
      list = arr;
      idx = found;
      break;
    }
  }
  if (hitYear == null){
    throw new Error('Транзакцію не знайдено');
  }

  const item = _txEnsureMetaFields_(list[idx]);
  if (action === 'merge'){
    if (item.duplicateOf){
      list.splice(idx, 1);
    } else {
      const filtered = list.filter(function(it){ return String(it.duplicateOf || '') !== item.itemId; });
      list = filtered;
    }
  } else if (action === 'keepBoth'){
    item.duplicateOf = null;
    if (item.internalType === 'duplicate') item.internalType = null;
    item.isInternal = false;
    list[idx] = item;
  } else if (action === 'markInternal'){
    item.isInternal = true;
    item.internalType = 'duplicate';
    if (!item.duplicateOf) item.duplicateOf = item.itemId;
    list[idx] = item;
  }

  _writeTxListForYear_(hitYear, list);
  _txInvalidateYearCache_(hitYear, item.date);
  return { ok: true, year: hitYear, action: action };
}

/** =========================
 *   PLATFORM DETECTION
 *  ========================= */

function getPlatformInfo(ua){
  const raw = ua && ua.ua ? String(ua.ua) : String(ua || '');
  const value = raw.trim();
  const test = value.toLowerCase();
  let device = 'desktop';
  if (/iphone|ipad|ipod/.test(test)) device = 'ios';
  else if (/android/.test(test)) device = 'android';
  return { device: device, ua: value };
}

function txIsReportable(tx){
  return _txIsReportable_(tx);
}
