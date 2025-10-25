function getBootstrap() {
  const u = getUserSettings();
  return {
    settings: { activeYear: u.activeYear, cacheDashboard: u.cacheDashboard },
    funds: [], accounts: []
  };
}

/** Планові місяці з budgets_YYYY.json (у папці користувача) */
function listPlannedMonths({year}) {
  const y = Number(year || getUserSettings().activeYear);
  const b = readJson(budgetsFile(y));
  if (!b) return [];
  if (Array.isArray(b.months)) return b.months.map(x => x && (x.monthKey || x)).filter(Boolean);
  return Object.keys(b).filter(k => /^\d{4}-\d{2}$/.test(k)).sort();
}

/** Повертає список місяців року, де є АБО план (budgets), АБО транзакції (tx). */
function listActiveMonths({ year }){
  const y = Number(year || getUserSettings().activeYear);
  const out = new Set();

  // 1) З бюджетів
  const budgets = readJson(budgetsFile(y));
  if (budgets){
    if (Array.isArray(budgets.months)) {
      budgets.months.forEach(x => { if (x && x.monthKey) out.add(x.monthKey); });
    } else {
      // формат-словник
      Object.keys(budgets).forEach(k => { if (/^\d{4}-\d{2}$/.test(k)) out.add(k); });
    }
  }

  // 2) З транзакцій
  const tx = readJson(txFile(y));
  if (tx && Array.isArray(tx.items)){
    tx.items.forEach(t => {
      if (t && t.date){
        const d = new Date(t.date);
        const mk = toMonthKey_(new Date(d.getFullYear(), d.getMonth(), 1));
        out.add(mk);
      }
    });
  }

  // Впорядкувати зростанням
  return Array.from(out).sort();
}
