// Keeps the Photos live tile in sync when pictures are added or removed (camera, imports, screenshots…).
export default function start(os) {
  const refresh = os.util.debounce(() => { if (os.tiles.isPinned('photos') || os.tiles.layout?.().some((t) => t.id === 'photos')) os.tiles.refresh('photos'); }, 1500);
  os.fs.on('change', ({ path }) => { if (path.startsWith('/Pictures') || /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(path)) refresh(); });
}
