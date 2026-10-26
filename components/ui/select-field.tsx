"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const EMPTY = "__empty__"

export function SelectField({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder = "Select",
  disabled,
  className,
  size = "default",
}: {
  id?: string
  label: string
  value: string
  onValueChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  disabled?: boolean
  className?: string
  size?: "sm" | "default"
}) {
  const items = options.map((option) => ({
    label: option.label,
    itemValue: option.value === "" ? EMPTY : option.value,
  }))
  const current = value === "" ? EMPTY : value

  return (
    <Select
      items={items.map((item) => ({ value: item.itemValue, label: item.label }))}
      value={items.some((item) => item.itemValue === current) ? current : null}
      onValueChange={(next, details) => {
        // Opening the menu registers items one at a time. Until the current
        // value is in that list, the select reports null. Keep the controlled value.
        if (next == null) {
          details.cancel()
          return
        }
        const raw = typeof next === "string" ? next : ""
        onValueChange(raw === EMPTY ? "" : raw)
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} size={size} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((option) => (
          <SelectItem key={option.itemValue} value={option.itemValue}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
