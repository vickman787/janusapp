"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, X } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { BottomNav } from "@/components/BottomNav";
import { getServerAuthHeaders } from "@/lib/activityStore";

interface GroupItem {
  id: string;
  name: string;
  members: Array<{ address: string; username?: string }>;
  recentSplits: Array<{ title: string; status: "Active" | "Settled" | "Cancelled"; createdAt: number }>;
}

export default function GroupsPage() {
  const { authenticated, login, user } = usePrivy();
  const activeAddress = user?.wallet?.address;
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [memberInput, setMemberInput] = useState("");
  const [members, setMembers] = useState<Array<{ address: string; username: string }>>([]);
  const [isResolvingMember, setIsResolvingMember] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    if (!activeAddress) {
      setGroups([]);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(`/api/groups?address=${encodeURIComponent(activeAddress)}`, {
        headers: await getServerAuthHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Could not load groups");
      setGroups(data.groups || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load groups");
    } finally {
      setIsLoading(false);
    }
  }, [activeAddress]);

  useEffect(() => {
    if (!authenticated) {
      queueMicrotask(() => setGroups([]));
      return;
    }
    queueMicrotask(() => void loadGroups());
  }, [authenticated, loadGroups]);

  async function addMember() {
    const username = memberInput.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      setError("Enter a valid JANUS username, such as @vickman.");
      return;
    }
    setIsResolvingMember(true);
    setError(null);
    try {
      const response = await fetch(`/api/profiles?username=${encodeURIComponent(username)}`);
      const data = await response.json();
      if (!data.profile?.walletAddress) throw new Error("That username is not registered yet.");
      const address = data.profile.walletAddress.toLowerCase();
      if (address === activeAddress?.toLowerCase()) throw new Error("You are already the organizer.");
      if (members.some((member) => member.address.toLowerCase() === address)) {
        throw new Error("That member is already in this group.");
      }
      setMembers((current) => [...current, { address: data.profile.walletAddress, username: `@${data.profile.username}` }]);
      setMemberInput("");
    } catch (memberError) {
      setError(memberError instanceof Error ? memberError.message : "Could not add member");
    } finally {
      setIsResolvingMember(false);
    }
  }

  async function createGroup() {
    if (!activeAddress) return;
    if (!groupName.trim()) {
      setError("Give this group a name.");
      return;
    }
    if (members.length === 0) {
      setError("Add at least one JANUS username to this group.");
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getServerAuthHeaders()) },
        body: JSON.stringify({ address: activeAddress, name: groupName, members }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Could not create group");
      setGroups((current) => [data.group, ...current]);
      setGroupName("");
      setMemberInput("");
      setMembers([]);
      setShowCreate(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create group");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0B0813] text-white px-5 pt-7 pb-28 max-w-md mx-auto">
      <header className="flex items-center gap-4 border-b border-white/10 pb-5 mb-7">
        <Link href="/wallet" className="inline-flex items-center gap-2 py-2 text-sm text-white/55 hover:text-white transition-colors" aria-label="Back to wallet">
          <ArrowLeft className="w-4 h-4 text-white/80" />
          <span>Wallet</span>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-white tracking-tight">Groups</h1>
          <p className="text-xs text-white/45 mt-0.5">Reusable people for recurring splits</p>
        </div>
        {authenticated && (
          <button onClick={() => { setError(null); setShowCreate(true); }} className="inline-flex items-center gap-1 py-2 text-sm font-semibold text-[#AFA3FF] hover:text-white" aria-label="Create group">
            <Plus className="w-5 h-5" />
            <span>New</span>
          </button>
        )}
      </header>

      {!authenticated ? (
        <div className="border-y border-white/10 py-8 text-center">
          <p className="text-sm font-bold text-white mb-1">Connect to manage groups</p>
          <button onClick={login} className="mt-4 px-4 py-2 rounded-lg bg-[#836EF9] text-xs font-semibold">Connect wallet</button>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-white/50 text-center pt-10">Loading your groups...</p>
      ) : groups.length === 0 ? (
        <div className="border-y border-white/10 py-8 text-center">
          <p className="text-sm font-bold text-white">Create your first group</p>
          <p className="text-xs text-white/45 mt-1">Save friends, roommates, or teammates for the next split.</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 px-4 py-2 rounded-lg bg-[#836EF9] text-xs font-semibold">Create group</button>
        </div>
      ) : (
        <div className="divide-y divide-white/10 border-y border-white/10">
          {groups.map((group) => (
            <section key={group.id} className="py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-white truncate">{group.name}</h2>
                  <p className="text-xs text-white/45 mt-1">{group.members.length} saved {group.members.length === 1 ? "member" : "members"}</p>
                </div>
                <Link href={`/split/new?group=${group.id}`} className="shrink-0 py-2 text-xs font-semibold text-[#AFA3FF] hover:text-white">New split</Link>
              </div>
              <p className="text-xs text-white/65 mt-3 truncate">{group.members.map((member) => member.username || `${member.address.slice(0, 6)}...${member.address.slice(-4)}`).join(", ")}</p>
              {group.recentSplits.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#2A2242] text-[11px] text-white/45">
                  <span className="text-white/60">Recent:</span> {group.recentSplits.map((split) => split.title).join(", ")}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#12101A] border border-white/15 rounded-xl max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">New group</h2><button onClick={() => !isCreating && setShowCreate(false)}><X className="w-5 h-5 text-white/50" /></button></div>
            {error && <p className="mb-3 border-l-2 border-red-400 pl-3 py-1 text-xs text-red-200">{error}</p>}
            <label className="text-xs text-white/50 block mb-1">Group name</label>
            <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="House rent" maxLength={80} className="w-full bg-transparent border-b border-white/15 px-0 py-2.5 text-sm text-white outline-none focus:border-[#836EF9]" />
            <label className="text-xs text-white/50 block mt-5 mb-1">Add JANUS username</label>
            <div className="flex gap-2"><input value={memberInput} onChange={(event) => setMemberInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addMember(); } }} placeholder="@vickman" className="min-w-0 flex-1 bg-transparent border-b border-white/15 px-0 py-2.5 text-sm text-white outline-none focus:border-[#836EF9]" /><button onClick={() => void addMember()} disabled={isResolvingMember} className="px-3 text-[#AFA3FF] text-xs font-semibold disabled:opacity-50">Add</button></div>
            {members.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{members.map((member) => <span key={member.address} className="inline-flex items-center gap-1 rounded-lg bg-[#836EF9]/15 px-2 py-1 text-xs text-[#C4B5FD]">{member.username}<button onClick={() => setMembers((current) => current.filter((item) => item.address !== member.address))} aria-label={`Remove ${member.username}`}><X className="w-3 h-3" /></button></span>)}</div>}
            <button onClick={() => void createGroup()} disabled={isCreating} className="mt-5 w-full py-3 rounded-lg bg-[#836EF9] text-sm font-semibold disabled:opacity-50">{isCreating ? "Saving group..." : "Save group"}</button>
          </div>
        </div>
      )}
      <BottomNav />
    </main>
  );
}
