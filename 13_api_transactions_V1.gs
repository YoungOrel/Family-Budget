/** 13_api_transactions.gs
 * Легкий перегляд транзакцій із фільтрами періоду та пагінацією
 * Виклик: getTransactionsView({ year, from, to, page, size })
 * - from/to: 'YYYY-MM-DD' (обидва включно; можна передати тільки from або тільки to)
 * - page: 1..N (за замовч. 1)
 * - size: кількість на сторінку (за замовч. 50)
 */
function getTransactionsView(params){
  const u = getUserSettings();
  const y = Number((params && params.year) || u.activeYear);
  const fromStr = params && params.from;
  const toStr   = params && params.to;
  const page    = Math.max(1, Number(params && params.page || 1));
  const size    = Math.min(500, Math.max(10, Number(params && params.size || 50)));

  const data = readJson(txFile(y)) || { items: [] };
  let items = Array.isArray(data.items) ? data.items.slice() : [];

  // Фільтр періоду (включно)
  if (fromStr || toStr){
    const from = fromStr ? new Date(fromStr) : new Date('1970-01-01');
    const to   = toStr   ? new Date(toStr)   : new Date('2999-12-31');
    items = items.filter(t => {
      const d = new Date(t.date);
      return d >= from && d <= to;
    });
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