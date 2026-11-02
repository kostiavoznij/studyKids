/**
 * «Уроки» — синхронізація через Google Таблицю.
 *
 * Цей скрипт живе в таблиці і працює як маленький сервер: застосунок надсилає
 * сюди зміни і забирає чужі. Кожен запис зберігається рядком: службові колонки,
 * кілька колонок для зручного перегляду і повний запис у JSON в останній колонці.
 *
 * Як встановити — docs/SYNC_SETUP.md у репозиторії.
 */

const TYPES = ['students', 'groups', 'lessons', 'payments', 'daysOff', 'taxes', 'taxPlans', 'bankMonths'];

/**
 * Newer versions of the app may send record types this script doesn't list.
 * They are stored as they are, on a tab named after the type (no readable
 * columns, only the JSON), so the app doesn't have to wait for a script update.
 * A later script that gives such a type its own tab must move those rows over.
 */
const EXTRA_TYPE = /^[a-z][A-Za-z0-9]{1,39}$/;

const SHEETS = {
  students: { title: 'Учні', view: ['Ім\'я', 'Предмет', 'Клас', 'Ціна', 'Статус', 'Оплата'] },
  groups: { title: 'Групи', view: ['Назва', 'Ціна з учня', 'Учасників'] },
  lessons: { title: 'Уроки', view: ['Дата', 'Час', 'Хв', 'Тип', 'Статус', 'Хто', 'Тема', 'Ціна'] },
  payments: { title: 'Оплати', view: ['Дата', 'Учень', 'Сума', 'Уроків', 'Примітка'] },
  daysOff: { title: 'Дні без уроків', view: ['З', 'По', 'Причина', 'Коментар'] },
  taxes: { title: 'Податки', view: ['Сплачено', 'Що', 'За період', 'Сума', 'Примітка'] },
  taxPlans: { title: 'Як сплачую податки', view: ['Нагадувати з', 'Податок', 'ЄСВ'] },
  bankMonths: { title: 'Звірка з банком', view: ['Місяць', 'За випискою', 'Розбіжність прийнято', 'Пояснення'] },
};

const DAY_OFF_UA = { dayoff: 'вихідний', vacation: 'відпустка', sick: 'лікарняний', holiday: 'свято', break: 'канікули', other: 'інше' };

const MONTHS_UA = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];

/** id | rev | updatedAt | deleted | …view… | data */
const LEAD = ['id', 'rev', 'updatedAt', 'deleted'];

const STATUS_UA = { active: 'займається', trial: 'пробний', paused: 'пауза', archived: 'архів', planned: 'заплановано', done: 'проведено', cancelled: 'скасовано' };

const CONNECT_SHEET = 'Підключення';

/* ---------------- entry points ---------------- */

