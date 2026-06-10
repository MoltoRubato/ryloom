"use client";

import { ArrowLeft, ArrowRight, Building2, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { RyloomLogo } from "@/components/auth/ryloom-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

const STEPS = [1, 2] as const;
type Step = (typeof STEPS)[number];

function ProgressDots({ step }: { step: Step }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-hidden="true">
      {STEPS.map((s) => (
        <span
          key={s}
          className={cn(
            "h-2 rounded-full transition-all duration-300",
            s === step ? "w-6 bg-primary" : "w-2 bg-border",
          )}
        />
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();

  const { data: me, isLoading: meLoading } = api.user.me.useQuery();
  const { data: memberships, isLoading: workspacesLoading } =
    api.workspace.list.useQuery();

  const createWorkspace = api.workspace.create.useMutation();
  const updateUser = api.user.update.useMutation();

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const prefilledName = useRef(false);
  const redirected = useRef(false);

  // Already onboarded with at least one workspace → straight to the app.
  useEffect(() => {
    if (redirected.current) return;
    if (me?.onboardingCompleted && memberships && memberships.length > 0) {
      redirected.current = true;
      router.replace("/app");
    }
  }, [me, memberships, router]);

  // Prefill the name from the profile once it loads.
  useEffect(() => {
    if (me && !prefilledName.current) {
      prefilledName.current = true;
      if (me.name) setName(me.name);
    }
  }, [me]);

  const loading = meLoading || workspacesLoading;
  const trimmedName = name.trim();
  const trimmedWorkspaceName = workspaceName.trim();

  function goToStep2(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (trimmedName.length === 0) return;
    if (trimmedWorkspaceName.length === 0) {
      const firstName = trimmedName.split(/\s+/)[0] ?? trimmedName;
      setWorkspaceName(`${firstName}'s workspace`);
    }
    setStep(2);
  }

  async function finish(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (trimmedWorkspaceName.length === 0 || submitting) return;
    setSubmitting(true);

    let created: { id: string };
    try {
      created = await createWorkspace.mutateAsync({ name: trimmedWorkspaceName });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't create your workspace. Try again.",
      );
      setSubmitting(false);
      return;
    }

    try {
      await updateUser.mutateAsync({
        name: trimmedName,
        onboardingCompleted: true,
        defaultWorkspaceId: created.id,
      });
    } catch (err) {
      // The workspace exists — let the user in, but surface the hiccup.
      toast.error(
        err instanceof Error ? err.message : "Couldn't save your profile details.",
      );
    }

    router.push(`/app/w/${created.id}`);
    router.refresh();
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/10 via-background to-background"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-48 left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-8">
        <RyloomLogo />

        {loading ? (
          <Card className="w-full rounded-xl border-border shadow-sm">
            <CardContent className="flex items-center justify-center py-16">
              <Loader2
                className="size-6 animate-spin text-muted-foreground"
                aria-label="Loading"
              />
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full overflow-hidden rounded-xl border-border shadow-sm">
            <CardContent className="flex flex-col gap-6 py-8">
              <ProgressDots step={step} />

              <AnimatePresence mode="wait" initial={false}>
                {step === 1 ? (
                  <motion.div
                    key="step-1"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  >
                    <form onSubmit={goToStep2} className="flex flex-col gap-6">
                      <div className="space-y-1.5 text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">
                          What&apos;s your name?
                        </h1>
                        <p className="text-sm text-muted-foreground">
                          This is how teammates and viewers will see you.
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="onboarding-name">Full name</Label>
                        <Input
                          id="onboarding-name"
                          type="text"
                          name="name"
                          placeholder="Ada Lovelace"
                          autoComplete="name"
                          autoFocus
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={trimmedName.length === 0}
                      >
                        Continue
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Button>
                    </form>
                  </motion.div>
                ) : (
                  <motion.div
                    key="step-2"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  >
                    <form onSubmit={finish} className="flex flex-col gap-6">
                      <div className="space-y-1.5 text-center">
                        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Building2 className="size-6" aria-hidden="true" />
                        </span>
                        <h1 className="text-2xl font-semibold tracking-tight">
                          Name your workspace
                        </h1>
                        <p className="text-sm text-muted-foreground">
                          Your videos live here. You can invite your team later.
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="onboarding-workspace">Workspace name</Label>
                        <Input
                          id="onboarding-workspace"
                          type="text"
                          name="workspace"
                          placeholder="Acme Inc."
                          autoComplete="organization"
                          autoFocus
                          required
                          maxLength={100}
                          value={workspaceName}
                          onChange={(e) => setWorkspaceName(e.target.value)}
                          disabled={submitting}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button
                          type="submit"
                          className="w-full"
                          disabled={submitting || trimmedWorkspaceName.length === 0}
                        >
                          {submitting ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          {submitting ? "Setting things up…" : "Create workspace"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full text-sm font-normal text-muted-foreground"
                          disabled={submitting}
                          onClick={() => setStep(1)}
                        >
                          <ArrowLeft className="size-4" aria-hidden="true" />
                          Back
                        </Button>
                      </div>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
