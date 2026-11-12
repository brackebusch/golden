import { Plus, X } from 'lucide-react'
import type { ColumnProfile, DatasetProfile } from '@shared/types'
import type { Filter } from '@shared/querySpec'
import { columnLabel } from '@shared/describe'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RevealList } from './Reveal'
import { ValuesPicker } from './ValuesPicker'

interface Props {
  profile: DatasetProfile
  filters: Filter[]
  onChange: (filters: Filter[]) => void
}

/** Columns with few enough values get a value picker; other numeric columns get a range. */
const usesValues = (c: ColumnProfile) => c.kinds.includes('category')

function newFilter(c: ColumnProfile): Filter {
  if (usesValues(c)) return { op: 'in', column: c.fieldName, values: [] }
  if (c.kinds.includes('number')) return { op: 'range', column: c.fieldName, min: null, max: null }
  return { op: 'contains', column: c.fieldName, value: '' }
}

export function FilterSection({ profile, filters, onChange }: Props) {
  const columns = profile.columns.filter((c) => !c.hidden)
  const set = (i: number, f: Filter) => onChange(filters.map((x, j) => (j === i ? f : x)))
  const remove = (i: number) => onChange(filters.filter((_, j) => j !== i))
  const rollups = filters.map((f, i) => ({ f, i })).filter(({ f }) => f.op === 'not_in' && f.rollup)
  const regular = filters.map((f, i) => ({ f, i })).filter(({ f }) => !(f.op === 'not_in' && f.rollup))
  // Stable keys (column + occurrence) so removing one filter collapses that card, not the last one.
  const seen = new Map<string, number>()
  const keyOf = (f: Filter) => {
    const n = seen.get(f.column) ?? 0
    seen.set(f.column, n + 1)
    return `${f.column}#${n}`
  }

  return (
    <div>
      {rollups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {rollups.map(({ f, i }) => (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                  Excluding {f.op === 'not_in' ? f.values.join(', ') : ''} ({columnLabel(profile, f.column)})
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="hover:bg-muted-foreground/20 rounded-sm p-0.5"
                    aria-label="Remove filter"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                These rows summarize other rows. Including them can double count. Remove this chip to include them.
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}

      <RevealList
        className="pb-2"
        items={regular.flatMap(({ f, i }) => {
          const c = profile.columns.find((x) => x.fieldName === f.column)
          if (!c) return []
          return [
            {
              key: keyOf(f),
              node: (
                <div className="bg-muted/40 space-y-1.5 rounded-md border p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="flex-1 truncate text-xs font-medium">{c.label}</span>
                    {(f.op === 'in' || f.op === 'not_in') && (
                      <Select
                        value={f.op}
                        onValueChange={(op) =>
                          set(i, {
                            op: op as 'in' | 'not_in',
                            column: f.column,
                            values: f.values,
                          })
                        }
                      >
                        <SelectTrigger size="sm" className="h-7 w-[84px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in">is</SelectItem>
                          <SelectItem value="not_in">is not</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => remove(i)} aria-label="Remove filter">
                      <X className="size-3.5" />
                    </Button>
                  </div>
                  {(f.op === 'in' || f.op === 'not_in') && (
                    <ValuesPicker datasetId={profile.id} column={c} selected={f.values} onChange={(values) => set(i, { ...f, values })} />
                  )}
                  {f.op === 'range' && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        className="h-8"
                        placeholder={c.min ? `Min (${Number(c.min).toLocaleString()})` : 'Min'}
                        value={f.min ?? ''}
                        onChange={(e) =>
                          set(i, {
                            ...f,
                            min: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                      <span className="text-muted-foreground text-xs">to</span>
                      <Input
                        type="number"
                        className="h-8"
                        placeholder={c.max ? `Max (${Number(c.max).toLocaleString()})` : 'Max'}
                        value={f.max ?? ''}
                        onChange={(e) =>
                          set(i, {
                            ...f,
                            max: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  )}
                  {f.op === 'contains' && (
                    <Input
                      className="h-8"
                      placeholder="Contains…"
                      value={f.value}
                      onChange={(e) => set(i, { ...f, value: e.target.value })}
                    />
                  )}
                </div>
              ),
            },
          ]
        })}
      />

      <Select
        value=""
        onValueChange={(field) => {
          const c = columns.find((x) => x.fieldName === field)
          if (c) onChange([...filters, newFilter(c)])
        }}
      >
        <SelectTrigger size="sm" className="text-muted-foreground w-full border-dashed">
          <span className="flex items-center gap-1.5">
            <Plus className="size-3.5" /> Add filter
          </span>
        </SelectTrigger>
        <SelectContent>
          {columns.map((c) => (
            <SelectItem key={c.fieldName} value={c.fieldName}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