function doGet() {
  return json({ ok: true, app: 'uroky', message: 'Сервер «Уроків» працює. Дані доступні лише із застосунку з кодом доступу.' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ ok: false, error: 'bad_request' });
  }
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('KEY');
  if (!key || !props.getProperty('SHEET_ID')) return json({ ok: false, error: 'not_set_up' });
  if (req.key !== key) return json({ ok: false, error: 'bad_key' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
    switch (req.action) {
      case 'ping':
        return json({ ok: true, rev: getRev(), counts: counts(ss), types: TYPES, anyType: true });
      case 'pull':
        return json(pull(ss, Number(req.since) || 0));
      case 'push':
        return json(push(ss, req.records || {}));
      case 'hello':
        rememberUrl(ss, String(req.url || ''));
        return json({ ok: true });
      default:
        return json({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json({ ok: false, error: 'server', message: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- sync ---------------- */

function pull(ss, since) {
  const records = {};
  for (const type of allTypes()) {
    const rows = readRows(ss, type);
    records[type] = rows.filter((r) => r.rev > since).map((r) => r.data);
  }
  return { ok: true, rev: getRev(), records, types: TYPES, anyType: true };
}

/**
 * Last write wins per record: an incoming record replaces the stored one only if
 * it was changed later. Every accepted change gets the next revision number, which
 * is what other devices ask for in pull().
 */
function push(ss, incoming) {
  let rev = getRev();
  let accepted = 0;
  const names = studentNames(ss, incoming.students || []);
  const extra = Object.keys(incoming).filter((t) => TYPES.indexOf(t) < 0 && EXTRA_TYPE.test(t));

  for (const type of TYPES.concat(extra)) {
    const list = incoming[type];
    if (!Array.isArray(list) || list.length === 0) continue;
    if (extra.indexOf(type) >= 0) rememberType(type);
    const sheet = ensureSheet(ss, type);
    const rows = readRows(ss, type);
    const index = {};
    rows.forEach((r, i) => (index[r.id] = i));
    let changed = false;

    for (const rec of list) {
      if (!rec || typeof rec.id !== 'string') continue;
      const at = index[rec.id];
      if (at !== undefined && !(Number(rec.updatedAt) > rows[at].updatedAt)) continue;
      rev++;
      const row = { id: rec.id, rev, updatedAt: Number(rec.updatedAt) || 0, data: rec };
      if (at === undefined) {
        index[rec.id] = rows.length;
        rows.push(row);
      } else {
        rows[at] = row;
      }
      accepted++;
      changed = true;
    }
    if (changed) writeRows(sheet, type, rows, names);
  }
  setRev(rev);
  return { ok: true, rev, accepted, types: TYPES, anyType: true };
}

function counts(ss) {
  const out = {};
  for (const type of allTypes()) out[type] = readRows(ss, type).length;
  return out;
}

function allTypes() {
  return TYPES.concat(extraTypes());
}

function extraTypes() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('EXTRA_TYPES') || '[]');
  } catch (err) {
    return [];
  }
}

function rememberType(type) {
  const list = extraTypes();
  if (list.indexOf(type) >= 0) return;
  list.push(type);
  PropertiesService.getScriptProperties().setProperty('EXTRA_TYPES', JSON.stringify(list));
}

function sheetDef(type) {
  return SHEETS[type] || { title: type, view: [] };
}

/* ---------------- sheet helpers ---------------- */

function ensureSheet(ss, type) {
  const def = sheetDef(type);
  let sheet = ss.getSheetByName(def.title);
  if (!sheet) {
    sheet = ss.insertSheet(def.title);
    const header = LEAD.concat(def.view, ['data']);
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // ids and JSON stay plain text, otherwise Sheets may turn them into numbers or dates
    sheet.getRange(1, 1, 1000, 1).setNumberFormat('@');
    sheet.getRange(1, header.length, 1000, 1).setNumberFormat('@');
  }
  return sheet;
}

function readRows(ss, type) {
  const def = sheetDef(type);
  const sheet = ss.getSheetByName(def.title);
  if (!sheet) return [];
  const last = sheet.getLastRow();
  const width = LEAD.length + def.view.length + 1;
  if (last < 2) return [];
  return sheet
    .getRange(2, 1, last - 1, width)
    .getValues()
    .filter((v) => v[0] !== '')
    .map((v) => {
      let data;
      try {
        data = JSON.parse(v[width - 1]);
      } catch (err) {
        data = null;
      }
      return { id: String(v[0]), rev: Number(v[1]) || 0, updatedAt: Number(v[2]) || 0, data };
    })
    .filter((r) => r.data);
}

function writeRows(sheet, type, rows, names) {
  const values = rows.map((r) => {
    const d = r.data;
    return [r.id, r.rev, r.updatedAt, d.deletedAt ? 'так' : ''].concat(view(type, d, names).map(safe), [JSON.stringify(d)]);
  });
  if (values.length) sheet.getRange(2, 1, values.length, values[0].length).setValues(values);
}

/** Human-readable columns, so the table is useful on its own. */
function view(type, d, names) {
  const name = (id) => names[id] || '';
  switch (type) {
    case 'students':
      return [d.name, d.subject, d.grade, d.price, STATUS_UA[d.status] || d.status, d.billing === 'after' ? 'після уроку' : 'наперед'];
    case 'groups':
      return [d.name, d.price, (d.studentIds || []).length];
    case 'lessons': {
      const start = String(d.start || '');
      const parts = d.participants || [];
      return [
        start.slice(0, 10),
        start.slice(11, 16),
        d.duration,
        d.kind === 'trial' ? 'пробний' : d.groupId ? 'груповий' : 'урок',
        STATUS_UA[d.status] || d.status,
        parts.map((p) => name(p.studentId)).join(', '),
        d.topic || '',
        parts.reduce((s, p) => s + (Number(p.price) || 0), 0),
      ];
    }
    case 'payments':
      return [d.date, name(d.studentId), d.amount, d.lessons || '', d.note || ''];
    case 'daysOff':
      return [d.from, d.to, DAY_OFF_UA[d.kind] || d.kind, d.note || ''];
    case 'taxes':
      return [d.date, d.kind === 'esv' ? 'ЄСВ' : 'податок (ЄП + ВЗ)', periodUa(String(d.period || '')), d.amount, d.note || ''];
    case 'taxPlans': {
      const rules = d.rules || {};
      return [periodUa(String(d.start || '')), rulesUa(rules.tax), rulesUa(rules.esv)];
    }
    case 'bankMonths':
      return [periodUa(String(d.month || '')), d.amount, d.acceptedDiff != null ? d.acceptedDiff : '', d.note || ''];
  }
  return [];
}

/** '2026-10' → «жовтень 2026», '2026-Q4' → «IV квартал 2026» */
function periodUa(p) {
  const q = p.match(/^(\d{4})-Q([1-4])$/);
  if (q) return ['I', 'II', 'III', 'IV'][q[2] - 1] + ' квартал ' + q[1];
  const m = p.match(/^(\d{4})-(\d{2})$/);
  return m ? MONTHS_UA[Number(m[2]) - 1] + ' ' + m[1] : p;
}

/** first month of a quarter '2027-01' → «I кв. 2027» */
function quarterUa(month) {
  return ['I', 'II', 'III', 'IV'][Math.floor((Number(month.slice(5, 7)) - 1) / 3)] + ' кв. ' + month.slice(0, 4);
}

function rulesUa(list) {
  return (list || [])
    .map((r) => (r.every === 'quarter' ? 'щокварталу' : 'щомісяця') + (r.from ? ' з ' + quarterUa(r.from) : ''))
    .join(', ');
}

/** Text that starts like a formula would be run by Sheets — keep it literal. */
function safe(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

function studentNames(ss, incoming) {
  const out = {};
  for (const r of readRows(ss, 'students')) out[r.id] = r.data.name;
  for (const s of incoming) if (s && s.id) out[s.id] = s.name;
  return out;
}

function getRev() {
  return Number(PropertiesService.getScriptProperties().getProperty('REV')) || 0;
}

function setRev(rev) {
  PropertiesService.getScriptProperties().setProperty('REV', String(rev));
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- setup ---------------- */

/** Run once from the editor: creates the tabs and the access code. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  if (!props.getProperty('KEY')) props.setProperty('KEY', newKey());
  for (const type of TYPES) ensureSheet(ss, type);
  writeConnectSheet(ss);
  // drop the empty default tab a new spreadsheet starts with
  for (const sh of ss.getSheets()) {
    if (sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  }
  Logger.log('Готово. Код доступу: ' + props.getProperty('KEY'));
}

/** Makes a new access code — all devices then need to reconnect. */
function resetKey() {
  PropertiesService.getScriptProperties().setProperty('KEY', newKey());
  writeConnectSheet(SpreadsheetApp.getActiveSpreadsheet());
  Logger.log('Новий код доступу: ' + PropertiesService.getScriptProperties().getProperty('KEY'));
}

function newKey() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += abc[parseInt(hex.substr(i * 2, 2), 16) % abc.length];
    if (i % 4 === 3 && i < 15) out += '-';
  }
  return out;
}

/** The app reports its address after the first successful connection. */
function rememberUrl(ss, url) {
  if (!/^https:\/\/script\.google\.com\//.test(url)) return;
  PropertiesService.getScriptProperties().setProperty('URL', url);
  writeConnectSheet(ss);
}

function writeConnectSheet(ss) {
  const props = PropertiesService.getScriptProperties();
  let sheet = ss.getSheetByName(CONNECT_SHEET);
  if (!sheet) sheet = ss.insertSheet(CONNECT_SHEET, 0);
  const url = props.getProperty('URL') || '(з’явиться після першого підключення з ноутбука)';
  const key = props.getProperty('KEY');
  const rows = [
    ['Підключення застосунку «Уроки»', ''],
    ['Код доступу', key],
    ['Адреса', url],
    ['Код для іншого пристрою (скопіюйте цілком)', props.getProperty('URL') ? props.getProperty('URL') + ' ' + key : ''],
    ['', ''],
    ['Як підключити', 'Застосунок → Ще → Синхронізація → вставте код → «Підключити». Нікому не пересилайте цей код.'],
  ];
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(1, 1).setFontWeight('bold');
  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 640);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Уроки').addItem('Створити вкладки та код доступу', 'setup').addItem('Змінити код доступу', 'resetKey').addToUi();
}
