import {
  Github,
  ExternalLink,
  Heart,
  Bug,
  PlusCircle,
  Lightbulb,
  Shield,
  FileText,
  Twitter,
  Youtube,
  MessageCircle,
  Coffee,
  Scale,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { useGames } from "../hooks/useGames";
import { REPO_OWNER, REPO_NAME } from "../lib/schema";
import { formatNumber } from "../lib/utils";

const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

interface Social {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  handle?: string;
}

const SOCIALS: Social[] = [
  { icon: Twitter, label: "X / Twitter", handle: "@SkullMute0011", href: "https://x.com/SkullMute0011" },
  { icon: Youtube, label: "YouTube", handle: "@SkullMute", href: "https://www.youtube.com/@SkullMute" },
  { icon: MessageCircle, label: "Discord (repo)", handle: "#general", href: "https://discord.gg/2aNR3aVt" },
  { icon: MessageCircle, label: "Discord (game)", handle: "#general", href: "https://discord.gg/kDM9GMu5vm" },
  { icon: Coffee, label: "Patreon / Ko-fi", handle: "skullmute", href: "https://ko-fi.com/skullmute" },
  { icon: ExternalLink, label: "Steam", handle: "Profile", href: "https://steamcommunity.com/profiles/76561199544666292/" },
  { icon: ExternalLink, label: "Bluesky", handle: "@skullmute0011", href: "https://bsky.app/profile/skullmute0011.bsky.social" },
  { icon: ExternalLink, label: "Mastodon", handle: "@skullmute1122", href: "https://mastodon.social/@skullmute1122" },
];

interface Dep {
  name: string;
  role: string;
  href: string;
  /** SPDX identifier — see https://spdx.org/licenses */
  license: string;
  /** Optional direct link to the dep's LICENSE file. */
  licenseHref?: string;
}

const DEPS: Dep[] = [
  { name: "React 18", role: "UI runtime", href: "https://react.dev/", license: "MIT", licenseHref: "https://github.com/facebook/react/blob/main/LICENSE" },
  { name: "TypeScript 5", role: "type system", href: "https://www.typescriptlang.org/", license: "Apache-2.0", licenseHref: "https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt" },
  { name: "Vite 5", role: "build + dev server", href: "https://vitejs.dev/", license: "MIT", licenseHref: "https://github.com/vitejs/vite/blob/main/LICENSE" },
  { name: "Tailwind CSS 3", role: "styling", href: "https://tailwindcss.com/", license: "MIT", licenseHref: "https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE" },
  { name: "Radix UI", role: "headless UI primitives", href: "https://www.radix-ui.com/", license: "MIT", licenseHref: "https://github.com/radix-ui/primitives/blob/main/LICENSE" },
  { name: "TanStack Query", role: "data fetching + caching", href: "https://tanstack.com/query", license: "MIT", licenseHref: "https://github.com/TanStack/query/blob/main/LICENSE" },
  { name: "TanStack Table + Virtual", role: "1.2k-row virtualised table", href: "https://tanstack.com/table", license: "MIT", licenseHref: "https://github.com/TanStack/table/blob/main/LICENSE" },
  { name: "Apache ECharts", role: "treemap / heatmap / wordcloud / …", href: "https://echarts.apache.org/", license: "Apache-2.0", licenseHref: "https://github.com/apache/echarts/blob/master/LICENSE" },
  { name: "echarts-wordcloud", role: "ECharts wordcloud plugin", href: "https://github.com/ecomfe/echarts-wordcloud", license: "BSD-3-Clause", licenseHref: "https://github.com/ecomfe/echarts-wordcloud/blob/master/LICENSE" },
  { name: "OpenPGP.js", role: "client-side commit signing", href: "https://openpgpjs.org/", license: "LGPL-3.0", licenseHref: "https://github.com/openpgpjs/openpgpjs/blob/main/LICENSE" },
  { name: "Workbox + vite-plugin-pwa", role: "service worker + offline cache", href: "https://vite-pwa-org.netlify.app/", license: "MIT", licenseHref: "https://github.com/vite-pwa/vite-plugin-pwa/blob/main/LICENSE" },
  { name: "Zustand", role: "UI/state store", href: "https://zustand-demo.pmnd.rs/", license: "MIT", licenseHref: "https://github.com/pmndrs/zustand/blob/main/LICENSE" },
  { name: "Fuse.js", role: "fuzzy search", href: "https://www.fusejs.io/", license: "Apache-2.0", licenseHref: "https://github.com/krisk/Fuse/blob/main/LICENSE" },
  { name: "cmdk", role: "command palette", href: "https://cmdk.paco.me/", license: "MIT", licenseHref: "https://github.com/pacocoursey/cmdk/blob/main/LICENSE" },
  { name: "lucide-react", role: "icons", href: "https://lucide.dev/", license: "ISC", licenseHref: "https://github.com/lucide-icons/lucide/blob/main/LICENSE" },
  { name: "sonner", role: "toasts", href: "https://sonner.emilkowal.ski/", license: "MIT", licenseHref: "https://github.com/emilkowalski/sonner/blob/main/LICENSE.md" },
  { name: "idb-keyval", role: "IndexedDB wrapper", href: "https://github.com/jakearchibald/idb-keyval", license: "Apache-2.0", licenseHref: "https://github.com/jakearchibald/idb-keyval/blob/main/LICENSE" },
];

const ISSUE_TEMPLATES = [
  { id: "bug_report", label: "Bug report", icon: Bug, color: "text-rose-400" },
  { id: "feature_request", label: "Feature request", icon: Lightbulb, color: "text-amber-400" },
  { id: "add_games", label: "Add games", icon: PlusCircle, color: "text-emerald-400" },
  { id: "delete_game", label: "Delete game", icon: Shield, color: "text-violet-400" },
  { id: "feedback", label: "Feedback", icon: MessageCircle, color: "text-blue-400" },
];

interface LegalDoc {
  label: string;
  path: string;
  hint: string;
}

const LEGAL_DOCS: LegalDoc[] = [
  { label: "MIT License", path: "LICENSE", hint: "the actual binding terms — short and friendly" },
  { label: "Disclaimer", path: "docs/DISCLAIMER.md", hint: "no warranty, accuracy caveats, liability shrug" },
  { label: "Terms of Use", path: "docs/ToS.md", hint: "what you agree to by using the repo / site" },
  { label: "EULA", path: "docs/EULA.md", hint: "redundant with MIT but exists for paranoia" },
  { label: "Privacy Policy", path: "docs/PRIVACY_POLICY.md", hint: "no data collected by the site itself" },
  { label: "Acknowledgements", path: "docs/ACKNOWLEDGEMENTs.md", hint: "credits to AI assistants + contributors" },
  { label: "Contact", path: "docs/Contact.md", hint: "where to find me" },
];

export function AboutPage() {
  const games = useGames();
  const total = games.data?.records.length ?? 0;
  const lastUpdated = games.data?.index.last_updated ?? "";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">About</h1>
        <p className="text-sm text-muted-foreground">
          The repo, the dev, the stack, the legal stuff, and the fine print on
          accuracy.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-4 w-4" /> Repository
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Tracked games" value={formatNumber(total)} />
            <Stat
              label="Data last updated"
              value={lastUpdated ? lastUpdated.slice(0, 16).replace("T", " ") + "Z" : "—"}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            <strong>{REPO_OWNER}/{REPO_NAME}</strong> — a curated, automatically
            refreshed list of free-to-play Steam games. Daily Python pipeline +
            GitHub Actions; this web app sits on top of the same data shards.
            MIT licensed.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                <Github className="mr-1 h-3 w-3" /> GitHub
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`${REPO_URL}/blob/main/games/all-games_part1.md`} target="_blank" rel="noreferrer">
                <FileText className="mr-1 h-3 w-3" /> All games (markdown)
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`${REPO_URL}/blob/main/games/top-online.md`} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-3 w-3" /> Top online (markdown)
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a
                href={`https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/data/data_001.jsonl`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="mr-1 h-3 w-3" /> Raw JSONL (shard 1)
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> Heads-up before
            you trust this
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Genre is best-effort.</strong> The pipeline picks one genre
              per game by reading Steam tags and parsing the description; for
              hybrids and weird indie titles it can be wrong. The
              <em> Edit </em> drawer lets the maintainer fix it manually.
            </li>
            <li>
              <strong>English-language assumption.</strong> The scraper, ingest
              pipeline, and this UI all assume Steam pages and search results
              are in English. Steam regional storefront overrides can break
              parsing — names / genres / DLC counts may end up incorrect for
              non-EN users.
            </li>
            <li>
              <strong>Test data may have leaked in.</strong> While building the
              app, a handful of records were committed as part of testing
              (edits, adds, deletes). They eventually get cleaned up by the
              daily pipeline, but if you spot a row that looks off, file a
              <em> Bug Report</em> issue.
            </li>
            <li>
              <strong>"Unsigned" commits in the activity feed are mine.</strong>{" "}
              Many of those are commits I made while the GPG key wasn't unlocked
              during development; they're not malicious — just a lock-state
              artefact, not signed.
            </li>
            <li>
              <strong>This is not a Valve / Steam product.</strong> Independent
              project, no affiliation, no support contract.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" /> AI disclosure
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            About <strong>~70 %</strong> of the code in this repository was
            generated with the help of large-language-model assistants:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Grok</strong> — initial v1 Python pipeline (~2025).
            </li>
            <li>
              <strong>Claude</strong> — v2 refactor, the Python data layer, this
              entire web app, the GPG signing path, the legal docs you're
              reading, and most of the recent commits.
            </li>
          </ul>
          <p>
            Generated code is reviewed and tested before each commit, but
            mistakes happen — especially in subtle areas like commit-bytes
            formatting (which we got wrong twice before fixing in 4.1) and
            CDN-cache invalidation (fixed in 6.2). Please file an issue if you
            see something off.
          </p>
          <p>
            No user data is sent to any LLM at runtime. The only AI calls
            happen on my dev machine while I'm writing code, never from your
            browser.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-rose-400" /> Maintained by SkullMute
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            One Vietnamese dev (poli0981 / SkullMute), running this in spare
            time. Hit me up on any of these if something is broken or you want
            to chat:
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <s.icon className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{s.label}</div>
                  {s.handle && (
                    <div className="truncate text-xs text-muted-foreground">{s.handle}</div>
                  )}
                </div>
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4" /> Report something
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Issue templates pre-fill labels and required fields so I can triage
            faster.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ISSUE_TEMPLATES.map((t) => (
              <a
                key={t.id}
                href={`${REPO_URL}/issues/new?template=${t.id}.yml`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <t.icon className={"h-4 w-4 " + t.color} />
                <span className="flex-1 font-medium">{t.label}</span>
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4" /> Legal &amp; license
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The whole repo (data, code, docs, this web app) is{" "}
            <a
              href={`${REPO_URL}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              MIT-licensed
            </a>
            . Everything below is supplemental — the MIT terms still govern.
          </p>
          <ul className="space-y-1.5">
            {LEGAL_DOCS.map((d) => (
              <li
                key={d.path}
                className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
              >
                <a
                  href={`${REPO_URL}/blob/main/${d.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:text-primary"
                >
                  {d.label}
                </a>
                <span className="ml-2 truncate text-xs text-muted-foreground">
                  {d.hint}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> Stack &amp; third-party
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            All third-party libraries used by this app, with their SPDX licence
            identifiers. The Python pipeline relies on <code>requests</code> +{" "}
            <code>urllib3</code> only (both Apache-2.0).
          </p>
          <ul className="space-y-1.5">
            {DEPS.map((d) => (
              <li
                key={d.name}
                className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm"
              >
                <a
                  href={d.href}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate font-medium hover:text-primary"
                >
                  {d.name}
                </a>
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                  {d.role}
                </span>
                {d.licenseHref ? (
                  <a
                    href={d.licenseHref}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0"
                    title={`${d.license} licence`}
                  >
                    <Badge variant="outline" className="font-mono">
                      {d.license}
                    </Badge>
                  </a>
                ) : (
                  <Badge variant="outline" className="shrink-0 font-mono">
                    {d.license}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          <Separator />
          <div className="text-xs text-muted-foreground">
            Steam, Steam Store, Steam Community, and the Steam logo are
            trademarks of Valve Corporation. This site is not affiliated with
            Valve.
            <br />
            Steam header images served from Akamai (
            <code>shared.akamai.steamstatic.com</code>). Public-key search for
            commit verification uses <code>api.github.com</code>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <Badge variant="secondary">{label}</Badge>
      <div className="mt-1 truncate text-xl font-semibold">{value}</div>
    </div>
  );
}
