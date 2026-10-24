export function wallGeometry(width: number) {
  const tileWidth = Math.round(Math.min(260, Math.max(140, width * 0.145)));
  const tileHeight = tileWidth * 16 / 9;
  return { tileWidth, tileHeight, stepX: tileWidth * 1.08, stepY: tileHeight + tileWidth * 0.08 };
}
