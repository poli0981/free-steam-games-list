import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { useAuth } from "../stores/auth";
import { REPO_OWNER, REPO_NAME, DEFAULT_BRANCH } from "../lib/schema";
import { formatRelativeDate } from "../lib/utils";
import { cn } from "../lib/utils";

interface Commit {
  sha: string;
  html_url: string;
  commit: {
    author: { name: string; email: string; date: string };
    message: string;
    verification: { verified: boolean; reason: string };
  };
  author: { login: string; avatar_url: string } | null;
  committer: { login: string; avatar_url: string } | null;
}

type Filter = "all" | "mine" | "bot";

async function fetchCommits(token: string | null): Promise<Commit[]> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=80&sha=${DEFAULT_BRANCH}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Commits API: ${res.status} ${res.statusText}`);
  return (await res.json()) as Commit[];
}

export function ActivityPage() {
  const auth = useAuth();
  const [filter, setFilter] = useState<Filter>("all");

  const q = useQuery({
    queryKey: ["activity", auth.user?.login ?? null],
    queryFn: () => fetchCommits(auth.token),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!q.data) return [];
    const login = auth.user?.login ?? null;
    return q.data.filter((c) => {
      const isBot = c.author?.login === "github-actions[bot]";
      const isMine = login != null && c.author?.login === login;
      if (filter === "mine") return isMine;
      if (filter === "bot") return isBot;
      return true;
    });
  }, [q.data, filter, auth.user?.login]);

  if (q.isLoading) return <LoadingState label="Loading recent commits…" />;
  if (q.error) return <ErrorState error={q.error as Error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="text-sm text-muted-foreground">
            Recent {q.data?.length ?? 0} commits on{" "}
            <code className="rounded bg-muted px-1">{DEFAULT_BRANCH}</code>. Verified
            commits are signed by the author's registered GPG key.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border bg-card p-1 text-xs">
          <Filter className="ml-1 h-3 w-3 text-muted-foreground" />
          {(["all", "mine", "bot"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "ghost"}
              className="h-6 text-xs capitalize"
              onClick={() => setFilter(f)}
            >
              {f === "mine" ? "Me" : f === "bot" ? "Bots" : "All"}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-normal text-muted-foreground">
            Showing {filtered.length} commits
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {filtered.map((c) => (
              <CommitRow key={c.sha} commit={c} />
            ))}
            {filtered.length === 0 && (
              <li className="p-6 text-center text-sm text-muted-foreground">
                No commits match this filter.
              </li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function CommitRow({ commit }: { commit: Commit }) {
  const verified = commit.commit.verification?.verified;
  const reason = commit.commit.verification?.reason ?? "unsigned";
  const subject = (commit.commit.message ?? "").split("\n")[0];
  const isBot = commit.author?.login === "github-actions[bot]";

  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30">
      <div className="mt-0.5 shrink-0">
        {commit.author?.avatar_url ? (
          <img
            src={commit.author.avatar_url}
            alt=""
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
            {subject || "(no message)"}
          </a>
          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-50" />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {commit.author ? (
            <span className="inline-flex items-center gap-1">
              {isBot ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
              {commit.author.login}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {commit.commit.author.name}
            </span>
          )}
          <span>·</span>
          <span title={commit.commit.author.date}>
            {formatRelativeDate(commit.commit.author.date)}
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
            <ShieldCheck className="mr-1 h-3 w-3" /> Verified
          </Badge>
        ) : reason === "unsigned" ? (
          <Badge variant="secondary" className="font-normal">
            unsigned
          </Badge>
        ) : (
          <Badge
            variant="warning"
            className="font-normal"
            title={`reason: ${reason}`}
          >
            <ShieldAlert className="mr-1 h-3 w-3" /> {reason}
          </Badge>
        )}
      </div>
    </li>
  );
}
