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
}

const DEPS: Dep[] = [
  { name: "React 18", role: "UI runtime", href: "https://react.dev/" },
  { name: "TypeScript 5", role: "type system", href: "https://www.typescriptlang.org/" },
  { name: "Vite 5", role: "build + dev server", href: "https://vitejs.dev/" },
  { name: "Tailwind CSS 3", role: "styling", href: "https://tailwindcss.com/" },
  { name: "shadcn/ui (Radix)", role: "UI primitives", href: "https://ui.shadcn.com/" },
  { name: "TanStack Query", role: "data fetching + caching", href: "https://tanstack.com/query" },
  { name: "TanStack Table + Virtual", role: "1.2k-row virtualised table", href: "https://tanstack.com/table" },
  { name: "Apache ECharts", role: "charts (treemap / heatmap / wordcloud / …)", href: "https://echarts.apache.org/" },
  { name: "OpenPGP.js", role: "client-side commit signing", href: "https://openpgpjs.org/" },
  { name: "Workbox + vite-plugin-pwa", role: "service worker + offline cache", href: "https://vite-pwa-org.netlify.app/" },
  { name: "Zustand", role: "UI/state store", href: "https://zustand-demo.pmnd.rs/" },
  { name: "Fuse.js", role: "fuzzy search", href: "https://www.fusejs.io/" },
  { name: "cmdk", role: "command palette", href: "https://cmdk.paco.me/" },
  { name: "lucide-react", role: "icons", href: "https://lucide.dev/" },
  { name: "sonner", role: "toasts", href: "https://sonner.emilkowal.ski/" },
];

const ISSUE_TEMPLATES = [
  { id: "bug_report", label: "Bug report", icon: Bug, color: "text-rose-400" },
  { id: "feature_request", label: "Feature request", icon: Lightbulb, color: "text-amber-400" },
  { id: "add_games", label: "Add games", icon: PlusCircle, color: "text-emerald-400" },
  { id: "delete_game", label: "Delete game", icon: Shield, color: "text-violet-400" },
  { id: "feedback", label: "Feedback", icon: MessageCircle, color: "text-blue-400" },
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
          The repo, the dev, the stack, and how to get bugs in front of me.
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
            <Heart className="h-4 w-4 text-rose-400" /> Maintained by SkullMute
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            One Vietnamese dev (poli0981 / SkullMute), 70% AI-assisted (Grok for v1,
            Claude for v2+), running this in spare time. Hit me up on any of these
            if something is broken or you want to chat:
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
            <FileText className="h-4 w-4" /> Stack &amp; third-party
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            All third-party libraries used by this app. The Python pipeline
            relies on <code>requests</code> + <code>urllib3</code> only.
          </p>
          <ul className="space-y-1.5">
            {DEPS.map((d) => (
              <li
                key={d.name}
                className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
              >
                <a
                  href={d.href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:text-primary"
                >
                  {d.name}
                </a>
                <span className="text-xs text-muted-foreground">{d.role}</span>
              </li>
            ))}
          </ul>
          <Separator />
          <div className="text-xs text-muted-foreground">
            Steam, Steam Store, Steam Community, and the Steam logo are trademarks
            of Valve Corporation. This site is not affiliated with Valve.
            <br />
            Steam header images served from Akamai (<code>shared.akamai.steamstatic.com</code>).
            Public-key search for commit verification uses <code>api.github.com</code>.
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
