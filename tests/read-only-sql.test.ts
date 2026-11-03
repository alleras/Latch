import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkReadOnlySql, type SqlDialect } from '../src/main/databases/read-only-sql.ts'

const dialects: SqlDialect[] = ['postgresql', 'mysql', 'sqlserver', 'sqlite']

function allowed(sql: string, dialect: SqlDialect): boolean {
  return checkReadOnlySql(sql, dialect).allowed
}

test('plain reads are allowed in every dialect', () => {
  for (const dialect of dialects) {
    assert.equal(allowed('SELECT 1', dialect), true, dialect)
    assert.equal(allowed('select id, name from users where id = 1;', dialect), true, dialect)
    assert.equal(allowed('WITH recent AS (SELECT * FROM orders) SELECT count(*) FROM recent', dialect), true, dialect)
    assert.equal(allowed('SELECT 1; SELECT 2;', dialect), true, dialect)
    assert.equal(allowed('-- leading comment\nSELECT 1 /* trailing */', dialect), true, dialect)
  }
})

test('writes, DDL, and transaction control are rejected in every dialect', () => {
  for (const dialect of dialects) {
    for (const sql of [
      'INSERT INTO users VALUES (1)',
      'update users set name = 1',
      'DELETE FROM users',
      'DROP TABLE users',
      'CREATE TABLE t (id int)',
      'ALTER TABLE users ADD x int',
      'TRUNCATE TABLE users',
      'COMMIT',
      'ROLLBACK',
      'BEGIN',
      'GRANT SELECT ON users TO someone',
      'SELECT 1; DELETE FROM users',
      'SELECT * INTO copy FROM users'
    ]) {
      assert.equal(allowed(sql, dialect), false, `${dialect}: ${sql}`)
    }
  }
})

test('data-modifying CTEs and locking reads are rejected', () => {
  assert.equal(allowed('WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone', 'postgresql'), false)
  assert.equal(allowed('SELECT * FROM users FOR UPDATE', 'postgresql'), false)
})

test('T-SQL statements without semicolons cannot hide a write', () => {
  assert.equal(allowed('SELECT 1 DELETE FROM users', 'sqlserver'), false)
  assert.equal(allowed('SELECT 1\nEXEC sp_who', 'sqlserver'), false)
  assert.equal(allowed('SELECT * FROM OPENQUERY(remote, \'SELECT 1\')', 'sqlserver'), false)
  assert.equal(allowed('DECLARE @id int = 5; SET @id = 6; SELECT @id', 'sqlserver'), true)
  assert.equal(allowed('sp_configure', 'sqlserver'), false)
})

test('keywords inside strings, quoted names, and comments do not count', () => {
  assert.equal(allowed("SELECT 'DELETE FROM users' AS note", 'postgresql'), true)
  assert.equal(allowed('SELECT "update" FROM "drop"', 'postgresql'), true)
  assert.equal(allowed('SELECT [delete] FROM [dbo].[insert]', 'sqlserver'), true)
  assert.equal(allowed('SELECT `delete` FROM `insert`', 'mysql'), true)
  assert.equal(allowed('SELECT 1 -- DELETE FROM users', 'sqlite'), true)
  assert.equal(allowed('SELECT $body$ DROP TABLE x $body$', 'postgresql'), true)
  assert.equal(allowed("SELECT E'it\\'s; DELETE' AS note", 'postgresql'), true)
})

test('an unquoted keyword used as a name explains how to fix it', () => {
  const check = checkReadOnlySql('SELECT call FROM phone_log', 'postgresql')
  assert.equal(check.allowed, false)
  assert.match(check.allowed ? '' : check.reason, /quote it/)
})

test('MySQL comment and escape rules cannot hide statements', () => {
  // `1--1` is arithmetic in MySQL, not a comment.
  assert.equal(allowed('SELECT 1--1; DELETE FROM users', 'mysql'), false)
  // Executable comments run.
  assert.equal(allowed('SELECT 1 /*! ; DELETE FROM users */', 'mysql'), false)
  // Backslash escapes depend on server mode, so both readings must be safe.
  assert.equal(allowed("SELECT '\\''; DELETE FROM users; -- '", 'mysql'), false)
  assert.equal(allowed("SELECT '\\'; DELETE FROM users; -- '", 'mysql'), false)
  // MySQL block comments do not nest.
  assert.equal(allowed('SELECT 1 /* /* */ ; DELETE FROM users; /* */', 'mysql'), false)
  assert.equal(allowed('SHOW TABLES', 'mysql'), true)
  assert.equal(allowed('DESCRIBE users', 'mysql'), true)
})

test('statements outside the read list are rejected with the allowed list', () => {
  const check = checkReadOnlySql('SET default_transaction_read_only = off', 'postgresql')
  assert.equal(check.allowed, false)
  assert.match(check.allowed ? '' : check.reason, /SET statements are not allowed.*SELECT/)
  assert.equal(allowed('COPY users TO STDOUT', 'postgresql'), false)
  assert.equal(allowed("SELECT set_config('default_transaction_read_only', 'off', false)", 'postgresql'), false)
  assert.equal(allowed("ATTACH DATABASE 'other.db' AS other", 'sqlite'), false)
  assert.equal(allowed('PRAGMA table_info(users)', 'sqlite'), true)
  assert.equal(allowed('PRAGMA table_info(users)', 'postgresql'), false)
})

test('text the guard cannot tokenize with certainty is rejected', () => {
  assert.equal(allowed("SELECT 'unterminated", 'postgresql'), false)
  assert.equal(allowed('SELECT 1 /* open comment', 'sqlserver'), false)
  assert.equal(allowed('SELECT $tag$ never closed', 'postgresql'), false)
  assert.equal(allowed('', 'sqlite'), false)
  assert.equal(allowed(' ;; ', 'sqlite'), false)
})
