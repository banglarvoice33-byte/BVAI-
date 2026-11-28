// Prints 0..99 so an editor can check every spelling once: node pipeline/print-bn-numbers.mjs
import { WORDS_0_99 } from './bn-speech.mjs';
WORDS_0_99.forEach((w, i) => console.log(`${String(i).padStart(2, ' ')}  ${w}`));
