<script lang="ts" module>
  import { cva, type VariantProps } from "class-variance-authority";

  // success and warning previously used raw Tailwind palette classes
  // (bg-emerald-500/15 text-emerald-400, bg-amber-500/15 text-amber-400) while
  // --success and --warning tokens existed and went unused. That meant a
  // palette change moved everything EXCEPT the two badges that carry meaning.
  export const badgeVariants = cva(
    "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
    {
      variants: {
        variant: {
          default: "border-transparent bg-primary/15 text-primary",
          secondary: "border-transparent bg-secondary text-secondary-foreground",
          destructive: "border-transparent bg-destructive/15 text-destructive",
          outline: "text-foreground",
          success: "border-transparent bg-success/15 text-success",
          warning: "border-transparent bg-warning/15 text-warning",
          info: "border-transparent bg-info/15 text-info",
        },
      },
      defaultVariants: { variant: "default" },
    },
  );

  export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "../utils";

  type Props = {
    class?: string;
    variant?: BadgeVariant;
    children: Snippet;
  } & Omit<HTMLAttributes<HTMLSpanElement>, "class">;

  let { class: className, variant, children, ...rest }: Props = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)} {...rest}>{@render children()}</span>
