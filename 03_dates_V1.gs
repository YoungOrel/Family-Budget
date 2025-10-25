function toMonthKey_(d){ return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM'); }
function parseMonthKey_(mk){ const [y,m] = mk.split('-').map(Number); return {y, m}; }
function monthRange_(mk){
  const {y,m} = parseMonthKey_(mk);
  const start = new Date(y, m-1, 1);
  const end = new Date(y, m, 1); // не включно
  return { start, end };
}
