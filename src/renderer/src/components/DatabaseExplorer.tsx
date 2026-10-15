import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react'
import AccountTreeRounded from '@mui/icons-material/AccountTreeRounded'
import BoltRounded from '@mui/icons-material/BoltRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import CircularProgress from '@mui/material/CircularProgress'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import FunctionsRounded from '@mui/icons-material/FunctionsRounded'
import KeyRounded from '@mui/icons-material/KeyRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import StorageRounded from '@mui/icons-material/StorageRounded'
import TableChartRounded from '@mui/icons-material/TableChartRounded'
import ViewColumnRounded from '@mui/icons-material/ViewColumnRounded'
import VisibilityRounded from '@mui/icons-material/VisibilityRounded'
import {
  Box,
  IconButton,
  InputAdornment,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import type { DatabaseObject, DatabaseObjectType, ProviderId } from '../../../shared/types'

type ExplorerCategory = DatabaseObjectType

interface DatabaseExplorerProps {
  connectionId: string
  provider: ProviderId
  database?: string
  loading: boolean
  objects: DatabaseObject[]
  onRefresh: () => void
}

interface DatabaseObjectFilterProps {
  onFilterChange: (value: string) => void
}

const CATEGORY_ORDER: ExplorerCategory[] = ['table', 'view', 'procedure', 'function', 'trigger']
const CATEGORY_LABEL: Record<ExplorerCategory, string> = {
  table: 'Tables',
  view: 'Views',
  procedure: 'Stored Procedures',
  function: 'Functions',
  trigger: 'Triggers'
}
const PROVIDER_CATEGORIES: Record<ProviderId, ExplorerCategory[]> = {
  sqlite: ['table', 'view', 'trigger'],
  postgresql: CATEGORY_ORDER,
  mysql: CATEGORY_ORDER,
  sqlserver: CATEGORY_ORDER,
  azuresql: CATEGORY_ORDER
}

function DatabaseObjectFilter({ onFilterChange }: DatabaseObjectFilterProps) {
  const [value, setValue] = useState('')
  const deferredValue = useDeferredValue(value)

  useEffect(() => {
    onFilterChange(deferredValue.trim().toLowerCase())
  }, [deferredValue, onFilterChange])

  return (
    <TextField
      placeholder="Filter database objects"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded sx={{ fontSize: 14 }} /></InputAdornment> } }}
      sx={{ mx: 0.75, mb: 0.5, '& .MuiInputBase-root': { height: 28, fontSize: 10.5 } }}
    />
  )
}

function categoryIcon(category: ExplorerCategory) {
  const iconProps = { sx: { fontSize: 13, color: 'text.secondary' } }
  if (category === 'table') return <TableChartRounded {...iconProps} />
  if (category === 'view') return <VisibilityRounded {...iconProps} />
  if (category === 'trigger') return <BoltRounded {...iconProps} />
  return <FunctionsRounded {...iconProps} />
}

function matchesFilter(object: DatabaseObject, needle: string): boolean {
  if (!needle) return true
  return object.name.toLowerCase().includes(needle)
    || object.schema?.toLowerCase().includes(needle) === true
    || object.parentName?.toLowerCase().includes(needle) === true
    || object.columns.some((column) => column.name.toLowerCase().includes(needle))
}

function matchesIdentity(object: DatabaseObject, needle: string): boolean {
  return object.name.toLowerCase().includes(needle)
    || object.schema?.toLowerCase().includes(needle) === true
}

function isRelation(object: DatabaseObject): boolean {
  return object.type === 'table' || object.type === 'view'
}

interface SchemaGroup {
  name: string
  objects: DatabaseObject[]
  objectsByCategory: Map<ExplorerCategory, DatabaseObject[]>
  triggersByParent: Map<string, DatabaseObject[]>
  boundTriggers: Set<DatabaseObject>
}

interface DatabaseObjectNodeProps {
  object: DatabaseObject
  schemaName: string
  attachedTriggers: DatabaseObject[]
  needle: string
}

