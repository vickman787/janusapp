export function profileProofMessage(
  userId: string,
  walletAddress: string,
  username: string,
  timestamp: number
): string {
  return [
    "JANUS username registration",
    `User: ${userId}`,
    `Wallet: ${walletAddress.toLowerCase()}`,
    `Username: ${username.toLowerCase()}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");
}
