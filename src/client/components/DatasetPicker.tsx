import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import type { DatasetSummary } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TruncatedText } from './TruncatedText'

interface Props {
  value: { id: string; name: string } | null
  loading?: boolean
  onSelect: (id: string) => void
}

export function DatasetPicker({ value, loading, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<DatasetSummary[]>([])
  const [searching, setSearching] = useState(false)

  // Runs on mount too, so the default list is ready before the dropdown is first opened.
  useEffect(() => {
    const ctrl = new AbortController()
    setSearching(true) // show the indicator immediately, including during the debounce
    const t = setTimeout(async () => {
      try {
        setResults(await api.datasets(q, ctrl.signal))
      } catch {
        /* aborted or failed; keep previous results */
      } finally {
        if (!ctrl.signal.aborted) setSearching(false)
      }
    }, q ? 120 : 0)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <TruncatedText
            text={loading ? 'Loading dataset…' : (value?.name ?? 'Choose a dataset…')}
            className={cn('min-w-0 flex-1 text-left', !value && 'text-muted-foreground')}
          />
          {loading ? <Loader2 className="size-4 animate-spin opacity-60" /> : <ChevronsUpDown className="size-4 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search data.wa.gov datasets…" value={q} onValueChange={setQ} />
          <CommandList>
            {searching && (
              <div className="text-muted-foreground flex items-center gap-2 border-b px-3 py-2 text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Searching data.wa.gov…
              </div>
            )}
            {!searching && <CommandEmpty>No datasets found.</CommandEmpty>}
            <CommandGroup className={cn('transition-opacity', searching && 'opacity-50')}>
              {results.map((d) => (
                <CommandItem
                  key={d.id}
                  value={d.id}
                  onSelect={() => {
                    onSelect(d.id)
                    setOpen(false)
                  }}
                  className="items-start"
                >
                  <Check className={cn('mt-0.5 size-4', value?.id === d.id ? 'opacity-100' : 'opacity-0')} />
                  <div className="min-w-0 flex-1">
                    <TruncatedText text={d.name} className="font-medium" />
                    <div className="text-muted-foreground line-clamp-1 text-xs">
                      {d.category ? `${d.category} · ` : ''}
                      {d.description || 'No description'}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
