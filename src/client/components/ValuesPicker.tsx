import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import type { ColumnProfile, DistinctValue } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  datasetId: string
  column: ColumnProfile
  selected: string[]
  onChange: (values: string[]) => void
}

/**
 * Searchable multi-select of a column's distinct values.
 * Small columns (fully covered by the profile's top values) load instantly;
 * larger ones search the server as you type.
 */
export function ValuesPicker({ datasetId, column, selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const complete = (column.cardinality ?? Infinity) <= column.topValues.length
  const [options, setOptions] = useState<DistinctValue[]>(complete ? column.topValues : [])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || complete) return
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        setOptions(await api.values(datasetId, column.fieldName, q, ctrl.signal))
      } catch {
        /* aborted */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, 200)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [open, q, complete, datasetId, column.fieldName])

  const visible = complete && q ? options.filter((o) => o.value.toLowerCase().includes(q.toLowerCase())) : options
  // Keep selected values visible even when they aren't in the current search results.
  const extra = selected.filter((s) => !visible.some((o) => o.value === s)).map((value) => ({ value, count: NaN }))
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between font-normal">
          <span className={cn('truncate', selected.length === 0 && 'text-muted-foreground')}>
            {selected.length === 0 ? 'Choose values…' : selected.length === 1 ? selected[0] : `${selected.length} selected`}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={`Search ${column.label.toLowerCase()}…`} value={q} onValueChange={setQ} />
          <CommandList>
            {loading && visible.length === 0 ? (
              <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
                <Loader2 className="size-4 animate-spin" /> Loading values…
              </div>
            ) : (
              <CommandEmpty>No matching values.</CommandEmpty>
            )}
            <CommandGroup>
              {[...extra, ...visible].map((o) => (
                <CommandItem key={o.value} value={o.value} onSelect={() => toggle(o.value)}>
                  <Check className={cn('size-4', selected.includes(o.value) ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex-1 truncate">{o.value}</span>
                  {Number.isFinite(o.count) && <span className="text-muted-foreground text-xs">{o.count.toLocaleString()}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="flex justify-end border-t p-1.5">
            <Button variant="ghost" size="sm" onClick={() => onChange([])}>
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
