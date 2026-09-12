import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  GitCommit,
  Bot,
  User,
  Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { LoadingState, ErrorState } from "../components/common/QueryState";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { DEFAULT_BRANCH } from "../lib/schema";
import { API_ORIGIN } from "../lib/site";
import { formatRelativeDate } from "../lib/utils";
import { cn } from "../lib/utils";

/**
 * Flattened by the Worker, not by GitHub. /api/activity narrows the upstream
 * payload to these fields, so the commit-author email GitHub returns for every
 * commit never reaches the browser at all, `subject` is the first line only
 * (the bodies carry Co-Authored-By trailers with real addresses, and nothing
 * below renders them), and `avatar` arrives already rewritten to this site's
 * own /img/gh/ proxy.
 */
interface Commit {
  sha: string;
  html_url: string;
  subject: string;
  author_date: string;
  author_name: string;
  login: string | null;
  avatar: string | null;
  verified: boolean;
  reason: string;
}

// "mine" is gone with sign-in: with no signed-in identity there is no
// "me" to filter against.
type Filter = "all" | "bot";

/** The pipeline's own commits are authored by this account. */
const BOT_LOGIN = "github-actions[bot]";

async function fetchCommits(): Promise<Commit[]> {
  // Same-origin through the Worker. This page used to call api.github.com
  // directly, which leaked every visitor's IP to GitHub, forced
  // https://api.github.com into the site-wide connect-src, and returned avatar
  // URLs on a host no CSP here allowed - so every avatar was blocked outright.
  const res = await fetch(`${API_ORIGIN}/api/activity`);
  if (!res.ok) throw new Error(`Activity: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { commits?: Commit[] };
  return body.commits ?? [];
}

export function ActivityPage() {
  const { t } = useTranslation();
  useDocumentTitle("activity.title");
  const [filter, setFilter] = useState<Filter>("all");

  const q = useQuery({
    queryKey: ["activity"],
    queryFn: fetchCommits,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!q.data) return [];
    return q.data.filter((c) => {
      const isBot = c.login === BOT_LOGIN;
      if (filter === "bot") return isBot;
      return true;
    });
  }, [q.data, filter]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error as Error} onRetry={() => void q.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("activity.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("activity.subtitle", { count: q.data?.length ?? 0, branch: DEFAULT_BRANCH })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border bg-card p-1 text-xs">
          <Filter className="ml-1 h-3 w-3 text-muted-foreground" />
          {(["all", "bot"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "ghost"}
              className="h-6 text-xs"
              onClick={() => setFilter(f)}
            >
              {f === "bot" ? t("activity.filterBots") : t("activity.filterAll")}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-normal text-muted-foreground">
            {t("activity.showingCount", { count: filtered.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {filtered.map((c) => (
              <CommitRow key={c.sha} commit={c} />
            ))}
            {filtered.length === 0 && (
              <li className="p-6 text-center text-sm text-muted-foreground">
                {t("activity.noMatches")}
              </li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function CommitRow({ commit }: { commit: Commit }) {
  const { t } = useTranslation();
  const verified = commit.verified;
  const reason = commit.reason || "unsigned";
  const subject = commit.subject;
  const isBot = commit.login === BOT_LOGIN;

  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30">
      <div className="mt-0.5 shrink-0">
        {commit.avatar ? (
          <img
            src={`${API_ORIGIN}${commit.avatar}`}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "h-7 w-7 rounded-full border",
              isBot && "ring-1 ring-amber-500/40",
            )}
          />
        ) : (
          <div className="grid h-7 w-7 place-items-center rounded-full border bg-muted">
            <GitCommit className="h-3 w-3 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <a
            href={commit.html_url}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium hover:text-primary"
          >
            {subject || t("activity.noMessage")}
          </a>
          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-50" />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {commit.login ? (
            <span className="inline-flex items-center gap-1">
              {isBot ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
              {commit.login}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {commit.author_name}
            </span>
          )}
          <span>·</span>
          <span title={commit.author_date}>
            {formatRelativeDate(commit.author_date)}
          </span>
          <span>·</span>
          <code className="rounded bg-muted px-1 font-mono">
            {commit.sha.slice(0, 7)}
          </code>
        </div>
      </div>

      <div className="shrink-0">
        {verified ? (
          <Badge variant="success" className="font-normal">
            <ShieldCheck className="mr-1 h-3 w-3" /> {t("activity.verifiedBadge")}
          </Badge>
        ) : reason === "unsigned" ? (
          <Badge variant="secondary" className="font-normal">
            {t("activity.unsignedBadge")}
          </Badge>
        ) : (
          <Badge
            variant="warning"
            className="font-normal"
            title={t("activity.reasonPrefix", { reason })}
          >
            <ShieldAlert className="mr-1 h-3 w-3" /> {reason}
          </Badge>
        )}
      </div>
    </li>
  );
}
