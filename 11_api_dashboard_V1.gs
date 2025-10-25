/** API дашборду поверх персистентних снапшотів */

function getDashboard({ year, month, force }){
  if (force) {
    return rebuildSnapshotForMonth({ year, month });
  }
  return getDashboardSnapshot({ year, month });
}

function rebuildDashboard({ year, month }){
  return rebuildSnapshotForMonth({ year, month });
}

/* ===== ВНУТРІШНІ РОЗРАХУНКИ (колишній getDashboard) ===== */
function _computeDashboardInternal({ year, monthKey, plannedMonths }) {
  const y = Number(year);

  const budgets = readJson(budgetsFile(y)); // плани
  const tx = readJson(txFile(y));           // транзакції

  if (!budgets || (!budgets.months && Object.keys(budgets || {}).length === 0)) {
    return _mockDashboard_(monthKey, plannedMonths && plannedMonths.length ? plannedMonths : [monthKey]);
  }

  // нормалізуємо бюджет по місяцях у словник monthKey -> monthData
  const monthDict = {};
  if (Array.isArray(budgets.months)) {
    budgets.months.forEach(x => { if (x && x.monthKey) monthDict[x.monthKey] = x; });
  } else {
    Object.assign(monthDict, budgets);
  }
  const monthData = monthDict[monthKey] || {};

  // KPI суми
  const plannedBase = Number(monthData?.incomes?.plannedBase || 0);
  const plannedAdd  = (monthData?.incomes?.additional || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const plannedIncomesTotal = plannedBase + plannedAdd;

  const planList  = (monthData?.allocationPlan || []); // [{fund, plannedAmount}]
  const planTotal = planList.reduce((s, r) => s + Number(r.plannedAmount || 0), 0);

  const allocList = (monthData?.allocations || []);   // [{fund, planned, confirmed, confirmedAmount}]
  const confirmedRows = allocList.filter(a => a.confirmed);
  const allocatedByFund = {};
  confirmedRows.forEach(a => {
    const v = (a.confirmedAmount != null && a.confirmedAmount !== '')
      ? Number(a.confirmedAmount)
      : Number(a.planned || 0);
    const f = a.fund || '—';
    allocatedByFund[f] = (allocatedByFund[f] || 0) + v;
  });
  const allocatedTotal = Object.values(allocatedByFund).reduce((s, v) => s + v, 0);

  // Витрати за поточний місяць
  const { start, end } = monthRange_(monthKey);
  const txItems = (tx?.items || []).filter(t => {
    const d = new Date(t.date);
    return d >= start && d < end;
  });
  const txReportable = txItems.filter(t => {
    if (typeof txIsReportable === 'function') return txIsReportable(t);
    return !(t && (t.isInternal || t.internalType === 'duplicate' || t.duplicateOf));
  });
  const spentByFund = {};
  const recent = [];
  txItems.forEach(t => {
    if (t.amount < 0) {
      const f = t.fund || '—';
      if (txReportable.includes(t)) {
        spentByFund[f] = (spentByFund[f] || 0) + Math.abs(Number(t.amount));
      }
    }
    recent.push({ date: t.date, fund: t.fund, amount: t.amount, details: t.details });
  });
  const spentTotal = Object.values(spentByFund).reduce((s, v) => s + v, 0);
  recent.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Рядки фондів
  const fundsSet = new Set([
    ...planList.map(x => x.fund),
    ...Object.keys(allocatedByFund),
    ...Object.keys(spentByFund)
  ]);
  const items = [];
  for (const f of fundsSet) {
    const p = planList.find(x => x.fund === f)?.plannedAmount || 0;
    const a = allocatedByFund[f] || 0;
    const s = spentByFund[f] || 0;
    items.push({
      fund: f,
      plan: p,
      allocated: a,
      spent: s,
      gap: a - s,
      planPct:        planTotal      ? p / planTotal      : 0,
      allocatedPct:   allocatedTotal ? a / allocatedTotal : 0,
      score: (a > 0 ? s / a : (s > 0 ? Number.POSITIVE_INFINITY : 0))
    });
  }
  items.sort((a, b) => b.score - a.score || a.gap - b.gap);

  // ===== МоМ-дельти (до такого ж дня попереднього місяця) =====
  const prevKey = (function () {
    const { y: y0, m } = parseMonthKey_(monthKey);
    const prev = new Date(y0, m - 2, 1);
    return toMonthKey_(prev);
  })();

  // Чи існує попередній місяць серед активних (план або транзакції)
  const prevExists = Array.isArray(plannedMonths) && plannedMonths.includes(prevKey);

  let mom = {
    incomes: null,       // Δ план надходжень (сума)
    planDist: null,      // Δ план розподілу (сума)
    allocated: null,     // Δ факт розподілу (сума)
    spent: null,         // Δ витрати (сума до cut)
    ratios: {            // Δ часток
      planPctDelta: null,
      allocatedPctDelta: null
    }
  };

  // 1) Витрати попереднього місяця — навіть якщо немає плану
  (function computePrevSpent(){
    if (!prevExists) { mom.spent = null; return; }
    const [py, pm] = prevKey.split('-').map(Number);
    if (!py || !pm) { mom.spent = null; return; }
    const prevStart = new Date(py, pm - 1, 1);
    const today = new Date();
    const prevCut = new Date(
      prevStart.getFullYear(),
      prevStart.getMonth(),
      Math.min(
        today.getDate(),
        new Date(prevStart.getFullYear(), prevStart.getMonth() + 1, 0).getDate()
      )
    );
    const prevTx = readJson(txFile(prevStart.getFullYear()));
    const prevTxItems = (prevTx?.items || []).filter(t => {
      const d = new Date(t.date);
      return d >= prevStart && d <= prevCut;
    }).filter(t => {
      if (typeof txIsReportable === 'function') return txIsReportable(t);
      return !(t && (t.isInternal || t.internalType === 'duplicate' || t.duplicateOf));
    });
    const prevSpent = prevTxItems.reduce((s, t) => s + (t.amount < 0 ? Math.abs(Number(t.amount)) : 0), 0);
    mom.spent = spentTotal - prevSpent;
  })();

  // 2) Інші метрики — тільки якщо є план попереднього місяця
  if (prevExists && monthDict[prevKey]) {
    const prevData = monthDict[prevKey];

    // План надходжень попереднього місяця
    const prevInBase = Number(prevData?.incomes?.plannedBase || 0);
    const prevInAdd  = (prevData?.incomes?.additional || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const prevPlannedIncomesTotal = prevInBase + prevInAdd;
    mom.incomes = plannedIncomesTotal - prevPlannedIncomesTotal;

    // План розподілу попереднього місяця
    const prevPlanTotal = (prevData?.allocationPlan || []).reduce((s, r) => s + Number(r.plannedAmount || 0), 0);
    mom.planDist = planTotal - prevPlanTotal;

    // Факт розподілу попереднього місяця
    const prevAllocRows = (prevData?.allocations || []).filter(a => a.confirmed);
    const prevAllocTotal = prevAllocRows.reduce((s, a) => s + ((a.confirmedAmount != null && a.confirmedAmount !== '') ? Number(a.confirmedAmount) : Number(a.planned || 0)), 0);
    mom.allocated = allocatedTotal - prevAllocTotal;

    // Δ відсотків:
    const prevPlanPctOfIncome  = prevPlannedIncomesTotal ? (prevPlanTotal  / prevPlannedIncomesTotal) : null;
    const prevAllocPctOfPlan   = prevPlanTotal           ? (prevAllocTotal / prevPlanTotal)           : null;
    const currPlanPctOfIncome  = plannedIncomesTotal     ? (planTotal      / plannedIncomesTotal)     : null;
    const currAllocPctOfPlan   = planTotal               ? (allocatedTotal / planTotal)               : null;

    mom.ratios = {
      planPctDelta:      (currPlanPctOfIncome != null && prevPlanPctOfIncome != null) ? (currPlanPctOfIncome - prevPlanPctOfIncome) : null,
      allocatedPctDelta: (currAllocPctOfPlan  != null && prevAllocPctOfPlan  != null) ? (currAllocPctOfPlan  - prevAllocPctOfPlan)  : null
    };
  }


  const ratios = {
    planPctOfIncome:      plannedIncomesTotal ? (planTotal      / plannedIncomesTotal) : null,
    allocatedPctOfPlan:   planTotal           ? (allocatedTotal / planTotal)           : null  // <— ОНОВЛЕНО
  };


  const kpis = {
    plannedIncomesTotal,
    plannedTotal: planTotal,
    allocatedTotal,
    spentTotal,
    ratios,
    mom,
    momAvailable: prevExists,
    sparks: { planned:[8,9,7,10,11,12], allocated:[7,8,6,9,10,9], spent:[6,7,5,9,10,8] }
  };

  const recent10 = recent.slice(0, 10);
  const monthsOut = plannedMonths && plannedMonths.length ? plannedMonths : [monthKey];
  return { monthKey, kpis, items, recent: recent10, months: monthsOut };
}

/** Мок, якщо немає файлів */
function _mockDashboard_(monthKey, months) {
  const items = [
    { fund:'Пальне',    plan:6000,  allocated:5000,  spent:5200 },
    { fund:'Продукти',  plan:12000, allocated:10000, spent:9800 },
    { fund:'Комуналка', plan:8000,  allocated:6000,  spent:7000 },
    { fund:'Одяг',      plan:4000,  allocated:3000,  spent:1500 },
    { fund:'Подарунки', plan:5000,  allocated:3500,  spent:4200 },
  ].map(x=> ({...x, gap:x.allocated - x.spent, score:(x.spent/Math.max(x.allocated,1e-9)), planPct:0, allocatedPct:0}));
  items.sort((a,b)=> b.score - a.score || a.gap - b.gap);

  const kpis = {
    plannedIncomesTotal: 0,
    plannedTotal:   items.reduce((s,x)=>s+x.plan,0),
    allocatedTotal: items.reduce((s,x)=>s+x.allocated,0),
    spentTotal:     items.reduce((s,x)=>s+x.spent,0),
    ratios: { planPctOfIncome:null, allocatedPctOfIncome:null },
    mom: { incomes:null, planDist:null, allocated:null, spent:null, ratios:{ planPctDelta:null, allocatedPctDelta:null } },
    sparks: { planned:[8,9,7,10,11,12], allocated:[7,8,6,9,10,9], spent:[6,7,5,9,10,8] }
  };
  const recent = [
    {date:'2025-09-18', fund:'Продукти', amount:-480, details:'АТБ'},
    {date:'2025-09-17', fund:'Пальне', amount:-1500, details:'OKKO'},
    {date:'2025-09-16', fund:'Комуналка', amount:-900, details:'Електроенергія'},
    {date:'2025-09-16', fund:'Подарунки', amount:-700, details:'LEGO'},
    {date:'2025-09-15', fund:'Одяг', amount:-650, details:'H&M'}
  ];
  return { monthKey, kpis, items, recent, months };
}