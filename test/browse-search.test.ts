// The Series search box's words, in both languages. Runs public/js/i18n.js in a
// vm with the few browser globals it touches (no database needed).
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(join(__dirname, '..', '..', 'public', 'js', 'i18n.js'), 'utf8');

function loadI18n() {
  const doc = { documentElement: { lang: '' } };
  const store: Record<string, string> = {};
  const ctx: any = {
    window: {},
    document: doc,
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = String(v); },
    },
    navigator: { language: 'en', languages: ['en'] },
    Promise,
  };
  ctx.window.document = doc;
  ctx.window.localStorage = ctx.localStorage;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return ctx.window.dtvI18n;
}

test('search box words exist in English and Indonesian', () => {
  const i18n = loadI18n();
  for (const code of ['en', 'id']) {
    i18n.setLocale(code);
    for (const key of ['searchSeries', 'noMatchBody', 'clearSearch']) {
      assert.notStrictEqual(i18n.t(key), key, `${code}: ${key} is missing`);
    }
    const title = i18n.t('noMatchTitle', { q: 'abc' });
    assert.ok(title.includes('abc'), `${code}: no-match title should include what was typed`);
  }
});

test('search box words differ between English and Indonesian', () => {
  const i18n = loadI18n();
  i18n.setLocale('en');
  const en = i18n.t('searchSeries');
  i18n.setLocale('id');
  assert.notStrictEqual(i18n.t('searchSeries'), en);
});
