<script lang="ts" module>
  import { cva, type VariantProps } from "class-variance-authority";

  export const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
      "transition-colors disabled:pointer-events-none disabled:opacity-50",
    {
      variants: {
        variant: {
          default: "bg-primary text-primary-foreground hover:bg-primary/90",
          destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
          secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          ghost: "hover:bg-accent hover:text-accent-foreground",
          link: "text-primary underline-offset-4 hover:underline",
        },
        size: {
          default: "h-9 px-4 py-2",
          sm: "h-8 rounded-md px-3 text-xs",
          lg: "h-10 rounded-md px-6",
          icon: "h-9 w-9",
        },
      },
      defaultVariants: { variant: "default", size: "default" },
    },
  );

  export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
  export type ButtonSize = VariantProps<typeof buttonVariants>["size"];
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { cn } from "../utils";

  // `href` replaces Radix's asChild. Rendering an <a> when there is an href and
  // a <button> otherwise is the whole of what asChild was used for here, and it
  // keeps the element semantically correct without a slot-merging abstraction.
  type Props = {
    class?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    href?: string;
    children: Snippet;
  } & Omit<HTMLButtonAttributes & HTMLAnchorAttributes, "class" | "size">;

  let { class: className, variant, size, href, children, ...rest }: Props = $props();
</script>

{#if href}
  <a {href} class={cn(buttonVariants({ variant, size }), className)} {...rest}>
    {@render children()}
  </a>
{:else}
  <button class={cn(buttonVariants({ variant, size }), className)} {...rest}>
    {@render children()}
  </button>
{/if}