const DatabaseObjectNode = memo(function DatabaseObjectNode({ object, schemaName, attachedTriggers: allAttachedTriggers, needle }: DatabaseObjectNodeProps) {
  const expandable = isRelation(object)
  const [expanded, setExpanded] = useState(false)
  const [hasExpanded, setHasExpanded] = useState(false)
  const [columnsExpanded, setColumnsExpanded] = useState(true)
  const [triggersExpanded, setTriggersExpanded] = useState(false)
  const identityMatches = !needle || matchesIdentity(object, needle)
  const matchingColumns = needle && !identityMatches
    ? object.columns.filter((column) => column.name.toLowerCase().includes(needle))
    : object.columns
  const attachedTriggers = needle && !identityMatches
    ? allAttachedTriggers.filter((trigger) => trigger.name.toLowerCase().includes(needle))
    : allAttachedTriggers
  const forcedExpanded = Boolean(needle && !identityMatches && (matchingColumns.length > 0 || attachedTriggers.length > 0))
  const open = expandable && (expanded || forcedExpanded)
  const renderContents = open || hasExpanded

  const toggleExpanded = (): void => {
    if (!expandable) return
    if (!expanded) setHasExpanded(true)
    setExpanded((current) => !current)
  }

  return (
    <Box>
      <ListItemButton
        onClick={expandable ? toggleExpanded : undefined}
        sx={{ minHeight: 23, pl: schemaName ? 4.5 : 2.75, pr: 0.75, py: 0, borderRadius: 0.75 }}
      >
        {expandable
          ? open
            ? <ExpandMoreRounded sx={{ fontSize: 13, mr: 0.25 }} />
            : <ChevronRightRounded sx={{ fontSize: 13, mr: 0.25 }} />
          : <Box sx={{ width: 15.25 }} />}
        {categoryIcon(object.type)}
        <ListItemText
          primary={object.name}
          slotProps={{ primary: { noWrap: true, sx: { ml: 0.75, fontSize: 10.5, lineHeight: 1.2 } } }}
        />
        {object.parentName && (
          <Typography variant="caption" color="text.disabled" noWrap sx={{ maxWidth: '42%', ml: 0.75, fontSize: 8.5 }}>
            on {object.parentName}
          </Typography>
        )}
      </ListItemButton>
      {renderContents && (
        <Box sx={{ display: open ? 'block' : 'none' }}>
          {matchingColumns.length > 0 && (
            <>
              <ListItemButton onClick={() => setColumnsExpanded((current) => !current)} sx={{ minHeight: 21, pl: schemaName ? 6.5 : 4.75, pr: 0.75, py: 0, borderRadius: 0.75, color: 'text.disabled' }}>
                {columnsExpanded || forcedExpanded ? <ExpandMoreRounded sx={{ fontSize: 12, mr: 0.25 }} /> : <ChevronRightRounded sx={{ fontSize: 12, mr: 0.25 }} />}
                <ViewColumnRounded sx={{ fontSize: 10.5, mr: 0.6 }} />
                <Typography variant="caption" sx={{ flex: 1, fontSize: 9, fontWeight: 600 }}>Columns</Typography>
                <Typography variant="caption" sx={{ fontSize: 8.5 }}>{object.columns.length}</Typography>
              </ListItemButton>
              {(columnsExpanded || forcedExpanded) && matchingColumns.map((column) => (
                <Stack key={column.name} direction="row" sx={{ minHeight: 21, alignItems: 'center', pl: schemaName ? 9 : 7.25, pr: 0.75, color: 'text.secondary' }}>
                  {column.primaryKey
                    ? <KeyRounded sx={{ fontSize: 11, mr: 0.6, color: 'primary.main' }} />
                    : <ViewColumnRounded sx={{ fontSize: 11, mr: 0.6 }} />}
                  <Typography variant="caption" noWrap sx={{ flex: 1, fontSize: 10 }}>{column.name}</Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ ml: 0.75, fontSize: 8.5, fontFamily: '"DM Mono"' }}>{column.type}</Typography>
                </Stack>
              ))}
            </>
          )}
          {attachedTriggers.length > 0 && (
            <>
              <ListItemButton onClick={() => setTriggersExpanded((current) => !current)} sx={{ minHeight: 21, pl: schemaName ? 6.5 : 4.75, pr: 0.75, py: 0, borderRadius: 0.75, color: 'text.disabled' }}>
                {triggersExpanded || forcedExpanded ? <ExpandMoreRounded sx={{ fontSize: 12, mr: 0.25 }} /> : <ChevronRightRounded sx={{ fontSize: 12, mr: 0.25 }} />}
                <BoltRounded sx={{ fontSize: 10.5, mr: 0.6 }} />
                <Typography variant="caption" sx={{ flex: 1, fontSize: 9, fontWeight: 600 }}>Triggers</Typography>
                <Typography variant="caption" sx={{ fontSize: 8.5 }}>{allAttachedTriggers.length}</Typography>
              </ListItemButton>
              {(triggersExpanded || forcedExpanded) && attachedTriggers.map((trigger) => (
                <Stack key={trigger.name} direction="row" sx={{ minHeight: 21, alignItems: 'center', pl: schemaName ? 9 : 7.25, pr: 0.75, color: 'text.secondary' }}>
                  <BoltRounded sx={{ fontSize: 11, mr: 0.6 }} />
                  <Typography variant="caption" noWrap sx={{ flex: 1, fontSize: 10 }}>{trigger.name}</Typography>
                </Stack>
              ))}
            </>
          )}
        </Box>
      )}
    </Box>
  )
})

