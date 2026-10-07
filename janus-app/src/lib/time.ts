export function currentTimestamp(): number {
  return Date.now();
}

export function newSplitSeed(): string {
  return `janus-split-${crypto.randomUUID()}`;
}
