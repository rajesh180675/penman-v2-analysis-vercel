export default function unsupportedDomRasterizer(): never {
  throw new Error(
    "DOM raster PDF rendering is disabled. Use the versioned semantic report renderer.",
  );
}
