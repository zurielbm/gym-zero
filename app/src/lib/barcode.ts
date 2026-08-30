// prepareZXingModule must come from barcode-detector, NOT zxing-wasm: the
// ponyfill bundles its own copy of the zxing runtime with its own module
// registry, and configuring zxing-wasm's registry leaves the ponyfill on its
// default CDN loader. The .wasm asset itself comes from the zxing-wasm
// package, which barcode-detector pins to an exact version — keep our
// package.json pin identical so glue and binary never drift apart.
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

/**
 * WASM-backed BarcodeDetector (zxing) used on every browser — iOS Safari has
 * no native one, and using the ponyfill everywhere keeps one code path with
 * identical format support.
 *
 * The decoder's .wasm ships in our own bundle instead of the default jsDelivr
 * CDN, so scanning works offline and on tailnet-only deployments.
 */
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
})

/** QR for machines + the 1D formats food packaging uses. */
export const createScanDetector = () =>
  new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e'] })
