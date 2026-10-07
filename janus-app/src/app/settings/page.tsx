"use client";

import { useEffect, useState } from "react";
import {
  Copy,
  Check,
  LogOut,
  LogIn,
  ArrowLeft,
  Droplets,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { JanusLogo } from "@/components/JanusLogo";
import { getAccessToken, getIdentityToken, usePrivy, useSignMessage } from "@privy-io/react-auth";
import { profileProofMessage } from "@/lib/profileProof";
import {
  AUSD_ADDRESS,
  JANUS_SPLIT_ADDRESS,
  AGORA_FAUCET_ADDRESS,
} from "@/lib/web3";

export default function SettingsPage() {
  const { login, logout, authenticated, user } = usePrivy();
  const { signMessage } = useSignMessage();
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedContract, setCopiedContract] = useState(false);

  // Faucet state
  const [isClaimingFaucet, setIsClaimingFaucet] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [registeredUsername, setRegisteredUsername] = useState<string | null>(null);
  const [usernameMsg, setUsernameMsg] = useState<string | null>(null);
  const [isSavingUsername, setIsSavingUsername] = useState(false);

  const activeAddress = user?.wallet?.address;

  useEffect(() => {
    if (!authenticated || !activeAddress) return;
    (async () => {
      const [accessToken, identityToken] = await Promise.all([getAccessToken(), getIdentityToken()]);
      const res = await fetch(`/api/profiles?address=${encodeURIComponent(activeAddress)}`, {
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(identityToken ? { "X-Privy-Identity-Token": identityToken } : {}),
        },
      });
      const data = await res.json();
      if (data.profile?.username) {
        setUsername(data.profile.username);
        setRegisteredUsername(data.profile.username);
      } else {
        setRegisteredUsername(null);
      }
    })().catch(() => undefined);
  }, [authenticated, activeAddress]);

  async function handleSaveUsername() {
    if (!activeAddress || !user?.id || registeredUsername) return;
    setIsSavingUsername(true);
    setUsernameMsg(null);
    try {
      const [accessToken, identityToken] = await Promise.all([getAccessToken(), getIdentityToken()]);
      const proofTimestamp = Date.now();
      const proofMessage = profileProofMessage(user.id, activeAddress, username, proofTimestamp);
      const proof = await signMessage({ message: proofMessage }, { address: activeAddress });
      const res = await fetch("/api/profiles", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(identityToken ? { "X-Privy-Identity-Token": identityToken } : {}),
        },
        body: JSON.stringify({
          address: activeAddress,
          username,
          proofTimestamp,
          proofSignature: proof.signature,
        }),
      });
      const data = await res.json();
      if (data.success) setRegisteredUsername(data.profile.username);
      setUsernameMsg(data.success ? `Username saved as @${data.profile.username}` : data.error || "Could not save username");
    } catch {
      setUsernameMsg("Could not connect to the profile service");
    } finally {
      setIsSavingUsername(false);
    }
  }

  function handleCopyAddress() {
    if (!activeAddress) return;
    navigator.clipboard.writeText(activeAddress).then(() => {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    });
  }

  function handleCopyContract() {
    navigator.clipboard.writeText(JANUS_SPLIT_ADDRESS).then(() => {
      setCopiedContract(true);
      setTimeout(() => setCopiedContract(false), 2000);
    });
  }

  async function handleClaimFaucet() {
    if (!authenticated || !activeAddress) {
      login();
      return;
    }
    if (isClaimingFaucet) return;
    setIsClaimingFaucet(true);
    setFaucetMsg(null);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: activeAddress }),
      });
      const data = await res.json();
      if (data.success) {
        setFaucetMsg("+10,000 AUSD Claimed!");
        setTimeout(() => setFaucetMsg(null), 4000);
      } else {
        alert(data.error || "Failed to claim");
      }
    } catch {
      alert("Error contacting faucet");
    } finally {
      setIsClaimingFaucet(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0B0813] text-white px-5 pt-7 pb-12 max-w-md mx-auto relative flex flex-col justify-between">
      <div>
        <header className="pt-2 pb-6 flex items-center justify-between">
          <Link
            href="/"
            className="w-10 h-10 rounded-full bg-[#161224] border border-[#2A2242] flex items-center justify-center hover:border-[#836EF9]/50 transition-colors shadow-sm"
          >
            <ArrowLeft className="w-5 h-5 text-white/70" />
          </Link>
          <JanusLogo size={36} showText={true} />
          <div className="w-10" />
        </header>

        {/* ── Active Privy Wallet Address ── */}
        <section className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">
              Connected Wallet Address
            </p>
            <span className="text-[10px] font-semibold text-[#836EF9] bg-[#836EF9]/10 px-2 py-0.5 rounded-full border border-[#836EF9]/30">
              {authenticated ? "Privy Session Active" : "Not Connected"}
            </span>
          </div>

          <div className="bg-[#161224]/90 border border-[#2A2242] rounded-2xl p-4 shadow-sm">
            {authenticated && activeAddress ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 overflow-hidden">
                  <div className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse shrink-0" />
                  <p className="text-white/80 font-mono text-xs truncate">
                    {activeAddress}
                  </p>
                </div>
                <button
                  onClick={handleCopyAddress}
                  className="shrink-0 w-8 h-8 rounded-lg bg-[#836EF9]/15 hover:bg-[#836EF9]/25 flex items-center justify-center transition-colors text-[#836EF9]"
                  title="Copy Address"
                >
                  {copiedAddress ? (
                    <Check className="w-4 h-4 text-[#10B981]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="text-xs text-white/50 mb-3">
                  Connect your wallet, email, Google, or passkey via Privy
                </p>
                <button
                  onClick={login}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#836EF9] to-[#A0055D] text-white text-xs font-bold shadow-[0_2px_12px_rgba(131,110,249,0.35)] hover:opacity-95 transition-opacity"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Connect / Sign In</span>
                </button>
              </div>
            )}
          </div>
        </section>

        {authenticated && activeAddress && (
          <section className="mb-4">
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
              JANUS Username
            </p>
            <div className="bg-[#161224]/90 border border-[#2A2242] rounded-2xl p-4 shadow-sm">
              <p className="text-xs text-white/50 mb-2">Use this name when inviting you to a split.</p>
              <div className="flex items-center gap-2">
                <span className="text-[#836EF9] font-bold">@</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  readOnly={Boolean(registeredUsername)}
                  placeholder="your_username"
                  maxLength={20}
                  className="flex-1 bg-[#0B0813] border border-[#2A2242] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#836EF9]"
                />
                <button
                  onClick={handleSaveUsername}
                  disabled={isSavingUsername || Boolean(registeredUsername) || username.length < 3}
                  className="px-3 py-2 rounded-xl bg-[#836EF9]/20 text-[#A78BFA] text-xs font-bold disabled:opacity-40"
                >
                  {isSavingUsername ? "Saving" : "Save"}
                </button>
              </div>
              {registeredUsername && <p className="text-xs text-white/50 mt-2">This name is linked to your wallet.</p>}
              {usernameMsg && <p className="text-xs text-white/60 mt-2">{usernameMsg}</p>}
            </div>
          </section>
        )}

        {/* ── Deployed Contracts on Monad Testnet ── */}
        <section className="mb-4">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
            On-Chain Deployments (Monad Testnet)
          </p>
          <div className="bg-[#161224]/90 border border-[#2A2242] rounded-2xl p-4 space-y-3 shadow-sm text-xs">
            <div>
              <span className="text-white/40 block mb-0.5">
                JanusSplit Settler Contract
              </span>
              <div className="flex items-center justify-between">
                <a
                  href={`https://testnet.monadscan.com/address/${JANUS_SPLIT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-white/90 hover:text-[#836EF9] underline underline-offset-2 truncate"
                >
                  {JANUS_SPLIT_ADDRESS}
                </a>
                <button
                  onClick={handleCopyContract}
                  className="ml-2 text-white/40 hover:text-white"
                >
                  {copiedContract ? (
                    <Check className="w-3.5 h-3.5 text-[#10B981]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-[#2A2242]/60">
              <span className="text-white/40 block mb-0.5">
                Agora AUSD Token (6 decimals)
              </span>
              <a
                href={`https://testnet.monadscan.com/address/${AUSD_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-white/80 hover:text-[#836EF9] truncate block"
              >
                {AUSD_ADDRESS}
              </a>
            </div>

            <div className="pt-2 border-t border-[#2A2242]/60">
              <span className="text-white/40 block mb-0.5">
                Agora Faucet Contract
              </span>
              <a
                href={`https://testnet.monadscan.com/address/${AGORA_FAUCET_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-white/80 hover:text-[#836EF9] truncate block"
              >
                {AGORA_FAUCET_ADDRESS}
              </a>
            </div>
          </div>
        </section>

        {/* ── Actions ── */}
        <section className="mb-4">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
            Wallet & Faucet Actions
          </p>
          <div className="bg-[#161224]/90 border border-[#2A2242] rounded-2xl overflow-hidden divide-y divide-[#2A2242] shadow-sm">
            {/* Claim Faucet Button */}
            <button
              onClick={handleClaimFaucet}
              disabled={isClaimingFaucet}
              className="w-full flex items-center justify-between p-4 hover:bg-[#1E1833]/60 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <Droplets className="w-4 h-4 text-[#10B981]" />
                <div>
                  <span className="text-sm font-medium text-white block">
                    Claim 10,000 Agora AUSD
                  </span>
                  <span className="text-[10px] text-white/40">
                    Direct on-chain faucet drip to your address
                  </span>
                </div>
              </div>
              {isClaimingFaucet ? (
                <Loader2 className="w-4 h-4 text-[#10B981] animate-spin" />
              ) : faucetMsg ? (
                <span className="text-xs font-bold text-[#10B981]">
                  {faucetMsg}
                </span>
              ) : (
                <span className="text-xs font-bold text-[#10B981] bg-[#10B981]/15 px-2 py-1 rounded-lg">
                  Claim
                </span>
              )}
            </button>

            {/* Privy Login / Disconnect */}
            {authenticated ? (
              <button
                onClick={logout}
                className="w-full flex items-center justify-between p-4 hover:bg-[#1E1833]/60 transition-colors text-left text-[#A0055D]"
              >
                <div className="flex items-center gap-3">
                  <LogOut className="w-4 h-4" />
                  <span className="text-sm font-medium">Disconnect Wallet</span>
                </div>
              </button>
            ) : (
              <button
                onClick={login}
                className="w-full flex items-center justify-between p-4 hover:bg-[#1E1833]/60 transition-colors text-left text-[#836EF9]"
              >
                <div className="flex items-center gap-3">
                  <LogIn className="w-4 h-4" />
                  <span className="text-sm font-medium">Connect with Privy</span>
                </div>
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Build info */}
      <div className="text-center mt-6">
        <p className="text-white/30 text-xs">
          Janus v0.1.0 · Monad Metropolis Hackathon 2026
        </p>
      </div>
    </main>
  );
}
