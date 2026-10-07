"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ClearFiltersButtonProps {
  onClear: () => void;
  disabled?: boolean;
  className?: string;
}

export function ClearFiltersButton({ onClear, disabled, className }: ClearFiltersButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClear}
      disabled={disabled}
      className={cn("shrink-0 px-3 text-slate", className)}
    >
      <X className="h-3.5 w-3.5" aria-hidden />
      Clear filters
    </Button>
  );
}
