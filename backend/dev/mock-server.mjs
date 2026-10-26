// Runs backend/Code.gs locally against an in-memory spreadsheet, so the app's
// sync can be tested without a Google account:
//   node backend/dev/mock-server.mjs            → http://localhost:8787/exec
// The access code is printed on start. Data lives only while the process runs.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const code = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

class Range {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = this.sheet.data[this.row - 1 + r] ?? [];
      out.push(Array.from({ length: this.cols }, (_, c) => line[this.col - 1 + c] ?? ''));
    }
    return out;
  }
  setValues(values) {
    values.forEach((line, r) => {
      const target = (this.sheet.data[this.row - 1 + r] ??= []);
      line.forEach((v, c) => (target[this.col - 1 + c] = v));
    });
    return this;
  }
  setNumberFormat() {
    return this;
  }
  setFontWeight() {
    return this;
  }
}

class Sheet {
  constructor(name) {
    this.name = name;
    this.data = [];
  }
  getName() {
    return this.name;
  }
  getLastRow() {
    return this.data.filter((r) => r && r.some((v) => v !== '' && v != null)).length;
  }
  getRange(row, col, rows = 1, cols = 1) {
    return new Range(this, row, col, rows, cols);
  }
  setFrozenRows() {}
  setColumnWidth() {}
}

const sheets = new Map([['Sheet1', new Sheet('Sheet1')]]);
const spreadsheet = {
  getId: () => 'mock-sheet',
  getSheetByName: (n) => sheets.get(n) ?? null,
  insertSheet: (n) => {
    const s = new Sheet(n);
    sheets.set(n, s);
    return s;
  },
  getSheets: () => [...sheets.values()],
  deleteSheet: (s) => sheets.delete(s.getName()),
};
const props = new Map();

const context = vm.createContext({
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, getUi: () => ({}) },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => props.get(k) ?? null,
      setProperty: (k, v) => props.set(k, String(v)),
    }),
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
  },
  Utilities: { getUuid: () => randomUUID() },
  Logger: { log: (...a) => console.log('[gs]', ...a) },
  console,
});
vm.runInContext(code, context, { filename: 'Code.gs' });
context.setup();

const port = Number(process.env.PORT || 8787);
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET') {
    res.end(context.doGet().text);
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const out = context.doPost({ postData: { contents: body } });
    res.setHeader('Content-Type', 'application/json');
    res.end(out.text);
  });
}).listen(port, () => {
  console.log(`mock Apps Script on http://localhost:${port}/exec`);
  console.log(`access code: ${props.get('KEY')}`);
});
