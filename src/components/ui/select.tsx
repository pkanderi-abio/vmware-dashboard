import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}

interface SelectContextType {
  value?: string;
  onValueChange?: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SelectContext = React.createContext<SelectContextType | undefined>(undefined);

const Select: React.FC<SelectProps> = ({ value, onValueChange, children }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}>
      {/* Added relative here so SelectContent absolute positioning works correctly */}
      <div className="relative w-full md:w-auto inline-block">
        {children}
      </div>
    </SelectContext.Provider>
  );
};

const SelectTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => {
    const ctx = React.useContext(SelectContext);
    return (
      <button
        ref={ref}
        type="button"
        onClick={() => ctx?.setOpen(!ctx?.open)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 opacity-50 ml-2" />
      </button>
    );
  }
);
SelectTrigger.displayName = "SelectTrigger";

const SelectValue: React.FC<{ placeholder?: string }> = ({ placeholder }) => {
  const ctx = React.useContext(SelectContext);
  return <span>{ctx?.value || placeholder}</span>;
};

// NEW: Interface to support the 'align' prop
interface SelectContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end";
}

const SelectContent: React.FC<SelectContentProps> = ({ 
  className, 
  children, 
  align = "start", 
  ...props 
}) => {
  const ctx = React.useContext(SelectContext);
  if (!ctx?.open) return null;

  return (
    <>
      {/* Backdrop to close when clicking outside */}
      <div className="fixed inset-0 z-40" onClick={() => ctx.setOpen(false)} />
      
      <div
        className={cn(
          "absolute z-50 mt-1 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
          // If align is end, pin to right. Otherwise, pin to left.
          align === "end" ? "right-0" : "left-0",
          className
        )}
        {...props}
      >
        <div className="p-1">
          {children}
        </div>
      </div>
    </>
  );
};

const SelectItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { value: string }>(
  ({ className, children, value, ...props }, ref) => {
    const ctx = React.useContext(SelectContext);
    return (
      <div
        ref={ref}
        onClick={() => {
          ctx?.onValueChange?.(value);
          ctx?.setOpen(false);
        }}
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          ctx?.value === value && "bg-accent text-accent-foreground",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
SelectItem.displayName = "SelectItem";

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };