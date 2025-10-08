export type CharFrequency = Map<string, number>;

export function buildFrequency(text: string): CharFrequency {
  const frequency = new Map<string, number>();
  for (const ch of text) {
    frequency.set(ch, (frequency.get(ch) ?? 0) + 1);
  }
  return frequency;
}

export function subtractFrequency(sourceFreq: CharFrequency, targetText: string): boolean {
  for (const ch of targetText) {
    const currentCount = sourceFreq.get(ch);
    if (currentCount === undefined) {
      return false;
    }
    if (currentCount === 1) {
      sourceFreq.delete(ch);
    } else {
      sourceFreq.set(ch, currentCount - 1);
    }
  }
  return true;
}
