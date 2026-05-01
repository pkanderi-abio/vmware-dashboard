import * as React from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

interface CommandSearchProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  placeholder?: string
  className?: string
}

// Custom hook to manage command search state
export function useCommandSearch() {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
      if (e.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return { open, setOpen }
}

export function CommandSearch({
  open,
  onOpenChange,
  onClose,
  placeholder = "Search...",
  className,
}: CommandSearchProps) {
  const [searchQuery, setSearchQuery] = React.useState("")

  const handleOpenChange = (newOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(newOpen)
    }
    if (!newOpen && onClose) {
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn("p-0 overflow-hidden max-w-lg", className)}>
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="p-1 hover:bg-muted rounded"
            >
              <X className="h-4 w-4 opacity-50" />
            </button>
          )}
        </div>
        <div className="max-h-[300px] overflow-y-auto p-2">
          {searchQuery ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              <p>No results found for "{searchQuery}"</p>
              <p className="text-xs mt-1">Try searching for VMs, hosts, or datastores</p>
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground text-center">
              <p>Type to search...</p>
              <p className="text-xs mt-1">Press <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Esc</kbd> to close</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CommandSearch