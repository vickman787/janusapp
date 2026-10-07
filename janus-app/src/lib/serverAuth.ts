import {
  PrivyClient,
  verifyAccessToken,
  verifyIdentityToken,
  type VerifyAccessTokenResponse,
} from "@privy-io/node";
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader } from "jose";

const appId = (process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID)
  ?.trim()
  .replace(/^['"]|['"]$/g, "");
const apiUrl = process.env.PRIVY_API_BASE_URL || "https://api.privy.io";
const appSecret = process.env.PRIVY_APP_SECRET
  ?.trim()
  .replace(/^['"]|['"]$/g, "");

let appJwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let privyClient: PrivyClient | undefined;

function getAppJwks() {
  if (!appId) throw new Error("PRIVY_APP_ID is not configured");
  if (!appJwks) {
    appJwks = createRemoteJWKSet(
      new URL(`${apiUrl}/v1/apps/${appId}/jwks.json`)
    );
  }
  return appJwks;
}

function getPrivyClient() {
  if (!appId || !appSecret) return undefined;
  if (!privyClient) {
    privyClient = new PrivyClient({ appId, appSecret, apiUrl });
  }
  return privyClient;
}

export interface AuthenticatedPrivyUser {
  userId: string;
  accessToken: VerifyAccessTokenResponse;
  walletAddresses: string[];
}

export async function authenticatePrivyRequest(
  req: Request
): Promise<AuthenticatedPrivyUser | null> {
  const authorization = req.headers.get("authorization") || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken || !appId) return null;

  try {
    const key = getAppJwks();
    const verifiedAccessToken = await verifyAccessToken({
      access_token: accessToken,
      app_id: appId,
      verification_key: key,
    });

    const identityToken = req.headers.get("x-privy-identity-token");
    let walletAddresses: string[] = [];
    if (identityToken) {
      const user = await verifyIdentityToken({
        identity_token: identityToken,
        app_id: appId,
        verification_key: key,
      });
      if (user.id !== verifiedAccessToken.user_id) return null;
      walletAddresses = user.linked_accounts
        .filter(
          (account) =>
            (account as { chain_type?: string }).chain_type === "ethereum" &&
            "address" in account
        )
        .map((account) => (account as { address: string }).address.toLowerCase());
    } else {
      const client = getPrivyClient();
      if (client) {
        try {
          const user = await client.users()._get(verifiedAccessToken.user_id);
          walletAddresses = user.linked_accounts
            .filter(
              (account) =>
                (account as { chain_type?: string }).chain_type === "ethereum" &&
                "address" in account
            )
            .map((account) => (account as { address: string }).address.toLowerCase());
        } catch (error) {
          console.warn(
            "Privy user lookup failed:",
            error instanceof Error ? error.message : "unknown error"
          );
        }
      }
    }

    if (walletAddresses.length === 0) {
      console.warn("Privy request has no verified Ethereum wallet", {
        hasIdentityToken: Boolean(identityToken),
        userIdPrefix: verifiedAccessToken.user_id.slice(0, 16),
      });
    }

    return {
      userId: verifiedAccessToken.user_id,
      accessToken: verifiedAccessToken,
      walletAddresses,
    };
  } catch (error) {
    let tokenDiagnostics: Record<string, unknown> = {};
    try {
      const claims = decodeJwt(accessToken);
      tokenDiagnostics = {
        algorithm: decodeProtectedHeader(accessToken).alg,
        issuer: claims.iss,
        audience: claims.aud,
        subjectPrefix:
          typeof claims.sub === "string" ? claims.sub.slice(0, 12) : undefined,
        expired:
          typeof claims.exp === "number" ? claims.exp * 1000 <= Date.now() : "unknown",
      };
    } catch {
      tokenDiagnostics = { tokenFormat: "not-a-decodable-jwt" };
    }
    console.warn(
      "Privy authentication failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
      {
        appIdPrefix: appId?.slice(0, 6),
        appIdLength: appId?.length,
        ...tokenDiagnostics,
      }
    );
    return null;
  }
}

export function walletBelongsToUser(
  user: AuthenticatedPrivyUser,
  address: string
): boolean {
  return user.walletAddresses.includes(address.toLowerCase());
}
