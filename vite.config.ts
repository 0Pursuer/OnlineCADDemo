import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import topLevelAwait from "vite-plugin-top-level-await";

// NOTE: vite-plugin-wasm is NOT used here because OpenCascade.js uses Emscripten's
// dynamic library loading (loadDynamicLibrary) which requires WASM modules to have
// special imports (env, GOT.func, GOT.mem) that vite-plugin-wasm cannot handle.
// Instead, WASM files are served from the public/ directory and loaded by Emscripten natively.

/**
 * Vite plugin to patch replicad for opencascade.js 2.0.0-beta compatibility.
 * 
 * Problem: replicad 0.20.5 calls `.Build(progress)` and `.Perform(progress)`
 * with a Message_ProgressRange argument, but opencascade.js 2.0.0-beta's 
 * Emscripten bindings expect these methods with 0 arguments.
 * 
 * Solution: Transform replicad's source code during bundling to remove
 * the progress argument from all .Build() and .Perform() calls.
 */
function patchReplicadForOCCT(): Plugin {
  return {
    name: 'patch-replicad-occt-compat',
    enforce: 'pre',
    transform(code, id) {
      // Only transform replicad's bundle
      if (!id.includes('replicad') || !id.endsWith('.js')) {
        return null;
      }

      let patched = code;
      let patchCount = 0;

      // Aggressive Pattern 1: .Build(...) with any number of arguments/whitespace
      // Matches .Build(progress), .Build(  progress  ), .Build(\n progress \n), etc.
      const buildRegex = /\.Build\s*\(\s*[^)]+\s*\)/g;
      patched = patched.replace(buildRegex, (match) => {
        patchCount++;
        return '.Build()';
      });

      // Aggressive Pattern 2: .Perform(...) with any arguments
      const performRegex = /\.Perform\s*\(\s*[^)]+\s*\)/g;
      patched = patched.replace(performRegex, (match) => {
        patchCount++;
        return '.Perform()';
      });

      // Aggressive Pattern 3: BRepAlgoAPI constructor calls with progress argument
      // new oc.BRepAlgoAPI_Fuse_3(a, b, progress) -> new oc.BRepAlgoAPI_Fuse_3(a, b)
      const algoRegex = /(new\s+(?:this\.)?oc\.BRepAlgoAPI_(?:Fuse|Cut|Common)_3\s*\([^)]*?),\s*[^)]+?\s*\)/g;
      patched = patched.replace(algoRegex, (match, prefix) => {
        patchCount++;
        return prefix + ')';
      });

      if (patchCount > 0) {
        console.log(`\x1b[32m[patch-replicad]\x1b[0m Patched ${patchCount} calls in ${id}`);
        return { code: patched, map: null };
      }

      // Pattern 4: MakeThickSolidByJoin and similar with trailing progress arg
      // These multi-line calls pass `progress` as the last argument
      patched = patched.replace(
        /,\s*\n?\s*progress\s*\n?\s*\)/g,
        (match) => {
          // Only patch if it looks like a trailing argument
          patchCount++;
          return '\n    )';
        }
      );

      if (patchCount > 0) {
        console.log(`[patch-replicad] Patched ${patchCount} OCCT API calls in ${id.split('/').pop()}`);
        return { code: patched, map: null };
      }

      return null;
    }
  };
}

export default defineConfig({
  plugins: [
    patchReplicadForOCCT(),
    react(),
    topLevelAwait(),
  ],
  worker: {
    format: 'es',
    plugins: () => [
      patchReplicadForOCCT(),
      topLevelAwait(),
    ],
  },
  optimizeDeps: {
    exclude: ['opencascade.js', 'replicad']
  },
  server: {
    headers: {
      // Essential for SharedArrayBuffer support in browsers
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  build: {
    target: 'esnext'
  },
  assetsInclude: ['**/*.wasm']
});
