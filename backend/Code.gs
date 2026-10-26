/**
 * «Уроки» — синхронізація через Google Таблицю.
 *
 * Цей скрипт живе в таблиці і працює як маленький сервер: застосунок надсилає
 * сюди зміни і забирає чужі. Кожен запис зберігається рядком: службові колонки,
 * кілька колонок для зручного перегляду і повний запис у JSON в останній колонці.
 *
 * Як встановити — docs/SYNC_SETUP.md у репозиторії.
 */

const TYPES = ['students', 'groups', 'lessons', 'payments'];

const SHEETS = {
  students: { title: 'Учні', view: ['Ім\'я', 'Предмет', 'Клас', 'Ціна', 'Статус', 'Оплата'] },
  groups: { title: 'Групи', view: ['Назва', 'Ціна з учня', 'Учасників'] },
  lessons: { title: 'Уроки', view: ['Дата', 'Час', 'Хв', 'Тип', 'Статус', 'Хто', 'Тема', 'Ціна'] },
  payments: { title: 'Оплати', view: ['Дата', 'Учень', 'Сума', 'Уроків', 'Примітка'] },
};

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
        return json({ ok: true, rev: getRev(), counts: counts(ss) });
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
  for (const type of TYPES) {
    const rows = readRows(ss, type);
    records[type] = rows.filter((r) => r.rev > since).map((r) => r.data);
  }
  return { ok: true, rev: getRev(), records };
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

  for (const type of TYPES) {
    const list = incoming[type];
    if (!Array.isArray(list) || list.length === 0) continue;
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
  return { ok: true, rev, accepted };
}

function counts(ss) {
  const out = {};
  for (const type of TYPES) out[type] = readRows(ss, type).length;
  return out;
}

/* ---------------- sheet helpers ---------------- */

function ensureSheet(ss, type) {
  const def = SHEETS[type];
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
  const sheet = ss.getSheetByName(SHEETS[type].title);
  if (!sheet) return [];
  const last = sheet.getLastRow();
  const width = LEAD.length + SHEETS[type].view.length + 1;
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
  }
  return [];
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
