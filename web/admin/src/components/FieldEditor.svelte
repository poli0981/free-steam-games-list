<!-- One manual field's control. The genre list carries counts because they are
     how a vague bucket gets noticed. -->
<script lang="ts">
  import type { FieldSpec } from "../lib/fields";

  type Props = {
    spec: FieldSpec;
    value: string;
    id: string;
    disabled?: boolean;
    invalid?: boolean;
    genres?: { genre: string; count: number }[];
    /** The value the field held when loaded, kept selectable even when unusual. */
    current?: string;
  };
  let { spec, value = $bindable(), id, disabled = false, invalid = false, genres = [], current = "" }: Props = $props();

  const base =
    "w-full rounded-md border bg-background px-3 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50";
  const border = $derived(invalid ? "border-destructive" : "border-input");
  const extra = $derived(
    spec.options && current && !spec.options.some((o) => o.value === current) ? current : null,
  );
</script>

{#if spec.kind === "genre"}
  <input
    {id}
    bind:value
    type="text"
    list="{id}-list"
    maxlength="500"
    autocomplete="off"
    {disabled}
    aria-invalid={invalid}
    class="{base} {border} h-9"
  />
  <datalist id="{id}-list">
    {#each genres as g (g.genre)}
      <option value={g.genre}>{g.count} games</option>
    {/each}
  </datalist>
{:else if spec.kind === "select"}
  <select {id} bind:value {disabled} aria-invalid={invalid} class="{base} {border} h-9">
    {#if extra !== null}
      <option value={extra}>{extra} (current, not a valid choice)</option>
    {/if}
    {#each spec.options ?? [] as o (o.value)}
      <option value={o.value}>{o.label}</option>
    {/each}
  </select>
{:else if spec.kind === "area"}
  <textarea {id} bind:value rows="3" maxlength="500" {disabled} aria-invalid={invalid} class="{base} {border} py-2 leading-5"
  ></textarea>
{:else}
  <input {id} bind:value type="text" maxlength="500" autocomplete="off" {disabled} aria-invalid={invalid} class="{base} {border} h-9" />
{/if}
