"use client";

import * as React from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { BellIcon, CheckCheckIcon, Loader2Icon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, getInitials } from "@/lib/utils";
import { api } from "@/trpc/react";

export function NotificationsMenu() {
  const [open, setOpen] = React.useState(false);
  const utils = api.useUtils();

  const unreadQuery = api.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const listQuery = api.notification.list.useQuery({}, { enabled: open });

  const markRead = api.notification.markRead.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.notification.unreadCount.invalidate(),
        utils.notification.list.invalidate(),
      ]);
    },
  });

  const unreadCount = unreadQuery.data?.count ?? 0;
  const items = listQuery.data?.items ?? [];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <BellIcon className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            disabled={markRead.isPending || unreadCount === 0}
            onClick={() => markRead.mutate({})}
          >
            {markRead.isPending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <CheckCheckIcon className="size-3.5" />
            )}
            Mark all read
          </Button>
        </div>
        <Separator />
        <div className="max-h-96 overflow-y-auto">
          {listQuery.isPending ? (
            <div className="flex flex-col gap-3 p-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <BellIcon className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">You&apos;re all caught up</p>
              <p className="text-xs text-muted-foreground">
                Comments, reactions, and views on your videos will show up here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col p-1">
              {items.map(({ notification, actor }) => {
                const body = (
                  <div className="flex w-full items-start gap-2.5">
                    {actor ? (
                      <Avatar className="mt-0.5 size-7 shrink-0">
                        <AvatarImage
                          src={actor.avatarUrl ?? undefined}
                          alt={actor.name ?? actor.email}
                        />
                        <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                          {getInitials(actor.name, actor.email)}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        <BellIcon className="size-3.5 text-muted-foreground" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {notification.title}
                      </span>
                      {notification.body && (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                          {notification.body}
                        </span>
                      )}
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatDistanceToNow(notification.createdAt, {
                          addSuffix: true,
                        })}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        notification.readAt ? "bg-transparent" : "bg-primary",
                      )}
                    />
                  </div>
                );
                return (
                  <DropdownMenuItem
                    key={notification.id}
                    asChild={Boolean(notification.videoId)}
                    className="cursor-pointer rounded-md px-2 py-2"
                    onSelect={() => {
                      if (!notification.readAt) {
                        markRead.mutate({ id: notification.id });
                      }
                    }}
                  >
                    {notification.videoId ? (
                      <Link href={`/app/video/${notification.videoId}`}>{body}</Link>
                    ) : (
                      body
                    )}
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
