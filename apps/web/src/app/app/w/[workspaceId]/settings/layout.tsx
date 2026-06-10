"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import {
  BarChart3,
  Blocks,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "General", segment: "", icon: Settings },
  { label: "Members", segment: "/members", icon: Users },
  { label: "Branding", segment: "/branding", icon: Palette },
  { label: "Security & compliance", segment: "/security", icon: ShieldCheck },
  { label: "Audit log", segment: "/audit-log", icon: ScrollText },
  { label: "Integrations", segment: "/integrations", icon: Blocks },
  { label: "Usage", segment: "/usage", icon: BarChart3 },
] as const;

export default function WorkspaceSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ workspaceId: string }>();
  const pathname = usePathname();
  const base = `/app/w/${params.workspaceId}/settings`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Workspace settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your workspace, team, plan, and security controls.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        <nav
          aria-label="Settings navigation"
          className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:w-56 lg:shrink-0 lg:overflow-visible lg:px-0"
        >
          <ul className="flex gap-1 lg:flex-col">
            {NAV_ITEMS.map((item) => {
              const href = `${base}${item.segment}`;
              const active =
                item.segment === ""
                  ? pathname === base
                  : pathname === href || pathname.startsWith(`${href}/`);
              const Icon = item.icon;
              return (
                <li key={item.label} className="shrink-0">
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
