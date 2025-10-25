/**
 * Створює базові файли даних на рік, якщо їх ще немає.
 * Виконувати один раз на старті нового року.
 */
function initDbYear(year) {
  const y = Number(year || new Date().getFullYear());
  const folder = _dbFolder();

  const budgetsName = budgetsFile(y);
  const txName = txFile(y);

  // ---- budgets_<year>.json ----
  const budgetsTemplate = {
    months: [
      {
        monthKey: Utilities.formatDate(new Date(y, 0, 1), Session.getScriptTimeZone(), 'yyyy-MM'),
        incomes: { plannedBase: 0, additional: [] },
        allocationPlan: [
          { fund: 'Продукти', plannedAmount: 0 },
          { fund: 'Пальне', plannedAmount: 0 },
          { fund: 'Комуналка', plannedAmount: 0 },
          { fund: 'Подарунки', plannedAmount: 0 }
        ],
        allocations: []
      }
    ]
  };

  // ---- transactions_<year>.json ----
  const transactionsTemplate = {
    items: [
      // приклад порожнього запису
      // { date: '2025-01-01', fund: 'Продукти', amount: -500, details: 'АТБ' }
    ]
  };

  writeJson(budgetsName, budgetsTemplate);
  writeJson(txName, transactionsTemplate);

  return {
    ok: true,
    files: [budgetsName, txName],
    folder: folder.getName()
  };
}

/**
 * Демо-дані для поточного користувача (викликається з веб-апки).
 * ВАЖЛИВО: працює коректно лише якщо deploy: "Execute as: User accessing the web app".
 */
function apiSeedDemoForMe() {
  const year = 2025;

  const demoBudgets = {
    months: [
      {
        monthKey: '2025-08',
        incomes: { plannedBase: 42000, additional: [ { name: 'Фріланс', amount: 3000 } ] },
        allocationPlan: [
          { fund:'Продукти',  plannedAmount:12000 },
          { fund:'Пальне',    plannedAmount:6000  },
          { fund:'Комуналка', plannedAmount:8000  },
          { fund:'Подарунки', plannedAmount:4000  },
          { fund:'Одяг',      plannedAmount:3000  }
        ],
        allocations: [
          { fund:'Продукти',  planned:12000, confirmed:true,  confirmedAmount:11000 },
          { fund:'Пальне',    planned:6000,  confirmed:true,  confirmedAmount:6000  },
          { fund:'Комуналка', planned:8000,  confirmed:true,  confirmedAmount:7000  },
          { fund:'Подарунки', planned:4000,  confirmed:false, confirmedAmount:''    },
          { fund:'Одяг',      planned:3000,  confirmed:true,  confirmedAmount:2000  }
        ]
      },
      {
        monthKey: '2025-09',
        incomes: { plannedBase: 45000, additional: [ { name: 'Бонус', amount: 2000 } ] },
        allocationPlan: [
          { fund:'Продукти',  plannedAmount:13000 },
          { fund:'Пальне',    plannedAmount:6500  },
          { fund:'Комуналка', plannedAmount:7500  },
          { fund:'Подарунки', plannedAmount:5000  },
          { fund:'Одяг',      plannedAmount:3500  }
        ],
        allocations: [
          { fund:'Продукти',  planned:13000, confirmed:true,  confirmedAmount:10000 },
          { fund:'Пальне',    planned:6500,  confirmed:true,  confirmedAmount:5000  },
          { fund:'Комуналка', planned:7500,  confirmed:true,  confirmedAmount:6000  },
          { fund:'Подарунки', planned:5000,  confirmed:true,  confirmedAmount:3500  },
          { fund:'Одяг',      planned:3500,  confirmed:false, confirmedAmount:''    }
        ]
      }
    ]
  };

  const demoTx = {
    items: [
      { date:'2025-08-02', fund:'Продукти',   amount:-820,  details:'АТБ' },
      { date:'2025-08-05', fund:'Пальне',     amount:-1500, details:'ОККО' },
      { date:'2025-08-07', fund:'Комуналка',  amount:-980,  details:'Електроенергія' },
      { date:'2025-08-12', fund:'Продукти',   amount:-650,  details:'Сільпо' },
      { date:'2025-08-15', fund:'Одяг',       amount:-1200, details:'H&M' },
      { date:'2025-08-19', fund:'Подарунки',  amount:-900,  details:'Іграшки' },
      { date:'2025-08-22', fund:'Комуналка',  amount:-750,  details:'Вода' },
      { date:'2025-08-28', fund:'Пальне',     amount:-1200, details:'WOG' },

      { date:'2025-09-03', fund:'Продукти',   amount:-930,  details:'АТБ' },
      { date:'2025-09-05', fund:'Пальне',     amount:-1600, details:'ОККО' },
      { date:'2025-09-09', fund:'Комуналка',  amount:-1020, details:'Електроенергія' },
      { date:'2025-09-12', fund:'Продукти',   amount:-720,  details:'Сільпо' },
      { date:'2025-09-17', fund:'Подарунки',  amount:-700,  details:'LEGO' },
      { date:'2025-09-19', fund:'Одяг',       amount:-650,  details:'H&M' },
      { date:'2025-09-23', fund:'Комуналка',  amount:-840,  details:'Вода' },
      { date:'2025-09-27', fund:'Пальне',     amount:-1350, details:'WOG' }
    ]
  };

  // важливо: writeJson пише в папку ПОТОЧНОГО користувача (_dbFolder())
  writeJson(budgetsFile(year), demoBudgets);
  writeJson(txFile(year),      demoTx);

  return { ok:true };
}
