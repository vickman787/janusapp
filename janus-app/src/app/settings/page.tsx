"use client";

import { useEffect, useState } from "react";
import {
  Copy,
  Check,
  LogOut,
  LogIn,
  ArrowLeft,
  Fingerprint,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { JanusLogo } from "@/components/JanusLogo";
import { BottomNav } from "@/components/BottomNav";
import { getAccessToken, getIdentityToken, useLinkAccount, usePrivy, useSendTransaction, useSignMessage } from "@privy-io/react-auth";
import { profileProofMessage } from "@/lib/profileProof";
import { encodeFunctionData } from "viem";
import {
  AUSD_ADDRESS,
  JANUS_SPLIT_ADDRESS,
  AGORA_FAUCET_ABI,
  AGORA_FAUCET_ADDRESS,
  ensureGas,
  MON_GAS_REQUIRED_MESSAGE,
  publicClient,
} from "@/lib/web3";

export default function SettingsPage() {
  const router = useRouter();
  const { login, logout, authenticated, user } = usePrivy();
  const { linkPasskey } = useLinkAccount();
  const { sendTransaction } = useSendTransaction();
  const { signMessage } = useSignMessage();
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedContract, setCopiedContract] = useState(false);

  // Faucet state
  const [isClaimingFaucet, setIsClaimingFaucet] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState<string | null>(null);
  const [faucetErrorMsg, setFaucetErrorMsg] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [registeredUsername, setRegisteredUsername] = useState<string | null>(null);
  const [usernameMsg, setUsernameMsg] = useState<string | null>(null);
  const [isSavingUsername, setIsSavingUsername] = useState(false);

  const activeAddress = user?.wallet?.address;
  const hasPasskey = user?.linkedAccounts.some((account) => account.type === "passkey") ?? false;

  async function handleDisconnect() {
    await logout();
    router.replace("/");
  }

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
      if (!res.ok) {
        setUsernameMsg("Your saved username could not be loaded right now. Your profile has not been changed.");
        return;
      }
      if (data.profile?.username) {
        setUsername(data.profile.username);
        setRegisteredUsername(data.profile.username);
      } else {
        setRegisteredUsername(null);
      }
    })().catch(() => setUsernameMsg("Your saved username could not be loaded right now. Your profile has not been changed."));
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
    setFaucetErrorMsg(null);
    try {
      if (!(await ensureGas(activeAddress))) {
        setFaucetErrorMsg(MON_GAS_REQUIRED_MESSAGE);
        return;
      }

      const callData = encodeFunctionData({
        abi: AGORA_FAUCET_ABI,
        functionName: "requestFunds",
        args: [activeAddress as `0x${string}`] as const,
      });
      const { hash } = await sendTransaction(
        { to: AGORA_FAUCET_ADDRESS, data: callData, chainId: 10143 },
        { address: activeAddress }
      );
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("AUSD faucet claim reverted");
      setFaucetMsg("+10,000 AUSD Claimed!");
      setTimeout(() => setFaucetMsg(null), 4000);
    } catch (error) {
      setFaucetErrorMsg(error instanceof Error ? error.message : "AUSD faucet claim failed");
    } finally {
      setIsClaimingFaucet(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0B0813] text-white px-5 pt-7 pb-28 max-w-md mx-auto relative flex flex-col justify-between">
      <div>
        <header className="pt-2 pb-6 flex items-center justify-between">
          <Link
            href="/wallet"
            className="inline-flex items-center gap-2 py-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Wallet</span>
          </Link>
          <JanusLogo size={36} showText={true} />
          <div className="w-10" />
        </header>

        {/* ── Active Privy Wallet Address ── */}
        <section className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-white/55">
              Connected account
            </p>
            <span className="text-[10px] font-semibold text-white/50">
              {authenticated ? "Signed in" : "Not connected"}
            </span>
          </div>

          <div className="border-y border-white/10 py-4">
            {authenticated && activeAddress ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 overflow-hidden">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] shrink-0" />
                  <p className="text-white/80 font-mono text-xs truncate">
                    {activeAddress}
                  </p>
                </div>
                <button
                  onClick={handleCopyAddress}
                  className="shrink-0 p-1 text-white/50 hover:text-white transition-colors"
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
                  className="inline-flex items-center gap-2 px-4 py-2 border border-[#836EF9]/60 text-[#C5BCFF] text-xs font-semibold hover:bg-[#836EF9]/10 transition-colors"
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
            <p className="mb-2 text-xs font-semibold text-white/55">
              JANUS username
            </p>
            <div className="border-y border-white/10 py-4">
              <p className="text-xs text-white/50 mb-2">Use this name when inviting you to a split.</p>
              <div className="flex items-center gap-2">
                <span className="text-[#836EF9] font-bold">@</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  readOnly={Boolean(registeredUsername)}
                  placeholder="your_username"
                  maxLength={20}
                  className="flex-1 bg-transparent border-b border-white/15 px-1 py-2 text-sm text-white outline-none focus:border-[#836EF9]"
                />
                <button
                  onClick={handleSaveUsername}
                  disabled={isSavingUsername || Boolean(registeredUsername) || username.length < 3}
                  className="px-3 py-2 text-[#C5BCFF] text-xs font-semibold disabled:opacity-40"
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
        <details className="mb-6 border-t border-white/10 pt-4 text-xs">
          <summary className="cursor-pointer list-none font-semibold text-white/45 hover:text-white/70">
            Network details
          </summary>
          <div className="mt-4 space-y-3 text-xs">
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

            <div className="pt-3 border-t border-white/10">
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

            <div className="pt-3 border-t border-white/10">
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
        </details>

        {/* ── Actions ── */}
        <section className="mb-4">
          <p className="mb-2 text-xs font-semibold text-white/55">
            Account actions
          </p>
          <div className="divide-y divide-white/10 border-y border-white/10">
            {authenticated && (
              <button
                onClick={() => linkPasskey({ name: "JANUS" })}
                disabled={hasPasskey}
                className="flex w-full items-center justify-between gap-6 py-3.5 text-left transition-colors hover:bg-white/[0.02] disabled:cursor-default disabled:hover:bg-transparent"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Fingerprint className="h-4 w-4 shrink-0 text-[#A78BFA]" />
                  <div className="min-w-0">
                    <span className="block text-sm font-medium text-white">
                      Passkey
                    </span>
                    <span className="mt-0.5 block text-xs text-white/40">
                      {hasPasskey
                        ? "Registered for password-free sign in"
                        : "Use your fingerprint, face, or device PIN"}
                    </span>
                  </div>
                </div>
                <span className={`shrink-0 text-xs font-semibold ${hasPasskey ? "text-[#10B981]" : "text-[#A78BFA]"}`}>
                  {hasPasskey ? "Ready" : "Add passkey"}
                </span>
              </button>
            )}

            {/* Claim Faucet Button */}
            <button
              onClick={handleClaimFaucet}
              disabled={isClaimingFaucet}
              className="flex w-full items-center justify-between gap-6 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
            >
              <div className="min-w-0">
                  <span className="block text-sm font-medium text-white">
                    Add test funds
                  </span>
                  <span className="mt-0.5 block text-xs text-white/40">
                    Receive 10,000 AUSD for testing
                  </span>
              </div>
              {isClaimingFaucet ? (
                <Loader2 className="w-4 h-4 text-[#10B981] animate-spin" />
              ) : faucetMsg ? (
                <span className="shrink-0 text-xs font-medium text-[#10B981]">
                  {faucetMsg}
                </span>
              ) : (
                <span className="shrink-0 text-xs font-semibold text-[#A78BFA]">
                  Add funds
                </span>
              )}
            </button>
            {faucetErrorMsg && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-xs leading-5 text-amber-300">
                <span>{faucetErrorMsg}</span>
                {faucetErrorMsg === MON_GAS_REQUIRED_MESSAGE && (
                  <a
                    href="https://faucet.monad.xyz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#A78BFA] underline underline-offset-2 hover:text-white"
                  >
                    Get testnet MON ↗
                  </a>
                )}
              </div>
            )}

            {/* Privy Disconnect */}
            {authenticated ? (
              <button
                onClick={handleDisconnect}
                className="flex w-full items-center justify-between py-3.5 text-left text-red-300/75 transition-colors hover:text-red-300"
              >
                <span className="text-sm font-medium">Disconnect account</span>
                <LogOut className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </section>
      </div>

      {/* Build info */}
      <div className="text-center mt-6">
        <p className="text-white/30 text-xs">
          JANUS Consumer Payments
        </p>
      </div>

      <BottomNav />
    </main>
  );
}
