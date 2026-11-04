import { countTokens as o200k } from 'gpt-tokenizer/encoding/o200k_base';

/** Token count with the o200k_base tokenizer (GPT-4o family). A proxy for other models. */
export function countTokens(s: string): number {
  return o200k(s);
}
