import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLocale, isRtlLocale } from './index.ts';

test('normalizeLocale keeps exact region-qualified matches', () => {
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN');
  assert.equal(normalizeLocale('zh-TW'), 'zh-TW');
  assert.equal(normalizeLocale('pt-BR'), 'pt-BR');
});

test('normalizeLocale accepts bare languages we ship', () => {
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('ja'), 'ja');
  assert.equal(normalizeLocale('ko'), 'ko');
  assert.equal(normalizeLocale('de'), 'de');
});

test('normalizeLocale folds a region onto the bare language we ship', () => {
  assert.equal(normalizeLocale('fr-CA'), 'fr'); // we ship bare fr
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('es-419'), 'es'); // Latin-American Spanish → es
  assert.equal(normalizeLocale('de-AT'), 'de');
});

test('normalizeLocale maps ship-only-regional Portuguese to pt-BR', () => {
  assert.equal(normalizeLocale('pt'), 'pt-BR'); // bare
  assert.equal(normalizeLocale('pt-PT'), 'pt-BR'); // European → closest shipped
});

test('normalizeLocale maps Simplified-Chinese tags to zh-CN', () => {
  assert.equal(normalizeLocale('zh'), 'zh-CN'); // bare → Simplified default
  assert.equal(normalizeLocale('zh-Hans'), 'zh-CN'); // script subtag
  assert.equal(normalizeLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(normalizeLocale('zh-SG'), 'zh-CN'); // Singapore uses Simplified
});

test('normalizeLocale maps Traditional-Chinese tags to zh-TW', () => {
  assert.equal(normalizeLocale('zh-Hant'), 'zh-TW'); // script subtag
  assert.equal(normalizeLocale('zh-Hant-HK'), 'zh-TW');
  assert.equal(normalizeLocale('zh-HK'), 'zh-TW'); // Hong Kong uses Traditional
  assert.equal(normalizeLocale('zh-MO'), 'zh-TW'); // Macau uses Traditional
});

test('normalizeLocale is case-insensitive for the fallbacks', () => {
  assert.equal(normalizeLocale('PT'), 'pt-BR');
  assert.equal(normalizeLocale('ZH-HANT'), 'zh-TW');
  assert.equal(normalizeLocale('zh-hant'), 'zh-TW');
});

test('normalizeLocale falls back to English for unsupported / empty input', () => {
  assert.equal(normalizeLocale('xx'), 'en');
  assert.equal(normalizeLocale('tlh-AA'), 'en'); // unshipped language + region
  assert.equal(normalizeLocale(''), 'en');
  assert.equal(normalizeLocale(null), 'en');
  assert.equal(normalizeLocale(undefined), 'en');
});

test('isRtlLocale flags Arabic and Hebrew only', () => {
  assert.equal(isRtlLocale('ar'), true);
  assert.equal(isRtlLocale('he'), true);
  assert.equal(isRtlLocale('en'), false);
  assert.equal(isRtlLocale('zh-TW'), false);
});
