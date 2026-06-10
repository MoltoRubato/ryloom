"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, Loader2, Mail, Sparkles, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { SettingsSection } from "@/components/settings/settings-section";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getInitials } from "@/lib/utils";
import { api } from "@/trpc/react";

const BASE_ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "viewer", label: "Viewer" },
  { value: "guest", label: "Guest" },
] as const;

const ADVANCED_ROLES = [
  { value: "billing_admin", label: "Billing admin" },
  { value: "content_admin", label: "Content admin" },
  { value: "compliance_admin", label: "Compliance admin" },
] as const;

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
  guest: "Guest",
  billing_admin: "Billing admin",
  content_admin: "Content admin",
  compliance_admin: "Compliance admin",
};

type AssignableRole =
  | (typeof BASE_ROLES)[number]["value"]
  | (typeof ADVANCED_ROLES)[number]["value"];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success(`${label} copied`);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't access the clipboard");
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      Copy
    </Button>
  );
}

export default function MembersSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const utils = api.useUtils();

  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const workspaceQuery = api.workspace.get.useQuery({ workspaceId });
  const meQuery = api.user.me.useQuery();
  const membersQuery = api.workspace.listMembers.useQuery({ workspaceId });

  const role = workspaceQuery.data?.role;
  const plan = workspaceQuery.data?.plan;
  const isAdmin = role === "owner" || role === "admin";

  const invitesQuery = api.workspace.listInvites.useQuery(
    { workspaceId },
    { enabled: isAdmin },
  );

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("member");
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    inviteUrl: string;
    emailSent: boolean;
  } | null>(null);

  const inviteMember = api.workspace.inviteMember.useMutation({
    onSuccess: async (data, vars) => {
      setInviteEmail("");
      setInviteResult({
        email: vars.email,
        inviteUrl: data.inviteUrl,
        emailSent: data.emailSent,
      });
      await utils.workspace.listInvites.invalidate({ workspaceId });
    },
    onError: (err) => toast.error(err.message),
  });

  const revokeInvite = api.workspace.revokeInvite.useMutation({
    onSuccess: async () => {
      toast.success("Invite revoked");
      await utils.workspace.listInvites.invalidate({ workspaceId });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateRole = api.workspace.updateMemberRole.useMutation({
    onMutate: async (vars) => {
      await utils.workspace.listMembers.cancel({ workspaceId });
      const prev = utils.workspace.listMembers.getData({ workspaceId });
      utils.workspace.listMembers.setData({ workspaceId }, (old) =>
        old?.map((row) =>
          row.member.userId === vars.userId
            ? { ...row, member: { ...row.member, role: vars.role } }
            : row,
        ),
      );
      return { prev };
    },
    onError: (err, _vars, context) => {
      if (context?.prev) {
        utils.workspace.listMembers.setData({ workspaceId }, context.prev);
      }
      toast.error(err.message);
    },
    onSuccess: () => toast.success("Role updated"),
    onSettled: () => void utils.workspace.listMembers.invalidate({ workspaceId }),
  });

  const removeMember = api.workspace.removeMember.useMutation({
    onSuccess: async () => {
      toast.success("Member removed");
      await utils.workspace.listMembers.invalidate({ workspaceId });
    },
    onError: (err) => toast.error(err.message),
  });

  const submitInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    inviteMember.mutate({ workspaceId, email, role: inviteRole });
  };

  if (workspaceQuery.isLoading || membersQuery.isLoading || !plan) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const members = membersQuery.data ?? [];
  const invites = invitesQuery.data ?? [];
  const myId = meQuery.data?.id;
  const advancedRolesAvailable = plan.advancedAdminRoles;

  const seatsNote =
    plan.maxSeats === null
      ? `${members.length} ${members.length === 1 ? "seat" : "seats"} used · unlimited seats on the ${plan.name} plan`
      : `${members.length} of ${plan.maxSeats} seats used on the ${plan.name} plan`;

  return (
    <div className="space-y-6">
      {isAdmin && (
        <SettingsSection
          title="Invite people"
          description="Invites expire after 14 days. A shareable link is always generated."
        >
          <form
            onSubmit={submitInvite}
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <Input
              type="email"
              required
              placeholder="teammate@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1"
              aria-label="Invite email"
            />
            <Select
              value={inviteRole}
              onValueChange={(v) => setInviteRole(v as AssignableRole)}
            >
              <SelectTrigger className="sm:w-48" aria-label="Invite role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASE_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
                {ADVANCED_ROLES.map((r) => (
                  <SelectItem
                    key={r.value}
                    value={r.value}
                    disabled={!advancedRolesAvailable}
                  >
                    <span className="flex items-center gap-2">
                      {r.label}
                      <Badge variant="secondary" className="gap-1">
                        <Sparkles className="size-3" />
                        Enterprise
                      </Badge>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={inviteMember.isPending}>
              {inviteMember.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              Invite
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">{seatsNote}</p>
        </SettingsSection>
      )}

      {isAdmin && invites.length > 0 && (
        <SettingsSection
          title="Pending invites"
          description="People who haven't accepted their invitation yet."
        >
          <div className="-mx-6 overflow-x-auto px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Invited</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">{invite.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {ROLE_LABELS[invite.role] ?? invite.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDistanceToNow(new Date(invite.createdAt), {
                        addSuffix: true,
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                `${origin}/invite/${invite.token}`,
                              );
                              toast.success("Invite link copied");
                            } catch {
                              toast.error("Couldn't access the clipboard");
                            }
                          }}
                        >
                          <Copy className="size-4" />
                          Copy link
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={revokeInvite.isPending}
                          onClick={() =>
                            revokeInvite.mutate({ inviteId: invite.id })
                          }
                        >
                          <X className="size-4" />
                          Revoke
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title="Members"
        description={seatsNote}
      >
        <div className="-mx-6 overflow-x-auto px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last seen</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(({ member, user }) => {
                const isOwnerRow = member.role === "owner";
                const isSelf = user.id === myId;
                const canChangeRole = isAdmin && !isOwnerRow && !isSelf;
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarImage
                            src={user.avatarUrl ?? undefined}
                            alt={user.name ?? user.email}
                          />
                          <AvatarFallback>
                            {getInitials(user.name, user.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {user.name ?? user.email}
                            {isSelf && (
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {canChangeRole ? (
                        <Select
                          value={member.role}
                          onValueChange={(v) =>
                            updateRole.mutate({
                              workspaceId,
                              userId: user.id,
                              role: v as AssignableRole,
                            })
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-44"
                            aria-label={`Role for ${user.email}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BASE_ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                            {ADVANCED_ROLES.map((r) => (
                              <SelectItem
                                key={r.value}
                                value={r.value}
                                disabled={!advancedRolesAvailable}
                              >
                                <span className="flex items-center gap-2">
                                  {r.label}
                                  <Badge variant="secondary" className="gap-1">
                                    <Sparkles className="size-3" />
                                    Enterprise
                                  </Badge>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={isOwnerRow ? "default" : "outline"}>
                          {ROLE_LABELS[member.role] ?? member.role}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.lastSeenAt
                        ? formatDistanceToNow(new Date(user.lastSeenAt), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex justify-end">
                          {!isOwnerRow && !isSelf && (
                            <ConfirmDialog
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="size-4" />
                                  Remove
                                </Button>
                              }
                              title={`Remove ${user.name ?? user.email}?`}
                              description="They immediately lose access to this workspace. Their videos stay in the workspace and can be transferred by an admin."
                              confirmLabel="Remove member"
                              destructive
                              onConfirm={() =>
                                removeMember.mutateAsync({
                                  workspaceId,
                                  userId: user.id,
                                })
                              }
                            />
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </SettingsSection>

      <Dialog
        open={inviteResult !== null}
        onOpenChange={(open) => {
          if (!open) setInviteResult(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite sent</DialogTitle>
            <DialogDescription>
              {inviteResult?.emailSent ? (
                <span className="flex items-center gap-1.5">
                  <Mail className="size-4" />
                  We emailed {inviteResult.email}. You can also share this link
                  directly:
                </span>
              ) : (
                <>
                  Email delivery isn&apos;t configured, so share this link with{" "}
                  {inviteResult?.email} to let them join:
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={inviteResult?.inviteUrl ?? ""}
              onFocus={(e) => e.target.select()}
              className="font-mono text-xs"
            />
            <CopyButton text={inviteResult?.inviteUrl ?? ""} label="Invite link" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteResult(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
