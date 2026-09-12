<!--
  TEMPORARY scaffold specimen.

  Replaced by the real Dashboard as the port proceeds. It exists so the design
  tokens and the three fonts can be verified in a browser before any page is
  built on top of them - in particular that IBM Plex Sans really does have
  tabular figures, which is the reason it was chosen for the 3,400-row table
  and was flagged in the plan as "verify before committing to it".
-->
<svelte:head>
  <title>Scaffold specimen</title>
</svelte:head>

<div class="container space-y-10 py-10">
  <header class="space-y-2">
    <h1 class="text-4xl font-semibold">Bricolage Grotesque — display</h1>
    <p class="max-w-2xl text-muted-foreground">
      Body text is IBM Plex Sans. Phiêu lưu, nhập vai, chiến thuật — the
      Vietnamese subset has to render, because <code>vi</code> is a shipped locale.
    </p>
  </header>

  <section class="space-y-3">
    <h2 class="text-xl font-semibold">Tabular figures</h2>
    <p class="text-sm text-muted-foreground">
      The rows must align. If the left column is ragged, IBM Plex Sans is not
      applying <code>tnum</code> and the table needs a different face.
    </p>
    <div class="grid max-w-md grid-cols-2 gap-x-8 rounded-lg border bg-card p-4">
      <div>
        <div class="mb-1 text-xs text-muted-foreground">tabular (tnum)</div>
        <div class="tnum space-y-0.5">
          <div>1,111,111</div>
          <div>492,197</div>
          <div>88,888</div>
          <div>10</div>
        </div>
      </div>
      <div>
        <div class="mb-1 text-xs text-muted-foreground">proportional</div>
        <div class="space-y-0.5">
          <div>1,111,111</div>
          <div>492,197</div>
          <div>88,888</div>
          <div>10</div>
        </div>
      </div>
    </div>
  </section>

  <section class="space-y-3">
    <h2 class="text-xl font-semibold">JetBrains Mono — numeric / code</h2>
    <p class="font-mono text-sm">appid 730 · 86% (Very Positive) · 0123456789</p>
  </section>

  <section class="space-y-3">
    <h2 class="text-xl font-semibold">Tokens</h2>
    <div class="flex flex-wrap gap-2">
      {#each ["bg-background", "bg-card", "bg-surface-2", "bg-muted", "bg-accent", "bg-secondary"] as c (c)}
        <div class="rounded-md border px-3 py-6 text-xs {c}">{c}</div>
      {/each}
    </div>
    <div class="flex flex-wrap gap-2">
      {#each ["bg-primary text-primary-foreground", "bg-destructive text-destructive-foreground", "bg-success text-white", "bg-warning text-black", "bg-info text-white"] as c (c)}
        <div class="rounded-md px-3 py-6 text-xs {c}">{c.split(" ")[0]}</div>
      {/each}
    </div>
    <p class="text-sm">
      Opacity modifiers must still resolve through <code>color-mix()</code>:
      <span class="rounded bg-primary/15 px-2 py-1 text-primary">bg-primary/15</span>
    </p>
  </section>
</div>
