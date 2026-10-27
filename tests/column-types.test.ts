import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mysqlResultType, mysqlTypeDeclaration, sqlServerResultType, sqlServerTypeDeclaration } from '../src/main/databases/column-types.ts'

test('SQL Server declarations preserve character capacity, MAX, decimal and temporal precision', () => {
  assert.equal(sqlServerTypeDeclaration({ type: 'varchar', length: 255 }), 'VARCHAR(255)')
  assert.equal(sqlServerTypeDeclaration({ type: 'nvarchar', length: -1 }), 'NVARCHAR(MAX)')
  assert.equal(sqlServerTypeDeclaration({ type: 'decimal', precision: 18, scale: 0 }), 'DECIMAL(18,0)')
  assert.equal(sqlServerTypeDeclaration({ type: 'datetime2', scale: 3 }), 'DATETIME2(3)')
  assert.equal(sqlServerTypeDeclaration({ type: 'int', precision: 10, scale: 0 }), 'INT')
  assert.equal(sqlServerTypeDeclaration({ type: 'text', length: 2147483647 }), 'TEXT')
})

test('SQL Server protocol byte lengths become Unicode character counts without halving MAX', () => {
  const type = Object.assign(() => {}, { declaration: 'nvarchar' })
  assert.equal(sqlServerResultType({ type, length: 510 }), 'NVARCHAR(255)')
  assert.equal(sqlServerResultType({ type, length: 65535 }), 'NVARCHAR(MAX)')
  assert.equal(sqlServerResultType({ type: { declaration: 'nchar' }, length: 20 }), 'NCHAR(10)')
  assert.equal(sqlServerResultType({ type: { declaration: 'varbinary' }, length: 20 }), 'VARBINARY(20)')
  assert.equal(sqlServerResultType({ type: {}, length: 0 }), null)
})

test('MySQL declarations preserve case-sensitive enum literals', () => {
  assert.equal(mysqlTypeDeclaration("enum('Pending','DONE')"), "ENUM('Pending','DONE')")
  assert.equal(mysqlTypeDeclaration('varchar(255)'), 'VARCHAR(255)')
  assert.equal(mysqlTypeDeclaration('decimal(12,2) unsigned'), 'DECIMAL(12,2) unsigned')
})

test('MySQL expression metadata distinguishes byte capacities and decimal display widths', () => {
  const field = { decimals: 2, flags: 0, columnLength: 12, columnType: 246 }
  assert.equal(mysqlResultType(field), 'DECIMAL(10,2)')
  assert.equal(mysqlResultType({ ...field, flags: 32 }), 'DECIMAL(11,2)')
  assert.equal(mysqlResultType({ ...field, columnType: 253, columnLength: 1020, characterSet: 45 }), 'VARCHAR (up to 1020 bytes)')
  assert.equal(mysqlResultType({ ...field, columnType: 253, columnLength: 255, characterSet: 63 }), 'VARBINARY (up to 255 bytes)')
  assert.equal(mysqlResultType({ ...field, columnType: 3 }), 'INT')
  assert.equal(mysqlResultType({ ...field, columnType: 999 }), null)
})
