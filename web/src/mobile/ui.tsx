import { useRef, type ComponentProps, type ReactNode } from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("m-button inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mobile-ring disabled:cursor-not-allowed disabled:opacity-50", {
  variants: {
    variant: {
      primary: "border-mobile-primary bg-mobile-primary text-mobile-primary-foreground",
      secondary: "border-mobile-border bg-mobile-secondary text-mobile-foreground",
      outline: "border-mobile-border bg-mobile-card text-mobile-foreground",
      ghost: "border-transparent bg-transparent text-mobile-foreground",
      destructive: "border-mobile-destructive bg-mobile-destructive text-mobile-destructive-foreground",
    },
    size: { default: "px-4", icon: "size-11 p-0", compact: "px-3" },
  },
  defaultVariants: { variant: "secondary", size: "default" },
});

export function Button({ variant, size, className, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("m-card", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn("m-input", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn("m-textarea", className)} {...props} />;
}

export function Avatar({ src, name, className }: { src?: string; name: string; className?: string }) {
  return <AvatarPrimitive.Root className={cn("m-avatar", className)}>
    {src && <AvatarPrimitive.Image src={src} alt="" className="m-avatar" />}
    <AvatarPrimitive.Fallback className="m-avatar-fallback" aria-hidden="true">{name.slice(0, 1)}</AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>;
}

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("m-badge", className)} {...props} />;
}

export function Skeleton({ className, ...props }: ComponentProps<"span">) {
  return <span aria-hidden="true" className={cn("m-skeleton", className)} {...props} />;
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={400}><TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Content side="bottom" className="m-tooltip">{label}</TooltipPrimitive.Content>
  </TooltipPrimitive.Root></TooltipPrimitive.Provider>;
}

function Modal({ open, onClose, label, className, children }: {
  open: boolean; onClose: () => void; label: string; className: string; children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  return <DialogPrimitive.Root open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <DialogPrimitive.Portal container={document.querySelector<HTMLElement>(".m-shell") || undefined}>
      <DialogPrimitive.Overlay className="m-modal-overlay" />
      <DialogPrimitive.Content ref={content} tabIndex={-1} onOpenAutoFocus={event => { event.preventDefault(); content.current?.focus(); }} className={cn("m-modal", className)} aria-describedby={undefined}>
        <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

export function Sheet(props: Omit<ComponentProps<typeof Modal>, "className">) {
  return <Modal {...props} className="m-activity" />;
}

export function Dialog(props: Omit<ComponentProps<typeof Modal>, "className">) {
  return <Modal {...props} className="m-dialog-body" />;
}
