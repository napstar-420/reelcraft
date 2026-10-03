/** How an enum option is shown in a generated form: "transcribe_align" →
 * "Transcribe align". The stored value is unchanged; numbers show as they are. */
export function enumOptionLabel(option: string | number): string {
  if (typeof option === 'number') return String(option);
  const words = option.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
