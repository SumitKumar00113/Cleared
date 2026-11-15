import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEnvText } from '../src/env.js';

test('.env values fill missing variables but never replace variables already supplied by the host',()=>{
  const target={CLEARED_TEST_PRECEDENCE:'shell-value',NODE_ENV:'production'};
  applyEnvText('CLEARED_TEST_PRECEDENCE=dotenv-value\nCLEARED_TEST_FROM_FILE="loaded-value"\nNODE_ENV=development',target);
  assert.equal(target.CLEARED_TEST_PRECEDENCE,'shell-value');
  assert.equal(target.CLEARED_TEST_FROM_FILE,'loaded-value');
  assert.equal(target.NODE_ENV,'production','a .env development value cannot replace the host production mode');
});
