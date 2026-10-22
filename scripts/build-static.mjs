// Build dell'app statica per il deploy: public/ resta il sorgente leggibile
// (quello che si modifica a mano), dist/ è l'output pubblicato da Netlify.
//
// L'unica trasformazione è la minificazione dello script principale di
// public/index.html con terser. Niente altro cambia: niente rinominazione di
// funzioni globali (mangle.toplevel resta false, il default di terser) — è
// essenziale perché l'HTML richiama moltissime funzioni per nome tramite
// onclick="nomeFunzione(...)", che smetterebbero di funzionare se quei nomi
// venissero rinominati.
import { readFile, writeFile, rm, mkdir, cp, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'public');
const OUT = join(ROOT, 'dist');

// Marcatori usati per isolare lo script principale dentro index.html, senza
// toccare il resto del file (preload incorporato, altri <script> esterni,
// CSS, markup). Se questi marcatori non si trovano più — perché qualcuno ha
// riscritto l'inizio del file — il build si ferma invece di produrre un
// index.html silenziosamente rotto o non minificato.
const SCRIPT_START_MARKER = 'let S = {}; // main state';
const SCRIPT_END_MARKER = '</script>';

async function buildIndexHtml() {
  const srcPath = join(SRC, 'index.html');
  const html = await readFile(srcPath, 'utf8');

  const start = html.indexOf(SCRIPT_START_MARKER);
  if (start === -1) {
    throw new Error(
      `build-static: marcatore di inizio script non trovato in index.html ("${SCRIPT_START_MARKER}"). ` +
      'Lo script è stato spostato o riscritto: aggiorna SCRIPT_START_MARKER in scripts/build-static.mjs.'
    );
  }
  const end = html.indexOf(SCRIPT_END_MARKER, start);
  if (end === -1) {
    throw new Error('build-static: tag di chiusura </script> non trovato dopo il marcatore di inizio.');
  }

  const originalScript = html.slice(start, end);
  const result = await minify(originalScript, {
    compress: true,
    mangle: true, // toplevel resta false (default): i nomi globali non si toccano
  });
  if (!result.code) {
    throw new Error('build-static: terser non ha prodotto output (controlla eventuali errori di sintassi).');
  }

  const minifiedHtml = html.slice(0, start) + result.code + html.slice(end);
  await writeFile(join(OUT, 'index.html'), minifiedHtml, 'utf8');

  const before = Buffer.byteLength(originalScript, 'utf8');
  const after = Buffer.byteLength(result.code, 'utf8');
  console.log(
    `build-static: index.html minificato (script ${before} -> ${after} byte, ` +
    `-${before - after} byte, -${(100 * (before - after) / before).toFixed(1)}%)`
  );
}

async function copyRest() {
  const entries = await readdir(SRC, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'index.html') continue; // già gestito sopra
    await cp(join(SRC, entry.name), join(OUT, entry.name), { recursive: true });
  }
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await copyRest();
  await buildIndexHtml();
  console.log('build-static: completato ->', OUT);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
