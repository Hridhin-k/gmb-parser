"use client"

import { format, parseISO } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function DatePicker({
  value,
  onChange,
  disabled,
  label,
  min,
  max,
  className,
}: {
  value: string
  onChange: (isoDay: string) => void
  disabled?: boolean
  label: string
  min?: string
  max?: string
  className?: string
}) {
  const selected = value ? parseISO(`${value}T00:00:00Z`) : undefined

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn("h-10 justify-start rounded-lg px-3 font-normal", className)}
          />
        }
      >
        <CalendarIcon className="text-slate" />
        {selected ? format(selected, "d MMM yyyy") : label}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(day) => {
            if (day instanceof Date) onChange(format(day, "yyyy-MM-dd"))
          }}
          disabled={(date) => {
            const day = format(date, "yyyy-MM-dd")
            if (min && day < min) return true
            if (max && day > max) return true
            return false
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
