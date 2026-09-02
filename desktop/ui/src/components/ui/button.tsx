import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-oklch(0.705 0.015 286.067) focus-visible:ring-[3px] focus-visible:ring-oklch(0.705 0.015 286.067)/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-oklch(0.577 0.245 27.325) aria-invalid:ring-oklch(0.577 0.245 27.325)/20 dark:aria-invalid:ring-oklch(0.577 0.245 27.325)/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 dark:focus-visible:border-oklch(0.552 0.016 285.938) dark:focus-visible:ring-oklch(0.552 0.016 285.938)/50 dark:aria-invalid:border-oklch(0.704 0.191 22.216) dark:aria-invalid:ring-oklch(0.704 0.191 22.216)/20 dark:dark:aria-invalid:ring-oklch(0.704 0.191 22.216)/40",
  {
    variants: {
      variant: {
        default: "bg-oklch(0.21 0.006 285.885) text-oklch(0.985 0 0) hover:bg-oklch(0.21 0.006 285.885)/90 dark:bg-oklch(0.92 0.004 286.32) dark:text-oklch(0.21 0.006 285.885) dark:hover:bg-oklch(0.92 0.004 286.32)/90",
        destructive:
          "bg-oklch(0.577 0.245 27.325) text-white hover:bg-oklch(0.577 0.245 27.325)/90 focus-visible:ring-oklch(0.577 0.245 27.325)/20 dark:bg-oklch(0.577 0.245 27.325)/60 dark:focus-visible:ring-oklch(0.577 0.245 27.325)/40 dark:bg-oklch(0.704 0.191 22.216) dark:hover:bg-oklch(0.704 0.191 22.216)/90 dark:focus-visible:ring-oklch(0.704 0.191 22.216)/20 dark:dark:bg-oklch(0.704 0.191 22.216)/60 dark:dark:focus-visible:ring-oklch(0.704 0.191 22.216)/40",
        outline:
          "border bg-oklch(1 0 0) shadow-xs hover:bg-oklch(0.967 0.001 286.375) hover:text-oklch(0.21 0.006 285.885) dark:border-oklch(0.92 0.004 286.32) dark:bg-oklch(0.92 0.004 286.32)/30 dark:hover:bg-oklch(0.92 0.004 286.32)/50 dark:bg-oklch(0.141 0.005 285.823) dark:hover:bg-oklch(0.274 0.006 286.033) dark:hover:text-oklch(0.985 0 0) dark:dark:border-oklch(1 0 0 / 15%) dark:dark:bg-oklch(1 0 0 / 15%)/30 dark:dark:hover:bg-oklch(1 0 0 / 15%)/50",
        secondary:
          "bg-oklch(0.967 0.001 286.375) text-oklch(0.21 0.006 285.885) hover:bg-oklch(0.967 0.001 286.375)/80 dark:bg-oklch(0.274 0.006 286.033) dark:text-oklch(0.985 0 0) dark:hover:bg-oklch(0.274 0.006 286.033)/80",
        ghost:
          "hover:bg-oklch(0.967 0.001 286.375) hover:text-oklch(0.21 0.006 285.885) dark:hover:bg-oklch(0.967 0.001 286.375)/50 dark:hover:bg-oklch(0.274 0.006 286.033) dark:hover:text-oklch(0.985 0 0) dark:dark:hover:bg-oklch(0.274 0.006 286.033)/50",
        link: "text-oklch(0.21 0.006 285.885) underline-offset-4 hover:underline dark:text-oklch(0.92 0.004 286.32)",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