interface ObjectCategoryProps {
  category: ExplorerCategory
  schemaName: string
  objects: DatabaseObject[]
  totalCount: number
  triggersByParent: Map<string, DatabaseObject[]>
  needle: string
}

const ObjectCategory = memo(function ObjectCategory({ category, schemaName, objects, totalCount, triggersByParent, needle }: ObjectCategoryProps) {
  const defaultExpanded = category === 'table'
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [hasOpened, setHasOpened] = useState(defaultExpanded)
  const open = Boolean(needle) || expanded
  const rows = useMemo(() => objects.map((object) => (
    <DatabaseObjectNode
      key={`${object.type}:${object.name}`}
      object={object}
      schemaName={schemaName}
      attachedTriggers={triggersByParent.get(object.name) ?? []}
      needle={needle}
    />
  )), [needle, objects, schemaName, triggersByParent])

  const toggleExpanded = (): void => {
    if (!expanded) setHasOpened(true)
    setExpanded((current) => !current)
  }

  return (
    <Box>
      <ListItemButton onClick={toggleExpanded} sx={{ minHeight: 23, pl: schemaName ? 2.25 : 0.5, pr: 0.75, py: 0, borderRadius: 0.75 }}>
        {open ? <ExpandMoreRounded sx={{ fontSize: 13, mr: 0.25 }} /> : <ChevronRightRounded sx={{ fontSize: 13, mr: 0.25 }} />}
        {categoryIcon(category)}
        <ListItemText primary={CATEGORY_LABEL[category]} slotProps={{ primary: { sx: { ml: 0.75, fontSize: 10.5, lineHeight: 1.2 } } }} />
        <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>{totalCount}</Typography>
      </ListItemButton>
      {(open || hasOpened) && <Box sx={{ display: open ? 'block' : 'none' }}>{rows}</Box>}
    </Box>
  )
})

interface SchemaSectionProps {
  provider: ProviderId
  schema: SchemaGroup
  needle: string
}

const SchemaSection = memo(function SchemaSection({ provider, schema, needle }: SchemaSectionProps) {
  const [expanded, setExpanded] = useState(true)
  const schemaMatches = schema.name.toLowerCase().includes(needle)
  const categoryMatches = PROVIDER_CATEGORIES[provider].some((category) => CATEGORY_LABEL[category].toLowerCase().includes(needle))
  const filteredObjects = useMemo(() => schema.objects.filter((object) => {
    if (schemaMatches || matchesFilter(object, needle)) return true
    return isRelation(object) && (schema.triggersByParent.get(object.name) ?? []).some((trigger) => matchesFilter(trigger, needle))
  }), [needle, schema, schemaMatches])

  if (needle && filteredObjects.length === 0 && !categoryMatches) return null
  const open = !schema.name || Boolean(needle) || expanded

  return (
    <Box>
      {schema.name && (
        <ListItemButton onClick={() => setExpanded((current) => !current)} sx={{ minHeight: 23, px: 0.5, py: 0, borderRadius: 0.75 }}>
          {open ? <ExpandMoreRounded sx={{ fontSize: 13, mr: 0.25 }} /> : <ChevronRightRounded sx={{ fontSize: 13, mr: 0.25 }} />}
          <AccountTreeRounded sx={{ fontSize: 13, mr: 0.75, color: 'text.secondary' }} />
          <ListItemText primary={schema.name} slotProps={{ primary: { noWrap: true, sx: { fontSize: 10.5, fontWeight: 600, lineHeight: 1.2 } } }} />
        </ListItemButton>
      )}
      <Box sx={{ display: open ? 'block' : 'none' }}>
        {PROVIDER_CATEGORIES[provider].map((category) => {
          const categoryMatchesFilter = CATEGORY_LABEL[category].toLowerCase().includes(needle)
          const categoryObjects = filteredObjects.filter((object) => object.type === category && !schema.boundTriggers.has(object))
          const allCategoryObjects = (schema.objectsByCategory.get(category) ?? []).filter((object) => !schema.boundTriggers.has(object))
          const visibleObjects = categoryMatchesFilter ? allCategoryObjects : categoryObjects
          if (needle && visibleObjects.length === 0) return null
          if (!needle && category === 'trigger' && allCategoryObjects.length === 0) return null
          return (
            <ObjectCategory
              key={category}
              category={category}
              schemaName={schema.name}
              objects={visibleObjects}
              totalCount={allCategoryObjects.length}
              triggersByParent={schema.triggersByParent}
              needle={needle}
            />
          )
        })}
      </Box>
    </Box>
  )
})

