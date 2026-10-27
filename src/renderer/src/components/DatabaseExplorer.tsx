import { memo, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import AccountTreeRounded from '@mui/icons-material/AccountTreeRounded'
import BoltRounded from '@mui/icons-material/BoltRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import CircularProgress from '@mui/material/CircularProgress'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import FolderOutlined from '@mui/icons-material/FolderOutlined'
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
import type { DatabaseObject, DatabaseObjectType, ProviderId, SchemaConstraint, SchemaDefault, SchemaIndex } from '../../../shared/types'
import { componentSizes } from '../theme'

type ExplorerCategory = DatabaseObjectType
const SIDEBAR_SIZE = componentSizes.sidebarPanel

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
      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded sx={{ fontSize: SIDEBAR_SIZE.icon }} /></InputAdornment> } }}
      sx={{ mx: 0.75, mb: 0.5, '& .MuiInputBase-root': { height: SIDEBAR_SIZE.filterHeight } }}
    />
  )
}

function categoryIcon(category: ExplorerCategory) {
  const iconProps = { sx: { fontSize: SIDEBAR_SIZE.icon, color: 'text.secondary' } }
  if (category === 'table') return <TableChartRounded {...iconProps} />
  if (category === 'view') return <VisibilityRounded {...iconProps} />
  if (category === 'trigger') return <BoltRounded {...iconProps} />
  return <FunctionsRounded {...iconProps} />
}

function includesText(value: string | undefined, needle: string): boolean {
  return value?.toLowerCase().includes(needle) === true
}

function constraintMatches(constraint: SchemaConstraint, needle: string): boolean {
  return includesText(constraint.name, needle)
    || includesText(constraint.type.replaceAll('-', ' '), needle)
    || constraint.columns.some((column) => includesText(column, needle))
    || includesText(constraint.referencedSchema, needle)
    || includesText(constraint.referencedTable, needle)
    || constraint.referencedColumns?.some((column) => includesText(column, needle)) === true
    || includesText(constraint.expression, needle)
}

function indexMatches(index: SchemaIndex, needle: string): boolean {
  return includesText(index.name, needle)
    || includesText(index.type, needle)
    || (index.unique && 'unique'.includes(needle))
    || (index.primary && 'primary'.includes(needle))
    || index.columns.some((column) => includesText(column.name, needle) || includesText(column.expression, needle))
    || includesText(index.predicate, needle)
}

function defaultMatches(defaultValue: SchemaDefault, needle: string): boolean {
  return includesText(defaultValue.name, needle)
    || includesText(defaultValue.column, needle)
    || includesText(defaultValue.expression, needle)
}

