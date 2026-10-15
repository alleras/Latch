export interface CellPosition {
  rowIndex: number
  columnIndex: number
}

export interface SelectionModifiers {
  extend: boolean
  additive: boolean
}

export function cellSelectionKey(position: CellPosition): string {
  return `${position.rowIndex}:${position.columnIndex}`
}

export function selectCells(
  current: Set<string>,
  anchor: CellPosition | null,
  target: CellPosition,
  modifiers: SelectionModifiers
): Set<string> {
  if (!modifiers.extend || !anchor) {
    if (!modifiers.additive) return new Set([cellSelectionKey(target)])
    const next = new Set(current)
    const key = cellSelectionKey(target)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  }

  const next = modifiers.additive ? new Set(current) : new Set<string>()
  const firstRow = Math.min(anchor.rowIndex, target.rowIndex)
  const lastRow = Math.max(anchor.rowIndex, target.rowIndex)
  const firstColumn = Math.min(anchor.columnIndex, target.columnIndex)
  const lastColumn = Math.max(anchor.columnIndex, target.columnIndex)

  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    for (let columnIndex = firstColumn; columnIndex <= lastColumn; columnIndex += 1) {
      next.add(cellSelectionKey({ rowIndex, columnIndex }))
    }
  }
  return next
}

export function selectRows(
  current: Set<number>,
  anchor: number | null,
  target: number,
  modifiers: SelectionModifiers
): Set<number> {
  if (!modifiers.extend || anchor === null) {
    if (!modifiers.additive) return new Set([target])
    const next = new Set(current)
    next.has(target) ? next.delete(target) : next.add(target)
    return next
  }

  const next = modifiers.additive ? new Set(current) : new Set<number>()
  const firstRow = Math.min(anchor, target)
  const lastRow = Math.max(anchor, target)
  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) next.add(rowIndex)
  return next
}

export function selectedCellPositions(selection: Set<string>): CellPosition[] {
  return [...selection]
    .map((key) => {
      const [rowIndex, columnIndex] = key.split(':').map(Number)
      return { rowIndex, columnIndex }
    })
    .sort((left, right) => left.rowIndex - right.rowIndex || left.columnIndex - right.columnIndex)
}