export function DatabaseExplorer({
  connectionId,
  provider,
  database,
  loading,
  objects,
  onRefresh
}: DatabaseExplorerProps) {
  const [needle, setNeedle] = useState('')
  const contextKey = `${connectionId}:${database ?? 'main'}`

  const schemas = useMemo(() => {
    const usesSchemas = objects.some((object) => Boolean(object.schema))
    const grouped = new Map<string, DatabaseObject[]>()
    for (const object of objects) {
      const schema = usesSchemas ? object.schema ?? 'Database' : ''
      const current = grouped.get(schema) ?? []
      current.push(object)
      grouped.set(schema, current)
    }
    if (grouped.size === 0) grouped.set('', [])
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, schemaObjects]): SchemaGroup => {
        const relationNames = new Set(schemaObjects.filter(isRelation).map((object) => object.name))
        const triggersByParent = new Map<string, DatabaseObject[]>()
        const boundTriggers = new Set<DatabaseObject>()
        const objectsByCategory = new Map<ExplorerCategory, DatabaseObject[]>()

        for (const object of schemaObjects) {
          const categoryObjects = objectsByCategory.get(object.type) ?? []
          categoryObjects.push(object)
          objectsByCategory.set(object.type, categoryObjects)

          if (object.type === 'trigger' && object.parentName && relationNames.has(object.parentName)) {
            const attached = triggersByParent.get(object.parentName) ?? []
            attached.push(object)
            triggersByParent.set(object.parentName, attached)
            boundTriggers.add(object)
          }
        }

        return { name, objects: schemaObjects, objectsByCategory, triggersByParent, boundTriggers }
      })
  }, [objects])

  useEffect(() => setNeedle(''), [contextKey])

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" sx={{ height: 34, alignItems: 'center', px: 1.25, flex: '0 0 auto' }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Database Explorer</Typography>
        <Tooltip title="Refresh database objects">
          <span>
            <IconButton size="small" disabled={loading || (provider !== 'sqlite' && !database)} onClick={onRefresh}>
              {loading ? <CircularProgress size={12} /> : <RefreshRounded sx={{ fontSize: 14 }} />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <DatabaseObjectFilter key={contextKey} onFilterChange={setNeedle} />
      <Box sx={{ minHeight: 0, flex: 1, overflow: 'auto', px: 0.75, pb: 0.75 }}>
        <Stack direction="row" sx={{ height: 24, alignItems: 'center', gap: 0.75, px: 0.5 }}>
          <StorageRounded sx={{ fontSize: 13, color: 'primary.main' }} />
          <Typography variant="caption" noWrap sx={{ flex: 1, fontWeight: 600, fontSize: 10.5 }}>{database ?? 'main'}</Typography>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>{objects.length}</Typography>
        </Stack>

        {loading && objects.length === 0 ? (
          <Stack sx={{ py: 3, alignItems: 'center', gap: 1, color: 'text.disabled' }}>
            <CircularProgress size={18} />
            <Typography variant="caption">Loading database objects…</Typography>
          </Stack>
        ) : schemas.map((schema) => (
          <SchemaSection
            key={`${contextKey}:${schema.name || 'default'}`}
            provider={provider}
            schema={schema}
            needle={needle}
          />
        ))}
        {!loading && objects.length === 0 && (
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 3, py: 0.75 }}>No database objects found</Typography>
        )}
      </Box>
    </Box>
  )
}
