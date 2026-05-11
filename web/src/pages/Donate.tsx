import { Heart, Coffee, Gift, Github, CreditCard, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

interface DonationPlatform {
  /** i18n key suffix under `donate.platform.*` for label/desc. */
  key: "github" | "kofi" | "bmc" | "patreon" | "paypal";
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Tailwind classes for accent ring + icon tint. */
  accent: string;
}

const PLATFORMS: DonationPlatform[] = [
  {
    key: "github",
    href: "https://github.com/sponsors/poli0981",
    icon: Github,
    accent: "ring-violet-500/30 text-violet-400",
  },
  {
    key: "kofi",
    href: "https://ko-fi.com/skullmute",
    icon: Coffee,
    accent: "ring-rose-500/30 text-rose-400",
  },
  {
    key: "bmc",
    href: "https://buymeacoffee.com/skullmute",
    icon: Coffee,
    accent: "ring-amber-500/30 text-amber-400",
  },
  {
    key: "patreon",
    href: "https://patreon.com/skullmute",
    icon: Gift,
    accent: "ring-orange-500/30 text-orange-400",
  },
  {
    key: "paypal",
    href: "https://paypal.me/DungDang212",
    icon: CreditCard,
    accent: "ring-blue-500/30 text-blue-400",
  },
];

export function DonatePage() {
  const { t } = useTranslation();
  useDocumentTitle("donate.title");
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Heart className="h-6 w-6 text-rose-400" /> {t("donate.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("donate.subtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {PLATFORMS.map((p) => (
          <Card key={p.key} className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className={`grid h-9 w-9 place-items-center rounded-md bg-card ring-1 ${p.accent}`}
                >
                  <p.icon className="h-4 w-4" />
                </span>
                {t(`donate.platform.${p.key}`)}
              </CardTitle>
              <CardDescription className="text-xs">
                {t(`donate.platform.${p.key}Desc`)}
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={p.href} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1 h-3 w-3" /> {t("donate.cta")}
                </a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{t("donate.footnote")}</p>
    </div>
  );
}