function matchesFilter(object: DatabaseObject, needle: string): boolean {
  if (!needle) return true
  return includesText(object.name, needle)
    || includesText(object.schema, needle)
    || includesText(object.parentName, needle)
    || object.columns.some((column) => includesText(column.name, needle) || includesText(column.type, needle))
    || object.constraints.some((constraint) => constraintMatches(constraint, needle))
    || object.indexes.some((index) => indexMatches(index, needle))
    || object.defaults.some((defaultValue) => defaultMatches(defaultValue, needle))
    || (object.columns.length > 0 && 'columns'.includes(needle))
    || (object.constraints.length > 0 && 'constraints'.includes(needle))
    || (object.indexes.length > 0 && 'indexes'.includes(needle))
    || (object.defaults.length > 0 && 'defaults'.includes(needle))
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

interface DetailFolderProps {
  label: string
  count: number
  leftPadding: number
  defaultExpanded?: boolean
  forcedExpanded: boolean
  children: ReactNode
}

const DetailFolder = memo(function DetailFolder({ label, count, leftPadding, defaultExpanded = false, forcedExpanded, children }: DetailFolderProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [hasOpened, setHasOpened] = useState(defaultExpanded)
  const open = forcedExpanded || expanded

  const toggleExpanded = (): void => {
    if (!expanded) setHasOpened(true)
    setExpanded((current) => !current)
  }

  return (
    <Box>
      <ListItemButton onClick={toggleExpanded} sx={{ minHeight: SIDEBAR_SIZE.detailRowHeight, pl: leftPadding, pr: 0.75, py: 0, borderRadius: 0.75, color: 'text.disabled' }}>
        {open ? <ExpandMoreRounded sx={{ fontSize: SIDEBAR_SIZE.chevron, mr: 0.25 }} /> : <ChevronRightRounded sx={{ fontSize: SIDEBAR_SIZE.chevron, mr: 0.25 }} />}
        <FolderOutlined sx={{ fontSize: SIDEBAR_SIZE.detailIcon, mr: 0.65, color: 'primary.main' }} />
        <Typography variant="sidebarSection" sx={{ flex: 1 }}>{label}</Typography>
        <Typography variant="sidebarMeta">{count}</Typography>
      </ListItemButton>
      {(open || hasOpened) && <Box sx={{ display: open ? 'block' : 'none' }}>{children}</Box>}
    </Box>
  )
})

interface DetailEntryProps {
  leftPadding: number
  icon: ReactNode
  name: string
  metadata?: string
  label?: string
  hoverDetails?: ReactNode
}

function DetailEntry({ leftPadding, icon, name, metadata, label, hoverDetails }: DetailEntryProps) {
  const nameLabel = (
    <Typography component="span" variant="sidebarItem" noWrap sx={{ display: 'block', width: 'fit-content', maxWidth: '100%' }}>
      {name}
    </Typography>
  )
  return (
    <Box sx={{ minHeight: SIDEBAR_SIZE.detailRowHeight, pl: leftPadding, pr: 0.75, color: 'text.secondary' }}>
      <Stack direction="row" sx={{ minHeight: SIDEBAR_SIZE.detailRowHeight, alignItems: 'center' }}>
        {icon}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          {hoverDetails
            ? <Tooltip title={hoverDetails} placement="right" arrow={false} enterDelay={350}>{nameLabel}</Tooltip>
            : nameLabel}
        </Box>
        {metadata && <Typography component="span" variant="sidebarBadge" color="text.disabled" sx={{ flex: '0 0 auto', ml: 0.75 }}>{metadata}</Typography>}
        {label && <Typography variant="sidebarMeta" color="text.disabled" noWrap sx={{ ml: 0.75, maxWidth: '48%' }}>{label}</Typography>}
      </Stack>
    </Box>
  )
}

function constraintLabel(constraint: SchemaConstraint): string {
  return constraint.type.replaceAll('-', ' ').toUpperCase()
}

function constraintMetadata(constraint: SchemaConstraint): string {
  if (constraint.type === 'primary-key') return 'PK'
  if (constraint.type === 'foreign-key') return 'FK'
  if (constraint.type === 'unique') return 'UQ'
  if (constraint.type === 'check') return 'CK'
  return 'EX'
}

function indexTypeMetadata(type: string | undefined): string | undefined {
  if (!type) return undefined
  const normalized = type.toUpperCase().replaceAll('_', ' ')
  if (normalized.includes('NONCLUSTERED')) return 'NC'
  if (normalized.includes('CLUSTERED')) return 'CL'
  if (normalized === 'BTREE' || normalized === 'B-TREE') return 'BT'
  if (normalized === 'HASH') return 'HS'
  if (normalized.length <= 4) return normalized
  return undefined
}

function indexMetadata(index: SchemaIndex): string {
  const purpose = index.primary ? 'PK' : index.unique ? 'UQ' : 'IX'
  const type = indexTypeMetadata(index.type)
  return type ? `${purpose}·${type}` : purpose
}

interface HoverDetailsProps {
  title: string
  rows: Array<{ label: string; value: ReactNode }>
}

function HoverDetails({ title, rows }: HoverDetailsProps) {
  const visibleRows = rows.filter((row) => row.value !== undefined && row.value !== null && row.value !== false)
  return (
    <Box sx={{ maxWidth: 420, py: 0.25 }}>
      <Typography variant="sidebarTitle" sx={{ display: 'block', mb: visibleRows.length > 0 ? 0.5 : 0 }}>{title}</Typography>
      {visibleRows.map((row) => (
        <Stack key={row.label} direction="row" sx={{ alignItems: 'flex-start', gap: 1, mt: 0.35 }}>
          <Typography variant="sidebarMeta" color="text.secondary" sx={{ minWidth: 74 }}>{row.label}</Typography>
          <Box sx={{ minWidth: 0, flex: 1 }}>{row.value}</Box>
        </Stack>
      ))}
    </Box>
  )
}

function MetadataValue({ children }: { children: string }) {
  return (
    <Typography variant="sidebarItem" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
      {children}
    </Typography>
  )
}

function MetadataColumnList({ values }: { values: string[] }) {
  return <MetadataCode>{`(${values.join(', ')})`}</MetadataCode>
}

function MetadataCode({ children }: { children: string }) {
  return (
    <Typography component="code" variant="sidebarCode" sx={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {children}
    </Typography>
  )
}

function constraintHoverDetails(constraint: SchemaConstraint): ReactNode {
  const reference = constraint.referencedTable
    ? `${constraint.referencedSchema ? `${constraint.referencedSchema}.` : ''}${constraint.referencedTable}${constraint.referencedColumns?.length ? ` (${constraint.referencedColumns.join(', ')})` : ''}`
    : undefined
  return (
    <HoverDetails
      title={constraint.name}
      rows={[
        { label: 'Type', value: <MetadataValue>{constraintLabel(constraint)}</MetadataValue> },
        { label: 'Columns', value: constraint.columns.length > 0 ? <MetadataColumnList values={constraint.columns} /> : undefined },
        { label: 'References', value: reference ? <MetadataCode>{reference}</MetadataCode> : undefined },
        { label: 'On update', value: constraint.onUpdate ? <MetadataValue>{constraint.onUpdate}</MetadataValue> : undefined },
        { label: 'On delete', value: constraint.onDelete ? <MetadataValue>{constraint.onDelete}</MetadataValue> : undefined },
        { label: 'Expression', value: constraint.expression ? <MetadataCode>{constraint.expression}</MetadataCode> : undefined }
      ]}
    />
  )
}

function indexColumnValues(index: SchemaIndex, included: boolean): string[] {
  return index.columns.filter((column) => column.included === included).map((column) => {
    const value = column.name ?? column.expression ?? '<expression>'
    const prefix = column.prefixLength ? `${value}(${column.prefixLength})` : value
    const direction = column.descending && !/\bDESC\b/i.test(prefix) ? ' DESC' : ''
    return `${prefix}${direction}`
  })
}

function indexHoverDetails(index: SchemaIndex): ReactNode {
  const attributes = [index.primary ? 'PRIMARY' : '', index.unique ? 'UNIQUE' : ''].filter(Boolean)
  const columns = indexColumnValues(index, false)
  const includedColumns = indexColumnValues(index, true)
  return (
    <HoverDetails
      title={index.name}
      rows={[
        { label: 'Type', value: index.type ? <MetadataValue>{index.type}</MetadataValue> : undefined },
        { label: 'Attributes', value: attributes.length > 0 ? <MetadataValue>{attributes.join(' · ')}</MetadataValue> : undefined },
        { label: 'Columns', value: columns.length > 0 ? <MetadataColumnList values={columns} /> : undefined },
        { label: 'Included', value: includedColumns.length > 0 ? <MetadataColumnList values={includedColumns} /> : undefined },
        { label: 'Filter', value: index.predicate ? <MetadataCode>{index.predicate}</MetadataCode> : undefined }
      ]}
    />
  )
}

function defaultHoverDetails(defaultValue: SchemaDefault): ReactNode {
  return (
    <HoverDetails
      title={defaultValue.name ?? defaultValue.column}
      rows={[
        { label: 'Column', value: <MetadataCode>{defaultValue.column}</MetadataCode> },
        { label: 'Expression', value: <MetadataCode>{defaultValue.expression}</MetadataCode> }
      ]}
    />
  )
}

const DatabaseObjectNode = memo(function DatabaseObjectNode({ object, schemaName, attachedTriggers: allAttachedTriggers, needle }: DatabaseObjectNodeProps) {
  const expandable = isRelation(object)
  const [expanded, setExpanded] = useState(false)
  const [hasExpanded, setHasExpanded] = useState(false)
  const identityMatches = !needle || matchesIdentity(object, needle)
  const showAllDetails = !needle || identityMatches
  const categoryMatches = {
    columns: Boolean(needle && 'columns'.includes(needle)),
    constraints: Boolean(needle && 'constraints'.includes(needle)),
    indexes: Boolean(needle && 'indexes'.includes(needle)),
    defaults: Boolean(needle && 'defaults'.includes(needle)),
    triggers: Boolean(needle && 'triggers'.includes(needle))
  }
  const matchingColumns = !showAllDetails && !categoryMatches.columns
    ? object.columns.filter((column) => includesText(column.name, needle) || includesText(column.type, needle))
    : object.columns
  const matchingConstraints = !showAllDetails && !categoryMatches.constraints
    ? object.constraints.filter((constraint) => constraintMatches(constraint, needle))
    : object.constraints
  const matchingIndexes = !showAllDetails && !categoryMatches.indexes
    ? object.indexes.filter((index) => indexMatches(index, needle))
    : object.indexes
  const matchingDefaults = !showAllDetails && !categoryMatches.defaults
    ? object.defaults.filter((defaultValue) => defaultMatches(defaultValue, needle))
    : object.defaults
  const attachedTriggers = !showAllDetails && !categoryMatches.triggers
    ? allAttachedTriggers.filter((trigger) => trigger.name.toLowerCase().includes(needle))
    : allAttachedTriggers
  const forcedExpanded = Boolean(needle && !identityMatches && (
    matchingColumns.length > 0
    || matchingConstraints.length > 0
    || matchingIndexes.length > 0
    || matchingDefaults.length > 0
    || attachedTriggers.length > 0
  ))
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
        sx={{ minHeight: SIDEBAR_SIZE.rowHeight, pl: schemaName ? 4.5 : 2.75, pr: 0.75, py: 0, borderRadius: 0.75 }}
      >
        {expandable
          ? open
            ? <ExpandMoreRounded sx={{ fontSize: SIDEBAR_SIZE.chevron, mr: 0.25 }} />
            : <ChevronRightRounded sx={{ fontSize: SIDEBAR_SIZE.chevron, mr: 0.25 }} />
          : <Box sx={{ width: SIDEBAR_SIZE.chevron + 2.25 }} />}
        {categoryIcon(object.type)}
        <ListItemText
          primary={object.name}
          slotProps={{ primary: { variant: 'sidebarItem', noWrap: true, sx: { ml: 0.75 } } }}
        />
        {object.parentName && (
          <Typography variant="sidebarMeta" color="text.disabled" noWrap sx={{ maxWidth: '42%', ml: 0.75 }}>
            on {object.parentName}
          </Typography>
        )}
      </ListItemButton>
      {renderContents && (
        <Box sx={{ display: open ? 'block' : 'none' }}>
          {matchingColumns.length > 0 && (
            <DetailFolder label="Columns" count={object.columns.length} leftPadding={schemaName ? 6.5 : 4.75} forcedExpanded={forcedExpanded && matchingColumns.length > 0}>
              {matchingColumns.map((column) => (
                <DetailEntry
                  key={column.name}
                  leftPadding={schemaName ? 9 : 7.25}
                  icon={column.primaryKey
                    ? <KeyRounded sx={{ fontSize: SIDEBAR_SIZE.detailIcon, mr: 0.6, color: 'primary.main' }} />
                    : <ViewColumnRounded sx={{ fontSize: SIDEBAR_SIZE.detailIcon, mr: 0.6 }} />}
                  name={column.name}
                  label={column.type}
                  hoverDetails={column.type}
                />
              ))}
            </DetailFolder>
          )}
          {matchingConstraints.length > 0 && (
            <DetailFolder label="Constraints" count={object.constraints.length} leftPadding={schemaName ? 6.5 : 4.75} forcedExpanded={forcedExpanded && matchingConstraints.length > 0}>
              {matchingConstraints.map((constraint) => (
                <DetailEntry
                  key={`${constraint.type}:${constraint.name}`}
                  leftPadding={schemaName ? 9 : 7.25}
                  icon={<KeyRounded sx={{ fontSize: SIDEBAR_SIZE.detailIcon, mr: 0.6, color: constraint.type === 'primary-key' ? 'primary.main' : 'text.secondary' }} />}
                  name={constraint.name}
                  metadata={constraintMetadata(constraint)}
                  hoverDetails={constraintHoverDetails(constraint)}
                />
              ))}
            </DetailFolder>
          )}
          {matchingIndexes.length > 0 && (
            <DetailFolder label="Indexes" count={object.indexes.length} leftPadding={schemaName ? 6.5 : 4.75} forcedExpanded={forcedExpanded && matchingIndexes.length > 0}>
              {matchingIndexes.map((index) => (
                <DetailEntry
                  key={index.name}
                  leftPadding={schemaName ? 9 : 7.25}
                  icon={<TableChartRounded sx={{ fontSize: SIDEBAR_SIZE.detailIcon, mr: 0.6 }} />}
                  name={index.name}
                  metadata={indexMetadata(index)}
                  hoverDetails={indexHoverDetails(index)}
                />
              ))}
            </DetailFolder>
          )}
          {matchingDefaults.length > 0 && (
            <DetailFolder label="Defaults" count={object.defaults.length} leftPadding={schemaName ? 6.5 : 4.75} forcedExpanded={forcedExpanded && matchingDefaults.length > 0}>
              {matchingDefaults.map((defaultValue) => (
                <DetailEntry
                  key={`${defaultValue.column}:${defaultValue.name ?? ''}`}
                  leftPadding={schemaName ? 9 : 7.25}
                  icon={<FunctionsRounded sx={{ fontSize: SIDEBAR_SIZE.detailIcon, mr: 0.6 }} />}
                  name={defaultValue.name ?? defaultValue.column}
                  hoverDetails={defaultHoverDetails(defaultValue)}
                />
              ))}
            </DetailFolder>
          )}
          {attachedTriggers.length > 0 && (
            <DetailFolder label="Triggers" count={allAttachedTriggers.length} leftPadding={schemaName ? 6.5 : 4.75} forcedExpanded={forcedExpanded && attachedTriggers.length > 0}>
              {attachedTriggers.map((trigger) => (
                <DetailEntry
                  key={trigger.name}
                  leftPadding={schemaName ? 9 : 7.25}
                  icon={<BoltRounded sx={{ fontSize: SIDEBAR_SIZE.detailIcon, mr: 0.6 }} />}
                  name={trigger.name}
                />
              ))}
            </DetailFolder>
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
      <ListItemButton onClick={toggleExpanded} sx={{ minHeight: SIDEBAR_SIZE.rowHeight, pl: schemaName ? 2.25 : 0.5, pr: 0.75, py: 0, borderRadius: 0.75 }}>
        {open ? <ExpandMoreRounded sx={{ fontSize: SIDEBAR_SIZE.chevron, mr: 0.25 }} /> : <ChevronRightRounded sx={{ fontSize: SIDEBAR_SIZE.chevron, mr: 0.25 }} />}
        {categoryIcon(category)}
        <ListItemText primary={CATEGORY_LABEL[category]} slotProps={{ primary: { variant: 'sidebarSection', sx: { ml: 0.75 } } }} />
        <Typography variant="sidebarMeta" color="text.disabled">{totalCount}</Typography>
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
    if (!isRelation(object)) return false
    const attachedTriggers = schema.triggersByParent.get(object.name) ?? []
    return attachedTriggers.some((trigger) => matchesFilter(trigger, needle))
      || (attachedTriggers.length > 0 && 'triggers'.includes(needle))
  }), [needle, schema, schemaMatches])

  if (needle && filteredObjects.length === 0 && !categoryMatches) return null
  const open = !schema.name || Boolean(needle) || expanded

  return (
    <Box>
      {schema.name && (
        <ListItemButton onClick={() => setExpanded((current) => !current)} sx={{ minHeight: SIDEBAR_SIZE.rowHeight, px: 0.5, py: 0, borderRadius: 0.75 }}>
          {open ? <ExpandMoreRounded sx={{ fontSize: SIDEBAR_SIZE.chevron, mr: 0.25 }} /> : <ChevronRightRounded sx={{ fontSize: SIDEBAR_SIZE.chevron, mr: 0.25 }} />}
          <AccountTreeRounded sx={{ fontSize: SIDEBAR_SIZE.icon, mr: 0.75, color: 'text.secondary' }} />
          <ListItemText primary={schema.name} slotProps={{ primary: { variant: 'sidebarSection', noWrap: true } }} />
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
      <Stack direction="row" sx={{ height: SIDEBAR_SIZE.headerHeight, alignItems: 'center', px: 1.25, flex: '0 0 auto' }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Database Explorer</Typography>
        <Tooltip title="Refresh database objects">
          <span>
            <IconButton size="small" disabled={loading || (provider !== 'sqlite' && !database)} onClick={onRefresh}>
              {loading ? <CircularProgress size={SIDEBAR_SIZE.detailIcon} /> : <RefreshRounded sx={{ fontSize: SIDEBAR_SIZE.icon }} />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <DatabaseObjectFilter key={contextKey} onFilterChange={setNeedle} />
      <Box sx={{ minHeight: 0, flex: 1, overflow: 'auto', px: 0.75, pb: 0.75 }}>
        <Stack direction="row" sx={{ height: SIDEBAR_SIZE.rowHeight, alignItems: 'center', gap: 0.75, px: 0.5 }}>
          <StorageRounded sx={{ fontSize: SIDEBAR_SIZE.icon, color: 'primary.main' }} />
          <Typography variant="sidebarSection" noWrap sx={{ flex: 1 }}>{database ?? 'main'}</Typography>
          <Typography variant="sidebarMeta" color="text.disabled">{objects.length}</Typography>
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
