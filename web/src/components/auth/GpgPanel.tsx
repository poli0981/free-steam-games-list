import { useEffect, useState } from "react";
import {
  Lock,
  Unlock,
  KeyRound,
  Trash2,
  Upload,
  AlertCircle,
  ShieldCheck,
  ExternalLink,
  Timer,
  UserCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { useGpg } from "../../stores/gpg";

export function GpgPanel() {
  const gpg = useGpg();
  const [armored, setArmored] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    void gpg.hydrate();
  }, [gpg]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!armored.trim()) return;
    try {
      await gpg.saveKey(armored.trim());
      setArmored("");
      setShowAddForm(false);
    } catch {
      /* error in store */
    }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    try {
      await gpg.unlock(passphrase);
      setPassphrase("");
    } catch {
      /* error in store */
    }
  }

  // No saved key → show import form.
  if (!gpg.parsed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> GPG signing (optional)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            GitHub marks API commits as <em>Unverified</em> unless they carry a
            detached OpenPGP signature. Import your private key here and your
            edits/adds will commit with a <strong>Verified</strong> badge.
          </p>

          <ImportKeyForm
            armored={armored}
            setArmored={setArmored}
            error={gpg.error}
            busy={gpg.isVerifying}
            onSave={handleSave}
          />

          <SetupHelp />
        </CardContent>
      </Card>
    );
  }

  // Saved + unlocked → show key info + lock button.
  if (gpg.unlocked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Unlock className="h-4 w-4 text-emerald-400" />
            GPG signing —{" "}
            <Badge variant="success" className="ml-1">
              <ShieldCheck className="mr-1 h-3 w-3" /> unlocked
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <KeyInfo />
          <UidPicker />
          <AutolockPicker />
          <Separator />
          <div className="flex gap-2">
            <Button variant="outline" onClick={gpg.lock}>
              <Lock className="mr-1 h-3 w-3" /> Lock
            </Button>
            <Button variant="ghost" onClick={gpg.clearKey}>
              <Trash2 className="mr-1 h-3 w-3" /> Forget key
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Saved + locked → show unlock form.
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-4 w-4" /> GPG signing —{" "}
          <Badge variant="secondary" className="ml-1">
            locked
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <KeyInfo />
        <UidPicker />
        <AutolockPicker />

        <Separator />

        <form onSubmit={handleUnlock} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="passphrase">Passphrase</Label>
            <Input
              id="passphrase"
              type="password"
              placeholder="••••••••"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={gpg.isVerifying}
              autoComplete="current-password"
            />
          </div>

          {gpg.error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{gpg.error}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!passphrase || gpg.isVerifying}>
              <Unlock className="mr-1 h-3 w-3" />
              {gpg.isVerifying ? "Unlocking…" : "Unlock"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowAddForm((s) => !s)}>
              <Upload className="mr-1 h-3 w-3" />
              {showAddForm ? "Cancel replace" : "Replace key"}
            </Button>
            <Button type="button" variant="ghost" onClick={gpg.clearKey}>
              <Trash2 className="mr-1 h-3 w-3" /> Forget key
            </Button>
          </div>
        </form>

        {showAddForm && (
          <>
            <Separator />
            <ImportKeyForm
              armored={armored}
              setArmored={setArmored}
              error={null}
              busy={gpg.isVerifying}
              onSave={handleSave}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function KeyInfo() {
  const parsed = useGpg((s) => s.parsed);
  if (!parsed) return null;
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="grid grid-cols-[120px_1fr] gap-y-1.5 text-xs">
        <span className="font-medium uppercase tracking-wider text-muted-foreground">
          User ID
        </span>
        <span>
          {parsed.primaryName}
          {parsed.primaryEmail && (
            <span className="text-muted-foreground"> &lt;{parsed.primaryEmail}&gt;</span>
          )}
        </span>
        <span className="font-medium uppercase tracking-wider text-muted-foreground">
          Fingerprint
        </span>
        <span className="font-mono text-[10px] tracking-wide">
          {parsed.fingerprint.match(/.{1,4}/g)?.join(" ")}
        </span>
        <span className="font-medium uppercase tracking-wider text-muted-foreground">
          Algorithm
        </span>
        <span>{parsed.algorithm}</span>
      </div>
    </div>
  );
}

interface ImportProps {
  armored: string;
  setArmored: (s: string) => void;
  error: string | null;
  busy: boolean;
  onSave: (e: React.FormEvent) => void;
}

function ImportKeyForm({ armored, setArmored, error, busy, onSave }: ImportProps) {
  return (
    <form onSubmit={onSave} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="armored">Armored private key</Label>
        <Textarea
          id="armored"
          rows={6}
          placeholder={"-----BEGIN PGP PRIVATE KEY BLOCK-----\n…\n-----END PGP PRIVATE KEY BLOCK-----"}
          value={armored}
          onChange={(e) => setArmored(e.target.value)}
          className="font-mono text-[11px]"
          disabled={busy}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" disabled={!armored.trim() || busy}>
        <KeyRound className="mr-1 h-3 w-3" />
        {busy ? "Parsing…" : "Save key"}
      </Button>
    </form>
  );
}

function UidPicker() {
  const parsed = useGpg((s) => s.parsed);
  const idx = useGpg((s) => s.preferredUidIndex);
  const setIdx = useGpg((s) => s.setPreferredUidIndex);
  if (!parsed || parsed.userIds.length <= 1) return null;
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <UserCircle2 className="h-3 w-3" /> Commit identity
      </Label>
      <select
        value={Math.min(idx, parsed.userIds.length - 1)}
        onChange={(e) => setIdx(parseInt(e.target.value, 10))}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
      >
        {parsed.userIds.map((u, i) => (
          <option key={u + i} value={i}>
            {u}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Email of the chosen user ID is used as the commit author. Must be a
        verified email on your GitHub account for the badge to show as Verified.
      </p>
    </div>
  );
}

function AutolockPicker() {
  const mins = useGpg((s) => s.autolockMinutes);
  const setMins = useGpg((s) => s.setAutolockMinutes);
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <Timer className="h-3 w-3" /> Auto-lock after idle
      </Label>
      <select
        value={mins}
        onChange={(e) => setMins(parseInt(e.target.value, 10))}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
      >
        <option value="0">Never</option>
        <option value="5">5 minutes</option>
        <option value="15">15 minutes</option>
        <option value="30">30 minutes</option>
        <option value="60">1 hour</option>
      </select>
      <p className="text-xs text-muted-foreground">
        While unlocked, the decrypted key sits in memory. Auto-lock wipes it
        after the chosen idle window so a forgotten tab can't be used to sign
        commits.
      </p>
    </div>
  );
}

function SetupHelp() {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
      <p className="font-semibold">Setting up signed commits</p>
      <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
        <li>
          Generate (or export) a passphrase-protected GPG key whose user ID
          email is verified on your GitHub account.
        </li>
        <li>
          Add the public key to{" "}
          <a
            href="https://github.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            GitHub → Settings → SSH and GPG keys <ExternalLink className="inline h-3 w-3" />
          </a>
          .
        </li>
        <li>
          Export the private key with{" "}
          <code className="rounded bg-muted px-1">
            gpg --armor --export-secret-keys YOUR_KEY_ID
          </code>{" "}
          and paste the full block above.
        </li>
        <li>
          Unlock with your passphrase here. The decrypted key stays in memory
          only and is wiped when you lock or close the tab.
        </li>
      </ol>
      <p className="text-muted-foreground">
        <strong>Storage:</strong> the armored block in localStorage is itself
        passphrase-encrypted by PGP, so a tab snoop alone can't sign without
        also knowing your passphrase.
      </p>
    </div>
  );
}
