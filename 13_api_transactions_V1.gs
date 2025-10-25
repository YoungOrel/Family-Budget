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
  const pageItems = items.slice(start, start + size);

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
  var candidates = _collectTxYears_ ? _collectTxYears_() : [new Date().getFullYear(), new Date().getFullYear()-1, new Date().getFullYear()+1];
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
  var funds=_loadUniqueFundsListFromModel_ ? _loadUniqueFundsListFromModel_() : [];

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

  var main = list[mainIdx] || {};
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
    list.splice(mainIdx+1+i, 0, {
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
      parentId: String(main.itemId||main.id||'')
    });
  }

  writeJson('tx_' + year + '.json', list);
  if (typeof cacheInvalidate === 'function') { try { cacheInvalidate('tx:Y'+year); } catch(e){} }
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
  writeJson('tx_' + year + '.json', list);
  if (typeof cacheInvalidate === 'function') { try { cacheInvalidate('tx:Y'+year); } catch(e){} }
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
  writeJson('tx_' + year + '.json', list);
  if (typeof cacheInvalidate === 'function') { try { cacheInvalidate('tx:Y'+year); } catch(e){} }
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
