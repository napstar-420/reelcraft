import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,background-color,color,border-color,box-shadow] duration-150 ease-[var(--ease-out)] outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** The one main action on a surface: white on dark, black on light. */
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        outline:
          'border-line-strong bg-transparent text-foreground hover:bg-surface-2 aria-expanded:bg-surface-2',
        secondary: 'bg-surface-3 text-foreground hover:bg-surface-3/70 aria-expanded:bg-surface-3',
        ghost:
          'text-muted-foreground hover:bg-surface-2 hover:text-foreground aria-expanded:bg-surface-2 aria-expanded:text-foreground',
        /** Anything the assistant does. */
        accent: 'bg-acc text-acc-foreground hover:bg-acc/85',
        destructive:
          'bg-bad-soft text-bad hover:bg-bad/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        /** A confirmed, irreversible action. */
        danger: 'bg-bad text-white hover:bg-bad/85',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-9 gap-2 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[30px] gap-1.5 rounded-lg px-2.5 text-[13px] [&_svg:not([class*='size-'])]:size-[15px]",
        lg: 'h-10 gap-2 px-4',
        icon: 'size-9',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': "size-[30px] rounded-lg [&_svg:not([class*='size-'])]:size-[15px]",
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean;
    }
>(({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
});
Button.displayName = 'Button';

export { Button, buttonVariants };
