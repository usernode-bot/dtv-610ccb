// The Series search field's strings, in both languages.
// public/js/i18n.js is a browser script, so it runs here in a vm with the
// globals it reads at load: window, document.documentElement, localStorage
// and navigator.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadI18n() {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'i18n.js'), 'utf8');
  const window: any = {};
  const context = {
    window,
    document: { documentElement: {} as { lang?: string } },
    localStorage: { getItem: () => null, setItem: () => {} },
    navigator: { language: 'en', languages: ['en'] },
    console,
  };
  vm.runInNewContext(source, context);
  return window.dtvI18n;
}

test('browse search strings exist in English and Indonesian', () => {
  const i18n = loadI18n();
  for (const locale of ['en', 'id']) {
    i18n.setLocale(locale);
    assert.notStrictEqual(i18n.t('searchSeries'), 'searchSeries', `${locale}: searchSeries`);
    assert.notStrictEqual(i18n.t('noMatchBody'), 'noMatchBody', `${locale}: noMatchBody`);
    assert.notStrictEqual(i18n.t('clearSearch'), 'clearSearch', `${locale}: clearSearch`);
    assert.match(i18n.t('noMatchTitle', { q: 'abc' }), /abc/, `${locale}: noMatchTitle includes the query`);
  }
  assert.strictEqual(i18n.t('searchSeries'), 'Cari serial');
  i18n.setLocale('en');
  assert.strictEqual(i18n.t('searchSeries'), 'Search series');
  assert.strictEqual(i18n.t('clearSearch'), 'Clear search');
  assert.strictEqual(i18n.t('noMatchTitle', { q: 'spring' }), 'No series match "spring"');
});
