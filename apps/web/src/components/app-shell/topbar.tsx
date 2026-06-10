"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MenuIcon, SearchIcon, VideoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";

import { NotificationsMenu } from "./notifications-menu";
import type { Me } from "./types";
import { UserMenu } from "./user-menu";

export function Topbar({
  me,
  workspaceId,
  onOpenMobileNav,
}: {
  me: Me;
  workspaceId: string;
  onOpenMobileNav: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState(() => searchParams.get("q") ?? "");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(`/app/w/${workspaceId}/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMobileNav}
      >
        <MenuIcon className="size-4" />
        <span className="sr-only">Open navigation</span>
      </Button>

      <form
        onSubmit={handleSearchSubmit}
        className="relative hidden w-full max-w-md sm:block"
      >
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search videos, transcripts, summaries…"
          className="h-9 bg-background pr-10 pl-9"
        />
        <Kbd className="absolute top-1/2 right-2.5 hidden -translate-y-1/2 md:inline-flex">
          /
        </Kbd>
      </form>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <Button asChild variant="ghost" size="icon" className="sm:hidden">
          <Link href={`/app/w/${workspaceId}/search`}>
            <SearchIcon className="size-4" />
            <span className="sr-only">Search</span>
          </Link>
        </Button>
        <Button asChild className="gap-2">
          <Link href={`/record?workspaceId=${workspaceId}`}>
            <VideoIcon className="size-4" />
            <span className="hidden sm:inline">New video</span>
            <span className="sr-only sm:hidden">New video</span>
          </Link>
        </Button>
        <NotificationsMenu />
        <UserMenu me={me} />
      </div>
    </header>
  );
}
